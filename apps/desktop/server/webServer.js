/**
 * webServer.js —— 「web-editor/启动编辑器.py」的等价 Node.js 移植（Electron 分发版用）
 *
 * 为什么需要这份文件：
 *   `web-editor/启动编辑器.py` 用 Python 内置 http.server 托管已构建好的 `dist/web/`（单页应用），
 *   并额外提供 4 个前端依赖的 `__` 接口。**桌面分发版里必须用这份 Node 版**：打包出去的 Electron
 *   应用要在用户机器上直接跑，而用户机器上通常没有 Python（Windows 默认不带 python.exe，用户也不会装），
 *   不能用 child_process 去 spawn `python 启动编辑器.py`。这份模块把那个脚本**原样移植**成 Node 内置
 *   模块实现：运行目录推导、路由、方法、状态码、JSON 字段名、Content-Type、日志落盘位置全部照抄
 *   Python 版，前端（src/utils/logger.ts、src/registry/live.ts、src/utils/download.ts、
 *   src/utils/pluginPackage.ts、src/store/selfCheck.ts）不需要任何改动。
 *
 * 端口与接口用途（与 Python 版一致，默认 127.0.0.1:5179）：
 *   · GET  /__components  外部（热加载）组件清单 → {"files":[...]}；目录优先 `public/组件`（源目录，
 *                         改完即生效），没有才退回 `dist/组件`
 *   · GET  /__loginfo     日志落盘信息 → {"enabled":true,"dir":运行目录/logs,"today":当天文件名,
 *                         "files":[{name,bytes,mtime}]}；前端用它确认「日志真的写进磁盘了」
 *   · POST /__log         {"kind":"editor","lines":[...]} → 追加到 运行目录/logs/<kind>-YYYY-MM-DD.log
 *   · POST /__save        {"path":"docs/x.md","text":"..."} → 写到 运行目录/docs/ 下（只允许 docs/，
 *                         拒绝 `../`、绝对路径、盘符等路径穿越）
 *   · POST /__savePlugin  {"name":"x.js","text":"..."} → 写回**组件目录**（文件名白名单校验）
 *   · 其余路径：静态托管 dist/（Content-Type 按扩展名，全部带 Cache-Control: no-store），
 *     未知路径回落 dist/index.html（SPA 路由）；`/组件/<name>` 走组件目录（热加载，无需重新构建）
 *
 * 「运行目录」= 传入的仓库根下的 `web-editor/`（Python 版里就是脚本所在目录），
 * logs/ 与 docs/ 都落在这里；所有路径都基于 rootDir 推导，不写死任何盘符。
 *
 * 为什么要三个目录覆盖参数（logDir / docsDir / componentsDir）：
 *   开发时「运行目录」= 仓库里的 web-editor/，可写，所以 Python 版直接把日志、产物、外部组件都写在
 *   它下面。但**打包分发的 Electron 版装到 `C:\Program Files\...` 之后，安装目录是只读的**（普通用户
 *   没有写权限，Windows 还会做 UAC/虚拟化），往那里写 logs/docs/组件 一定失败。所以启动时允许把这三个
 *   可写目录指到 userData（如 `app.getPath('userData')/logs`）；三个都不传时仍旧按 Python 版的推导
 *   （`<运行目录>/logs`、`<运行目录>/docs`、`public/组件 → dist/组件`），行为与 Python 版完全一致。
 *
 * 用法（Electron 主进程；Node ≥ 22.12 的 ESM 也可以直接 require 本文件）：
 *   import { startWebServer } from './webServer.js'
 *   // 默认（开发/绿色版）：logs、docs、外部组件都在 web-editor/ 下，与 Python 版一致
 *   const web = await startWebServer({ rootDir: app.getAppPath() })  // → { url, port, close() }
 *   // 装到 Program Files（安装目录只读）时，把三个可写目录覆盖到 userData：
 *   //   const ud = app.getPath('userData')
 *   //   await startWebServer({ rootDir: app.getAppPath(),
 *   //     logDir: join(ud,'logs'), docsDir: join(ud,'docs'), componentsDir: join(ud,'组件') })
 *   // 退出前：await web.close()
 *
 * 只依赖 Node 内置模块（node:http / node:fs / node:path），不新增任何依赖。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/* ══════════════════ 常量（与 Python 版逐条对应） ══════════════════ */

