/**
 * E2 端到端 + 空白页回归：对**固定样张**逐张真产出 PDF，并用 PyMuPDF 判定页数与空白页。
 *
 *   node apps/desktop/scripts/pdf-export-check.mjs          # 全部样张
 *   node apps/desktop/scripts/pdf-export-check.mjs --keep   # 保留 PDF 便于人工看
 *
 * 链路（与用户点菜单完全一致）：
 *   `?loadJson=<data-url>` 载入样张 → `?exportPdf=<路径>` 钩子 → 页面 `exportPdf()` →
 *   主进程隐藏窗口加载「导出 HTML」→ `printToPDF` → 落盘 → 本脚本用 `python + PyMuPDF` 逐页判定。
 *
 * 断言设计（见 scripts/pdf-samples.mjs 的注释）：不写"页数必须 = 3"这种脆断言，
 * 而是 **空白页 = 0** + **关系断言**（末尾/连续分页符的页数必须与底稿相同、长表必须真的跨页）。
 * 退出码 0 = 全通过。
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPdfSamples } from './pdf-samples.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, '..');
const PORT = Number(process.env.PDF_CDP_PORT ?? 9224);
const KEEP = process.argv.includes('--keep');
const OUT_DIR = join(tmpdir(), `pdf-export-check-${process.pid}`);
mkdirSync(OUT_DIR, { recursive: true });
const USER_DATA = join(OUT_DIR, 'userdata');
mkdirSync(USER_DATA, { recursive: true });

const results = [];
const ok = (name, pass, evidence = '') => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? `\n        → ${evidence}` : ''}`);
};

const electronBin = () => {
  const local = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
  return existsSync(local) ? local : 'electron';
};

const child = spawn(electronBin(), ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`], {
  cwd: APP_DIR,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let appLog = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => {
  appLog += String(d);
});
const killApp = () => {
  try {
    child.kill();
  } catch {
    /* 已退出 */
  }
};

async function findTarget() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(400);
  }
  return null;
}

/** 在页面里求值（一次性连接；awaitPromise 以便直接等异步结果） */
function evaluate(wsUrl, expression, id = 1, timeoutMs = 20000) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      resolvePromise(v);
    };
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      resolvePromise(null);
      return;
    }
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === id) done(msg.result?.result?.value ?? null);
      } catch {
        /* 忽略 */
      }
    });
    ws.addEventListener('error', () => done(null));
    setTimeout(() => done(null), timeoutMs);
  });
}

/** 旁路收集页面异常（导航/载入/导出任何一步抛错都要看得见，否则只剩"超时"二字） */
function watchExceptions(wsUrl) {
  const errors = [];
  const ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 900, method: 'Runtime.enable' })));
  ws.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(String(ev.data));
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push('EXC ' + String(m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text ?? '').split('\n').slice(0, 2).join(' | '));
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
        const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
        if (text.trim()) errors.push('ERR ' + text.slice(0, 200));
      }
    } catch {
      /* 忽略 */
    }
  });
  return { errors, close: () => { try { ws.close(); } catch { /* 忽略 */ } } };
}

/** PyMuPDF 逐页判定：文本与绘图都为空 → 空白页 */
function analyzePdf(pdfPath) {
  const py = `
try:
    import pymupdf as fitz
except ImportError:
    import fitz
import json, sys
doc = fitz.open(sys.argv[1])
pages = []
for i, p in enumerate(doc):
    text = (p.get_text() or "").strip()
    drawings = p.get_drawings() or []
    pages.append({"index": i + 1, "chars": len(text), "drawings": len(drawings),
                  "blank": (len(text) == 0 and len(drawings) == 0)})
print(json.dumps({"pages": pages, "count": doc.page_count,
                  "blankPages": [p["index"] for p in pages if p["blank"]]}))
`;
  const f = join(OUT_DIR, 'analyze.py');
  writeFileSync(f, py, 'utf8');
  const r = spawnSync('python', [f, pdfPath], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return { error: `PyMuPDF 分析失败：${(r.stderr || '').trim().slice(0, 300) || `exit=${r.status}`}` };
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
  } catch (e) {
    return { error: `分析输出不是 JSON：${String(r.stdout).slice(0, 200)}（${e.message}）` };
  }
}

const target = await findTarget();
if (!target) {
  ok('CDP 起来并能找到页面', false, appLog.slice(-400));
  killApp();
  process.exit(1);
}
ok('CDP 起来并能找到页面', true, target.url);
const baseUrl = target.url.split('?')[0];

// ★等应用**真的挂载完成**再导航。CDP 报告 target 存在时，窗口自身的 `loadURL` 可能还在飞；
//   此时改 `location.href` 会被随后的自身加载覆盖 → 参数丢了 → 表现为"导出超时"（实测踩过）。
for (let i = 0; i < 60; i += 1) {
  const ready = await evaluate(
    target.webSocketDebuggerUrl,
    `document.readyState === 'complete' && !!document.querySelector('[data-menu]')`,
    3,
    8000,
  );
  if (ready === true) break;
  await sleep(500);
}
await sleep(800);
ok('应用已挂载（菜单栏出现）', (await evaluate(target.webSocketDebuggerUrl, `!!document.querySelector('[data-menu]')`, 4, 8000)) === true);

