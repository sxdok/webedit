/**
 * 职责：统一日志与诊断核心。
 *   · 分级（debug/info/warn/error）+ 作用域 + 结构化数据，带时间戳；
 *   · 内存环形缓冲（默认 500 条，可订阅）；
 *   · 关键级别落 localStorage（默认保留尾部 200 条）——刷新/崩溃后仍能拿到现场；
 *   · **落盘到运行目录**：启动器（启动编辑器.py）提供 `/__log`，日志按天追加到
 *     `<运行目录>/logs/editor-YYYY-MM-DD.log`；没有该接口（file:// 或别的静态服务器）时
 *     自动退回 localStorage 并在诊断报告里如实标注；
 *   · 捕获 window.onerror / unhandledrejection；
 *   · dump() 输出可直接粘给他人定位问题的文本报告。
 * 用法：log.info('store', 'setMode', { mode })、log.action('addComponent', {...})、log.error(...)
 *      URL 参数 ?log=debug|info|warn|error 控制最低输出级别（默认：dev=debug，prod=warn）。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** 时间戳 ms */ t: number;
  level: LogLevel;
  /** 模块/来源，如 store / canvas / registry / boot */ scope: string;
  msg: string;
  data?: unknown;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BUFFER = 500;
const PERSIST_KEY = 'visual-editor-log-v1';
const PERSIST_TAIL = 200;
/** 单条 data 的序列化上限，避免把整篇文档写进日志 */
const MAX_DATA_CHARS = 2000;

const buffer: LogEntry[] = [];
const listeners = new Set<(e: LogEntry) => void>();

let minLevel: LogLevel =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV ? 'debug' : 'warn';
let installed = false;

/* ══════════════ 内部工具 ══════════════ */

function summarize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  const t = typeof value;
  if (t === 'string') return (value as string).length > 300 ? `${(value as string).slice(0, 300)}…(${(value as string).length})` : value;
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'function') return '[fn]';
  if (Array.isArray(value)) {
    return depth > 2 ? `[Array ${value.length}]` : value.slice(0, 20).map((v) => summarize(v, depth + 1));
  }
  if (t === 'object') {
    if (depth > 2) return '[Object]';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      out[k] = summarize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function stringifyData(data: unknown): string {
  if (data === undefined) return '';
  try {
    const json = JSON.stringify(summarize(data));
    if (!json) return '';
    return json.length > MAX_DATA_CHARS ? `${json.slice(0, MAX_DATA_CHARS)}…(截断)` : json;
  } catch {
    return '[无法序列化]';
  }
}

function persistTail(): void {
  try {
    const tail = buffer.slice(-PERSIST_TAIL);
    localStorage.setItem(PERSIST_KEY, JSON.stringify(tail));
  } catch {
    /* 隐私模式/配额满：忽略 */
  }
}

/* ══════════════ 落盘到运行目录（启动器的 /__log） ══════════════ */

const REMOTE_INFO_URL = '/__loginfo';
const REMOTE_POST_URL = '/__log';
const FLUSH_MS = 1200;
const MAX_QUEUE = 400;

export interface RemoteInfo {
  /** 是否由启动器托管（有 /__log 接口） */
  enabled: boolean;
  /** 运行目录下的日志目录 */
  dir: string;
  /** 今天的文件名 */
  file: string;
  /** 还没送出去的行数 */
  pending: number;
  /** 是否曾经落盘失败并已退回本地存储 */
  failed: boolean;
}

export interface RemoteResult {
  ok: boolean;
  file: string;
  bytes: number;
  count: number;
}

let remoteEnabled = false;
let remoteDir = '';
let remoteFile = '';
let remoteFailed = false;
let flushTimer: number | null = null;
const outbox: string[] = [];

function formatEntry(e: LogEntry): string {
  const d = new Date(e.t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  // ★本地时间：日志文件用 UTC 会与文件时间戳差时区（曾被自己抓到差 8 小时）
  const ts =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  const data = stringifyData(e.data);
  return `${ts} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.msg}${data ? '  ' + data : ''}`;
}

/**
 * ★keepalive 请求体的硬上限：Fetch 规范规定带 `keepalive` 的请求体不能超过 **64KiB**，
 *   超过时 `fetch()` 会**直接抛 TypeError**（不是网络错，也不是 HTTP 错）。
 *   踩过的坑：诊断报告/自检报告动辄上百 KB，带上 keepalive 后每次都抛错 →
 *   被下面的 catch 当成"落盘失败"→ `remoteEnabled = false` →
 *   **之后连自检报告都写不进 logs/check-*.log**（现象是日志里报告突然断了）。
 */
const KEEPALIVE_MAX_BYTES = 60 * 1024;
/** 单次 POST 的目标体量（启动器 MAX_BODY = 512KiB，留足余量；报告按行切块多次写） */
const POST_CHUNK_BYTES = 120 * 1024;
/** 启动器单次最多收 2000 行，切块时不要超过它 */
const POST_CHUNK_LINES = 2000;

function utf8Size(s: string): number {
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length * 2; // 极端环境兜底（UTF-16 上界）
  }
}

/** 取 ≤budget 字节的最大前缀（二分；UTF-8 中文 3 字节/字符，不能按字符数硬切） */
function sliceByBytes(s: string, budget: number): { head: string; rest: string } {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (utf8Size(s.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  const n = Math.max(1, Math.min(lo, s.length));
  return { head: s.slice(0, n), rest: s.slice(n) };
}

/** 把行按体积/条数切成若干块（报告可能几百 KB，一次 POST 会被服务端 413 或 keepalive 限制挡住） */
function chunkLines(lines: string[]): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  const flush = () => {
    if (cur.length) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
  };
  for (const ln of lines) {
    let rest = ln;
    // ★单行本身就超过块上限（例如把整段报告写成一行）→ 先按字节硬切，
    //   否则这一块会顶到服务端 512KiB 上限 → 413 → 落盘链整条断掉。
    while (utf8Size(rest) > POST_CHUNK_BYTES) {
      const cut = sliceByBytes(rest, POST_CHUNK_BYTES / 2);
      flush();
      chunks.push([cut.head]);
      rest = cut.rest;
    }
    const s = utf8Size(rest) + 2;
    if (cur.length && (size + s > POST_CHUNK_BYTES || cur.length >= POST_CHUNK_LINES)) flush();
    cur.push(rest);
    size += s;
  }
  flush();
  return chunks;
}

/** 自检用：算出某段文本会被切成几块、最大一块多少字节（**不发请求**，纯计算） */
export function planPost(text: string): { chunks: number; maxBytes: number; keepalive: number } {
  const cs = chunkLines(text.split('\n'));
  let maxBytes = 0;
  let keepalive = 0;
  for (const c of cs) {
    const n = utf8Size(JSON.stringify({ kind: 'diagnostic', lines: c }));
    if (n > maxBytes) maxBytes = n;
    if (n <= KEEPALIVE_MAX_BYTES) keepalive += 1;
  }
  return { chunks: cs.length, maxBytes, keepalive };
}

async function postLog(kind: string, lines: string[]): Promise<RemoteResult | null> {
  if (!remoteEnabled || !lines.length) return null;
  let last: RemoteResult | null = null;
  for (const chunk of chunkLines(lines)) {
    const body = JSON.stringify({ kind, lines: chunk });
    try {
      const res = await fetch(REMOTE_POST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        // 只有小块才开 keepalive（页面卸载时尽量把日志送出去）；大报告走普通请求
        keepalive: utf8Size(body) <= KEEPALIVE_MAX_BYTES,
      });
      const json = (await res.json()) as RemoteResult & { error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      remoteFile = json.file;
      last = json;
    } catch (e) {
      remoteFailed = true;
      remoteEnabled = false; // 不再反复重试，避免每次日志都打网络
      console.warn('[logger] 日志落盘失败，已退回浏览器本地存储', e);
      return last;
    }
  }
  return last;
}

function scheduleFlush(): void {
  if (flushTimer != null || !remoteEnabled) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const lines = outbox.splice(0, outbox.length);
    void postLog('editor', lines);
  }, FLUSH_MS);
}

