/**
 * 主进程日志：按天写 `<userData>/logs/desktop-YYYY-MM-DD.log`，同时留一段内存环形缓冲给界面/诊断接口。
 *
 * 为什么不直接用 console：分发版是**双击启动**的，没有终端可看；用户报问题时我们能要到的
 * 只有磁盘上的日志文件。所以：文件必须有、路径必须好找（菜单里「打开日志目录」）、
 * 渲染进程的日志也往同一处汇（前端本来就会 POST `/__log`，这里是主进程侧的补充）。
 */
import { appendFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RING_MAX = 500;
const LEVELS = ['debug', 'info', 'warn', 'error'];

export function createLogger({ logDir, fileName = 'desktop', ringMax = RING_MAX } = {}) {
  const ring = [];
  let currentFile = null;
  const listeners = new Set();

  const day = () => new Date().toISOString().slice(0, 10);
  const fileFor = (d) => join(logDir, `${fileName}-${d}.log`);

  function write(level, msg, extra) {
    const line = `${new Date().toISOString()} [${String(level).toUpperCase().padEnd(5)}] ${msg}${extra === undefined ? '' : ` ${safeJson(extra)}`}`;
    ring.push(line);
    if (ring.length > ringMax) ring.splice(0, ring.length - ringMax);
    try {
      mkdirSync(logDir, { recursive: true });
      currentFile = fileFor(day());
      appendFileSync(currentFile, line + '\n', 'utf8');
    } catch {
      /* 日志写不进去（磁盘满/权限）不能反过来把应用弄崩 */
    }
    for (const fn of listeners) {
      try {
        fn(line);
      } catch {
        /* 监听者自己的问题不影响写日志 */
      }
    }
    return line;
  }

  const api = {
    logDir,
    file: () => currentFile ?? fileFor(day()),
    lines: () => ring.slice(),
    tail: (n = 100) => ring.slice(-n),
    onLine: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** 历史日志文件清单（按时间倒序），给「打开日志目录」旁边的诊断看 */
    files: () => {
      try {
        return readdirSync(logDir)
          .filter((f) => f.endsWith('.log'))
          .map((f) => {
            const st = statSync(join(logDir, f));
            return { name: f, bytes: st.size, mtime: Math.round(st.mtimeMs) };
          })
          .sort((a, b) => b.mtime - a.mtime);
      } catch {
        return [];
      }
    },
  };
  for (const lv of LEVELS) api[lv] = (msg, extra) => write(lv, msg, extra);
  /** 渲染进程来的整段文本（前端把 console 一起送过来），逐行入库 */
  api.raw = (text) => {
    for (const ln of String(text ?? '').split(/\r?\n/)) if (ln.trim()) write('info', ln.trim());
  };
  return api;
}

function safeJson(v) {
  if (v instanceof Error) return JSON.stringify({ error: v.message });
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
