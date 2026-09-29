/**
 * userData 目录改名迁移：`%APPDATA%\可视化编辑器` → `%APPDATA%\webedit`（P3.5 / ARCHITECTURE §6.10，决策 #14）。
 *
 * 用户 2026-09-28 的决定是**移动**（不是复制）——当时判断"没有存量用户，直接移动最干净"。
 * 但"移动"必须有保险，所以本模块按规格实现四道闸：
 *
 *   ① 移动**前**建清单：相对路径 + 字节数（+ 数据文件 SHA-256）；
 *   ② 移动用 `rename`（同盘符 = 原子操作，瞬时），失败（跨卷/权限/被占用）时退回
 *      **复制 → 复核 → 删源**（仍然只在复核通过后才删源）；
 *   ③ 移动后**复核清单**：文件数 + 字节数 + 关键文件哈希全一致 → 写迁移标记（时间/来源/文件数）；
 *      复核失败 → **移回去（回退）** 并报错，绝不留"半迁移"状态；
 *   ④ **幂等**：已迁移（新目录有标记且清单齐全）→ 什么都不做；两边都有数据却都没标记 → 报冲突、
 *      **一个字节都不动**（这种状态需要人来看，脚本不许自作主张）。
 *
 * 只依赖 `node:fs`/`node:crypto`，不 import electron —— 这样 verify 与自检能在纯 Node 下把它跑透。
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 迁移标记文件名（写在**新**目录里） */
export const MIGRATION_MARKER = 'migration.json';
/** 旧目录默认名（中文品牌名，改名前的 userData 目录） */
export const LEGACY_USER_DATA_NAME = '可视化编辑器';

/** 递归列出目录下所有文件（返回相对路径，正斜杠，已排序；空目录不列） */
export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(relative(root, p).split('\\').join('/'));
    }
  };
  walk(root);
  return out.sort();
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Chromium 自己的缓存目录/文件：迁移时**照样移动**（保持"移动"语义、不丢东西），
 * 但**不参与哈希复核** —— 它们随时在变，钉死哈希会让复核永远失败。
 */
const VOLATILE = [
  /^Cache\//,
  /^Code Cache\//,
  /^GPUCache\//,
  /^Dawn[A-Za-z]*Cache\//,
  /^blob_storage\//,
  /^Network\//,
  /^Session Storage\//,
  /^Local Storage\//,
  /^Shared Dictionary\//,
  /^Dictionaries\//,
  /^Preferences$/,
  /^declarative_performance_observer\.db/,
  /^Local State$/,
  /^Singleton/,
];
const isVolatile = (rel) => VOLATILE.some((re) => re.test(rel));

/**
 * 建清单。返回 `{ files, bytes, hashes }`：
 *   · `files` 相对路径列表（用于"文件数一致"）；
 *   · `bytes` 总字节（用于"体积一致"）；
 *   · `hashes` 关键文件（**非易变**文件，且 ≤ 4MB）的 SHA-256 —— 数据文件的真凭实据。
 */
export function buildManifest(root) {
  const files = listFiles(root);
  let bytes = 0;
  const hashes = {};
  for (const rel of files) {
    const size = statSync(join(root, rel)).size;
    bytes += size;
    if (!isVolatile(rel) && size <= 4 * 1024 * 1024) hashes[rel] = sha256(join(root, rel));
  }
  return { files, bytes, hashes };
}

/**
 * 用清单复核目录。返回 `{ ok, reasons }`；`reasons` 为空即通过。
 * 注意：易变（Chromium 缓存）文件**只比数量、不比哈希**。
 */
