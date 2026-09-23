/**
 * 日志与审计（规格 §10「审计日志」/ §14「可观测」）。
 *
 * · 控制台日志走 stderr —— **stdout 是 MCP 的 JSON-RPC 通道，绝不能污染**；
 * · 写操作追加到 `<workspace>/audit.log`：时间 / Tool / 参数摘要 / 结果 / 耗时；
 * · `--debug` 时打印每条 MCP 消息的请求与响应摘要。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let debugEnabled = process.argv.includes('--debug');

export function setDebug(on: boolean): void {
  debugEnabled = on;
}

/** 本地时间戳：用 UTC 会与文件时间差 8 小时（编辑器侧踩过同一个坑） */
const ts = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
};

/** 参数摘要：只留键与短值，避免把整份文档写进日志 */
function brief(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const out: string[] = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    let s: string;
    if (v == null) s = 'null';
    else if (typeof v === 'string') s = v.length > 40 ? `${v.slice(0, 40)}…(${v.length})` : v;
    else if (Array.isArray(v)) s = `[${v.length} 项]`;
    else if (typeof v === 'object') s = `{${Object.keys(v as object).slice(0, 6).join(',')}}`;
    else s = String(v);
    out.push(`${k}=${s}`);
  }
  return out.join(' ');
}

function appendAudit(line: string): void {
  try {
    fs.mkdirSync(config.workspace, { recursive: true });
    fs.appendFileSync(path.join(config.workspace, 'audit.log'), line + '\n', 'utf8');
  } catch {
    /* 审计日志写不进去不影响工具执行 */
  }
}

export const log = {
  info: (msg: string): void => {
    process.stderr.write(`[${ts()}] INFO  ${msg}\n`);
  },
  warn: (msg: string): void => {
    process.stderr.write(`[${ts()}] WARN  ${msg}\n`);
  },
  error: (msg: string): void => {
    process.stderr.write(`[${ts()}] ERROR ${msg}\n`);
  },
  debug: (msg: string): void => {
    if (debugEnabled) process.stderr.write(`[${ts()}] DEBUG ${msg}\n`);
  },
  /** 审计：所有写操作都要留痕 */
  audit: (tool: string, args: unknown, result: string, ms: number): void => {
    const line = `${ts()}\t${tool}\t${result}\t${ms}ms\t${brief(args)}`;
    appendAudit(line);
    log.debug(`audit ${line}`);
  },
  brief,
};