const samples = buildPdfSamples();
const stats = new Map(); // name → { count, blank, bytes }
const watcher = watchExceptions(target.webSocketDebuggerUrl);
for (const s of samples) {
  const pdfPath = join(OUT_DIR, `${s.name}.pdf`);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(s.doc))}`;
  const url = `${baseUrl}?loadJson=${encodeURIComponent(dataUrl)}&exportPdf=${encodeURIComponent(pdfPath)}`;
  watcher.errors.length = 0;
  await evaluate(target.webSocketDebuggerUrl, `location.href = ${JSON.stringify(url)}`);
  await sleep(1000);

  let title = '';
  for (let i = 0; i < 70; i += 1) {
    title = String((await evaluate(target.webSocketDebuggerUrl, 'document.title', 2)) ?? '');
    if (/^pdf-export:/.test(title)) break;
    await sleep(600);
  }
  const exportOk = /^pdf-export: ok/.test(title);
  ok(`样张「${s.name}」导出 PDF 成功`, exportOk, title || '(超时)');

  /* ★防"空过"：样张若在**导入**时就把节点丢了（例如分页符没被识别），"页数与底稿相同"照样会绿。
     所以读页面回报的 `__dshLoaded`（真正载入的节点数与分页符数），而不是数画布 DOM
     —— 分页画布会按页拆分/包裹节点，"画布节点数 == 顶层节点数"本身就不成立。 */
  const loadedRaw = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify(window.__dshLoaded ?? null)`, 6);
  let loaded = null;
  try {
    loaded = JSON.parse(String(loadedRaw));
  } catch {
    loaded = null;
  }
  const expectedNodes = s.doc.document.components.length;
  const expectedBreaks = s.doc.document.components.filter((c) => c.type === 'pageBreak').length;
  ok(
    `样张「${s.name}」完整载入（节点 ${loaded?.nodes} vs ${expectedNodes}，分页符 ${loaded?.breaks} vs ${expectedBreaks}）`,
    !!loaded && loaded.nodes === expectedNodes && loaded.breaks === expectedBreaks,
    loaded ? `导出 HTML ${loaded.htmlBytes} 字节` : '页面没有回报 __dshLoaded（导入可能失败）',
  );

  if (!exportOk) {
    // 超时时把页面状态取回来：是"没载入样张"还是"载入成功但导出没走"？
    const st = await evaluate(
      target.webSocketDebuggerUrl,
      `JSON.stringify({ href: location.href.slice(0, 120) + '…(len=' + location.href.length + ')', hasParams: location.search.includes('loadJson'), nodes: document.querySelectorAll('[data-node-id]').length, title: document.title })`,
      5,
    );
    console.error(`        状态快照：${st}`);
    if (watcher.errors.length) for (const e of watcher.errors.slice(0, 3)) console.error(`        页面异常：${e}`);
  }

  let bytes = 0;
  let head = '';
  if (existsSync(pdfPath)) {
    bytes = statSync(pdfPath).size;
    head = readFileSync(pdfPath).subarray(0, 5).toString('latin1');
  }
  ok(`样张「${s.name}」是合法 PDF（%PDF- 且字节 > 0）`, head === '%PDF-' && bytes > 0, `head=${JSON.stringify(head)} bytes=${bytes}`);

  const a = existsSync(pdfPath) ? analyzePdf(pdfPath) : { error: '没有文件' };
  if (a.error) {
    ok(`样张「${s.name}」可被 PyMuPDF 分析`, false, a.error);
    continue;
  }
  stats.set(s.name, { count: a.count, blank: a.blankPages, bytes });
  console.log(`        · 页数=${a.count} 空白页=[${a.blankPages.join(',')}] 每页字符数=${a.pages.map((p) => p.chars).join('/')}`);
}

/* ── 关系断言 ── */
for (const s of samples) {
  const st = stats.get(s.name);
  if (!st) continue;
  if (s.checks.includes('no-blank')) {
    ok(`样张「${s.name}」空白页 = 0`, st.blank.length === 0, st.blank.length ? `空白页：${st.blank.join(', ')}` : `页数=${st.count}，无空白页`);
  }
  if (s.checks.includes('multi-page')) {
    ok(`样张「${s.name}」确实跨页（页数 > 1，否则"无空白页"没意义）`, st.count > 1, `页数=${st.count}`);
  }
  if (s.checks.includes('single-page')) {
    ok(`样张「${s.name}」是单页（内容刚好一页时不许多出空白页）`, st.count === 1, `页数=${st.count}`);
  }
  const same = s.checks.find((c) => c.startsWith('same-as:'));
  if (same) {
    const refName = same.slice('same-as:'.length);
    const ref = stats.get(refName);
    ok(
      `样张「${s.name}」页数与「${refName}」相同（B2：末尾/连续分页符不得多出空白页）`,
      !!ref && ref.count === st.count,
      `本样张=${st.count} 页，底稿=${ref?.count ?? '(缺)'} 页`,
    );
  }
}

console.log(`\n产物目录：${OUT_DIR}${KEEP ? '（--keep：保留）' : ''}`);
killApp();
if (!KEEP) {
  setTimeout(() => {
    try {
      rmSync(OUT_DIR, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }, 800);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
