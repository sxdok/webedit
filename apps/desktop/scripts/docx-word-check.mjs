/**
 * E1 端到端验收：**导出的 .docx 用 Word 打开，图片可见、页脚显示"第 X 页 / 共 N 页"**。
 *
 *   node apps/desktop/scripts/docx-word-check.mjs [--keep]
 *
 * 四段证据（缺一段都不算验完）：
 *   ① 包结构：ZIP 里有 `word/media/image1.png` / `word/footer1.xml` / `word/header1.xml`（图片与页眉页脚是真部件）；
 *   ② 语义 XML：`document.xml` 里有 `w:pStyle w:val="Heading1"`…`Heading6`、`<w:drawing>` + `r:embed`；
 *      `footer1.xml` 里是 **`w:fldChar` + `PAGE`/`NUMPAGES` 域**（不是写死的页码文字）；
 *   ③ **用 Word 打开并转 PDF**（COM，见 ~/.dsh/AGENTS.md 的写法）；
 *   ④ 用 PyMuPDF 复核那份 PDF：页数 ≥ 2、两页的页脚文字**不同**（第 1 页 vs 第 2 页 → 证明域生效）、
 *      且至少一页有绘图对象（图片真的渲染出来了）。
 *
 * 退出码 0 = 全通过。Word COM 需要放宽文件沙箱（Word 会在 %APPDATA% 下建 owner/scratch 文件）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocxSample } from './docx-sample.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, '..');
const PORT = Number(process.env.DOCX_CDP_PORT ?? 9227);
const KEEP = process.argv.includes('--keep');
const OUT = join(tmpdir(), `docx-word-check-${process.pid}`);
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, pass, evidence = '') => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? `\n        → ${evidence}` : ''}`);
};

const electronBin = () => {
  const local = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
  return existsSync(local) ? local : 'electron';
};

const child = spawn(electronBin(), ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'ud')}`], {
  cwd: APP_DIR,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: ['ignore', 'ignore', 'ignore'],
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
      /* 等 */
    }
    await sleep(400);
  }
  return null;
}

function evaluate(wsUrl, expression, id = 1, timeoutMs = 20000) {
  return new Promise((res) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      res(v);
    };
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      res(null);
      return;
    }
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const m = JSON.parse(String(ev.data));
        if (m.id === id) done(m.result?.result?.value ?? null);
      } catch {
        /* 忽略 */
      }
    });
    ws.addEventListener('error', () => done(null));
    setTimeout(() => done(null), timeoutMs);
  });
}

/* ── 读 ZIP：只解析中央目录（我们用的是 STORE，不压缩，取数据段即可） ── */
function readZip(path) {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    // 本地头：30 + nameLen + extraLen 之后就是数据
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    entries.set(name, { method, size, data: buf.subarray(dataStart, dataStart + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const target = await findTarget();
if (!target) {
  ok('CDP 起来并找到页面', false);
  killApp();
  process.exit(1);
}
const baseUrl = target.url.split('?')[0];
for (let i = 0; i < 60; i += 1) {
  if ((await evaluate(target.webSocketDebuggerUrl, `!!document.querySelector('[data-menu]')`, 3, 8000)) === true) break;
  await sleep(500);
}

const docxPath = join(OUT, 'e1.docx');
const sample = buildDocxSample();
const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(sample))}`;
const url = `${baseUrl}?loadJson=${encodeURIComponent(dataUrl)}&exportDocx=${encodeURIComponent(docxPath)}`;
await evaluate(target.webSocketDebuggerUrl, `location.href = ${JSON.stringify(url)}`);
await sleep(1200);
let title = '';
for (let i = 0; i < 70; i += 1) {
  title = String((await evaluate(target.webSocketDebuggerUrl, 'document.title', 2)) ?? '');
  if (/^docx-export:/.test(title)) break;
  await sleep(600);
}
ok('页面侧导出 docx（?exportDocx 钩子）', /^docx-export: ok/.test(title), title || '(超时)');
killApp();

ok('docx 文件已落盘且是 ZIP（PK 头）', existsSync(docxPath) && readFileSync(docxPath).subarray(0, 2).toString('latin1') === 'PK', existsSync(docxPath) ? `${statSync(docxPath).size} 字节` : '没有文件');
if (!existsSync(docxPath)) {
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} 通过`);
  process.exit(1);
}

const zip = readZip(docxPath);
const names = zip ? [...zip.keys()] : [];
ok('包结构含图片与页眉页脚部件', names.includes('word/media/image1.png') && names.includes('word/footer1.xml') && names.includes('word/header1.xml'), names.join(' / '));

