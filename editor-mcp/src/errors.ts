/**
 * 统一错误码与返回体（规格 §8 / §9）。
 *
 * 原则：
 *   · 任何错误都以**结构化 error** 返回，不把堆栈抛给客户端；
 *   · BRIDGE_OFFLINE 且有 Headless 兜底时返回 `{ ok: true, degraded: true }`，不算失败；
 *   · 破坏性操作缺 `confirm: true` → CONFIRM_REQUIRED，且**不执行**。
 */
import { log } from './log.js';
import { config } from './config.js';

export const ErrorCodes = {
  // 传输 / 策略层（UNAUTHORIZED 与 ORIGIN_REJECTED 为 P0 安全新增）
  UNAUTHORIZED: 'UNAUTHORIZED',
  ORIGIN_REJECTED: 'ORIGIN_REJECTED',
  BRIDGE_OFFLINE: 'BRIDGE_OFFLINE',
  DOC_NOT_FOUND: 'DOC_NOT_FOUND',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
  PROPERTY_NOT_IN_SCHEMA: 'PROPERTY_NOT_IN_SCHEMA',
  INVALID_PROP_VALUE: 'INVALID_PROP_VALUE',
  PLUGIN_NOT_FOUND: 'PLUGIN_NOT_FOUND',
  PLUGIN_SYNTAX_ERROR: 'PLUGIN_SYNTAX_ERROR',
  PLUGIN_CONTRACT_ERROR: 'PLUGIN_CONTRACT_ERROR',
  PLUGIN_TYPE_PREFIX: 'PLUGIN_TYPE_PREFIX',
  PLUGIN_DRYRUN_FAILED: 'PLUGIN_DRYRUN_FAILED',
  WRITE_DISABLED: 'WRITE_DISABLED',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  PATH_NOT_ALLOWED: 'PATH_NOT_ALLOWED',
  TABLE_RANGE_INVALID: 'TABLE_RANGE_INVALID',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  IO_ERROR: 'IO_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ToolError {
  code: ErrorCode;
  message: string;
  hint?: string;
}

/** 统一返回体（规格 §8） */
export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ToolError;
  /** true = 没走成 Live Bridge，降级到无头/磁盘（规格 §二） */
  degraded?: boolean;
  /** 本次改动涉及的字段，便于客户端判断是否需要刷新 */
  changed?: string[];
}

export class EditorMcpError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'EditorMcpError';
    this.code = code;
    this.hint = hint;
  }
}

export const fail = (code: ErrorCode, message: string, hint?: string): ToolResult<never> => ({
  ok: false,
  error: hint ? { code, message, hint } : { code, message },
});

export const ok = <T>(data: T, extra: Omit<ToolResult<T>, 'ok' | 'data'> = {}): ToolResult<T> => ({
  ok: true,
  data,
  ...extra,
});

/**
 * 写操作的判定（规格 §10「写开关」）：`EDITOR_MCP_ALLOW_WRITE=false` 时这些动作一律拒绝。
 * 放在这里集中判定，而不是散在每个 handler 里 —— 漏一个就等于开了后门。
 */
const WRITE_ACTION = /\.(create|add|set|update|remove|delete|duplicate|rename|move|reorder|insert|patch|clear|restore|save|reload|import|embed|embedFromHtml)$/;

export function isWriteTool(tool: string): boolean {
  return WRITE_ACTION.test(tool);
}

/* ── 速率限制（规格 §10：调用 > N 次/分钟 → RATE_LIMITED）──
   按**进程**做滑动窗口：stdio 下一个进程就是一个客户端；HTTP 下多会话共用一个窗口，
   比"每客户端一个窗口"更保守（宁可早拦，也不放开）。 */
const callTimes: number[] = [];

export function rateLimited(now = Date.now()): boolean {
  const limit = config.rateLimitPerMinute;
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const windowStart = now - 60_000;
  while (callTimes.length && callTimes[0] < windowStart) callTimes.shift();
  callTimes.push(now);
  return callTimes.length > limit;
}

/**
 * 所有 Tool handler 的统一外壳：
 *   · 速率限制（RATE_LIMITED）；
 *   · 写开关（ALLOW_WRITE=false → WRITE_DISABLED，读操作不受影响）；
 *   · 捕获异常 → 结构化错误（支持 `CODE: message` 形式的消息，把错误码如实带出去）；
 *   · 记审计日志（规格 §10）。
 */
export async function runTool<T>(
  tool: string,
  args: Record<string, unknown>,
  fn: () => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  const started = Date.now();
  if (rateLimited(started)) {
    const res = fail(ErrorCodes.RATE_LIMITED, `调用过于频繁（上限 ${config.rateLimitPerMinute} 次/分钟，当前窗口内已超）`, '稍等再试，或调大 EDITOR_MCP_RATE_LIMIT。');
    log.audit(tool, args, ErrorCodes.RATE_LIMITED, Date.now() - started);
    return res;
  }
  if (!config.allowWrite && isWriteTool(tool)) {
    const res = fail(ErrorCodes.WRITE_DISABLED, `EDITOR_MCP_ALLOW_WRITE=false：${tool} 属于写操作，已拒绝`, '把环境变量设为 true（或删掉）再试；读操作不受影响。');
    log.audit(tool, args, ErrorCodes.WRITE_DISABLED, Date.now() - started);
    return res;
  }
  try {
    const res = await fn();
    log.audit(tool, args, res.ok ? 'ok' : (res.error?.code ?? 'error'), Date.now() - started);
    return res;
  } catch (e) {
    const err = toEditorError(e);
    log.error(`${tool} 失败：${err.code} ${err.message}`);
    log.audit(tool, args, err.code, Date.now() - started);
    return fail(err.code, err.message, err.hint);
  }
}

/** 把任意异常转成带错误码的 EditorMcpError：`CODE: message` 里的 CODE 会被认出来 */
export function toEditorError(e: unknown): EditorMcpError {
  if (e instanceof EditorMcpError) return e;
  const msg = String((e as Error)?.message ?? e);
  const m = msg.match(/^([A-Z][A-Z_]{2,}):\s*([\s\S]*)$/);
  if (m && (Object.values(ErrorCodes) as string[]).includes(m[1])) {
    return new EditorMcpError(m[1] as ErrorCode, m[2].trim() || m[1]);
  }
  return new EditorMcpError(ErrorCodes.IO_ERROR, msg);
}
