/**
 * Tool 的公共外壳：`runTool` + `withBridge` 组合，六域 Tools 共用，避免每个 Tool 重复十行样板。
 *
 * 语义（规格 §二 / §8）：
 *   · 先试 Live（编辑器实例），失败静默降级到无头，并在返回体标 `degraded`；
 *   · Live 已连上却返回业务错误（带错误码）→ **不降级**，原样返回该错误码；
 *   · 返回值统一 `{ ok, data, error?, degraded?, changed? }`。
 */
import { ErrorCodes, fail, runTool, type ErrorCode, type ToolResult } from '../errors.js';
import { BridgeCallError, withBridge, type Via } from '../bridge/fallback.js';

const KNOWN = new Set<string>(Object.values(ErrorCodes));

export interface ViaInfo {
  via: Via;
  degraded: boolean;
}

export async function viaBridge<T>(
  tool: string,
  params: Record<string, unknown>,
  headless: () => Promise<T>,
  opts: { changed?: string[]; viaTimeoutMs?: number; callTimeoutMs?: number } = {},
): Promise<ToolResult<T & ViaInfo>> {
  return runTool(tool, params, async () => {
    try {
      const res = await withBridge<T>(tool, params, headless, {
        ...(opts.viaTimeoutMs != null ? { readyTimeoutMs: opts.viaTimeoutMs } : {}),
        ...(opts.callTimeoutMs != null ? { callTimeoutMs: opts.callTimeoutMs } : {}),
      });
      const data = { ...(res.data as object), via: res.via, degraded: res.degraded } as T & ViaInfo;
      return {
        ok: true,
        data,
        degraded: res.degraded,
        ...(opts.changed ? { changed: opts.changed } : {}),
      };
    } catch (e) {
      if (e instanceof BridgeCallError) {
        const code: ErrorCode | string = KNOWN.has(e.code) ? (e.code as ErrorCode) : e.code;
        return fail(code as ErrorCode, e.message, `来自编辑器（Live）：${e.code}`);
      }
      throw e;
    }
  });
}

/** 只走 Live 的能力（编辑器里才有实现，例如导出 HTML/React、重载插件） */
export async function liveOnly<T>(
  tool: string,
  params: Record<string, unknown>,
  opts: { changed?: string[] } = {},
): Promise<ToolResult<T>> {
  return runTool(tool, params, async () => {
    const { liveBridge } = await import('../bridge/liveBridge.js');
    const ready = await liveBridge.ensureReady(800);
    if (!ready) {
      return fail(
        ErrorCodes.BRIDGE_OFFLINE,
        `${tool} 需要编辑器在线（这项能力只有编辑器里实现）`,
        '请启动编辑器并在菜单「帮助 → 开启 MCP 桥接」；或改用无头支持的能力（doc.* / node.* / table.* 等）',
      );
    }
    try {
      const data = await liveBridge.call<T>(tool, params);
      return { ok: true, data, ...(opts.changed ? { changed: opts.changed } : {}) };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const [code, ...rest] = msg.split(':');
      return fail(KNOWN.has(code) ? (code as ErrorCode) : ErrorCodes.IO_ERROR, rest.join(':').trim() || msg);
    }
  });
}
