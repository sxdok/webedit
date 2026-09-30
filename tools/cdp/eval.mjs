/**
 * CDP 通用探针（**入库**版，P3-M6 起）：起一个无头浏览器，打开 URL，执行一段**页面脚本文件**，
 * 把返回值打成 JSON；可选截图、刷新、改视口/窗口尺寸。
 *
 *   node tools/cdp/eval.mjs <url> <jsFile> [选项]
 *
 * 什么时候用它（而不是 `--dump-dom` / `--virtual-time-budget`）：那些只能看**静态初始态**，
 * 而本编辑器的很多行为要"真实交互 + 真实时间"才会出现（模式切换、点按钮、自检那串 setTimeout 链）。
 * 它跑的是**真浏览器 + 真时钟**，所以能复现"要交互才出现"的问题。
 *
 * 选项：
 *   --expr "<js>"              直接给一段表达式（不给 jsFile 时可用）
 *   --reload <秒> <jsFile2>    先跑 jsFile，再真刷新页面，等若干秒后跑 jsFile2（验证 localStorage 读侧等）
 *   --resize WxH [jsFile]      真实改视口尺寸（触发 resize + 重排）后再跑一段；可重复
 *   --window WxH [jsFile]      真实改浏览器窗口大小（最接近用户拖窗口边缘）后再跑一段；可重复
 *   --shot [路径]              最后截一张图（缺省写 <仓库根>/var/shots/cdp-<时间戳>.png）
 *   --wait-ready <毫秒>        等页面"根挂载点有子节点"的上限（默认 20000）
 *   --settle <毫秒>            就绪后再静置一会儿（默认 800）
 *
 * 落盘约定（P3-M4/M6）：**探针脚本入库 `tools/cdp/`；它产生的证据写 `var/`** ——
 * 截图进 `var/shots/`，日志进 `var/logs/`，源码树里不留运行产物。
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

/**
 * ★调试端口必须**每次取空闲端口**（P3-M6 踩过）：早先写死 9400，
 * 上一次中断留下的无头浏览器还占着它 → 新实例的调试端口打不开，而 `/json/list` 返回的是
 * **旧实例**的目标列表 → 探针报"没有拿到 CDP 页面目标"，可页面其实已经被新实例打开了。
 * 这类"报错指向错误原因"最难查，所以从根上避免碰撞。`CDP_PORT_OFFSET` 仍可用于固定端口。
 */
const freePort = () =>
  new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

/** 浏览器：优先环境变量 `CDP_BROWSER`，其次常见 Edge/Chrome 安装位。不再写死单个绝对路径。 */
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
    console.error('找不到无头浏览器。用 CDP_BROWSER=<路径> 指定 msedge/chrome 可执行文件。找过：\n  ' + cands.join('\n  '));
    process.exit(2);
  }
  return hit;
}

const args = process.argv.slice(2);
/** 取值型选项的下标（供"可重复"的选项跳过自己的参数） */
const argAfter = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
const fileArg = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
const exprArg = argAfter('--expr');
if (!url || (!fileArg && !exprArg)) {
  console.error(
    '用法: node tools/cdp/eval.mjs <url> (<jsFile> | --expr "<js>") [--reload <秒> <jsFile2>] ' +
      '[--resize WxH [jsFile]] [--window WxH [jsFile]] [--shot [路径]] [--wait-ready <毫秒>] [--settle <毫秒>]',
  );
  process.exit(2);
}
const shotArg = args.includes('--shot') ? argAfter('--shot') : null;
const wantShot = args.includes('--shot');
const waitReady = Number(argAfter('--wait-ready') ?? 20000);
const settle = Number(argAfter('--settle') ?? 800);

const BROWSER = findBrowser();
const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : (await freePort()) + (Number(process.env.CDP_PORT_OFFSET) || 0);
const profile = join(tmpdir(), `webedit-cdp-${Date.now()}`);

const child = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1680,1050',
    url,
  ],
  { stdio: 'ignore' },
);

/** 清理：关浏览器、删临时 profile（探针不该在磁盘上留垃圾） */
function cleanup(code = 0) {
  try {
    child.kill();
  } catch {
    /* 已经退出 */
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 可能还被占用，留给系统清理 */
  }
  process.exit(code);
}
process.on('exit', () => {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
});