const LOG_KINDS = ['editor', 'diagnostic', 'check', 'server'];
const MAX_BODY = 512 * 1024; // Python: MAX_BODY = 512 * 1024
const DEFAULT_PORT = 5179;
const DEFAULT_HOST = '127.0.0.1';
// close() 的优雅收尾上限：等到这个时间还没收尾就强杀剩余连接（避免 Electron 退出时 await 卡死）
const CLOSE_GRACE_MS = 2000;
// Python 版：free_port() = [preferred] + range(preferred+1, preferred+20) + [0] → 首选 + 19 个后继 + 系统分配
const PORT_SCAN_LIMIT = 20;
// Python 版日志用 open(..., encoding='utf-8')（newline=None）→ Windows 上 '\n' 被翻译成 os.linesep；
// /__save、/__savePlugin 显式 newline='\n' → 保持 LF。这里照抄这个不对称。
const EOL = process.platform === 'win32' ? '\r\n' : '\n';
// Python: server_version = "SimpleHTTP/" + __version__（0.6），sys_version = "Python/x.y.z"
const SERVER_HEADER = 'webServer.js (Node.js) Node/' + process.versions.node;

// Content-Type：逐条对齐本机 Python 3.13.5 `mimetypes.guess_type` 的实测值（含 http.server
// SimpleHTTPRequestHandler.extensions_map 的 .gz/.Z/.bz2/.xz 四条），查不到时和 Python 一样回落
// application/octet-stream。注意：Python 在本机对 .map / .woff / .woff2 / .ttf / .otf / .eot 都返回
// None（表里没有），所以这里也**故意不登记**它们，保证两端行为一致。
const MIME_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon', // 本机 Python 走 Windows 注册表的实测值
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'text/xml',
  '.csv': 'application/vnd.ms-excel', // 同上：注册表给的实测值
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/x-wav',
  '.zip': 'application/x-zip-compressed', // 同上：注册表给的实测值
  // SimpleHTTPRequestHandler.extensions_map
  '.gz': 'application/gzip',
  '.Z': 'application/octet-stream',
  '.bz2': 'application/x-bzip2',
  '.xz': 'application/x-xz',
};

// Python: BaseHTTPRequestHandler.responses / HTTPStatus（本机 3.13.5 实测）
const STATUS_PHRASES = {
  200: 'OK',
  304: 'Not Modified',
  403: 'Forbidden',
  404: 'Not Found',
  413: 'Content Too Large',
  500: 'Internal Server Error',
  501: 'Not Implemented',
};
const STATUS_EXPLAINS = {
  200: 'Request fulfilled, document follows',
  304: 'Document has not changed since given time',
  403: 'Request forbidden -- authorization will not help',
  404: 'Nothing matches the given URI',
  413: 'Content is too large',
  500: 'Server got itself in trouble',
  501: 'Server does not support this operation',
};

// Python: DEFAULT_ERROR_MESSAGE（send_error 的 HTML 错误页）；注意正文里 message 后面会补一个 "."
const ERROR_MESSAGE_TEMPLATE = `<!DOCTYPE HTML>
<html lang="en">
    <head>
        <meta charset="utf-8">
        <title>Error response</title>
    </head>
    <body>
        <h1>Error response</h1>
        <p>Error code: %CODE%</p>
        <p>Message: %MESSAGE%.</p>
        <p>Error code explanation: %CODE% - %EXPLAIN%.</p>
    </body>
</html>
`;

/* ══════════════════ 小工具 ══════════════════ */

