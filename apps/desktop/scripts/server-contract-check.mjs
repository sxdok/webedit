/**
 * 静态服务器的**契约测试**（P2④：服务器归一 —— JS 是规范实现，Python 启动器是降级备用）。
 *
 *   node apps/desktop/scripts/server-contract-check.mjs
 *
 * 两段证据：
 *   ① **端点集必须一致**（静态比对）：JS `server/webServer.js` 与 Python `web-editor/启动编辑器.py`
 *      对外承诺的是同一组接口。哪边悄悄加/删一个端点都会被这条抓住 —— 否则"两个启动器"很快会各说各话。
 *   ② **文档里承诺的形状真成立**（起真服务器探一遍）：`/__components`、`/__loginfo`、`/__log`、
 *      `/__save`、`/__savePlugin`，含**拒绝路径穿越**与**拒绝内部文件**两条负例 +
 *      静态托管与 SPA 回落。
 *
 * 为什么值得单独一个脚本：这些接口是"编辑器 ↔ 桌面壳 ↔ MCP"之间的**隐性契约**（页面直接 fetch 它们），
 * 却没有任何类型能表达；出问题时现象是"组件没了 / 日志不落盘 / 提示条不弹"，很难联想到服务器。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, '..');
const REPO = resolve(APP_DIR, '..', '..');
const PORT = Number(process.env.SERVER_CONTRACT_PORT ?? 37901);

const results = [];
const ok = (name, pass, evidence = '') => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? `\n        → ${evidence}` : ''}`);
};

/* ── ① 端点集：两个实现必须一致 ── */
const ENDPOINTS = ['/__components', '/__loginfo', '/__log', '/__save', '/__savePlugin'];
const jsSrc = readFileSync(join(APP_DIR, 'server', 'webServer.js'), 'utf8');
const pyPath = join(REPO, 'web-editor', '启动编辑器.py');
const pySrc = existsSync(pyPath) ? readFileSync(pyPath, 'utf8') : '';
ok('Python 降级启动器还在（没被误删）', !!pySrc, pyPath.replace(REPO + '\\', ''));
const inJs = ENDPOINTS.filter((e) => jsSrc.includes(`'${e}'`) || jsSrc.includes(`"${e}"`));
const inPy = ENDPOINTS.filter((e) => pySrc.includes(`"${e}"`) || pySrc.includes(`'${e}'`));
ok(
  '两个服务器对外承诺的端点集一致（JS 规范实现 vs Python 降级备用）',
  inJs.length === ENDPOINTS.length && inPy.length === ENDPOINTS.length,
  `JS 命中 ${inJs.length}/${ENDPOINTS.length}、Python 命中 ${inPy.length}/${ENDPOINTS.length}${inPy.length !== ENDPOINTS.length ? `；Python 缺：${ENDPOINTS.filter((e) => !inPy.includes(e)).join(', ')}` : ''}`,
);