/** 启动时探测一次：由启动器托管才启用落盘 */
async function initRemote(): Promise<boolean> {
  if (typeof fetch !== 'function' || typeof location === 'undefined') return false;
  if (!/^https?:$/.test(location.protocol)) return false; // file:// 没有接口
  try {
    const res = await fetch(REMOTE_INFO_URL, { cache: 'no-store' });
    if (!res.ok) return false;
    const j = (await res.json()) as { enabled?: boolean; dir?: string; today?: string };
    if (!j?.enabled) return false;
    remoteEnabled = true;
    remoteDir = j.dir ?? '';
    remoteFile = j.today ?? '';
    return true;
  } catch {
    return false; // 别的静态服务器：/__loginfo 可能是 HTML 或 404
  }
}

function emit(level: LogLevel, scope: string, msg: string, data?: unknown): void {
  const entry: LogEntry = { t: Date.now(), level, scope, msg, data: data === undefined ? undefined : summarize(data) };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);

  if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel]) {
    const tag = `[${scope}] ${msg}`;
    const payload = entry.data === undefined ? [] : [entry.data];
    if (level === 'error') console.error(tag, ...payload);
    else if (level === 'warn') console.warn(tag, ...payload);
    else if (level === 'info') console.info(tag, ...payload);
    else console.debug(tag, ...payload);
  }
  if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT.warn) persistTail();
  // 落盘：debug 只在把级别调到 debug 时也一起写，避免文件被调试噪声淹没
  if (remoteEnabled && LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel === 'debug' ? 'debug' : 'info']) {
    outbox.push(formatEntry(entry));
    if (outbox.length > MAX_QUEUE) outbox.splice(0, outbox.length - MAX_QUEUE);
    scheduleFlush();
  }
  listeners.forEach((fn) => {
    try {
      fn(entry);
    } catch {
      /* 订阅者自身出错不能影响日志 */
    }
  });
}

