/**
 * 职责：统一日志与诊断核心。
 *   · 分级（debug/info/warn/error）+ 作用域 + 结构化数据，带时间戳；
 *   · 内存环形缓冲（默认 500 条，可订阅）；
 *   · 关键级别落 localStorage（默认保留尾部 200 条）——刷新/崩溃后仍能拿到现场；
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
  const onBeforeUnload = () => persistTail();

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
