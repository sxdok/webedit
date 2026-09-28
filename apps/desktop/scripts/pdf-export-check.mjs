/**
 * E2 端到端：**真的产出一份 PDF，并用 PyMuPDF 判定页数与空白页**。
 *
 *   node apps/desktop/scripts/pdf-export-check.mjs                 # 默认样张（当前文档）
 *   node apps/desktop/scripts/pdf-export-check.mjs --keep          # 保留中间产物便于人工看
 *
 * 做法：
 *   1. 起桌面版（独立 userData + CDP），把页面导航到 `?exportPdf=<临时路径>`；
 *   2. 页面侧钩子会走**真实导出链路**（导出 HTML → 主进程隐藏窗口 printToPDF → 落盘）；
 *   3. 用 `python -m fitz`（PyMuPDF）逐页判定：`get_text()` 与 `get_drawings()` 都为空 → 空白页；
 *   4. 断言：文件存在、以 `%PDF-` 开头、字节 > 0、页数 ≥ 1、**空白页 = 0**。
 *
 * 为什么必须自动化：空白页靠人眼看不可靠（ARCHITECTURE §7.5 E2-补 的结论）。
 * 退出码 0 = 通过。
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function electronBin() {
  const local = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
  return existsSync(local) ? local : 'electron';
}

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

/** CDP：等页面目标出现 */
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

/** 在页面里求值（一次性连接，避免长时间持有） */
function evaluate(wsUrl, expression, id = 1) {
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
    setTimeout(() => done(null), 15000);
  });
}

/** PyMuPDF 逐页判定（用本机 python：D:\Python313 已装 pymupdf） */
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

// 导航到 ?exportPdf=<path>（等页面钩子把结论写进 document.title）
const pdfPath = join(OUT_DIR, 'sample.pdf');
const url = `${target.url.split('?')[0]}?exportPdf=${encodeURIComponent(pdfPath)}`;
await evaluate(target.webSocketDebuggerUrl, `location.href = ${JSON.stringify(url)}`);
await sleep(1200); // 页面重载

let title = '';
for (let i = 0; i < 60; i += 1) {
  title = String((await evaluate(target.webSocketDebuggerUrl, 'document.title', 2)) ?? '');
  if (/^pdf-export:/.test(title)) break;
  await sleep(700);
}
ok('页面侧导出钩子返回结论', /^pdf-export:/.test(title), title || '(超时未返回)');

ok('PDF 文件已落盘', existsSync(pdfPath), pdfPath);
let bytes = 0;
let head = '';
if (existsSync(pdfPath)) {
  bytes = statSync(pdfPath).size;
  head = readFileSync(pdfPath).subarray(0, 5).toString('latin1');
}
ok('PDF 以 %PDF- 开头且字节数 > 0', head === '%PDF-' && bytes > 0, `head=${JSON.stringify(head)} bytes=${bytes}`);

let analysis = { error: '未分析' };
if (existsSync(pdfPath)) analysis = analyzePdf(pdfPath);
if (analysis.error) {
  ok('PyMuPDF 能分析该 PDF', false, analysis.error);
} else {
  ok('PyMuPDF 能分析该 PDF', true, `页数=${analysis.count}`);
  ok('空白页 = 0（逐页：文本与绘图都为空才算空白）', analysis.blankPages.length === 0, analysis.blankPages.length ? `空白页：${analysis.blankPages.join(', ')}｜每页字符数：${analysis.pages.map((p) => p.chars).join('/')}` : `每页字符数：${analysis.pages.map((p) => p.chars).join('/')}`);
}

console.log(`\n产物目录：${OUT_DIR}${KEEP ? '（--keep：保留）' : ''}`);
killApp();
if (!KEEP) {
  // 延迟删除：Windows 上子进程可能还占着文件句柄
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
