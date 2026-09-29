/**
 * 桌面分发版的**无界面验证**（不需要 Electron，纯 Node 跑）：
 *   node apps/desktop/scripts/verify-desktop.mjs
 *
 * 为什么要有它：Electron 打包出来的东西"看起来能开"不算数。这里把**能被机器判定**的部分全验一遍：
 *   A 布局解析（dev / 安装包两套）        B 加密配置读取（对/错密钥、明文兜底、取值校验）
 *   C 更新接口（本地假更新服务器）        D 静态服务器（4 个 __ 接口 + 路径穿越 + SPA 回落）
 *   E MCP 子进程（真拉起、真握手、真重启、真收尾）  F 语法与安全基线静态检查
 *
 * 纪律：**只写临时目录**。MCP 的 workspace 用临时目录，并在前后比对用户真实
 * `editor-mcp/workspace/` 的文件数与最新改动时间 —— 验证脚本绝不能碰用户的活文档。
 *
 * 受限沙箱提示：本脚本要 spawn 子进程并**捕获管道输出**（mcpSupervisor 收日志就是这么干的），
 * 沙箱下会报 `spawn EPERM`；此时请用放宽的文件沙箱跑一次，或直接接受 E 段跳过。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, closeSync, copyFileSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_DIR = resolve(HERE, '..');
const REPO_ROOT = resolve(APP_DIR, '..', '..');
const WEB_ROOT = join(REPO_ROOT, 'web-editor');

/**
 * P0 起 MCP 强制 token：本脚本自带的子进程与所有探测用**同一把测试 token** ——
 * 这样既跑通闸门，又顺带覆盖「带 token 能握手」这条路径（缺 token 的行为由
 * editor-mcp/scripts/auth-check.mjs 专门验证 401/403）。
 */
const P0_TOKEN = `verify-${Date.now().toString(36)}-token`;

