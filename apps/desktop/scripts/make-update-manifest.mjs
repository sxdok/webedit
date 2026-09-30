/**
 * 生成 **GitHub Release 用的更新清单** `release/latest.json`。
 *
 * 背景（2026-09-30）：桌面版的更新源已指向
 *   `https://github.com/sxdok/webedit/releases/latest/download/` + `latest.json`
 * —— 也就是"**最新一条 release 里的 latest.json 资产**"。所以每次发版要做两件事：
 *   ① 把 `release/webedit-<版本>-{x64,portable}.exe` 与 `release/latest.json` 一起传上去；
 *   ② 用户端「帮助 → 检查更新」GET 那份 latest.json → 版本比较 → 给出 download.url（`install()` 故意不实现）。
 *
 * 清单形状（与 `src/updater.js` 的解析严格对齐）：
 *   { version, publishedAt, notes, mandatory, minVersion,
 *     download: { url, sizeBytes, sha256 }, portable?: { url, sizeBytes, sha256 },
 *     channels: { beta?: {…} } }
 *
 * 用法：
 *   node scripts/make-update-manifest.mjs                       # 用 package.json 版本 + release/ 里的 exe
 *   node scripts/make-update-manifest.mjs --notes 发版说明.md    # 自定义说明（markdown 原样进清单）
 *   node scripts/make-update-manifest.mjs --mandatory --min-version 0.3.0
 *   node scripts/make-update-manifest.mjs --repo owner/name      # 换仓库（默认 sxdok/webedit）
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_DIR, '..', '..');
const RELEASE_DIR = path.join(REPO_ROOT, 'release');

const argv = process.argv.slice(2);
const argOf = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

const pkg = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
const version = String(pkg.version ?? '').trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`✗ apps/desktop/package.json 的 version 不合法：${JSON.stringify(pkg.version)}`);
  process.exit(1);
}
const repo = argOf('--repo', 'sxdok/webedit');
const assetBase = `https://github.com/${repo}/releases/latest/download/`;
const exeName = `webedit-${version}-x64.exe`;
const portableName = `webedit-${version}-portable.exe`;

/** 资产 → { url, sizeBytes, sha256 }（文件不在就返回 null 并在最后报警） */
function assetOf(name) {
  const file = path.join(RELEASE_DIR, name);
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  return { url: assetBase + name, sizeBytes: statSync(file).size, sha256: createHash('sha256').update(buf).digest('hex') };
}

const installer = assetOf(exeName);
const portable = assetOf(portableName);

const notesArg = argOf('--notes');
const notes = notesArg
  ? existsSync(notesArg)
    ? readFileSync(notesArg, 'utf8').trim()
    : String(notesArg)
  : existsSync(path.join(RELEASE_DIR, `notes-${version}.md`))
    ? readFileSync(path.join(RELEASE_DIR, `notes-${version}.md`), 'utf8').trim()
    : `可视化编辑器 ${version}`;

const manifest = {
  version,
  publishedAt: new Date().toISOString(),
  notes,
  mandatory: argv.includes('--mandatory'),
  minVersion: argOf('--min-version', null),
  /* ★主下载链接 = 安装版；便携版单独一个字段，方便页面/说明里给"免安装"的人 */
  download: installer ?? { url: assetBase + exeName, sizeBytes: null, sha256: null },
  ...(portable ? { portable } : {}),
  channels: {},
};

const out = path.join(RELEASE_DIR, 'latest.json');
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`✓ 已写出更新清单：${path.relative(REPO_ROOT, out)}`);
console.log(`  版本 ${version} · 主下载 ${manifest.download.url}`);
if (manifest.download.sha256) console.log(`  安装版 sha256 ${manifest.download.sha256.slice(0, 16)}… · ${(manifest.download.sizeBytes / 1048576).toFixed(1)}MB`);
if (portable) console.log(`  便携版 ${portable.url} · ${(portable.sizeBytes / 1048576).toFixed(1)}MB`);
if (!installer) console.warn(`⚠ 没找到 release/${exeName}（清单仍会写出，但 url 指向一个还不存在的资产）—— 先跑 npm run dist`);
console.log('\n发版时把 release/latest.json 与两个 exe 一起传成 release 资产即可；用户端读的是 releases/latest/download/latest.json。');