const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS = [null, 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Python: datetime.date.today().isoformat() → 本地时区的 YYYY-MM-DD */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Python: BaseHTTPRequestHandler.log_date_time_string() → "25/Sep/2026 14:32:06" */
function logDateTimeString(d) {
  return `${pad2(d.getDate())}/${MONTHS[d.getMonth() + 1]}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}:${pad2(d.getSeconds())}`;
}

/** Python: email.utils.formatdate(...) / date_time_string() → "Fri, 25 Sep 2026 06:32:06 GMT" */
function httpDate(d) {
  return d.toUTCString();
}

/** Python: html.escape(s, quote=False) */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Python: str.splitlines()（常见换行；末尾换行不产生空行） */
function splitLines(s) {
  if (s === '') return [];
  const parts = String(s).split(/\r\n|[\n\r\v\f\u2028\u2029\u0085\u001c\u001d\u001e]/);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Python: int(x)，非整数写法一律当 0（ValueError → 0） */
function pythonInt(value) {
  const s = String(value ?? '').trim();
  if (!/^[+-]?\d+$/.test(s)) return 0;
  const n = Number(s);
  return Number.isSafeInteger(n) || Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** 用 Python 的口吻描述「不是 dict」的 payload（对应 payload.get 抛 AttributeError → 500） */
function pyTypeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (Array.isArray(v)) return 'list';
  switch (typeof v) {
    case 'number':
      return Number.isInteger(v) ? 'int' : 'float';
    case 'string':
      return 'str';
    case 'boolean':
      return 'bool';
    default:
      return 'dict';
  }
}

/** mtime → Python int(st.st_mtime)（秒，向零取整） */
function mtimeSeconds(ms) {
  return Math.trunc(ms / 1000);
}

/* ══════════════════ 运行目录 / 各子目录（基于 rootDir 推导） ══════════════════ */

/**
 * 「运行目录」= Python 版里 启动编辑器.py 所在目录 = 仓库根下的 `web-editor/`。
 * 日志与文档按它推导（`<运行目录>/logs`、`<运行目录>/docs`）—— 与产物位置**无关**。
 * 容错：传进来的 rootDir 本身就是 web-editor 时（打包布局 `resources/web-editor`），直接用它。
 */
export function resolveRunDir(rootDir) {
  const repo = path.resolve(rootDir);
  const nested = path.join(repo, 'web-editor');
  return isDir(nested) ? nested : repo;
}

/**
 * 产物目录（P3-M1 起有两套布局）：
 *   · 源码：`<仓库根>/dist/web`（vite 的 outDir）；
 *   · 打包：`<resources>/web-editor/dist`（extraResources 的 `to` 没变）；
 *   · 过渡兼容：`<仓库根>/web-editor/dist`（M1 之前的旧布局，留着不影响正确性）。
 *
 * ★调用方传进来的可能是**仓库根**（verify 脚本），也可能是 **web-editor 目录**
 *   （`main.js` 传的是 `layout.webRoot`）—— 所以两个方向都要试：`<dir>/dist/web` 与 `<dir>/../dist/web`。
 *   不这么做就会出现"verify 能过、桌面版开不出页面"（实测踩过：静态服务器返回不了首页，5 条界面断言连红）。
 * 都不存在时返回首选路径，让 `startWebServer` 用 `isFile(indexFile)` 报可行动的错。
 */
export function resolveDistDir(repo, runDir) {
  const parent = path.dirname(repo);
  const candidates = [
    path.join(repo, 'dist', 'web'),
    path.join(parent, 'dist', 'web'),
    path.join(runDir, 'dist'),
    path.join(repo, 'web-editor', 'dist'),
  ];
  return candidates.find((p) => isDir(p)) ?? candidates[0];
}

function makeContext({ rootDir, quiet, logDir, docsDir, componentsDir: componentsDirOption }) {
  const repo = path.resolve(rootDir);
  const runDir = resolveRunDir(repo);
  const distDir = resolveDistDir(repo, runDir);
  return {
    rootDir: repo,
    runDir,
    distDir,
    indexFile: path.join(distDir, 'index.html'),
    // 不传覆盖时落**仓库根 var/**（P3-M4：运行数据集中；桌面版会显式传 userData 下的目录）
    logDir: logDir ? path.resolve(logDir) : path.join(repo, 'var', 'logs'),
    docsDir: docsDir ? path.resolve(docsDir) : path.join(repo, 'var', 'docs'),
    docsDirOverride: docsDir ? path.resolve(docsDir) : null,
    componentsDirOverride: componentsDirOption ? path.resolve(componentsDirOption) : null,
    quiet: Boolean(quiet),
  };
}

/** Python: components_dir() —— 优先 public/组件（源目录，热加载），没有才退回 dist/组件；
 *  传了 componentsDir 覆盖时三条组件路径（清单/热加载/写回）都用它。 */
function componentsDir(ctx) {
  if (ctx.componentsDirOverride) return ctx.componentsDirOverride;
  const src = path.join(ctx.runDir, 'public', '组件');
  if (isDir(src)) return src;
  return path.join(ctx.distDir, '组件');
}

/* ══════════════════ 日志落盘（照抄 append_log / log_path） ══════════════════ */

function logPath(ctx, kind) {
  return path.join(ctx.logDir, `${kind}-${todayISO()}.log`);
}

/** 把若干行追加到运行目录的日志文件，返回 { file, bytes, count } */
function appendLog(ctx, kind, lines) {
  const k = LOG_KINDS.includes(kind) ? kind : 'editor';
  fs.mkdirSync(ctx.logDir, { recursive: true });
  const file = logPath(ctx, k);
  let text = '';
  for (const ln of lines) text += String(ln).replace(/[\r\n]+$/, '') + EOL; // Python: str(ln).rstrip("\r\n") + "\n"
  fs.appendFileSync(file, text, { encoding: 'utf8' });
  const st = fs.statSync(file);
  return { file, bytes: st.size, count: lines.length };
}

/** Python: Handler.log_message() —— 服务自身的访问/错误落盘 + 控制台输出 */
function logMessage(ctx, req, message) {
  const client = (req && req.socket && req.socket.remoteAddress) || '-';
  try {
    appendLog(ctx, 'server', [`${logDateTimeString(new Date())}  ${client}  ${message}`]);
  } catch {
    /* Python 版这里也是 try/except pass */
  }
  process.stderr.write(`${client} - - [${logDateTimeString(new Date())}] ${message}\n`);
}

/** Python: log_request() —— 每条响应记一行 `"GET /x HTTP/1.1" 200 -` */
function logRequest(ctx, req, code, size = '-') {
  logMessage(ctx, req, `"${req.method} ${req.url} HTTP/${req.httpVersion}" ${code} ${size}`);
}

/** Python: log_error() */
function logError(ctx, req, code, message) {
  logMessage(ctx, req, `code ${code}, message ${message}`);
}

/* ══════════════════ 响应骨架 ══════════════════ */

/**
 * Python: send_response(code, message) —— 先记日志，再写状态行 + Server + Date。
 * Date 由 Node 自动附加（格式与 Python 的 date_time_string 相同）。
 */
function beginResponse(ctx, req, res, code, message) {
  logRequest(ctx, req, code);
  res.statusCode = code;
  if (message != null) res.statusMessage = String(message);
  res.setHeader('Server', SERVER_HEADER);
}

/** Python: Handler.end_headers() —— 每条响应都补 Cache-Control: no-store */
function endHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
}

/** Python: send_error() —— HTML 错误页（reason phrase 用传入的 message，正文 message 后补 "."） */
function sendError(ctx, req, res, code, message) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const phrase = STATUS_PHRASES[code] || '???';
  const explain = STATUS_EXPLAINS[code] || '???';
  const msg = message == null ? phrase : String(message);
  logError(ctx, req, code, msg);
  beginResponse(ctx, req, res, code, msg);
  res.setHeader('Connection', 'close');
  const body = Buffer.from(
    ERROR_MESSAGE_TEMPLATE.replace(/%CODE%/g, String(code))
      .replace('%MESSAGE%', escapeHtml(msg))
      .replace('%EXPLAIN%', escapeHtml(explain)),
    'utf8',
  );
  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  endHeaders(res);
  res.shouldKeepAlive = false;
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Python: 各 do_* 里手工拼的 JSON 响应（application/json; charset=utf-8 + no-store） */
function sendJson(ctx, req, res, status, obj) {
  if (res.headersSent) {
    res.end();
    return;
  }
  beginResponse(ctx, req, res, status);
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  endHeaders(res);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/* ══════════════════ 写盘接口（照抄 save_artifact / save_plugin） ══════════════════ */

/**
 * 只允许写到文档目录下；拒绝 `../`、绝对路径、盘符（防目录穿越）。
 * · 没传 docsDir（默认）：与 Python 版逐字一致 —— 相对路径必须以 `docs/` 开头，且必须落在
 *   `<运行目录>/docs` 里，否则 `{ok:false,error:'只允许写到运行目录的 docs/ 下'}` / `'路径越界'`。
 * · 传了 docsDir（分发版指到 userData）：落盘根换成 `<docsDir>`，前端固定的 `docs/xxx.md` 前缀会被去掉
 *   （于是仍然落在根目录本身，与默认模式落进 `<运行目录>/docs` 对应）；只允许写在 `<docsDir>` 之下，
 *   `..`、绝对路径、盘符（含 `C:` / 备用数据流 `:`）一律 `{ok:false,error:'路径越界'}`。
 */
function saveArtifact(ctx, relPath, text) {
  const raw = String(relPath || '').replace(/\\/g, '/');
  let target;
  if (ctx.docsDirOverride) {
    const root = path.normalize(ctx.docsDirOverride);
    // 前端固定发 'docs/xxx.md'；把这段前缀去掉，让它直接落在 docsDir 根下
    const rest = raw.startsWith('docs/') ? raw.slice('docs/'.length) : raw;
    if (!rest || raw.startsWith('/') || raw.includes(':') || rest.split('/').includes('..')) {
      return { ok: false, error: '路径越界' }; // 绝对路径 / 盘符 / ../ 一律拒
    }
    target = path.normalize(path.join(root, rest));
    if (!target.startsWith(root + path.sep)) {
      return { ok: false, error: '路径越界' };
    }
  } else {
    const rel = raw.replace(/^\/+/, '');
    if (!rel.startsWith('docs/') || rel.split('/').includes('..')) {
      return { ok: false, error: '只允许写到运行目录的 docs/ 下' };
    }
    target = path.normalize(path.join(ctx.runDir, rel));
    const docsRoot = path.normalize(path.join(ctx.runDir, 'docs'));
    if (!target.startsWith(docsRoot + path.sep)) {
      return { ok: false, error: '路径越界' };
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, { encoding: 'utf8' }); // Python: newline="\n" → 不做换行翻译
  return { ok: true, file: target, bytes: Buffer.byteLength(text, 'utf8'), chars: text.length };
}

/** 把组件包里的一个文件写回组件目录；只允许 `<名字>.js`（不含路径、不以 `_` 开头） */
function savePlugin(ctx, name, text) {
  const n = String(name || '').trim();
  // Python: ^[\w\u4e00-\u9fa5-]+\.js$（str 模式下 \w 是 Unicode 词字符 = 字母/数字/下划线）
  if (!/^[\p{L}\p{N}_\u4e00-\u9fa5-]+\.js$/u.test(n) || n.startsWith('_') || n.includes('..')) {
    return { ok: false, error: '文件名不合法（只允许 xxx.js，不含路径）' };
  }
  if (!text) {
    return { ok: false, error: '内容为空' };
  }
  const d = componentsDir(ctx);
  fs.mkdirSync(d, { recursive: true });
  const target = path.normalize(path.join(d, n));
  if (path.dirname(target) !== path.normalize(d)) {
    return { ok: false, error: '路径越界' };
  }
  fs.writeFileSync(target, text, { encoding: 'utf8' });
  return { ok: true, file: target, bytes: Buffer.byteLength(text, 'utf8'), chars: text.length };
}

/* ══════════════════ URL / 路径（照抄 unquote + translate_path + send_head 的判定） ══════════════════ */

/** Node 的 req.url 是 latin1 字符串；先还原成 UTF-8，再做百分号解码（等价 Python 的 unquote） */
function decodeUrlPath(raw) {
  let s = raw;
  try {
    s = Buffer.from(raw, 'latin1').toString('utf8');
  } catch {
    /* 含 >0xFF 的码元：保持原样 */
  }
  try {
    return decodeURIComponent(s);
  } catch {
    /* 容错：只解开合法的 %XX，其余按 UTF-8 原样 */
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }
}

/** Python: SimpleHTTPRequestHandler.translate_path()（'..'、'.'、带目录分隔符的段一律丢弃） */
function translatePath(ctx, urlPath) {
  const trailingSlash = urlPath.endsWith('/');
  const words = path.posix.normalize(urlPath).split('/').filter((w) => w !== '');
  let out = ctx.distDir;
  for (const w of words) {
    const dir = path.dirname(w);
    if (w === '.' || w === '..' || (dir !== '' && dir !== '.')) continue;
    out = path.join(out, w);
  }
  if (trailingSlash) out += path.sep;
  return out;
}

function guessMimeType(file) {
  const ext = file.slice(file.lastIndexOf('.'));
  if (Object.prototype.hasOwnProperty.call(MIME_TYPES, ext)) return MIME_TYPES[ext];
  const lower = ext.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MIME_TYPES, lower)) return MIME_TYPES[lower];
  return null;
}

/** Python: 只有 If-Modified-Since 且没有 If-None-Match 时才考虑 304；且只认 UTC 时区 */
function isNotModifiedSince(headerValue, mtimeMs) {
  const v = String(headerValue || '').trim();
  if (!v) return false;
  const isUtc = /GMT$/i.test(v) || /\bUTC$/i.test(v) || /[+-]0000$/.test(v);
  if (!isUtc) return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  return Math.trunc(mtimeMs / 1000) * 1000 <= t;
}

/** 静态文件响应（Python: send_head + copyfile）；headersOnly 用于 HEAD */
function sendFile(ctx, req, res, target, { contentType, withLastModified = true, conditional = true }) {
  let st;
  try {
    st = fs.statSync(target);
  } catch {
    sendError(ctx, req, res, 404, 'File not found');
    return;
  }
  if (!st.isFile()) {
    sendError(ctx, req, res, 404, 'File not found');
    return;
  }
  if (conditional && req.headers['if-modified-since'] && !req.headers['if-none-match']) {
    if (isNotModifiedSince(req.headers['if-modified-since'], st.mtimeMs)) {
      beginResponse(ctx, req, res, 304);
      endHeaders(res);
      res.end();
      return;
    }
  }
  beginResponse(ctx, req, res, 200);
  res.setHeader('Content-type', contentType || guessMimeType(target) || 'application/octet-stream');
  res.setHeader('Content-Length', String(st.size));
  if (withLastModified) res.setHeader('Last-Modified', httpDate(st.mtime));
  endHeaders(res);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(target);
  stream.on('error', () => {
    if (!res.headersSent) sendError(ctx, req, res, 404, 'File not found');
    else res.destroy();
  });
  stream.pipe(res);
}

/* ══════════════════ GET / HEAD ══════════════════ */

/** GET /__components */
function serveComponents(ctx, req, res) {
  const d = componentsDir(ctx);
  let files = [];
  try {
    files = fs
      .readdirSync(d)
      .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
      .sort();
  } catch {
    files = [];
  }
  sendJson(ctx, req, res, 200, { files });
}

/** GET /__loginfo */
function serveLogInfo(ctx, req, res) {
  let files = [];
  try {
    for (const f of fs.readdirSync(ctx.logDir).sort()) {
      const st = fs.statSync(path.join(ctx.logDir, f));
      files.push({ name: f, bytes: st.size, mtime: mtimeSeconds(st.mtimeMs) });
    }
  } catch {
    files = [];
  }
  sendJson(ctx, req, res, 200, {
    enabled: true,
    dir: ctx.logDir,
    today: path.basename(logPath(ctx, 'editor')),
    files,
  });
}

/** 其余 GET/HEAD：静态托管 dist/（未知路径回落 index.html） */
function serveStatic(ctx, req, res, decodedPath) {
  // ① 外部组件走源目录（热加载：改完即生效，不需要重新构建）
  if (decodedPath.startsWith('/组件/')) {
    const target = path.join(componentsDir(ctx), path.basename(decodedPath));
    if (isFile(target)) {
      let ctype = guessMimeType(target) || 'application/javascript';
      if (!ctype.startsWith('text/') && !ctype.includes('javascript')) ctype = 'application/javascript';
      sendFile(ctx, req, res, target, {
        contentType: `${ctype}; charset=utf-8`,
        withLastModified: false,
        conditional: false,
      });
      return;
    }
  }
  // ② dist/：目录或未知的无扩展名路径 → index.html（交给前端路由）
  const rawJoin = path.normalize(path.join(ctx.distDir, decodedPath.replace(/^\/+/, '')));
  const base = path.basename(decodedPath);
  let effective = decodedPath;
  if (decodedPath === '/' || decodedPath === '' || isDir(rawJoin)) {
    effective = '/index.html';
  } else if (!exists(rawJoin) && !base.includes('.')) {
    effective = '/index.html';
  }
  const target = translatePath(ctx, effective);
  if (isDir(target)) {
    // Python 版：目录里有 index.html/index.htm 就伺服它（本启动器里这条分支基本走不到）
    for (const name of ['index.html', 'index.htm']) {
      const candidate = path.join(target, name);
      if (isFile(candidate)) {
        sendFile(ctx, req, res, candidate, {});
        return;
      }
    }
    sendError(ctx, req, res, 404, 'File not found');
    return;
  }
  sendFile(ctx, req, res, target, {});
}

/* ══════════════════ POST ══════════════════ */

/** 读满 n 字节（Python: self.rfile.read(n)） */
function readBody(req, n) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let got = 0;
    req.on('data', (c) => {
      chunks.push(c);
      got += c.length;
      if (got >= n) {
        req.pause();
        resolve(Buffer.concat(chunks).subarray(0, n));
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).subarray(0, n)));
    req.on('error', reject);
  });
}