const results = [];
let group = '';
const G = (t) => {
  group = t;
  process.stdout.write(`\n── ${t} ──\n`);
};
const ok = (name, pass, evidence = '') => {
  results.push({ group, name, pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? `\n        → ${evidence}` : ''}\n`);
  return pass;
};
const skip = (name, why) => {
  results.push({ group, name, pass: true, skipped: true });
  process.stdout.write(`SKIP  ${name}\n        → ${why}\n`);
};

const tmp = mkdtempSync(join(tmpdir(), 'desktop-verify-'));
const cleanups = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══════════ A 布局 ═══════════ */
async function testLayout() {
  G('A 路径布局');
  const { resolveLayout } = await import('../src/paths.js');
  const userData = join(tmp, 'userData');
  const dev = resolveLayout({ isPackaged: false, resourcesPath: '', userDataPath: userData });

  ok(
    'dev：webRoot 指向 web-editor（组件源目录）而产物在**仓库根 dist/web**（P3-M1）',
    dev.webRoot === WEB_ROOT && dev.distDir === join(REPO_ROOT, 'dist', 'web') && existsSync(join(dev.distDir, 'index.html')),
    `webRoot=${dev.webRoot}；distDir=${dev.distDir}；index.html=${existsSync(join(dev.distDir, 'index.html'))}`,
  );
  ok('dev：editor-mcp 入口存在', Boolean(dev.mcpEntry) && existsSync(dev.mcpEntry), `mcpEntry=${dev.mcpEntry}`);
  ok('dev：独立加密工具被解析到', Boolean(dev.secureConfigCore) && existsSync(dev.secureConfigCore), `secureConfigCore=${dev.secureConfigCore}`);
  ok('dev：加密配置与构建期密钥就位', existsSync(dev.configEncPath) && existsSync(dev.buildKeyPath), `enc=${existsSync(dev.configEncPath)}，buildKey=${existsSync(dev.buildKeyPath)}`);
  ok('dev：日志/文档落在 userData 而不是仓库', dev.logDir.startsWith(userData) && dev.docsDir.startsWith(userData), `logDir=${dev.logDir}`);

  // 模拟安装包布局：业务资源在 resources/ 下，用户数据在 userData
  const res = join(tmp, 'resources');
  const mk = (p) => mkdirSync(p, { recursive: true });
  mk(join(res, 'web-editor', 'dist'));
  mk(join(res, 'web-editor', 'public', '组件'));
  mk(join(res, 'editor-mcp', 'dist'));
  mk(join(res, 'tools', 'secure-config'));
  mk(join(res, 'config'));
  writeFileSync(join(res, 'web-editor', 'dist', 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');
  writeFileSync(join(res, 'editor-mcp', 'dist', 'index.js'), '//', 'utf8');
  writeFileSync(join(res, 'tools', 'secure-config', 'secure-config.mjs'), 'export const x=1;', 'utf8');
  writeFileSync(join(res, 'config', 'app-config.enc'), '{}', 'utf8');
  const packed = resolveLayout({ isPackaged: true, resourcesPath: res, userDataPath: userData });
  ok('packaged：业务资源从 resources/ 读，用户数据从 userData 写', packed.webRoot === join(res, 'web-editor') && packed.mcpEntry === join(res, 'editor-mcp', 'dist', 'index.js') && packed.logDir.startsWith(userData) && packed.docsDir.startsWith(userData), `webRoot=${packed.webRoot}；logDir=${packed.logDir}`);
  ok('packaged：配置文件优先读 resources/config（明文文件、可整包替换）', packed.configDir === join(res, 'config') && packed.configEncPath === join(res, 'config', 'app-config.enc'), `configDir=${packed.configDir}`);
  ok('packaged：绝不在安装目录里建可写数据目录', !packed.logDir.startsWith(res) && !packed.docsDir.startsWith(res) && !String(packed.mcpWorkspace).startsWith(res), `mcpWorkspace=${packed.mcpWorkspace}`);
  return { dev, packed, userData };
}

/* ═══════════ A2 组件目录落地 ═══════════ */
async function testComponents() {
  G('A2 组件目录落地（安装目录只读 → 种子拷进 userData）');
  const { resolveComponentsDir } = await import('../src/components.js');
  const bundled = join(tmp, 'bundled-组件');
  const user = join(tmp, 'user-组件');
  mkdirSync(bundled, { recursive: true });
  writeFileSync(join(bundled, '甲.js'), 'window.a=1;', 'utf8');
  writeFileSync(join(bundled, '乙.js'), 'window.b=1;', 'utf8');
  writeFileSync(join(bundled, '_manifest.json'), '["甲.js"]', 'utf8');
  writeFileSync(join(bundled, '忽略我.txt'), 'x', 'utf8');

  const dev = resolveComponentsDir({ mode: 'dev', bundledDir: bundled, userDir: user });
  ok('dev：直接用仓库源目录（保持热加载开发流程），不拷贝', dev.dir === bundled && dev.mode === 'repo' && !existsSync(user), `dir=${dev.dir}`);

  const first = resolveComponentsDir({ mode: 'packaged', bundledDir: bundled, userDir: user });
  ok('packaged 首次运行：把随包组件种子拷进 userData（含 _manifest.json，忽略非 js）', first.dir === user && first.seeded === 3 && existsSync(join(user, '甲.js')) && existsSync(join(user, '_manifest.json')) && !existsSync(join(user, '忽略我.txt')), `seeded=${first.seeded} dir=${first.dir}`);

  writeFileSync(join(user, '甲.js'), 'window.a=999;// 用户改过', 'utf8');
  writeFileSync(join(bundled, '丙.js'), 'window.c=1;', 'utf8');
  const second = resolveComponentsDir({ mode: 'packaged', bundledDir: bundled, userDir: user });
  ok('再次运行：用户改过的组件不被覆盖，升级带来的新组件会自动补进来', second.seeded === 1 && second.kept === 3 && readFileSync(join(user, '甲.js'), 'utf8').includes('999') && existsSync(join(user, '丙.js')), `补入=${second.seeded} 保留=${second.kept}；甲.js 仍是用户的=${readFileSync(join(user, '甲.js'), 'utf8').includes('999')}`);
}

/* ═══════════ B 加密配置 ═══════════ */async function testSecureConfig(dev) {
  G('B 加密配置（独立工具 + 应用侧读取）');
  const { loadAppConfig, normalizeConfig, maskUrl } = await import('../src/secureConfig.js');
  const { createLogger } = await import('../src/logger.js');
  const logger = createLogger({ logDir: join(tmp, 'logs') });
  const example = JSON.parse(readFileSync(join(APP_DIR, 'config', 'app-config.example.json'), 'utf8'));

  const r1 = await loadAppConfig({ layout: dev, env: { ...process.env, EDITOR_DESKTOP_CONFIG_KEY: '', EDITOR_DESKTOP_CONFIG_KEY_FILE: '' }, logger });
  ok('用随包 buildKey.js 能解开 app-config.enc', r1.meta.source === 'encrypted' && r1.meta.problems.length === 0, `source=${r1.meta.source} 密钥来源=${r1.meta.keySource} 指纹=${r1.meta.keyFingerprint}`);
  ok('解出来的值与明文源逐字段一致（含嵌套 update/mcp）', JSON.stringify(r1.config.update) === JSON.stringify(example.update) && JSON.stringify(r1.config.mcp) === JSON.stringify(example.mcp), `update.baseUrl=${r1.config.update.baseUrl}，mcp.httpPort=${r1.config.mcp.httpPort}`);
  ok('密文里查不到明文（加密是真生效的）', !readFileSync(dev.configEncPath, 'utf8').includes('updates.example.com'), `密文里出现 "updates.example.com" = ${readFileSync(dev.configEncPath, 'utf8').includes('updates.example.com')}`);

  const envKey = readFileSync(dev.configKeyPath, 'utf8').trim();
  const r2 = await loadAppConfig({ layout: dev, env: { ...process.env, EDITOR_DESKTOP_CONFIG_KEY: envKey } });
  ok('密钥来源可被环境变量覆盖（EDITOR_DESKTOP_CONFIG_KEY）', r2.meta.source === 'encrypted' && r2.meta.keySource === 'env:EDITOR_DESKTOP_CONFIG_KEY', `keySource=${r2.meta.keySource}`);

  const r3 = await loadAppConfig({ layout: dev, explicitKey: Buffer.from('00000000000000000000000000000000').toString('base64') });
  ok('密钥不对：不崩，退回默认值并明确报"解密失败"', r3.meta.source === 'defaults' && r3.meta.problems.some((p) => p.includes('解密失败')), `source=${r3.meta.source}；problems[0]=${r3.meta.problems[0] ?? '(无)'}`);

  const missing = { ...dev, configEncPath: join(tmp, 'nope.enc'), configPlainPath: join(tmp, 'nope.json') };
  const r4 = await loadAppConfig({ layout: missing });
  ok('没有配置文件：用默认值启动并提醒', r4.meta.source === 'defaults' && r4.meta.warnings.some((w) => w.includes('未找到配置文件')), `warnings[0]=${r4.meta.warnings[0]}`);

  const plainPath = join(tmp, 'app-config.json');
  writeFileSync(plainPath, JSON.stringify({ update: { baseUrl: 'https://plain.example.org/up/' } }), 'utf8');
  const r5 = await loadAppConfig({ layout: { ...dev, configEncPath: join(tmp, 'nope.enc'), configPlainPath: plainPath } });
  ok('明文兜底可用但必须警告（仅开发便利）', r5.meta.source === 'plain' && r5.meta.warnings.some((w) => w.includes('明文')), `source=${r5.meta.source}；warnings=${r5.meta.warnings.find((w) => w.includes('明文'))}`);

  const bad = normalizeConfig({ server: { port: 'abc' }, mcp: { httpPort: 37651, bridgePort: 37651 }, update: { baseUrl: 'ftp://x/' } });
  ok('取值校验：坏端口/端口打架/非 http 更新地址都被列出来', bad.problems.length >= 3, bad.problems.join(' ｜ '));
  const warn = normalizeConfig({ update: { baseUrl: 'https://updates.example.com/x/' } });
  ok('取值校验：还是示例地址时给出"正式分发前要换掉"的提醒', warn.warnings.some((w) => w.includes('示例地址')), warn.warnings.find((w) => w.includes('示例地址')));
  ok('更新地址在界面/日志里默认打码（只留主机名与路径首段前 2 字）', maskUrl('https://updates.example.com/visual-editor/') === 'https://updates.example.com/vi***' && maskUrl('乱写') === '(无法解析)', `${maskUrl('https://updates.example.com/visual-editor/')}；乱写→${maskUrl('无法解析')}`);

  /**
   * ★真实安装场景：把 config 目录放到一个**向上找不到任何 package.json** 的地方（模拟 %TEMP% 免安装解包目录
   * 与 Program Files 安装目录），并且只用构建期兜底密钥解密。
   * 真踩过：buildKey 用 `.js` 后缀装 ESM 语法 → 在那种目录里 Node 按 CJS 解析 → import 语法错误 →
   * 应用只好退回默认配置；而仓库里跑 win-unpacked 时恰好向上能找到 apps/desktop/package.json，**侥幸通过**。
   */
  const isolated = join(tmp, 'installed-like-nowhere', 'resources', 'config');
  mkdirSync(isolated, { recursive: true });
  copyFileSync(join(APP_DIR, 'config', 'app-config.enc'), join(isolated, 'app-config.enc'));
  const buildKeyReal = join(APP_DIR, 'config', 'buildKey.mjs');
  copyFileSync(buildKeyReal, join(isolated, 'buildKey.mjs'));
  const isoLayout = {
    ...dev,
    configDir: isolated,
    configEncPath: join(isolated, 'app-config.enc'),
    configPlainPath: join(isolated, 'app-config.json'),
    configKeyPath: join(isolated, 'config.key'),
    buildKeyPath: join(isolated, 'buildKey.mjs'),
    buildKeyLegacyPath: join(isolated, 'buildKey.js'),
  };
  const r6 = await loadAppConfig({ layout: isoLayout, env: { ...process.env, EDITOR_DESKTOP_CONFIG_KEY: '', EDITOR_DESKTOP_CONFIG_KEY_FILE: '' } });
  ok('模拟"安装目录/免安装解包目录"（向上没有 package.json）：只用随包密钥也能解开配置', r6.meta.source === 'encrypted' && r6.meta.problems.length === 0, `来源=${r6.meta.source} 密钥=${r6.meta.keySource} 问题数=${r6.meta.problems.length}${r6.meta.problems.length ? `（${r6.meta.problems[0]}）` : ''}`);
  ok('构建期密钥是 .mjs（.js 在那种目录里会被当 CJS，import 必失败）', buildKeyReal.endsWith('.mjs') && existsSync(buildKeyReal), `buildKeyPath=${buildKeyReal}`);
  return r1.config;
}

/* ═══════════ C 更新接口 ═══════════ */
async function testUpdater() {
  G('C 更新接口（本地假更新服务器）');
  const { createUpdater, compareVersions } = await import('../src/updater.js');

  ok('版本比较：正式版 > 预发布，数值逐段比', compareVersions('1.0.0', '1.0.0-beta') === 1 && compareVersions('1.2.3', '1.2.4') === -1 && compareVersions('1.0.0', 'v1.0.0') === 0 && compareVersions('乱写', '1.0.0') === null, '1.0.0>1.0.0-beta；1.2.3<1.2.4；1.0.0=v1.0.0；非版本号→null');

  // 假更新服务器：/latest.json 由当前测试用例改写
  let payload = '{}';
  let status = 200;
  const srv = createHttpServer((req, res) => {
    if (req.url.startsWith('/latest.json')) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(payload);
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const base = { enabled: true, baseUrl: `http://127.0.0.1:${port}/`, manifest: 'latest.json', channel: 'stable', allowPrerelease: false, timeoutMs: 4000, openMode: 'external' };
  const opened = [];
  const up = createUpdater({ config: { ...base }, currentVersion: '1.0.0', openExternal: async (u) => opened.push(u) });

  payload = JSON.stringify({ version: '1.1.0', notes: '修了几个 bug', publishedAt: '2026-09-25T00:00:00Z', download: { url: 'https://dl.example.com/app-1.1.0.exe', sha256: 'abc' } });
  let r = await up.check();
  ok('发现新版本：给出下载地址与说明', r.status === 'update-available' && r.latestVersion === '1.1.0' && r.downloadUrl.endsWith('app-1.1.0.exe') && r.notes.includes('bug'), `status=${r.status} latest=${r.latestVersion} url=${r.downloadUrl}`);

  const r2 = await up.openDownload();
  ok('打开下载页：把 URL 交给系统（这里用桩函数接住）', r2.ok && opened[0] === 'https://dl.example.com/app-1.1.0.exe', `openExternal 收到 ${opened[0]}`);

  payload = JSON.stringify({ version: '1.0.0' });
  r = await up.check();
  ok('同版本 → 已是最新', r.status === 'up-to-date', `status=${r.status}`);

  payload = JSON.stringify({ version: '1.1.0-beta.1' , download: { url: 'https://dl.example.com/beta.exe' } });
  r = await up.check();
  ok('不允许预发布时忽略预发布版本（并说明原因）', r.status === 'up-to-date' && String(r.note).includes('预发布'), `note=${r.note}`);

  const allowPre = createUpdater({ config: { ...base, allowPrerelease: true }, currentVersion: '1.0.0', openExternal: async () => {} });
  r = await allowPre.check();
  ok('允许预发布时能拿到 beta 版本', r.status === 'update-available' && r.latestVersion === '1.1.0-beta.1', `latest=${r.latestVersion}`);

  payload = JSON.stringify({ version: '2.0.0', channels: { beta: { version: '2.0.1', download: { url: 'https://dl.example.com/beta-2.0.1.exe' } } } });
  const chan = createUpdater({ config: { ...base, channel: 'beta' }, currentVersion: '1.0.0', openExternal: async () => {} });
  r = await chan.check();
  ok('通道覆盖：channels.<channel> 优先', r.latestVersion === '2.0.1' && r.downloadUrl.endsWith('beta-2.0.1.exe'), `latest=${r.latestVersion} url=${r.downloadUrl}`);

  payload = JSON.stringify({ version: '2.0.0', download: { url: 'javascript:alert(1)' } });
  r = await up.check();
  ok('清单里的下载地址不是 http(s) → 明确报错，绝不打开', r.status === 'error' && r.error.includes('http'), `error=${r.error}`);

  status = 404;
  r = await up.check();
  ok('清单 404 → 报错而不是当成"最新"', r.status === 'error' && r.error.includes('404'), `error=${r.error}`);

  status = 200;
  payload = '这不是 JSON';
  r = await up.check();
  ok('清单不是 JSON → 报错', r.status === 'error' && r.error.includes('JSON'), `error=${r.error}`);

  const disabled = createUpdater({ config: { ...base, enabled: false }, currentVersion: '1.0.0', openExternal: async () => {} });
  r = await disabled.check();
  ok('配置里关掉更新 → disabled（不联网）', r.status === 'disabled', `status=${r.status}`);

  const inst = await up.install();
  ok('自动安装是**预留**的：明确返回未实现，而不是假装成功', inst.ok === false && inst.reserved === true, `install() → ${JSON.stringify(inst)}`);

  srv.close();
  return { updater: up, base };
}

/* ═══════════ D 静态服务器 ═══════════ */
async function testWebServer(dev) {
  G('D 静态服务器（启动编辑器.py 的 Node 等价物）');
  const { startWebServer } = await import('../server/webServer.js');
  const dataRoot = join(tmp, 'data');
  const logDir = join(dataRoot, 'logs');
  const docsDir = join(dataRoot, 'docs');
  const componentsDir = join(dataRoot, '组件');
  mkdirSync(componentsDir, { recursive: true });
  writeFileSync(join(componentsDir, 'liveWidget.js'), 'window.EditorKit && (window.__liveOk = 1);', 'utf8');

  // ★P3-M1：产物在仓库根 dist/web，所以这里传**仓库根**（webServer 会 resolveDistDir 找它）
  const web = await startWebServer({ rootDir: REPO_ROOT, port: 0, host: '127.0.0.1', quiet: true, logDir, docsDir, componentsDir });
  cleanups.push(() => web.close());
  const base = web.url.replace(/\/$/, '');
  const get = async (p) => {
    const res = await fetch(base + p);
    return { status: res.status, type: res.headers.get('content-type') ?? '', cache: res.headers.get('cache-control') ?? '', text: await res.text() };
  };
  const post = async (p, body) => {
    const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const root = await get('/');
  ok('GET / → 200 HTML 且带 no-store', root.status === 200 && root.type.includes('text/html') && root.cache.includes('no-store'), `status=${root.status} type=${root.type} cache=${root.cache} 长度=${root.text.length}`);

  const spa = await get('/some/unknown/route');
  ok('未知路径回落到 index.html（SPA 路由）', spa.status === 200 && spa.text === root.text, `status=${spa.status} 与 index.html 相同=${spa.text === root.text}`);

  const miss = await get('/definitely-missing.js');
  ok('带扩展名的缺失资源 → 404（不回落，避免把 JS 当 HTML 喂给浏览器）', miss.status === 404, `status=${miss.status}`);

  const comps = await get('/__components');
  const compJson = JSON.parse(comps.text);
  ok('GET /__components 走**组件目录覆盖**（能列出临时目录里的那个组件）', comps.status === 200 && compJson.files.includes('liveWidget.js'), `files=${JSON.stringify(compJson.files)}`);

  const compFile = await get('/组件/liveWidget.js');
  ok('GET /组件/<name> 从组件目录热加载并给 JS 类型', compFile.status === 200 && compFile.type.includes('javascript') && compFile.text.includes('__liveOk'), `status=${compFile.status} type=${compFile.type}`);

  const info = await get('/__loginfo');
  const infoJson = JSON.parse(info.text);
  ok('GET /__loginfo 报告的是**覆盖后**的日志目录', info.status === 200 && infoJson.dir === logDir && infoJson.enabled === true, `dir=${infoJson.dir}`);

  const rlog = await post('/__log', { kind: 'check', lines: ['第一行', '第二行'] });
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const logFile = join(logDir, `check-${stamp}.log`);
  ok('POST /__log 真落盘到覆盖后的目录且按天分文件', rlog.status === 200 && rlog.json.ok && existsSync(logFile) && readFileSync(logFile, 'utf8').includes('第一行'), `file=${logFile} bytes=${rlog.json.bytes}`);

  const rsave = await post('/__save', { path: 'docs/组件清单.md', text: '# 清单\n' });
  ok('POST /__save 写到覆盖后的 docs 目录', rsave.status === 200 && rsave.json.ok && existsSync(join(docsDir, '组件清单.md')), `file=${rsave.json.file}`);

  const trav1 = await post('/__save', { path: '../evil.md', text: 'x' });
  const trav2 = await post('/__save', { path: 'docs/../../evil.md', text: 'x' });
  const trav3 = await post('/__save', { path: 'C:/Windows/evil.md', text: 'x' });
  ok('路径穿越被拒（../ 、../../ 、盘符绝对路径都是 403）', [trav1, trav2, trav3].every((x) => x.status === 403 && x.json && x.json.ok === false), `../=${trav1.status} ../../=${trav2.status} C:/=${trav3.status}`);

  const rplug = await post('/__savePlugin', { name: '生成的组件.js', text: 'window.x=1;' });
  ok('POST /__savePlugin 写回组件目录', rplug.status === 200 && rplug.json.ok && existsSync(join(componentsDir, '生成的组件.js')), `file=${rplug.json.file}`);
  const badPlug = await post('/__savePlugin', { name: '../x.js', text: 'x' });
  const badPlug2 = await post('/__savePlugin', { name: '_manifest.json', text: 'x' });
  ok('组件名白名单：拒绝路径与下划线开头的内部文件', badPlug.status === 403 && badPlug2.status === 403, `../x.js=${badPlug.status} _manifest.json=${badPlug2.status}`);

  const big = await fetch(base + '/__log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(600 * 1024) }).catch((e) => ({ status: -1, text: async () => String(e) }));
  ok('超过 512KB 的写入被拒（413）', big.status === 413, `status=${big.status}`);
  await big.text().catch(() => '');

  const badRoute = await fetch(base + '/__nope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok('未知 POST 路由 → 404', badRoute.status === 404, `status=${badRoute.status}`);
  await badRoute.text();

  const p = web.port;
  await web.close();
  cleanups.pop();
  const closed = await fetch(`http://127.0.0.1:${p}/`).then(() => false).catch(() => true);
  ok('close() 之后端口真的释放了', closed, `再连 http://127.0.0.1:${p}/ 失败=${closed}`);
  return { web, logDir, docsDir, componentsDir };
}

/* ═══════════ E MCP 子进程 ═══════════ */
async function testMcp(dev) {
  G('E MCP 子进程（真拉起 / 真握手 / 真重启 / 真收尾）');
  const { createMcpSupervisor, probeMcp, mcpRequest, parseRpcBody } = await import('../src/mcpSupervisor.js');
  const { createLogger } = await import('../src/logger.js');
  const logger = createLogger({ logDir: join(tmp, 'logs') });

  const liveWorkspace = join(REPO_ROOT, 'editor-mcp', 'workspace');
  const snapshot = (d) => {
    try {
      const files = readdirSync(d);
      return { n: files.length, newest: files.reduce((m, f) => Math.max(m, statSync(join(d, f)).mtimeMs), 0) };
    } catch {
      return { n: -1, newest: -1 };
    }
  };
  const before = snapshot(liveWorkspace);

  const freePort = async () => {
    const s = createHttpServer(() => {});
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const p = s.address().port;
    await new Promise((r) => s.close(r));
    return p;
  };
  const httpPort = await freePort();
  const bridgePort = await freePort();
  const workspace = join(tmp, 'mcp-workspace');

  const sup = createMcpSupervisor({
    token: P0_TOKEN,
    nodeBin: process.execPath,
    nodeEnv: {}, // 验证脚本是纯 Node，不要带 ELECTRON_RUN_AS_NODE
    mcpEntry: dev.mcpEntry,
    mcpRoot: dev.mcpRoot,
    host: '127.0.0.1',
    port: httpPort,
    bridgePort,
    workspace,
    pluginDir: dev.pluginDir,
    allowWrite: true,
    readyTimeoutMs: 20000,
    autoRestart: true,
    logger,
  });
  cleanups.push(() => sup.stop());

  const st = await sup.start();
  ok('拉起 editor-mcp --http 并在超时内就绪', st.state === 'ready' && !st.external && st.pid > 0, `state=${st.state} pid=${st.pid} url=${st.url}${st.lastError ? ` 错误=${st.lastError}` : ''}`);
  ok('无头文档目录被自动创建', existsSync(workspace), `workspace=${workspace}`);

  const probe = await probeMcp(st.url, { token: P0_TOKEN, timeoutMs: 4000 });
  ok('握手探测通过（initialize 返回 result）', probe.ok, `serverInfo=${JSON.stringify(probe.serverInfo)} 协议=${probe.protocolVersion}`);

  // 真跑一次 MCP 会话：initialize → initialized → tools/list
  const init = await mcpRequest(st.url, { token: P0_TOKEN,
    timeoutMs: 8000,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify-desktop', version: '0.1.0' } } },
  });
  const sid = init.sessionId;
  await mcpRequest(st.url, { token: P0_TOKEN,
    timeoutMs: 8000,
    sessionId: sid,
    body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  });
  const list = await mcpRequest(st.url, { token: P0_TOKEN, timeoutMs: 15000, sessionId: sid, body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
  const listJson = parseRpcBody(list.body);
  const tools = listJson?.result?.tools ?? [];
  ok('外部 AI 客户端能列出工具（tools/list 真的返回工具表）', Boolean(sid) && tools.length > 20, `session=${String(sid).slice(0, 8)}… 工具数=${tools.length} 例：${tools.slice(0, 3).map((t) => t.name).join(', ')}`);
  await mcpRequest(st.url, { token: P0_TOKEN, method: 'DELETE', sessionId: sid, timeoutMs: 3000 });

  const pid1 = st.pid;
  const re = await sup.restart();
  ok('重启：状态回到 ready 且是新进程', re.state === 'ready' && re.pid > 0 && re.pid !== pid1, `旧 pid=${pid1} 新 pid=${re.pid}`);
  const probeAfterRestart = await probeMcp(re.url, { token: P0_TOKEN, timeoutMs: 4000 });
  ok('重启后仍能握手', probeAfterRestart.ok, `ok=${probeAfterRestart.ok}`);

  // 接管：先手动起一个，再让 supervisor 去 start()，应当"接管"而不是再起一个
  const adoptPort = await freePort();
  const adoptBridge = await freePort();
  const raw = spawn(process.execPath, [dev.mcpEntry, '--http', '--port', String(adoptPort)], {
    cwd: dev.mcpRoot,
    env: { ...process.env, EDITOR_MCP_BRIDGE_URL: `ws://127.0.0.1:${adoptBridge}/bridge`, EDITOR_MCP_WORKSPACE: join(tmp, 'mcp-workspace-adopt') },
    stdio: 'ignore',
    windowsHide: true,
  });
  cleanups.push(() => {
    try {
      raw.kill('SIGKILL');
    } catch {
      /* 已退出 */
    }
  });
  const adoptUrl = `http://127.0.0.1:${adoptPort}/mcp`;
  let adopted = null;
  for (let i = 0; i < 40 && !adopted; i += 1) {
    const pr = await probeMcp(adoptUrl, { token: P0_TOKEN, timeoutMs: 1500 });
    if (pr.ok) adopted = pr;
    else await sleep(400);
  }
  if (!adopted) {
    skip('端口上已有可用 MCP 时"接管"而不是重复拉起', `手动起的那个 MCP 没能在 16s 内就绪（pid=${raw.pid}）`);
  } else {
    const sup2 = createMcpSupervisor({
    token: P0_TOKEN,
      nodeBin: process.execPath,
      nodeEnv: {},
      mcpEntry: dev.mcpEntry,
      mcpRoot: dev.mcpRoot,
      host: '127.0.0.1',
      port: adoptPort,
      bridgePort: adoptBridge,
      workspace: join(tmp, 'mcp-workspace-adopt'),
      readyTimeoutMs: 8000,
      logger,
    });
    const st2 = await sup2.start();
    ok('端口上已有可用 MCP 时"接管"而不是重复拉起', st2.state === 'ready' && st2.external === true && st2.pid === null, `state=${st2.state} external=${st2.external} pid=${st2.pid}`);
    await sup2.stop();
    const stillAlive = await probeMcp(adoptUrl, { token: P0_TOKEN, timeoutMs: 2000 });
    ok('接管来的外部进程：应用停止时**不动它**（它不归本应用管）', stillAlive.ok, `stop() 后仍能握手=${stillAlive.ok}`);
  }

  /**
   * ★版本不一致时**拒绝接管**（2026-09-28 加）。
   * 真踩过的风险：端口上恰好是另一个版本（旧安装版 / DSH 自己拉起的实例）时，老实现只要"能握手"就接管，
   * 于是 agent 静默连到了**别人的工具表与工作区**，而界面还显示"就绪"。这里用一个自报 9.9.9 的假 MCP 验它。
   */
  {
    const fakePort = adoptPort + 7;
    const fake = createHttpServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let id = 1;
        try {
          id = JSON.parse(raw).id ?? 1;
        } catch {
          /* 忽略 */
        }
        const body = JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '9.9.9' } },
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'mcp-session-id': 'fake-session' });
        res.end(body);
      });
    });
    await new Promise((r) => fake.listen(fakePort, '127.0.0.1', () => r()));
    try {
      const sup3 = createMcpSupervisor({
    token: P0_TOKEN,
        nodeBin: process.execPath,
        nodeEnv: {},
        mcpEntry: dev.mcpEntry,
        mcpRoot: dev.mcpRoot,
        host: '127.0.0.1',
        port: fakePort,
        bridgePort: adoptBridge + 7,
        workspace: join(tmp, 'mcp-workspace-foreign'),
        readyTimeoutMs: 5000,
        logger,
      });
      const st3 = await sup3.start();
      ok(
        '端口上是**别的版本**的 MCP 时拒绝接管（否则 agent 会静默连错实例）',
        st3.state === 'failed' && /拒绝接管/.test(String(st3.lastError ?? '')),
        `state=${st3.state} external=${st3.external} lastError=${String(st3.lastError ?? '').slice(0, 130)}`,
      );
      await sup3.stop();
    } finally {
      await new Promise((r) => fake.close(() => r()));
    }
  }

  // 收尾：真停掉，端口应释放
  const stoppedPid = sup.status().pid;
  await sup.stop();
  let gone = false;
  for (let i = 0; i < 20 && !gone; i += 1) {
    const pr = await probeMcp(sup.url, { token: P0_TOKEN, timeoutMs: 1000 });
    gone = !pr.ok;
    if (!gone) await sleep(300);
  }
  ok('stop() 之后 MCP 真的不在了（端口释放）', gone && sup.status().state === 'stopped', `pid=${stoppedPid} 状态=${sup.status().state}`);

  // 桥接中转端口被别人占着（本机常见：DSH 自己也起了一个 editor-mcp）→ 必须能照常服务，并把原因写进日志
  const busyBridge = createHttpServer(() => {});
  await new Promise((r) => busyBridge.listen(0, '127.0.0.1', r));
  const busyPort = busyBridge.address().port;
  const busyHttp = await freePort();
  const lines = [];
  const capLogger = createLogger({ logDir: join(tmp, 'logs') });
  capLogger.onLine((l) => lines.push(l));
  const sup3 = createMcpSupervisor({
    token: P0_TOKEN,
    nodeBin: process.execPath,
    nodeEnv: {},
    mcpEntry: dev.mcpEntry,
    mcpRoot: dev.mcpRoot,
    host: '127.0.0.1',
    port: busyHttp,
    bridgePort: busyPort, // ← 已被占用
    workspace: join(tmp, 'mcp-workspace-busy'),
    readyTimeoutMs: 20000,
    logger: capLogger,
  });
  const st3 = await sup3.start();
  const list3 = await mcpRequest(st3.url, { token: P0_TOKEN,
    timeoutMs: 15000,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify-busy', version: '0.1.0' } } },
  });
  const sid3 = list3.sessionId;
  await mcpRequest(st3.url, { token: P0_TOKEN, timeoutMs: 8000, sessionId: sid3, body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
  const tools3 = await mcpRequest(st3.url, { token: P0_TOKEN, timeoutMs: 15000, sessionId: sid3, body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
  const n3 = (parseRpcBody(tools3.body)?.result?.tools ?? []).length;
  ok('桥接端口被占时优雅降级：MCP 仍就绪、工具表照常返回，并把原因写进日志', st3.state === 'ready' && n3 > 20 && lines.some((l) => l.includes('桥接中转未能启动')), `state=${st3.state} 工具数=${n3}；日志里那句=${lines.find((l) => l.includes('桥接中转未能启动'))?.slice(-60) ?? '(没有)'}`);
  await mcpRequest(st3.url, { token: P0_TOKEN, method: 'DELETE', sessionId: sid3, timeoutMs: 3000 });
  await sup3.stop();
  await new Promise((r) => busyBridge.close(r));

  const after = snapshot(liveWorkspace);
  ok('全程没碰用户的活文档目录 editor-mcp/workspace', before.n === after.n && before.newest === after.newest, `前 ${before.n} 个文件/最新 ${new Date(before.newest).toISOString()}；后 ${after.n} 个/最新 ${new Date(after.newest).toISOString()}`);
}

/* ═══════════ G MCP 单文件打包 ═══════════ */
async function testMcpBundle() {
  G('G MCP 单文件打包（分发版唯一可靠形态）');
  const { bundleMcp } = await import('./bundle-mcp.mjs');
  const { createMcpSupervisor, mcpRequest, parseRpcBody } = await import('../src/mcpSupervisor.js');
  const { createLogger } = await import('../src/logger.js');
  const logger = createLogger({ logDir: join(tmp, 'logs') });

  const iso = join(tmp, 'bundle-iso');
  const outfile = join(iso, 'editor-mcp.bundle.mjs');
  let built;
  try {
    built = await bundleMcp({ outfile, quiet: true });
  } catch (e) {
    ok('把 editor-mcp 打成单文件（esbuild bundle）', false, `打包失败：${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  ok('把 editor-mcp 打成单文件（esbuild bundle）', existsSync(outfile) && built.bytes > 500 * 1024, `${(built.bytes / 1024 / 1024).toFixed(1)} MB 单文件（入口是已编译的 editor-mcp/dist/index.js）`);

  // ★真正要证明的是"自包含"：把它单独放进一个**没有 node_modules 的隔离目录**里，用文件重定向收输出
  const siblings = readdirSync(iso).filter((f) => f !== 'editor-mcp.bundle.mjs');
  const listProc = await new Promise((resolve) => {
    const outFile = join(tmp, 'bundle-list.out');
    const errFile = join(tmp, 'bundle-list.err');
    const fdOut = openSync(outFile, 'w');
    const fdErr = openSync(errFile, 'w');
    const c = spawn(process.execPath, [outfile, '--list'], { cwd: iso, stdio: ['ignore', fdOut, fdErr] });
    c.on('exit', (code) => {
      closeSync(fdOut);
      closeSync(fdErr);
      resolve({ code, out: readFileSync(outFile, 'utf8'), err: readFileSync(errFile, 'utf8') });
    });
    c.on('error', (e) => {
      closeSync(fdOut);
      closeSync(fdErr);
      resolve({ code: -1, out: '', err: e.message });
    });
  });
  let manifest = null;
  try {
    manifest = JSON.parse(listProc.out);
  } catch {
    manifest = null;
  }
  ok('单文件在"旁边没有 node_modules"的隔离目录里能独立跑（不依赖 DSH 的 pnpm store）', listProc.code === 0 && siblings.length === 0 && (manifest?.tools?.length ?? 0) > 100, `隔离目录里只有 ${siblings.length + 1} 个文件；exit=${listProc.code}；--list 报出 tools=${manifest?.tools?.length ?? '解析失败'} resources=${manifest?.resources?.length ?? '?'} prompts=${manifest?.prompts?.length ?? '?'}`);

  // 再用真监管器把它当 MCP 拉起来，走一遍 initialize + tools/list —— 证明"打包后的文件真能对外服务"
  const freePort = async () => {
    const s = createHttpServer(() => {});
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const p = s.address().port;
    await new Promise((r) => s.close(r));
    return p;
  };
  const sup = createMcpSupervisor({
    token: P0_TOKEN,
    nodeBin: process.execPath,
    nodeEnv: {},
    mcpEntry: outfile,
    mcpRoot: iso,
    host: '127.0.0.1',
    port: await freePort(),
    bridgePort: await freePort(),
    workspace: join(tmp, 'bundle-workspace'),
    readyTimeoutMs: 20000,
    logger,
  });
  const st = await sup.start();
  const init = await mcpRequest(st.url, { token: P0_TOKEN,
    timeoutMs: 10000,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify-bundle', version: '0.1.0' } } },
  });
  const sid = init.sessionId;
  await mcpRequest(st.url, { token: P0_TOKEN, timeoutMs: 8000, sessionId: sid, body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
  const tools = await mcpRequest(st.url, { token: P0_TOKEN, timeoutMs: 15000, sessionId: sid, body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
  const names = (parseRpcBody(tools.body)?.result?.tools ?? []).map((t) => t.name);
  ok('打包后的单文件作为 MCP 对外服务：就绪 + tools/list 返回真实工具名', st.state === 'ready' && names.length > 100 && names.every((n) => typeof n === 'string' && n.length > 0), `state=${st.state} 工具数=${names.length} 例：${names.slice(0, 3).join(', ')}`);
  await mcpRequest(st.url, { token: P0_TOKEN, method: 'DELETE', sessionId: sid, timeoutMs: 3000 });
  await sup.stop();
}

/* ═══════════ F 静态检查 ═══════════ */

/**
 * 极简 glob → 正则（只支持 electron-builder `files` 里真正用到的那几种写法：`**`、`*`、后缀）。
 * 为什么要它：真踩过一次 —— `files` 里漏了 `server/**​/*`，asar 里没有 `server/webServer.js`，
 * 打包版 ESM 入口一 import 就崩，而**桌面程序没有终端**，现象只是"双击没反应/卡住"。
 * 所以这里把"入口会 import 到的本地文件"逐个对 `files` 做匹配，缺一个就 FAIL。
 */
function globToRegExp(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = esc
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${body}$`);
}

/**
 * 扫出一个文件里所有 `from './x.js'` / `import('./x.js')` 形式的**本地**依赖（递归）。
 * ⚠ 这里路径一律以 APP_DIR 为基准解析：早先写成 `resolve(dirname(相对路径), …)` 会以 CWD 为基准，
 * 于是算出 APP_DIR 之外的路径、递归读到不存在的文件直接抛错（自己的检查脚本先把验证搞崩了）。
 */
function localImports(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const abs = join(APP_DIR, file);
  if (!existsSync(abs)) return seen;
  const text = readFileSync(abs, 'utf8');
  const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const target = resolve(dirname(abs), m[1]);
    if (!target.startsWith(APP_DIR)) continue;
    localImports(relative(APP_DIR, target).replace(/\\/g, '/'), seen);
  }
  return seen;
}

async function testPackagingManifest() {
  G('F2 打包清单完整性（真踩过：漏一个文件 → 双击没反应）');
  const pkg = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8'));
  const patterns = (pkg.build?.files ?? []).filter((p) => !String(p).startsWith('!')).map(globToRegExp);
  const entrances = ['main.js', 'preload.cjs'];
  const needed = new Set();
  for (const e of entrances) for (const f of localImports(e)) needed.add(f);
  const missing = [...needed].filter((f) => !patterns.some((re) => re.test(f)));
  ok(
    '入口 import 到的每个本地文件都被 build.files 覆盖（否则 asar 里会缺文件）',
    missing.length === 0,
    missing.length ? `缺：${missing.join(', ')}` : `${needed.size} 个本地依赖全部命中：${[...needed].sort().join(', ')}`,
  );
  const hasServerGlob = (pkg.build?.files ?? []).some((p) => String(p).startsWith('server/'));
  ok('server/ 目录在 build.files 里（它不在 src/ 下，最容易漏）', hasServerGlob, (pkg.build?.files ?? []).join(', '));

  /**
   * ★版本号必须**单一来源**（根 `package.json`）。
   * 注意：**Live 的就绪判据已经不是版本全等**了 —— §5.1 起改成"桥接协议 + 能力"（见下一条断言），
   * 所以版本号不一致**不再**直接废掉 Live；但"对外版本"只能有一个来源（发行物、诊断、更新都用它）。
   * P1③ 起版本由 `tools/sync-contracts.mjs` **生成**到各包（`package.json` 与 `version.ts`），
   * 所以这里比对的是生成物，而不是"每个文件里手写的字面量"。
   */
  const repo = resolve(APP_DIR, '..', '..');
  const readJson = (rel) => JSON.parse(readFileSync(join(repo, rel), 'utf8'));
  const grab = (rel, re) => (re.exec(readFileSync(join(repo, rel), 'utf8'))?.[1] ?? null);
  const rootVersion = readJson('package.json').version;
  const versionOf = (rel) => readJson(rel).version;
  const generatedVersion = (rel) => grab(rel, /VERSION\s*=\s*'([^']+)'/);
  const versions = {
    '根 package.json（唯一来源）': rootVersion,
    'contracts/version.json': readJson(join('contracts', 'version.json')).version,
    'apps/desktop/package.json': versionOf(join('apps', 'desktop', 'package.json')),
    'web-editor/package.json': versionOf(join('web-editor', 'package.json')),
    'editor-mcp/package.json': versionOf(join('editor-mcp', 'package.json')),
    'editor-mcp/src/version.ts（生成）': generatedVersion(join('editor-mcp', 'src', 'version.ts')),
    'web-editor/src/version.ts（生成）': generatedVersion(join('web-editor', 'src', 'version.ts')),
  };
  const uniq = [...new Set(Object.values(versions).filter(Boolean))];
  ok(
    '版本号单一来源（根 package.json → 各包 package.json 与 version.ts 由生成器同步）',
    uniq.length === 1 && Object.values(versions).every(Boolean),
    Object.entries(versions).map(([k, v]) => `${k}=${v ?? '?'}`).join('；'),
  );

  /**
   * ★§5.1：**桥接协议版本**跨包一致，且**能力名**都在 MCP 的契约里。
   * 协议号现在是"生成链"：`protocolGate.ts`（权威）→ `contracts/version.json` → 两端的 `version.ts`。
   * 漂移的后果比版本号更隐蔽 —— 协议号不一致会让所有依赖能力的方法静默走无头（界面只表现为"不实时"）。
   */
  const mcpProtocol = Number(grab(join('editor-mcp', 'src', 'bridge', 'protocolGate.ts'), /EDITOR_PROTOCOL\s*=\s*(\d+)/));
  const fileProtocol = Number(readJson(join('contracts', 'version.json')).protocol);
  const pageProtocol = Number(grab(join('web-editor', 'src', 'version.ts'), /EDITOR_PROTOCOL\s*=\s*(\d+)/));
  ok(
    '§5.1：桥接**协议版本**单一来源（protocolGate → contracts/version.json → 两端生成物）',
    mcpProtocol > 0 && mcpProtocol === fileProtocol && fileProtocol === pageProtocol,
    `protocolGate=${mcpProtocol || '?'} contracts=${fileProtocol || '?'} 页面生成物=${pageProtocol || '?'}`,
  );
  const featsOf = (rel, re, kind) => {
    const text = readFileSync(join(repo, rel), 'utf8');
    const block = re.exec(text)?.[1] ?? '';
    // 页面是**值**（`exportDocx: true`）；MCP 侧是**接口类型声明**（`exportDocx?: boolean`）
    const names =
      kind === 'types'
        ? [...block.matchAll(/^\s*(\w+)\?:/gm)].map((m) => m[1])
        : [...block.matchAll(/(\w+)\s*:\s*(?:true|false)/g)].map((m) => m[1]);
    return [...new Set(names)].sort();
  };
  const pageFeats = featsOf(join('web-editor', 'src', 'mcp', 'protocol.ts'), /EDITOR_FEATURES[^=]*=\s*\{([\s\S]*?)\n\};/, 'values');
  const mcpFeats = featsOf(join('editor-mcp', 'src', 'bridge', 'protocolGate.ts'), /interface EditorFeatures\s*\{([\s\S]*?)\n\}/, 'types');
  ok(
    '§5.1：**能力集**跨包一致（页面报的能力名都在 MCP 的契约里）',
    pageFeats.length > 0 && pageFeats.every((f) => mcpFeats.includes(f)),
    `页面=[${pageFeats.join(',')}] MCP=[${mcpFeats.join(',')}]`,
  );

  /**
   * ★端口是"文档与代码最容易各说各话"的事实（4 份 README 里出现过 20 次）。
   * P2⑥ 起：端口只在**根 README** 里列表，其余 README 指过去；这里做两道机械检查 ——
   *   ① 代码里的权威值（hub 取自 `config.bridgeUrl`、静态服务器取自 `DEFAULT_PORT`）必须与根 README 写的一致；
   *   ② 任何 README 都不许出现"第三个"端口号（抓打错的 37649 / 旧端口残留）。
   */
  const mcpConfig = readFileSync(join(repo, 'editor-mcp', 'src', 'config.ts'), 'utf8');
  const hubPort = Number(/bridgeUrl: env\([^,]+,\s*'ws:\/\/127\.0\.0\.1:(\d+)\/bridge'/.exec(mcpConfig)?.[1]);
  const staticPort = Number(/const DEFAULT_PORT = (\d+)/.exec(readFileSync(join(APP_DIR, 'server', 'webServer.js'), 'utf8'))?.[1]);
  const pyPort = Number(/--port", type=int, default=(\d+)/.exec(readFileSync(join(repo, 'web-editor', '启动编辑器.py'), 'utf8'))?.[1]);
  const rootReadme = readFileSync(join(repo, 'README.md'), 'utf8');
  const canonical = [hubPort, staticPort];
  ok(
    '静态服务器端口：JS（规范实现）与 Python（降级备用）默认值一致',
    staticPort > 0 && staticPort === pyPort,
    `webServer.DEFAULT_PORT=${staticPort || '?'}，启动编辑器.py default=${pyPort || '?'}`,
  );
  ok(
    '根 README 写出了权威端口（hub 与静态服务器）',
    canonical.every((p) => p > 0 && rootReadme.includes(String(p))),
    `hub=${hubPort || '?'}、静态=${staticPort || '?'}；README 命中=${canonical.filter((p) => rootReadme.includes(String(p))).join(',') || '(无)'}`,
  );
  const readmes = ['README.md', 'apps/desktop/README.md', 'editor-mcp/README.md', 'web-editor/README.md']
    .map((r) => ({ r, text: readFileSync(join(repo, r), 'utf8') }))
    .filter((x) => x.text);
  const stray = [];
  for (const { r, text } of readmes) {
    for (const m of text.matchAll(/\b(3765\d|37[0-9]{3}|5179)\b/g)) {
      const n = Number(m[1]);
      // 允许集合 = 两个权威端口 + MCP HTTP（37651，属于既定约定）
      if (![hubPort, staticPort, 37651].includes(n)) stray.push(`${r}:${n}`);
    }
  }
  ok(
    'README 里没有"第三个"端口（抓打错的端口号 / 旧端口残留）',
    stray.length === 0,
    stray.length ? `可疑：${[...new Set(stray)].join(', ')}` : `扫描 ${readmes.length} 份 README，端口取值都在 {${[...new Set([hubPort, staticPort, 37651])].join(', ')}} 内`,
  );
  /**
   * ★生成物不得漂移：`--check` 会比对"磁盘上现在的内容"与"重新生成的结果"。
   * 这条抓的是"有人手改了 `version.ts`/`contracts/*.json`/某个 package.json 的版本号"。
   */
  const gen = spawnSync(process.execPath, [join(repo, 'tools', 'sync-contracts.mjs'), '--check'], {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
  });
  ok(
    '契约生成物与源一致（`tools/sync-contracts.mjs --check`：版本/协议/方法清单都无法手改）',
    gen.status === 0,
    (gen.stdout || '').trim().split('\n').slice(-2).join(' ｜ ') || (gen.stderr || '').trim().slice(0, 200),
  );
  // 打包版要用的两个数据文件必须在 asar **外面**（密钥要能被替换、密文要能现场换）
  const er = (pkg.build?.extraResources ?? []).map((r) => String(r.to));
  ok('config/{app-config.enc, buildKey.mjs} 都在 extraResources（打包版从 resources/config 读密钥）', er.includes('config/app-config.enc') && er.includes('config/buildKey.mjs') && !er.includes('config/buildKey.js'), er.join(', '));

  /**
   * ★用**打包运行时真正用的那个 Node**再验一次密钥能不能加载。
   * 为什么必须这样验：Electron 33 自带 Node **20.18.3**，它没有"ESM 语法自动探测"；
   * 而随包密钥以前是 `.js` 装 ESM 语法，落在 `%TEMP%` 解包目录 / Program Files（向上都没有 package.json）
   * 时会被当 CommonJS → import 语法错误 → 应用只好退回默认配置。用本机的 Node 24 验**验不出来**
   * （24 会先按 CJS 失败再自动按 ESM 重试）。所以这里直接拿 electron.exe 当 node 跑。
   */
  const electronBin = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
  const isoDir = join(tmp, 'runtime-iso');
  mkdirSync(isoDir, { recursive: true });
  copyFileSync(join(APP_DIR, 'config', 'app-config.enc'), join(isoDir, 'app-config.enc'));
  copyFileSync(join(APP_DIR, 'config', 'buildKey.mjs'), join(isoDir, 'buildKey.mjs'));
  const probe = join(isoDir, 'probe.mjs');
  writeFileSync(
    probe,
    [
      "import { pathToFileURL } from 'node:url';",
      "import { readFileSync } from 'node:fs';",
      'const m = await import(pathToFileURL(process.argv[2]).href);',
      'const core = await import(pathToFileURL(process.argv[3]).href);',
      "const plain = core.decryptConfig(readFileSync(process.argv[4], 'utf8'), m.BUILD_CONFIG_KEY);",
      "console.log('KEYOK ' + plain.update.baseUrl + ' ' + m.BUILD_KEY_FINGERPRINT);",
    ].join('\n'),
    'utf8',
  );
  const origin = join(REPO_ROOT, 'tools', 'secure-config', 'secure-config.mjs');
  if (!existsSync(electronBin)) {
    skip('打包运行时（Electron 自带的 Node）在"没有 package.json 的目录"里能加载随包密钥', '未安装 electron（npm install 后才能验这一条）');
  } else {
    const outFile = join(tmp, 'runtime-probe.out');
    const errFile = join(tmp, 'runtime-probe.err');
    const r = await new Promise((resolve) => {
      const fdOut = openSync(outFile, 'w');
      const fdErr = openSync(errFile, 'w');
      const c = spawn(electronBin, [probe, join(isoDir, 'buildKey.mjs'), origin, join(isoDir, 'app-config.enc')], {
        cwd: isoDir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', fdOut, fdErr],
      });
      c.on('exit', (code) => {
        closeSync(fdOut);
        closeSync(fdErr);
        resolve({ code, out: readFileSync(outFile, 'utf8'), err: readFileSync(errFile, 'utf8') });
      });
      c.on('error', (e) => {
        closeSync(fdOut);
        closeSync(fdErr);
        resolve({ code: -1, out: '', err: e.message });
      });
    });
    const nodeVer = await new Promise((resolve) => {
      const o = join(tmp, 'electron-node-ver.out');
      const fd = openSync(o, 'w');
      const c = spawn(electronBin, ['-e', 'process.stdout.write(process.versions.node)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', fd, 'ignore'] });
      c.on('exit', () => {
        closeSync(fd);
        resolve(readFileSync(o, 'utf8').trim());
      });
      c.on('error', () => {
        closeSync(fd);
        resolve('?');
      });
    });
    ok(
      '打包运行时（Electron 自带的 Node）在"没有 package.json 的目录"里能加载随包密钥',
      r.code === 0 && /KEYOK/.test(r.out),
      `Electron 自带 Node ${nodeVer}；exit=${r.code}；输出=${r.out.trim() || '(空)'}${r.code !== 0 ? `；stderr=${r.err.split('\n').slice(0, 2).join(' / ')}` : ''}`,
    );
  }
}

/* ═══════════ F 静态检查 ═══════════ */
async function testStatic() {
  G('F 语法与安全基线（静态检查）');
  const files = ['main.js', 'preload.cjs', 'src/paths.js', 'src/logger.js', 'src/secureConfig.js', 'src/mcpSupervisor.js', 'src/updater.js', 'src/components.js', 'server/webServer.js', 'scripts/embed-key.mjs', 'scripts/bundle-mcp.mjs'];
  // ★stderr 重定向到**文件**而不是管道：受限沙箱里管道 stdio 会被拒（EPERM）
  const errFile = join(tmp, 'node-check.err');
  const parse = (file) =>
    new Promise((resolve) => {
      const fd = openSync(errFile, 'w');
      let c;
      try {
        c = spawn(process.execPath, ['--check', file], { cwd: APP_DIR, stdio: ['ignore', 'ignore', fd] });
      } catch (e) {
        closeSync(fd);
        resolve({ file, code: -1, err: e.message });
        return;
      }
      c.on('exit', (code) => {
        closeSync(fd);
        resolve({ file, code, err: readFileSync(errFile, 'utf8').trim() });
      });
      c.on('error', (e) => {
        closeSync(fd);
        resolve({ file, code: -1, err: e.message });
      });
    });
  const parsed = [];
  for (const f of files) parsed.push(await parse(f));
  ok('全部新文件语法通过（node --check）', parsed.every((p) => p.code === 0), parsed.filter((p) => p.code !== 0).map((p) => `${p.file}: ${p.err.split('\n')[0]}`).join(' ｜ ') || `${files.length} 个文件全部通过`);

  const text = (p) => readFileSync(join(APP_DIR, p), 'utf8');
  const main = text('main.js');
  const preload = text('preload.cjs');
  ok('安全基线：contextIsolation 开、nodeIntegration 关、sandbox 开', /contextIsolation:\s*true/.test(main) && /nodeIntegration:\s*false/.test(main) && /sandbox:\s*true/.test(main), 'main.js webPreferences 三项都在');
  ok('外链只放行 http/https，其余拒绝', main.includes('/^https?:\\/\\//i') && /只允许 http\/https 链接/.test(main), 'main.js openExternal 里 /^https?:\\/\\//i 协议白名单 + 拒绝文案都在');
  ok('preload 只暴露 window.desktop，不把 ipcRenderer 原样透出', /exposeInMainWorld\('desktop'/.test(preload) && !/exposeInMainWorld\([^)]*ipcRenderer/.test(preload), 'contextBridge.exposeInMainWorld("desktop", api)');
  ok('preload 没有暴露 fs / child_process 之类 Node 能力', !/require\(['"](node:)?(fs|child_process|net|http)['"]\)/.test(preload), 'preload 只 require("electron")');
  const pkg = JSON.parse(text('package.json'));
  ok('打包配置里有 extraResources（业务资源不进 asar，子进程才能跑）', Array.isArray(pkg.build?.extraResources) && pkg.build.extraResources.some((r) => String(r.to).includes('web-editor')), pkg.build.extraResources.map((r) => r.to).join(', '));
  ok('不再把 editor-mcp/node_modules 打进包（它是符号链接拼的，装不进安装包），改为单文件 bundle', !pkg.build.extraResources.some((r) => String(r.to).includes('node_modules')) && pkg.build.extraResources.some((r) => String(r.to).includes('editor-mcp-bundle')) && /bundle:mcp/.test(pkg.scripts?.dist ?? ''), `extraResources 有 editor-mcp-bundle=${pkg.build.extraResources.some((r) => String(r.to).includes('editor-mcp-bundle'))}；dist 脚本先打包=${pkg.scripts?.dist}`);
  ok('加密配置与密钥都在（开箱即用）', existsSync(join(APP_DIR, 'config', 'app-config.enc')) && existsSync(join(APP_DIR, 'config', 'buildKey.mjs')) && existsSync(join(APP_DIR, 'config', 'config.key')), 'config/{app-config.enc, buildKey.mjs, config.key}');
  // P0 ⑥：明文密钥必须**只在本地**——曾经它被 git 跟踪过，首次推送 GitHub 前才移出（d99a95c）。
  // 这条断言就是防它再被加回来（.gitignore 覆盖 + 不在索引里，两个条件都要满足）。
  const trackedKey = spawnSync('git', ['-C', REPO_ROOT, 'ls-files', '--error-unmatch', 'apps/desktop/config/config.key'], { encoding: 'utf8', windowsHide: true });
  const ignoredKey = spawnSync('git', ['-C', REPO_ROOT, 'check-ignore', 'apps/desktop/config/config.key'], { encoding: 'utf8', windowsHide: true });
  ok(
    '明文密钥 config.key 不在版本库里（status≠0）且已被 .gitignore 覆盖',
    trackedKey.status !== 0 && ignoredKey.status === 0,
    `git ls-files status=${trackedKey.status}；git check-ignore=${String(ignoredKey.stdout).trim() || '未命中'}`,
  );
  // P0 ⑥：老 buildKey.js 的回退分支已删（安装包里只有 buildKey.mjs）
  ok(
    '代码里没有老 buildKey.js 回退分支',
    !/buildKeyLegacyPath/.test(text('src/paths.js')) && !/buildKeyLegacyPath/.test(text('src/secureConfig.js')),
    'paths.js / secureConfig.js 均无 buildKeyLegacyPath',
  );

  /* ── D16（P4）：属性面板/控件里**不得再用原生 `title`**（规格 §7：统一走自研气泡） ──
   * 做法：扫 web-editor/src 的 tsx，遇到 `title={` / `title="` 就**回溯找它的宿主 JSX 标签**
   * （按大括号深度跳过箭头函数里的 `>`，遇到 depth 0 的 `>` 说明已走出该元素）：
   *   · 小写标签（button/span/input/select…）= DOM 元素 → 违规；
   *   · 大写标签（Modal / Section / ToolButton…）= 组件 prop → 放行。
   * 这条断言是必要的：气泡改事件委托（`data-tip-text`）后，**误写回原生 title 不会有任何报错**，
   * 只会悄悄退化回系统提示（丑且不一致）。
   */
  const hostTagOf = (lines, row) => {
    const m = /(?<![-\w])title=\{/.exec(lines[row]) ?? /(?<![-\w])title="/.exec(lines[row]);
    let col = m ? m.index : lines[row].length;
    let depth = 0;
    for (let k = row; k >= 0 && k >= row - 40; k -= 1) {
      const lineText = lines[k];
      for (let c = (k === row ? col - 1 : lineText.length - 1); c >= 0; c -= 1) {
        const ch = lineText[c];
        if (ch === '}') depth += 1;
        else if (ch === '{') depth -= 1;
        else if (depth === 0) {
          if (ch === '>') return null; // 走出本元素（上一个兄弟/父级已闭合）
          if (ch === '<') {
            const t = /^([A-Za-z][\w.:-]*)/.exec(lineText.slice(c + 1));
            return t ? t[1] : null;
          }
        }
      }
    }
    return null;
  };
  const srcRoot = join(WEB_ROOT, 'src');
  const tsxFiles = [];
  const collectTsx = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) collectTsx(p);
      else if (e.name.endsWith('.tsx')) tsxFiles.push(p);
    }
  };
  collectTsx(srcRoot);
  const titleViolations = [];
  for (const f of tsxFiles) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((_l, i) => {
      if (!/(?<![-\w])title=\{/.test(lines[i]) && !/(?<![-\w])title="/.test(lines[i])) return;
      const tag = hostTagOf(lines, i);
      if (tag && /^[a-z]/.test(tag)) titleViolations.push(`${relative(REPO_ROOT, f).replace(/\\/g, '/')}:${i + 1} <${tag}>`);
    });
  }
  ok(
    'D16：属性面板/控件里没有原生 `title`（DOM 元素一律走 `data-tip-text` + 自研气泡）',
    titleViolations.length === 0,
    titleViolations.length ? `违规 ${titleViolations.length} 处：${titleViolations.slice(0, 5).join('、')}` : `扫描 ${tsxFiles.length} 个 tsx，0 处原生 title`,
  );
  const appText = readFileSync(join(srcRoot, 'App.tsx'), 'utf8');
  ok(
    'D16：气泡事件委托层 `TooltipLayer` 已挂载（否则 data-tip-text 是死属性）',
    /import\s*\{[^}]*TooltipLayer[^}]*\}/.test(appText) && /<TooltipLayer\s*\/>/.test(appText),
    'App.tsx 有 import TooltipLayer 且渲染了 <TooltipLayer />',
  );

  /* ── §7.4：菜单上**标注**的快捷键必须有实现（防"标了 Ctrl+S、按下去什么也不发生"） ──
   * 行为断言在页面自检里（selfCheck 会真按 Ctrl+, / Ctrl+X / Ctrl+Y / F11）；
   * 这里做静态兜底：MenuBar 出现的每条 shortcut 都要能在处理端起对应键。 */
  const menuSrc = readFileSync(join(srcRoot, 'components/layout/MenuBar.tsx'), 'utf8');
  const handlersSrc = [
    join(srcRoot, 'components/layout/useShortcuts.ts'),
    join(srcRoot, 'components/layout/fileActions.ts'),
    join(srcRoot, 'utils/viewActions.ts'),
  ]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const NEEDS = {
    'Ctrl+Z': "'z'",
    'Ctrl+Y': "'y'",
    'Ctrl+X': "'x'",
    'Ctrl+C': "'c'",
    'Ctrl+V': "'v'",
    'Ctrl+D': "'d'",
    'Ctrl+A': "'a'",
    'Ctrl+F': "'f'",
    'Ctrl+N': "'n'",
    'Ctrl+S': "'s'",
    'Ctrl+Shift+S': "'s'",
    'Ctrl+O': "'o'",
    'Ctrl+,': "','",
    'Ctrl+=': "'='",
    'Ctrl+-': "'-'",
    'Ctrl+0': "'0'",
    'Ctrl+Shift+M': "'m'",
    F11: 'F11',
    Delete: 'Delete',
  };
  const ALLOW_NATIVE = new Set(['Ctrl+P']); // 打印由浏览器负责
  const declared = [...new Set([...menuSrc.matchAll(/shortcut:\s*'([^']+)'/g)].map((m) => m[1]))];
  const unwired = declared.filter((s) => !ALLOW_NATIVE.has(s) && !(NEEDS[s] && handlersSrc.includes(NEEDS[s])));
  ok(
    '§7.4：菜单上标注的快捷键都有实现（Ctrl+P 由浏览器负责，豁免）',
    unwired.length === 0,
    unwired.length ? `缺实现：${unwired.join('、')}` : `${declared.length} 个快捷键全部有对应处理：${declared.join(' / ')}`,
  );
}

/* ═══════════ 主流程 ═══════════ */
process.stdout.write(`桌面分发版验证（临时目录 ${tmp}）\n`);
const { dev } = await testLayout();
await testComponents();
await testSecureConfig(dev);
await testUpdater();
await testWebServer(dev);
try {
  await testMcp(dev);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/EPERM|not permitted/i.test(msg)) {
    skip('E MCP 子进程（整段）', `本环境不允许 spawn + 管道捕获输出（${msg.slice(0, 60)}）—— 请用放宽的文件沙箱重跑本脚本`);
  } else {
    ok('E MCP 子进程（整段）', false, `抛错：${msg}`);
  }
}
await testStatic();
await testPackagingManifest();
await testMcpBundle();

for (const c of cleanups) {
  try {
    await c();
  } catch {
    /* 清理失败不影响结论 */
  }
}
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  /* Windows 上偶发占用，留着也无妨 */
}

const bad = results.filter((r) => !r.pass);
const skipped = results.filter((r) => r.skipped).length;
process.stdout.write(
  `\n═══ 结果：${results.length - bad.length}/${results.length} 通过${skipped ? `（${skipped} 项 SKIP）` : ''}${bad.length ? ` —— 失败 ${bad.length} 项` : ' 全部通过'} ═══\n`,
);
if (bad.length) for (const b of bad) process.stdout.write(`  ✗ [${b.group}] ${b.name}\n`);
process.exit(bad.length ? 1 : 0);
