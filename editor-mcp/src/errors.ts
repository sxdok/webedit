/**
 * 统一错误码与返回体（规格 §8 / §9）。
 *
 * 原则：
 *   · 任何错误都以**结构化 error** 返回，不把堆栈抛给客户端；
 *   · BRIDGE_OFFLINE 且有 Headless 兜底时返回 `{ ok: true, degraded: true }`，不算失败；
 *   · 破坏性操作缺 `confirm: true` → CONFIRM_REQUIRED，且**不执行**。
 */
import { log } from './log.js';

export const ErrorCodes = {
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
 * 所有 Tool handler 的统一外壳：捕获异常 → 结构化错误；
 * 顺带记审计日志（规格 §10）。
 */
export async function runTool<T>(
  tool: string,
  args: Record<string, unknown>,
  fn: () => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  const started = Date.now();
  try {
    const res = await fn();
    log.audit(tool, args, res.ok ? 'ok' : (res.error?.code ?? 'error'), Date.now() - started);
    return res;
  } catch (e) {
    const err = e instanceof EditorMcpError ? e : new EditorMcpError(ErrorCodes.IO_ERROR, String((e as Error)?.message ?? e));
    log.error(`${tool} 失败：${err.code} ${err.message}`);
    log.audit(tool, args, err.code, Date.now() - started);
    return fail(err.code, err.message, err.hint);
  }
}