async function handlePost(ctx, req, res, route) {
  const n = pythonInt(req.headers['content-length']);
  if (n <= 0 || n > MAX_BODY) {
    sendError(ctx, req, res, 413, 'bad length');
    return;
  }
  let payload;
  try {
    const raw = await readBody(req, n);
    payload = JSON.parse(raw.toString('utf8'));
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      // Python 会在这里抛 AttributeError → 500
      throw new Error(`'${pyTypeName(payload)}' object has no attribute 'get'`);
    }
  } catch (e) {
    sendJson(ctx, req, res, 500, { ok: false, error: String((e && e.message) || e) });
    return;
  }
  try {
    let body;
    if (route === '/__log') {
      const kind = payload.kind ? String(payload.kind) : 'editor';
      let lines = payload.lines || [];
      if (typeof lines === 'string') lines = splitLines(lines);
      if (!Array.isArray(lines)) throw new Error(`'${pyTypeName(lines)}' object is not iterable`);
      lines = lines.map((x) => String(x)).slice(0, 2000);
      const info = lines.length
        ? appendLog(ctx, kind, lines)
        : { file: logPath(ctx, kind), bytes: 0, count: 0 }; // Python: 空行不建目录、不落盘
      body = { ok: true, ...info };
    } else {
      const rel = payload.path ? String(payload.path) : '';
      const text = payload.text ? String(payload.text) : '';
      body =
        route === '/__savePlugin'
          ? savePlugin(ctx, payload.name ? String(payload.name) : '', text)
          : saveArtifact(ctx, rel, text);
    }
    sendJson(ctx, req, res, body.ok ? 200 : 403, body);
  } catch (e) {
    // 落盘失败要如实回错，前端会记一条 error
    sendJson(ctx, req, res, 500, { ok: false, error: String((e && e.message) || e) });
  }
}