export function verifyAgainst(root, manifest) {
  const reasons = [];
  if (!existsSync(root)) return { ok: false, reasons: ['目标目录不存在'] };
  const actual = listFiles(root);
  if (actual.length !== manifest.files.length) {
    reasons.push(`文件数不一致：清单 ${manifest.files.length}，实际 ${actual.length}`);
  }
  let bytes = 0;
  for (const rel of actual) {
    try {
      bytes += statSync(join(root, rel)).size;
    } catch {
      reasons.push(`读不到：${rel}`);
    }
  }
  if (bytes !== manifest.bytes) reasons.push(`总字节不一致：清单 ${manifest.bytes}，实际 ${bytes}`);
  for (const [rel, want] of Object.entries(manifest.hashes)) {
    try {
      const got = sha256(join(root, rel));
      if (got !== want) reasons.push(`哈希不一致：${rel}`);
    } catch {
      reasons.push(`关键文件缺失：${rel}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** 读迁移标记（不存在/坏 JSON 都当"没有"） */
export function readMarker(newDir) {
  try {
    const j = JSON.parse(readFileSync(join(newDir, MIGRATION_MARKER), 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

/**
 * 执行迁移。**绝不抛异常**（调用方在启动路径上，迁移失败不该让应用起不来）；
 * 一切结果都通过返回值表达，由调用方写日志/弹提示条。
 *
 * @param {object} o
 * @param {string} o.oldDir          旧 userData 目录（`%APPDATA%\可视化编辑器`）
 * @param {string} o.newDir          新 userData 目录（`%APPDATA%\webedit`）
 * @param {(msg: string, level?: string) => void} [o.log]
 * @param {(dir: string, manifest: object) => {ok: boolean, reasons: string[]}} [o.verify]
 *        复核函数（默认 `verifyAgainst`）。留这个缝是为了**能真测"复核失败 → 回退"** ——
 *        否则那条路径只能靠读代码相信。
 * @returns {{status: 'noop'|'moved'|'copy-moved'|'rolled-back'|'conflict'|'skipped', detail: string, files?: number, bytes?: number, marker?: object}}
 */
export function migrateUserData({ oldDir, newDir, log, verify = verifyAgainst } = {}) {
  const say = (m, l = 'info') => log?.(m, l);
  if (!oldDir || !newDir) return { status: 'skipped', detail: '缺少 oldDir/newDir' };

  const oldOk = existsSync(oldDir);
  const newOk = existsSync(newDir);
  const marker = newOk ? readMarker(newDir) : null;

  /* ① 幂等：新目录已迁移过 → 什么都不做 */
  if (newOk && marker) {
    return { status: 'noop', detail: `已迁移过（${marker.migratedAt ?? '?'}，来自 ${marker.from ?? '?'}）`, files: marker.files, marker };
  }
  /* ② 没有旧目录 → 新装/已迁移，什么都不做 */
  if (!oldOk) return { status: 'noop', detail: '没有旧目录，无需迁移' };
  /* ③ 两边都有数据却没有标记 → 冲突，一个字节都不动（要人来看） */
  if (open_hasData(newDir) && open_hasData(oldDir)) {
    return { status: 'conflict', detail: `旧目录与新目录都有数据且无迁移标记：${oldDir} / ${newDir}。未做任何改动，请人工确认。` };
  }

  const manifest = buildManifest(oldDir);
  say(`准备迁移 userData：${oldDir} → ${newDir}（${manifest.files.length} 个文件，${(manifest.bytes / 1024 / 1024).toFixed(1)} MB）`);

  /* ④ 先试原子移动 */
  let mode = 'move';
  try {
    mkdirSync(join(newDir, '..'), { recursive: true });
    if (existsSync(newDir)) rmSync(newDir, { recursive: true, force: true }); // 空目录/半成品：清掉再挪
    renameSync(oldDir, newDir);
  } catch (e) {
    mode = 'copy';
    say(`rename 失败（${e.code ?? e.message}）→ 退回"复制 + 复核 + 删源"`, 'warn');
    try {
      cpSync(oldDir, newDir, { recursive: true });
    } catch (e2) {
      // 复制都起不来：清掉半成品，保持"未迁移"
      try {
        rmSync(newDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return { status: 'rolled-back', detail: `复制失败：${e2.message}（旧目录未动）` };
    }
  }

  /* ⑤ 复核；不过就回退 */
  const check = verify(newDir, manifest);
  if (!check.ok) {
    say(`迁移复核失败：${check.reasons.join('；')} → 回退`, 'error');
    try {
      if (mode === 'move') {
        if (existsSync(oldDir)) rmSync(oldDir, { recursive: true, force: true });
        renameSync(newDir, oldDir);
      } else {
        rmSync(newDir, { recursive: true, force: true }); // 复制模式：删掉半成品即可，旧目录一直在
      }
    } catch (e) {
      return { status: 'rolled-back', detail: `复核失败且回退未完成：${check.reasons.join('；')}；回退错误 ${e.message}` };
    }
    return { status: 'rolled-back', detail: `复核失败已回退（旧目录完好）：${check.reasons.join('；')}` };
  }

  /* 复制模式：**复核通过之后**才删源（规格：跨卷失败回退到"复制 + 复核 + 删源"；
     删源失败不算迁移失败 —— 数据已在目标且已复核，只是旧目录还占着空间，如实报出来即可）。 */
  let sourceRemoved = mode === 'move'; // move 模式下 rename 已经把源"移"走了
  if (mode === 'copy') {
    try {
      rmSync(oldDir, { recursive: true, force: true });
      sourceRemoved = true;
    } catch (e) {
      say(`数据已就位并复核通过，但旧目录删不掉（${e.message}）—— 可手动删除：${oldDir}`, 'warn');
    }
  }

  const result = {
    status: mode === 'move' ? 'moved' : 'copy-moved',
    detail:
      `${mode === 'move' ? '已移动' : '已复制并删除源'} ${manifest.files.length} 个文件 / ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB，复核通过` +
      (sourceRemoved ? '' : '；旧目录未能删除（数据已就位，可手动清理）'),
    files: manifest.files.length,
    bytes: manifest.bytes,
    marker: {
      migratedAt: new Date().toISOString(),
      from: oldDir,
      to: newDir,
      mode,
      files: manifest.files.length,
      bytes: manifest.bytes,
      /** 关键文件的哈希（复核用的"真凭实据"，也留作以后自查） */
      keyHashes: Object.fromEntries(Object.entries(manifest.hashes).slice(0, 200)),
    },
  };
  try {
    writeFileSync(join(newDir, MIGRATION_MARKER), `${JSON.stringify(result.marker, null, 2)}\n`, 'utf8');
  } catch (e) {
    // 标记写不上不算迁移失败（数据已就位且在复核之后），但要说清楚——否则下次会走"冲突"分支
    say(`迁移完成但标记写不上：${e.message}`, 'warn');
  }
  return result;
}

/** 目录是否存在且非空（只看顶层，够用且快） */
function open_hasData(dir) {
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}