/* 反向：JS 里出现的 `/__xxx` 端点都必须在契约清单里（防止"悄悄加了端点却没登记"） */
const jsRouteStrings = [...new Set([...jsSrc.matchAll(/['"](\/__[a-zA-Z]+)['"]/g)].map((m) => m[1]))];
const unregistered = jsRouteStrings.filter((r) => !ENDPOINTS.includes(r));
ok('JS 侧没有"未登记"的 /__ 端点', unregistered.length === 0, unregistered.length ? `未登记：${unregistered.join(', ')}` : `已登记 ${ENDPOINTS.length} 个：${ENDPOINTS.join(', ')}`);

/* ── ② 起真服务器探形状 ── */
const root = join(tmpdir(), `server-contract-${process.pid}`);
const dist = join(root, 'web-editor', 'dist');
mkdirSync(join(dist, '组件'), { recursive: true });
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>contract</title><div id="root"></div>', 'utf8');
writeFileSync(join(dist, '组件', '甲.js'), '// 外部组件甲\n', 'utf8');

const mod = await import(pathToFileURL(join(APP_DIR, 'server', 'webServer.js')).href);
const server = await mod.startWebServer({
  rootDir: root,
  port: PORT,
  quiet: true,
  logDir: join(root, 'logs'),
  docsDir: join(root, 'docs'),
  componentsDir: join(dist, '组件'),
});
const base = `http://127.0.0.1:${PORT}`;
const get = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.text() };
};
const post = async (p, data) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let body = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status, body };
};

try {
  const components = await get('/__components');
  let parsed = null;
  try {
    parsed = JSON.parse(components.body);
  } catch {
    parsed = null;
  }
  ok(
    'GET /__components → {files:[…]}（规范形状；编辑器两种都读，但服务器只写规范形状）',
    components.status === 200 && Array.isArray(parsed?.files) && parsed.files.includes('甲.js'),
    `${components.status} ${components.body.slice(0, 120)}`,
  );

  const loginfo = await get('/__loginfo');
  let li = null;
  try {
    li = JSON.parse(loginfo.body);
  } catch {
    li = null;
  }
  ok('GET /__loginfo → 含 enabled / dir（页面据此确认"日志真的落盘了"）', loginfo.status === 200 && li && 'enabled' in li && 'dir' in li, `${loginfo.status} ${loginfo.body.slice(0, 120)}`);

  const logRes = await post('/__log', { kind: 'contract', lines: ['契约测试写入一行'] });
  /* 验"日志真的落盘且能查到这一行"，而不是验某个具体文件名 ——
     文件名规则属于实现细节（按 kind + 日期），钉死它只会让测试变脆。 */
  const logDir = join(root, 'logs');
  const logsDirFiles = existsSync(logDir) ? readdirSync(logDir) : [];
  const hit = logsDirFiles.find((f) => readFileSync(join(logDir, f), 'utf8').includes('契约测试'));
  ok(
    'POST /__log → 追加到运行目录的 logs/（文件里有刚写的那一行）',
    logRes.status === 200 && !!hit,
    `${logRes.status}；logs/ 下文件：${logsDirFiles.join(', ') || '(空)'}${hit ? `；命中 ${hit}` : ''}`,
  );

  const saveOk = await post('/__save', { path: 'docs/契约.md', text: '# 契约测试' });
  ok('POST /__save → 允许写 docs/ 下相对路径', saveOk.status === 200 && existsSync(join(root, 'docs', '契约.md')), `${saveOk.status} ${JSON.stringify(saveOk.body).slice(0, 80)}`);

  const saveEscape = await post('/__save', { path: '../逃逸.md', text: 'x' });
  ok('POST /__save → **拒绝路径穿越**（负例）', saveEscape.status >= 400 && !existsSync(join(root, '..', '逃逸.md')), `${saveEscape.status} ${JSON.stringify(saveEscape.body).slice(0, 80)}`);

  const pluginOk = await post('/__savePlugin', { name: '契约.js', text: '// 契约测试组件' });
  ok('POST /__savePlugin → 允许写组件目录', pluginOk.status === 200 && existsSync(join(dist, '组件', '契约.js')), `${pluginOk.status} ${JSON.stringify(pluginOk.body).slice(0, 80)}`);

  const pluginBad = await post('/__savePlugin', { name: '_manifest.json', text: '[]' });
  ok('POST /__savePlugin → **拒绝内部文件**（负例：`_manifest.json` 不能由页面直接写）', pluginBad.status === 403, `${pluginBad.status} ${JSON.stringify(pluginBad.body).slice(0, 80)}`);

  const staticRes = await get('/index.html');
  ok('静态托管 dist/（GET /index.html → 200）', staticRes.status === 200 && staticRes.body.includes('contract'), `${staticRes.status}`);
  const spa = await get('/some/spa/route');
  ok('未知路径回落 index.html（SPA 路由）', spa.status === 200 && spa.body.includes('contract'), `${spa.status}`);
  const pluginFile = await get('/组件/甲.js');
  ok('GET /组件/<name> 走组件目录（热加载不需要重新构建）', pluginFile.status === 200 && pluginFile.body.includes('外部组件甲'), `${pluginFile.status}`);
} finally {
  await server.close();
  setTimeout(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }, 500);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