/* ══════════════════ 总入口 ══════════════════ */

function handleRequest(ctx, req, res) {
  const rawUrl = req.url || '/';
  const qi = rawUrl.indexOf('?');
  const routeEncoded = qi >= 0 ? rawUrl.slice(0, qi) : rawUrl; // Python 的 self.path.split("?")[0]（未解码）
  const method = req.method || 'GET';

  // 与 Python 一致：__ 路由**只在 GET 上生效**（Python 只重写了 do_GET；HEAD 走 send_head，
  // 于是 HEAD /__components 会当成未知路径回落 index.html）。__ 路由用未解码路径比对，文件路径才 unquote。
  if (method === 'GET') {
    if (routeEncoded === '/__components') return serveComponents(ctx, req, res);
    if (routeEncoded === '/__loginfo') return serveLogInfo(ctx, req, res);
    return serveStatic(ctx, req, res, decodeUrlPath(routeEncoded));
  }
  if (method === 'HEAD') {
    return serveStatic(ctx, req, res, decodeUrlPath(routeEncoded));
  }
  if (method === 'POST') {
    if (routeEncoded !== '/__log' && routeEncoded !== '/__save' && routeEncoded !== '/__savePlugin') {
      return sendError(ctx, req, res, 404, 'not found');
    }
    return handlePost(ctx, req, res, routeEncoded);
  }
  return sendError(ctx, req, res, 501, `Unsupported method ('${method}')`);
}