/* ── 连上页面目标 ── */
const want = new URL(url).host;
let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    // ★必须挑 URL 匹配的那个目标：浏览器首启可能还会开别的 page（欢迎页）
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && String(t.url).includes(want));
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {
    /* 还没起来 */
  }
  if (!wsUrl) await sleep(500);
}
if (!wsUrl) {
  console.error('没有拿到 CDP 页面目标（页面可能没加载出来）');
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

/* ── 等"真的就绪"：不再盲等固定秒数（那既慢又不稳） ── */
const readyExpr = `(document.readyState === 'complete') && !!document.querySelector('#root') && document.querySelector('#root').children.length > 0`;
let ready = false;
for (let waited = 0; waited < waitReady; waited += 250) {
  const r = await send('Runtime.evaluate', { expression: readyExpr, returnByValue: true });
  if (r.result?.result?.value === true) {
    ready = true;
    break;
  }
  await sleep(250);
}
if (!ready) console.error(`⚠ 等 ${waitReady}ms 后页面仍未就绪（#root 没有子节点），仍继续执行`);
await sleep(settle);

const runFile = async (file) => readFileSync(resolve(REPO, file), 'utf8');
const evaluate = async (expression, label) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    console.error(`页面里抛异常（${label}）：`, r.result.exceptionDetails.text, r.result.exceptionDetails.exception?.description ?? '');
  }
  return r.result?.result?.value ?? null;
};

const out = {};
out[ready ? '第一次' : '第一次（页面未就绪）'] = await evaluate(exprArg ?? (await runFile(fileArg)), '第一次');

/* --reload <秒> <jsFile2>：真刷新后跑第二段（验证"刷新后"的真实状态） */
const reloadIdx = args.indexOf('--reload');
if (reloadIdx >= 0) {
  const sec = Number(args[reloadIdx + 1]) || 5;
  const f2 = args[reloadIdx + 2];
  await send('Page.reload', { ignoreCache: false });
  await sleep(Math.max(1000, sec * 1000));
  out['刷新后'] = await evaluate(await runFile(f2), '刷新后');
}

/* --resize WxH [jsFile]：真改视口尺寸（触发 resize + 重排）；可重复 */
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--resize') continue;
  const [w, h] = (args[i + 1] ?? '0x0').split('x').map(Number);
  const next = args[i + 2];
  const file = next && !next.startsWith('--') ? next : null;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(1300);
  if (file) out[`改尺寸后 ${w}x${h}`] = await evaluate(await runFile(file), `改尺寸后 ${w}x${h}`);
}

/* --window WxH [jsFile]：真改浏览器窗口（最接近用户拖窗口边缘）；可重复 */
const winId = (await send('Browser.getWindowForTarget')).result?.windowId;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--window') continue;
  const [w, h] = (args[i + 1] ?? '0x0').split('x').map(Number);
  const next = args[i + 2];
  const file = next && !next.startsWith('--') ? next : null;
  if (winId == null) {
    console.error('拿不到 windowId，--window 跳过');
    continue;
  }
  await send('Browser.setWindowBounds', { windowId: winId, bounds: { windowState: 'normal', width: w, height: h } });
  await sleep(1400);
  if (file) out[`改窗口后 ${w}x${h}`] = await evaluate(await runFile(file), `改窗口后 ${w}x${h}`);
}

/* --moves "x,y;x,y;…" [--move-step <毫秒>]：**真**鼠标沿指定路径移动（CDP 受信任事件）。
   用来复现"鼠标从 A 划到 B 时中间经过某块区域"这类问题（例：二级菜单 hover 断链）。
   点可以写字面坐标 `x,y`，也可以写 **元素选择器**（自动取中心），支持偏移：
     @[data-menu-sub="export-sub"]         → 该元素中心
     @[data-menu-sub="export-sub"]-40,+6   → 中心往左 40、往下 6
   与 --hover 一样，放在 --shot 之前可以拍下路径走完后的样子。 */
