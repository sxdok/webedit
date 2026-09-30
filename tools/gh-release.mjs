/**
 * 一条命令发布 GitHub Release（含资产上传）—— 可复跑、幂等。
 *
 * 背景：桌面版的更新源是 `https://github.com/<repo>/releases/latest/download/latest.json`，
 * 所以发版要把 **两个 exe + latest.json** 作为资产传上去（`latest.json` 由
 * `apps/desktop/scripts/make-update-manifest.mjs` 生成，`npm run dist` 会自动跑）。
 *
 * 令牌来源（**优先级从高到低**，都不会被打印）：
 *   ① 环境变量 `GITHUB_TOKEN` / `GH_TOKEN`
 *   ② 文件 `<仓库根>/var/.gh-token`（`var/` 已 gitignore）—— 一行一个 token 即可
 *
 * 用法：
 *   node tools/gh-release.mjs                      # 用 apps/desktop/package.json 的版本 → tag v<版本>
 *   node tools/gh-release.mjs --tag v0.3.0 --name "v0.3.0" --body release/notes-0.3.0.md
 *   node tools/gh-release.mjs --dry-run            # 只打印将要上传的资产与请求，不联网
 *
 * 依赖：Node 18+ 内置 fetch（不需要 gh CLI、不需要 curl）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIR = path.join(REPO_ROOT, 'release');
const argv = process.argv.slice(2);
const argOf = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const dryRun = argv.includes('--dry-run');

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'apps', 'desktop', 'package.json'), 'utf8'));
const version = String(pkg.version ?? '').trim();
const repo = argOf('--repo', 'sxdok/webedit');
const tag = argOf('--tag', `v${version}`);
const name = argOf('--name', `v${version}`);
const bodyArg = argOf('--body');
const body = bodyArg
  ? existsSync(bodyArg)
    ? readFileSync(bodyArg, 'utf8').trim()
    : String(bodyArg)
  : existsSync(path.join(RELEASE_DIR, 'latest.json'))
    ? String(JSON.parse(readFileSync(path.join(RELEASE_DIR, 'latest.json'), 'utf8')).notes ?? '')
    : `v${version}`;

/** 要上传的资产：两个 exe（在就传）+ latest.json */
const assets = [`webedit-${version}-x64.exe`, `webedit-${version}-portable.exe`, 'latest.json']
  .map((n) => ({ name: n, file: path.join(RELEASE_DIR, n) }))
  .filter((a) => existsSync(a.file));

function token() {
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    const v = String(process.env[k] ?? '').trim();
    if (v) return { value: v, from: `环境变量 ${k}` };
  }
  const file = path.join(REPO_ROOT, 'var', '.gh-token');
  if (existsSync(file)) {
    const v = readFileSync(file, 'utf8').trim().split(/\r?\n/)[0].trim();
    if (v) return { value: v, from: 'var/.gh-token' };
  }
  return null;
}

console.log(`仓库 ${repo} · tag ${tag} · 版本 ${version}`);
console.log(`资产 ${assets.length} 个：`);
for (const a of assets) console.log(`  · ${a.name}（${(statSync(a.file).size / 1048576).toFixed(1)}MB）`);
if (assets.length < 3) console.warn('⚠ 资产不足 3 个（缺 exe 或 latest.json）—— 先跑 `npm run dist`');
if (dryRun) {
  console.log('\n--dry-run：不联网。将执行：');
  console.log(`  POST https://api.github.com/repos/${repo}/releases  {tag_name:${tag}, name:${name}}`);
  for (const a of assets) console.log(`  POST https://uploads.github.com/repos/${repo}/releases/<id>/assets?name=${a.name}`);
  process.exit(0);
}

const tok = token();
if (!tok) {
  console.error('✗ 没找到令牌：请设置 GITHUB_TOKEN，或把 PAT 写进 var/.gh-token（var/ 已 gitignore）。');
  process.exit(2);
}
const H = {
  Authorization: `Bearer ${tok.value}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'webedit-release-script',
};
const api = `https://api.github.com/repos/${repo}`;
const json = async (r) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t.slice(0, 300) };
  }
};

/** 已存在就复用（422 = tag_name 已存在），避免手滑建重 */
let release = null;
const created = await fetch(`${api}/releases`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag_name: tag, name, body, draft: false, prerelease: false }),
});
if (created.ok) {
  release = await json(created);
  console.log(`✓ 已创建 release：${release.html_url}`);
} else {
  const e = await json(created);
  if (created.status === 422) {
    const list = await json(await fetch(`${api}/releases/tags/${encodeURIComponent(tag)}`, { headers: H }));
    if (list?.id) {
      release = list;
      console.log(`· release 已存在，复用：${release.html_url}`);
    }
  }
  if (!release) {
    console.error(`✗ 创建失败（HTTP ${created.status}）：${JSON.stringify(e).slice(0, 300)}`);
    process.exit(1);
  }
}

/** 上传资产：同名已存在则先删（保证 latest.json 内容是最新的） */
const existing = await json(await fetch(`${api}/releases/${release.id}/assets?per_page=100`, { headers: H }));
const byName = new Map((Array.isArray(existing) ? existing : []).map((a) => [a.name, a]));
for (const a of assets) {
  const old = byName.get(a.name);
  if (old) {
    await fetch(`${api}/releases/assets/${old.id}`, { method: 'DELETE', headers: H });
    console.log(`  · 覆盖旧资产 ${a.name}`);
  }
  const buf = readFileSync(a.file);
  const up = await fetch(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(a.name)}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/octet-stream' },
    body: buf,
  });
  const info = await json(up);
  console.log(`${up.ok ? '✓' : '✗'} 上传 ${a.name} ${up.ok ? `→ ${info.browser_download_url}` : `HTTP ${up.status} ${JSON.stringify(info).slice(0, 200)}`}`);
}

/* 收尾：把 release 页面与"更新源要读的那份清单"打出来，方便一眼验证 */
const final = await json(await fetch(`${api}/releases/tags/${encodeURIComponent(tag)}`, { headers: H }));
console.log(`\nRelease：${final.html_url ?? '(读不到)'}`);
console.log(`更新源：https://github.com/${repo}/releases/latest/download/latest.json`);
console.log('令牌来源：' + tok.from + '（未打印内容）');