/** 绑定首选端口，被占用就照 Python 版往后找（+1…+19，最后交给系统分配） */
function listenOnce(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolve(addr && typeof addr === 'object' ? addr.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function listenFirstFree(server, host, preferred) {
  const candidates = [preferred];
  for (let i = 1; i < PORT_SCAN_LIMIT; i += 1) candidates.push(preferred + i);
  candidates.push(0); // Python: free_port() 最后一项是 0（交给系统分配）
  let lastErr = null;
  for (const p of candidates) {
    try {
      return await listenOnce(server, host, p);
    } catch (e) {
      if (e && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw new Error(
    `端口 ${preferred}（以及其后 19 个后继端口）都被占用，无法启动：${lastErr ? lastErr.message : '未知错误'}\n` +
      '     请先关掉那个旧窗口/进程（上一次的启动器/编辑器可能还开着），再重试。',
  );
}

/** 控制台横幅（对应 Python 版 main() 里的打印；组件组数只是提示信息） */
function countComponentGroups(ctx) {
  try {
    const dir = path.join(ctx.runDir, 'src', 'registry', 'components');
    return fs.readdirSync(dir).filter((f) => isDir(path.join(dir, f))).length;
  } catch {
    return 0;
  }
}

function printBanner(ctx, url, requestedPort, actualPort) {
  const out = process.stdout;
  if (actualPort !== requestedPort) {
    // ★常见陷阱：上一次的启动器还开着（关窗口/Ctrl+C 之外的强杀不会带走它），
    //   本服务会静默换端口，于是你打开的其实是**旧版本**。这里必须说清楚。
    out.write(`   ⚠ 端口 ${requestedPort} 已被占用（很可能是上一次的启动器还开着），已改用 ${actualPort}。\n`);
    out.write('     请先关掉那个旧窗口/进程，否则你看到的可能是旧版本，且 /__log 等接口也不会有。\n');
  }
  const n = countComponentGroups(ctx);
  out.write(`${'-'.repeat(64)}\n`);
  out.write(' 可视化编辑器已启动\n');
  out.write(`   地址    : ${url}\n`);
  out.write(`   产物    : ${ctx.distDir}\n`);
  out.write(`   组件目录: src/registry/components/（common / document / web 共 ${n} 组）\n`);
  out.write(`   日志    : ${ctx.logDir}\n`);
  out.write('   停止    : 调 close()（Python 版是 Ctrl+C / 关窗口）\n');
  out.write('   提示    : 开发模式请用 npm run dev（需要 esbuild 子进程权限）\n');
  out.write(`${'-'.repeat(64)}\n`);
}

/** URL 里主机名：'0.0.0.0'/'::' 显示成 127.0.0.1，IPv6 加方括号 */
function hostForUrl(host) {
  if (host === '0.0.0.0' || host === '::' || host === '::0') return '127.0.0.1';
  if (host.includes(':')) return `[${host}]`;
  return host;
}

/**
 * 启动静态服务（等价于 `python 启动编辑器.py` 托管 dist/ 的那部分）。
 *
 * @param {object} options
 * @param {string} options.rootDir 仓库根（里面应有 dist/web）；不写死盘符
 * @param {number} [options.port=5179] 首选端口，被占用时自动往后找
 * @param {string} [options.host='127.0.0.1'] 监听地址
 * @param {boolean} [options.quiet=false] true 时不打印启动横幅（只影响控制台输出）
 * @param {string} [options.logDir] 覆盖 logs 落盘目录（默认 `<运行目录>/logs`，与 Python 版一致）
 * @param {string} [options.docsDir] 覆盖 `/__save` 的落盘根（默认 `<运行目录>/docs`）
 * @param {string} [options.componentsDir] 覆盖组件目录，即 `/__components`、`/组件/<name>`、`/__savePlugin`
 *   用的目录（默认仍是 `public/组件` → `dist/组件`）
 * @returns {Promise<{url:string, port:number, close:() => Promise<void>, server:import('node:http').Server, runDir:string, distDir:string, logDir:string, docsDir:string, componentsDir:string}>}
 */
export async function startWebServer({
  rootDir,
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  quiet = false,
  logDir,
  docsDir,
  componentsDir: componentsDirOption,
} = {}) {
  if (!rootDir) throw new Error('startWebServer 需要 rootDir（仓库根，内含 dist/web）');
  const ctx = makeContext({ rootDir, quiet, logDir, docsDir, componentsDir: componentsDirOption });
  if (!isFile(ctx.indexFile)) {
    throw new Error(
      `dist/index.html 不存在，无法启动：${ctx.indexFile}\n     请先成功执行一次：npm run build（在 ${ctx.runDir} 下）`,
    );
  }

  // 在途请求计数：只有响应写完（或连接断了）才归零。close() 用它区分「空闲连接」和「正在写的请求」——
  // 实测 Node 24.15 上 closeIdleConnections() 并不会放掉已经收完响应的 keep-alive 连接（连接数一直是 1），
  // 所以不能只靠它，否则 server.close() 的回调要等客户端自己断开才触发。
  let inFlight = 0;
  let onAllIdle = null;

  const server = http.createServer(
    // ★请求头上限：Node 默认 16KB，超过直接回 **431**（页面白屏、标题为空 —— 排查时极难看出是这个原因）。
    //   本应用的页面 URL 会带长参数（`?load=<data:…>` 载入 HTML、`?loadJson=`、`?exportPdf=`），
    //   PDF 样张回归时就撞上过：30KB 的 `?loadJson=` 让应用**根本没加载起来**。抬到 256KB。
    { maxHeaderSize: 256 * 1024 },
    (req, res) => {
      inFlight += 1;
      res.on('close', () => {
        inFlight -= 1;
        if (inFlight === 0 && onAllIdle) onAllIdle();
      });
      try {
        handleRequest(ctx, req, res);
      } catch (e) {
        try {
          sendJson(ctx, req, res, 500, { ok: false, error: String((e && e.message) || e) });
        } catch {
          res.destroy();
        }
      }
    },
  );

  const actualPort = await listenFirstFree(server, host, port);
  server.on('error', (e) => {
    logMessage(ctx, null, `server error: ${(e && e.message) || e}`);
  });

  const url = `http://${hostForUrl(host)}:${actualPort}/`;
  // 实际生效的三个目录（分发版可以拿去显示/断言；componentsDir 是不传覆盖时的当前解析结果）
  const actualComponentsDir = componentsDir(ctx);
  if (!quiet) printBanner(ctx, url, port, actualPort);

  let closing = null;
  /**
   * 停止监听并释放端口（调用即停止 accept，端口立刻不再 LISTEN，不需要等连接收尾）。
   * 收尾策略：先优雅 —— server.close() + closeIdleConnections()，**正在写的请求允许写完**
   * （比如退出前最后一个 /__log 落盘）；空闲连接（没有在途请求）则立刻 closeAllConnections() 放掉，
   * 免得 await close() 一直挂着。超过 CLOSE_GRACE_MS 还有在途请求就兜底强杀，避免卡死。
   * 注：强杀会让客户端池子里的 keep-alive 连接收到 RST，浏览器/undici 对幂等请求会自己重试一次。
   */
  const close = () => {
    if (closing) return closing;
    closing = new Promise((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      let settled = false;
      let timer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        onAllIdle = null;
        if (timer) clearTimeout(timer);
        resolve();
      };
      const dropConnections = () => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      };
      const dropIfIdle = () => {
        if (inFlight === 0) dropConnections();
      };
      server.close(() => finish());
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
      onAllIdle = dropIfIdle;
      dropIfIdle();
      timer = setTimeout(() => {
        dropConnections();
        finish();
      }, CLOSE_GRACE_MS);
    });
    return closing;
  };

  return {
    url,
    port: actualPort,
    close,
    server,
    runDir: ctx.runDir,
    distDir: ctx.distDir,
    logDir: ctx.logDir,
    docsDir: ctx.docsDir,
    componentsDir: actualComponentsDir,
  };
}

export default startWebServer;
