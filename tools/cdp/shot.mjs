/**
 * 截图探针（入库版，P3-M6）：无头浏览器打开 URL → 可选先跑一段"页面预处理脚本"（点开面板、选中组件…）
 * → 截图到 PNG。**为什么要走 CDP**：很多界面状态要靠点击交互才出现，
 * 而 `--screenshot` 只能拍静态初始态。
 *
 *   node tools/cdp/shot.mjs <url> [输出png] [--js pre.js] [--full] [--width N] [--height N]
 *
 * 缺省输出：`<仓库根>/var/shots/shot-<时间戳>.png`（截图属运行数据，不进源码树）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 同 eval.mjs：调试端口每次取空闲端口（避免和上一次中断留下的实例撞车）。 */
const freePort = () =>
  new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

function findBrowser() {
  const cands = [
    process.env.CDP_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const hit = cands.find((p) => existsSync(p));
  if (!hit) {
    console.error('找不到无头浏览器。用 CDP_BROWSER=<路径> 指定 msedge/chrome。找过：\n  ' + cands.join('\n  '));
    process.exit(2);
  }
  return hit;
}

const argv = process.argv.slice(2);
const argAfter = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const url = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
if (!url) {
  console.error('用法: node tools/cdp/shot.mjs <url> [输出png] [--js pre.js] [--full] [--width N] [--height N]');
  process.exit(2);
}
const outArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const outPath = outArg
  ? isAbsolute(outArg)
    ? outArg
    : resolve(REPO, outArg)
  : join(REPO, 'var', 'shots', `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
const pre = argAfter('--js');
const fullPage = argv.includes('--full');
const width = Number(argAfter('--width') ?? 1680);
const height = Number(argAfter('--height') ?? 1050);

const BROWSER = findBrowser();
const PORT = process.env.SHOT_PORT ? Number(process.env.SHOT_PORT) : (await freePort()) + (Number(process.env.SHOT_PORT_OFFSET) || 0);
const profile = join(tmpdir(), `webedit-shot-${Date.now()}`);
const child = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    url,
  ],
  { stdio: 'ignore' },
);

const cleanup = (code) => {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(code);
};

const want = new URL(url).host;
let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && String(t.url).includes(want));
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {
    /* 还没起来 */
  }
  if (!wsUrl) await sleep(500);
}
if (!wsUrl) {
  console.error('没有拿到 CDP 页面目标');
  cleanup(1);
}

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = (seq += 1);
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');
/* 等就绪（同 eval.mjs：不盲等） */
for (let waited = 0; waited < 20000; waited += 250) {
  const r = await send('Runtime.evaluate', {
    expression: `(document.readyState === 'complete') && !!document.querySelector('#root') && document.querySelector('#root').children.length > 0`,
    returnByValue: true,
  });
  if (r.result?.result?.value === true) break;
  await sleep(250);
}
await sleep(1000);

if (pre) {
  const r = await send('Runtime.evaluate', { expression: readFileSync(resolve(REPO, pre), 'utf8'), awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.error('预处理脚本抛异常：', r.result.exceptionDetails.text);
  await sleep(1200); // 等界面把交互后的状态画出来
}

mkdirSync(dirname(outPath), { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
const bytes = readFileSync(outPath).length;
console.log(`已写出截图：${outPath}（${Math.round(bytes / 1024)} KB${fullPage ? '，整页' : ''}）`);
ws.close();
cleanup(0);
