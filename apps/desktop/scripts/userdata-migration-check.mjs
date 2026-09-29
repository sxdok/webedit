/**
 * userData 改名迁移的**自检**（P3.5）：把 `src/userDataMigration.js` 的每条路径都真跑一遍，
 * 全部在临时目录里做，**不碰真实用户数据**。
 *
 *   node apps/desktop/scripts/userdata-migration-check.mjs
 *
 * 覆盖：① 没有旧目录 → noop；② 真移动 → 复核通过 + 写标记 + 旧目录消失；
 * ③ 幂等（再跑什么都不做）；④ 两边都有数据 → 冲突且一个字节不动；
 * ⑤ 跨卷 → 自动退回"复制 + 复核 + 删源"；⑥ **复核失败 → 回退**（用注入的 verify 强制失败）；
 * ⑦ 篡改检测（改了文件内容，`verifyAgainst` 必须报哈希不一致）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HERE = new URL('..', import.meta.url);
const MOD = new URL('../src/userDataMigration.js', import.meta.url);
const { buildManifest, listFiles, migrateUserData, readMarker, verifyAgainst, MIGRATION_MARKER } = await import(MOD.href);

const results = [];
const ok = (name, pass, evidence = '') => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? `\n        → ${evidence}` : ''}`);
};
const root = join(tmpdir(), `webedit-migration-check-${Date.now()}`);
const dead = [];
const mk = (dir, files) => {
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text, 'utf8');
  }
  dead.push(dir);
  return dir;
};

try {
  /* ① 没有旧目录 → noop */
  const r1 = migrateUserData({ oldDir: join(root, 'nope-old'), newDir: join(root, 'nope-new') });
  ok('没有旧目录 → noop（新装用户不受影响）', r1.status === 'noop', r1.detail);

  /* ② 真移动 + 复核 + 标记 */
  const old2 = mk(join(root, 'case2-old'), { 'bridge-token': 'tok-123', 'logs/a.log': 'hello', 'workspace/d.editor.json': '{"title":"x"}' });
  const new2 = join(root, 'case2-new');
  const before2 = listFiles(old2).length;
  const r2 = migrateUserData({ oldDir: old2, newDir: new2 });
  /* 注意：迁移标记 `migration.json` 会写进**新目录**，所以"数据文件数"要把它排除掉再比 */
  const dataFiles = (d) => listFiles(d).filter((f) => f !== MIGRATION_MARKER).length;
  check2: {
    const marker = readMarker(new2);
    ok(
      '真移动：复核通过 + 写迁移标记 + 旧目录消失（数据文件数不变）',
      r2.status === 'moved' && before2 === 3 && !existsSync(old2) && dataFiles(new2) === 3 && marker && marker.files === 3,
      `status=${r2.status} 文件=${before2}→${existsSync(new2) ? dataFiles(new2) : '?'}（另有 ${listFiles(new2).length - dataFiles(new2)} 个标记文件）旧目录还在=${existsSync(old2)} marker.files=${marker?.files}`,
    );
    ok(
      '标记里记了来源/去向/时间/关键文件哈希',
      Boolean(marker?.from && marker?.to && marker?.migratedAt && Object.keys(marker?.keyHashes ?? {}).length >= 3),
      `from=${marker?.from}；keyHashes=${Object.keys(marker?.keyHashes ?? {}).join(',')}`,
    );
  }

  /* ③ 幂等：再跑一次什么都不做 */
  const r3 = migrateUserData({ oldDir: old2, newDir: new2 });
  ok('幂等：已迁移后再跑 → noop，新目录不变', r3.status === 'noop' && dataFiles(new2) === 3, r3.detail);

  /* ④ 冲突：两边都有数据且无标记 → 不动 */
  const old4 = mk(join(root, 'case4-old'), { 'a.txt': 'A' });
  const new4 = mk(join(root, 'case4-new'), { 'b.txt': 'B' });
  const r4 = migrateUserData({ oldDir: old4, newDir: new4 });
  ok(
    '冲突（两边都有数据、无标记）→ conflict 且一个字节不动',
    r4.status === 'conflict' && existsSync(join(old4, 'a.txt')) && existsSync(join(new4, 'b.txt')),
    r4.detail,
  );

  /* ⑤ 跨卷：源在 E:（工作区 var/），目标在系统临时目录（C:）→ rename 必失败 → 复制 + 删源 */
  const crossOld = join(process.cwd(), 'var', `tmp-migrate-src-${Date.now()}`);
  mk(crossOld, { 'x.txt': 'cross-volume', 'sub/y.txt': 'sub' });
  const crossNew = join(root, 'case5-new');
  const r5 = migrateUserData({ oldDir: crossOld, newDir: crossNew });
  ok(
    '跨卷回退：复制 + 复核 + 删源',
    r5.status === 'copy-moved' && !existsSync(crossOld) && existsSync(join(crossNew, 'sub', 'y.txt')) && existsSync(join(crossNew, 'x.txt')),
    `status=${r5.status}；源已删=${!existsSync(crossOld)}；x.txt=${existsSync(join(crossNew, 'x.txt'))}；sub/y.txt=${existsSync(join(crossNew, 'sub', 'y.txt'))}（源卷 ${getDrive(crossOld)} → 目标卷 ${getDrive(crossNew)}）`,
  );
  rmSync(crossOld, { recursive: true, force: true });

  /* ⑥ 复核失败 → 回退（注入 verify 强制失败） */
  const old6 = mk(join(root, 'case6-old'), { 'keep.txt': 'must-survive', 'b.txt': 'second' });
  const new6 = join(root, 'case6-new');
  const r6 = migrateUserData({
    oldDir: old6,
    newDir: new6,
    verify: () => ({ ok: false, reasons: ['注入的复核失败（测试用）'] }),
  });
  ok(
    '复核失败 → 移回去（旧目录内容完好、无半迁移状态）',
    r6.status === 'rolled-back' && existsSync(join(old6, 'keep.txt')) && readFileSync(join(old6, 'keep.txt'), 'utf8') === 'must-survive' && !existsSync(new6),
    `status=${r6.status}；旧目录还在=${existsSync(old6)}；新目录残留=${existsSync(new6)}`,
  );

  /* ⑦ 篡改检测：改了内容，复核必须报哈希不一致 */
  const tamper = mk(join(root, 'case7'), { 'data.json': '{"v":1}', 'logs/l.log': 'x' });
  const man = buildManifest(tamper);
  ok('清单：相对路径 + 字节数 + 非易变文件哈希', man.files.length === 2 && man.bytes > 0 && Object.keys(man.hashes).length === 2, `files=${man.files.length} bytes=${man.bytes} hashes=${Object.keys(man.hashes).length}`);
  ok('复核通过（未改动）', verifyAgainst(tamper, man).ok, verifyAgainst(tamper, man).reasons.join('；'));
  writeFileSync(join(tamper, 'data.json'), '{"v":2}', 'utf8');
  const bad = verifyAgainst(tamper, man);
  ok('篡改检测：改了内容 → 复核报"哈希不一致"', !bad.ok && bad.reasons.some((r) => r.includes('哈希不一致')), bad.reasons.join('；'));

  /* 清理 */
  for (const d of [...dead, root, join(root, 'case2-new'), join(root, 'case4-new'), join(root, 'case5-new')]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
} catch (e) {
  ok('自检脚本自身没崩', false, e.stack ?? String(e));
}

function getDrive(p) {
  return String(p).slice(0, 2).toUpperCase();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