const movesArg = argAfter('--moves');
if (movesArg) {
  const step = Number(argAfter('--move-step') ?? 60);
  const rawPts = String(movesArg)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const pts = [];
  for (const raw of rawPts) {
    if (raw.startsWith('@')) {
      /* @选择器[±dx,±dy] —— 选择器里可能带引号，用最后一个 ']' 作为选择器结束 */
      const close = raw.lastIndexOf(']');
      const sel = close > 0 ? raw.slice(1, close + 1) : raw.slice(1);
      const off = close > 0 ? raw.slice(close + 1) : '';
      const m = /^([+-]\d+)?([+-]\d+)?$/.exec(off.replace(/[\s,]/g, ''));
      const dx = m?.[1] ? Number(m[1]) : 0;
      const dy = m?.[2] ? Number(m[2]) : 0;
      const r = await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2) + (${dx}), y: Math.round(b.top + b.height / 2) + (${dy}) }); })()`,
        returnByValue: true,
      });
      const v = r.result?.result?.value;
      if (!v) {
        console.error(`--moves: 找不到元素 ${sel}`);
      } else {
        pts.push(JSON.parse(v));
      }
    } else {
      const [x, y] = raw.split(',').map((v) => Number(v.trim()));
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
  }
  const trail = [];
  for (const p of pts) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, buttons: 0 });
    await sleep(step);
    // 每步记录"针尖下是哪个元素"（菜单场景看它是否还在父项/子面板里）
    const hit = await send('Runtime.evaluate', {
      expression: `(() => { const el = document.elementFromPoint(${p.x}, ${p.y}); if (!el) return 'null'; const mi = el.closest('[data-menu-item]'); const ms = el.closest('[data-menu-sub]'); const mp = el.closest('[data-menu-panel]'); return el.tagName.toLowerCase() + (mi ? '[item=' + mi.getAttribute('data-menu-item') + ']' : '') + (ms ? '[sub=' + ms.getAttribute('data-menu-sub') + ']' : '') + (mp ? '[panel=' + mp.getAttribute('data-menu-panel') + ']' : ''); })()`,
      returnByValue: true,
    });
    trail.push({ 点: `${p.x},${p.y}`, 针尖下: hit.result?.result?.value ?? '?' });
  }
  await sleep(260);
  const after = await send('Runtime.evaluate', {
    expression: `(() => { const p = document.querySelector('[data-menu-panel="export-sub"]'); const t = document.querySelector('[data-menu-item="docx"]'); if (!t) return JSON.stringify({ 导出子面板还在: !!p }); const b = t.getBoundingClientRect(); const el = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)); return JSON.stringify({ 导出子面板还在: !!p, 目标项可点到: el === t || t.contains(el) }); })()`,
    returnByValue: true,
  });
  out['鼠标路径'] = { 步长ms: step, 轨迹: trail, 走完后: after.result?.result?.value ?? '?' };
}

/* --hover <选择器> [--hover-hold <毫秒>]：**真**把鼠标移到元素中心（CDP 派发受信任事件）——
   用于验证"悬浮气泡/悬浮态"这类必须真实指针事件才出现的东西（合成 MouseEvent 委托层不认）。
   可以放在 --shot 之前，用来拍下气泡弹出的样子。 */
const hoverSel = argAfter('--hover');
if (hoverSel) {
  const hold = Number(argAfter('--hover-hold') ?? 900);
  const box = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(hoverSel)}); if (!el) return null; const b = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`,
    returnByValue: true,
  });
  const pos = box.result?.result?.value ? JSON.parse(box.result.result.value) : null;
  if (!pos) {
    console.error(`--hover: 找不到元素 ${hoverSel}`);
  } else {
    /* 先移到旁边再移进来（有些实现要"真的移动过"才触发），然后**多次微动** ——
       静态停住不动的话，只依赖单次 mouseover 的实现可能不弹（真人鼠标总会有一点点抖动）。 */
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x - 40, y: pos.y - 40, buttons: 0 });
    await sleep(100);
    let tipText = '';
    for (let i = 0; i < 10 && !tipText; i += 1) {
      const jx = pos.x + (i % 3) - 1;
      const jy = pos.y + (i % 2);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: jx, y: jy, buttons: 0 });
      await sleep(Math.max(hold / 10, 120));
      const tip = await send('Runtime.evaluate', {
        expression: `(() => { const t = document.querySelector('[data-tooltip="1"], [role="tooltip"]'); return t ? (t.textContent || '').trim().slice(0, 80) : ''; })()`,
        returnByValue: true,
      });
      tipText = tip.result?.result?.value || '';
    }
    /* 拍图前再保持一次移动 —— 让气泡稳定显示在鼠标右下 */
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, buttons: 0 });
    await sleep(220);
    out['悬浮'] = { 选择器: hoverSel, 位置: pos, 气泡内容: tipText || '(没出现)' };
  }
}

/* --shot [路径]：缺省落 var/shots（截图是"运行数据"，不进源码树） */
if (wantShot) {
  const shotPath = shotArg
    ? isAbsolute(shotArg)
      ? shotArg
      : resolve(REPO, shotArg)
    : join(REPO, 'var', 'shots', `cdp-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  mkdirSync(dirname(shotPath), { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
  console.log('已写出截图：' + shotPath);
}

console.log(JSON.stringify(out, null, 2));
ws.close();
cleanup(0);