/* ══════════════ 对外 API ══════════════ */

export const log = {
  debug: (scope: string, msg: string, data?: unknown) => emit('debug', scope, msg, data),
  info: (scope: string, msg: string, data?: unknown) => emit('info', scope, msg, data),
  warn: (scope: string, msg: string, data?: unknown) => emit('warn', scope, msg, data),
  error: (scope: string, msg: string, data?: unknown) => emit('error', scope, msg, data),

  /** 记录一次会改文档的动作（审计轨迹） */
  action: (name: string, data?: unknown) => emit('info', 'action', name, data),

  /** 耗时统计：配合 time() 使用，超过阈值会记 warn */
  time<T>(scope: string, msg: string, fn: () => T, warnMs = 50): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      const ms = Math.round(performance.now() - t0);
      if (ms >= warnMs) emit('warn', scope, `${msg} 较慢`, { ms });
      else emit('debug', scope, `${msg} ok`, { ms });
    }
  },

  entries: (): LogEntry[] => [...buffer],
  clear: (): void => {
    buffer.length = 0;
    try {
      localStorage.removeItem(PERSIST_KEY);
    } catch {
      /* ignore */
    }
  },
  subscribe(fn: (e: LogEntry) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setLevel(l: LogLevel): void {
    minLevel = l;
    emit('info', 'logger', `日志级别设为 ${l}`);
  },
  getLevel: (): LogLevel => minLevel,

  /* ── 落盘到运行目录（启动器的 /__log；不可用时退回 localStorage） ── */
  initRemote,
  remoteInfo: (): RemoteInfo => ({
    enabled: remoteEnabled,
    dir: remoteDir,
    file: remoteFile,
    pending: outbox.length,
    failed: remoteFailed,
  }),
  /** 立刻把待写队列刷到运行目录的 editor 日志；返回落盘结果（未启用时返回 null）
   *  ★只写 editor：以前允许传 kind，结果把普通日志刷进了 check-*.log（自检结果反而没落盘）。 */
  async flushRemote(): Promise<RemoteResult | null> {
    if (flushTimer != null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    const lines = outbox.splice(0, outbox.length);
    return postLog('editor', lines);
  },
  /** 把一段文本（如诊断报告）单独写成一个文件条目 */
  async saveReport(kind: 'diagnostic' | 'check', text: string): Promise<RemoteResult | null> {
    return postLog(kind, text.split('\n'));
  },

  /** 从 localStorage 恢复上次会话尾部的日志（崩溃后仍能看到现场） */
  restorePersisted(): number {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return 0;
      const arr = JSON.parse(raw) as LogEntry[];
      if (!Array.isArray(arr)) return 0;
      arr.forEach((e) => buffer.push({ ...e, msg: `${e.msg}` }));
      if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
      return arr.length;
    } catch {
      return 0;
    }
  },

  /** 可粘贴的文本报告（含日志尾部与全局环境） */
  dump(): string {
    const head = [
      `# 可视化编辑器 日志报告`,
      `生成时间: ${new Date().toISOString()}`,
      `URL: ${typeof location !== 'undefined' ? location.href : '-'}`,
      `UA: ${typeof navigator !== 'undefined' ? navigator.userAgent : '-'}`,
      `视口: ${typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x` : '-'}`,
      `日志级别: ${minLevel} · 缓冲 ${buffer.length} 条 · 上限 ${MAX_BUFFER}`,
      ''.padEnd(60, '-'),
    ].join('\n');
    const body = buffer
      .map((e) => {
        const ts = new Date(e.t).toISOString().slice(11, 23);
        const data = stringifyData(e.data);
        return `${ts} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.msg}${data ? '  ' + data : ''}`;
      })
      .join('\n');
    return `${head}\n${body}\n`;
  },
};

/** 安装全局错误捕获（只装一次）；返回卸载函数 */
export function installGlobalDiagnostics(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;

  const onError = (e: ErrorEvent) => {
    emit('error', 'window', e.message || '未知脚本错误', {
      source: `${e.filename ?? '-'}:${e.lineno ?? 0}:${e.colno ?? 0}`,
      stack: e.error instanceof Error ? e.error.stack?.split('\n').slice(0, 6).join('\n') : undefined,
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    emit('error', 'promise', '未处理的 Promise 拒绝', {
      reason: r instanceof Error ? r.message : String(r),
      stack: r instanceof Error ? r.stack?.split('\n').slice(0, 6).join('\n') : undefined,
    });
  };
  const onBeforeUnload = () => {
    persistTail();
    void log.flushRemote(); // keepalive 提交，尽量把最后的日志留下
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('beforeunload', onBeforeUnload);
  (window as unknown as { __EDITOR_LOG__?: typeof log }).__EDITOR_LOG__ = log;

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('beforeunload', onBeforeUnload);
    installed = false;
  };
}