const docXml = zip?.get('word/document.xml')?.data.toString('utf8') ?? '';
const footerXml = zip?.get('word/footer1.xml')?.data.toString('utf8') ?? '';
const headerXml = zip?.get('word/header1.xml')?.data.toString('utf8') ?? '';
const headingStyles = [1, 2, 3, 4, 5, 6].filter((l) => docXml.includes(`w:pStyle w:val="Heading${l}"`));
ok('Heading1..6 样式都写进 document.xml', headingStyles.length === 6, `命中 ${headingStyles.join(',') || '(无)'}`);
ok('图片是真 `<w:drawing>` + 关系引用（不是占位文字）', docXml.includes('<w:drawing>') && /r:embed="rId\d+"/.test(docXml) && !docXml.includes('[图片：'), `含 drawing=${docXml.includes('<w:drawing>')}、embed=${/r:embed="rId\d+"/.test(docXml)}`);
ok('页脚是 `fldChar` + PAGE/NUMPAGES 域（不是写死的页码）', footerXml.includes('<w:fldChar') && footerXml.includes('PAGE') && footerXml.includes('NUMPAGES'), footerXml.includes('第') ? '含「第…页」文字与域' : '页脚里没有域');
ok('页眉也有内容（含 DATE 域）', headerXml.includes('E1 页眉自检') && headerXml.includes('DATE'), headerXml.slice(0, 0) || `header1.xml ${headerXml.length} 字节`);

/* ── ③ Word 打开并转 PDF（COM） ── */
const pdfPath = join(OUT, 'e1.pdf');
const ps1 = join(OUT, 'word2pdf.ps1');
writeFileSync(
  ps1,
  [
    'param([string]$Docx, [string]$Pdf)',
    '$ErrorActionPreference = "Stop"',
    'Get-Process WINWORD -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
    'Start-Sleep -Milliseconds 400',
    '$w = New-Object -ComObject Word.Application',
    '$w.Visible = $false',
    '$d = $w.Documents.Open($Docx, $false, $true)',
    '$d.ExportAsFixedFormat($Pdf, 17)',
    '$d.Close($false)',
    '$w.Quit(0)',
    'Write-Output "ok"',
  ].join('\r\n'),
  'utf8',
);
const word = spawnSync('pwsh', ['-NoProfile', '-File', ps1, docxPath, pdfPath], { encoding: 'utf8', windowsHide: true, timeout: 180000 });
const wordOk = word.status === 0 && existsSync(pdfPath) && statSync(pdfPath).size > 0;
ok('Word 能打开该 docx 并导出 PDF', wordOk, wordOk ? `${statSync(pdfPath).size} 字节` : `exit=${word.status} ${(word.stderr || word.stdout || '').trim().slice(0, 300)}`);

/* ── ④ PyMuPDF 复核 ── */
if (wordOk) {
  const py = `
try:
    import pymupdf as fitz
except ImportError:
    import fitz
import json, sys
doc = fitz.open(sys.argv[1])
pages = []
for i, p in enumerate(doc):
    pages.append({"index": i+1, "text": (p.get_text() or "").strip(), "drawings": len(p.get_drawings() or [])})
print(json.dumps({"count": doc.page_count, "pages": pages}))
`;
  const pyf = join(OUT, 'check.py');
  writeFileSync(pyf, py, 'utf8');
  const r = spawnSync('python', [pyf, pdfPath], { encoding: 'utf8', windowsHide: true });
  let info = null;
  try {
    info = JSON.parse((r.stdout ?? '').trim().split('\n').pop() ?? '{}');
  } catch {
    info = null;
  }
  ok('PyMuPDF 能读该 PDF', !!info && !info.error, info ? `页数=${info.count}` : (r.stderr || '').slice(0, 200));
  if (info?.pages?.length) {
    const withPageField = info.pages.filter((p) => /第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页/.test(p.text));
    const texts = withPageField.map((p) => (p.text.match(/第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页/) ?? [''])[0]);
    ok('页脚的 PAGE/NUMPAGES 域渲染成了「第 X 页 / 共 N 页」', withPageField.length >= 2, `命中 ${withPageField.length} 页：${texts.join(' | ')}`);
    ok('两页页码**不同**（证明是域而非写死文字）', new Set(texts).size >= 2, `页脚取值：${texts.join(' | ')}`);
    ok('图片真的渲染出来了（某一页有绘图对象）', info.pages.some((p) => p.drawings > 0), `每页绘图对象：${info.pages.map((p) => p.drawings).join('/')}`);
  }
}

console.log(`\n产物目录：${OUT}${KEEP ? '（--keep）' : ''}`);
if (!KEEP) {
  setTimeout(() => {
    try {
      rmSync(OUT, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }, 800);
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
