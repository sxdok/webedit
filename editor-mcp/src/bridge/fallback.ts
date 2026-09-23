/**
 * 双通道自动降级（规格 §二 / §4.1）：
 *
 *   优先 Live Bridge（编辑器实例，实时同步）
 *   ↳ 不可用（没开桥接 / 版本不匹配 / 调用失败）时**静默降级**到 Headless（磁盘文档），
 *     并在返回值里标 `degraded: true`，让客户端知道"没连上编辑器"。
 *
 * 注意两点：
 *   1. 写操作在 Live 失败后降级到 Headless 是**有意为之**：离线批处理也要能建文档；
 *      但如果 Live 已经连上却"调用报错"（比如 NODE_NOT_FOUND），那是业务错误，**不再降级**，
 *      否则会把用户的编辑意图悄悄写进另一个地方。
 *   2. 编辑器从未连上时的代价要可控：`ensureReady` 最多等几百毫秒，绝不让工具挂住。
 */
import { log } from '../log.js';
import { liveBridge } from './liveBridge.js';

export type Via = 'live' | 'headless';

export interface ChannelResult<T> {
  data: T;
  degraded: boolean;
  via: Via;
}

export class BridgeCallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeCallError';
    this.code = code;
  }
}

/**
 * 先试 Live，再退 Headless。
 * @param method  桥接方法名（与 Tool 名一致，如 'doc.create'）
 * @param params  桥接参数
 * @param headless 无头实现
 * @param opts.readyTimeoutMs 等待桥接就绪的上限（默认 800ms）
 */
export async function withBridge<T>(
  method: string,
  params: Record<string, unknown>,
  headless: () => Promise<T>,
  opts: { readyTimeoutMs?: number; callTimeoutMs?: number } = {},
): Promise<ChannelResult<T>> {
  const ready = await liveBridge.ensureReady(opts.readyTimeoutMs ?? 800);
  if (ready) {
    try {
      const data = await liveBridge.call<T>(method, params, opts.callTimeoutMs ?? 8000);
      return { data, degraded: false, via: 'live' };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // 编辑器**有意不做**的方法（LIVE_FALLBACK）：不是业务错误，直接降级到无头并标 degraded
      if (msg.startsWith('LIVE_FALLBACK')) {
        log.info(`编辑器不做 ${method}（${msg.replace(/^LIVE_FALLBACK:\s*/, '')}），改用无头通道`);
      } else if (/^BRIDGE_OFFLINE:/.test(msg)) {
        // "编辑器不在线"是**通道问题**不是业务问题：必须降级（否则编辑器一关，所有工具全废）
        log.warn(`Live 调用 ${method} 时编辑器已不在线，降级到无头`);
      } else if (/^[A-Z_]+:/.test(msg)) {
        // 桥接侧的"业务错误"（带错误码前缀）→ 直接抛，不降级
        const [code, ...rest] = msg.split(':');
        throw new BridgeCallError(code, rest.join(':').trim() || msg);
      } else {
        log.warn(`Live 调用 ${method} 失败（${msg}），降级到无头`);
      }
    }
  }
  const data = await headless();
  return { data, degraded: true, via: 'headless' };
}

/** 给资源/诊断用的桥接状态摘要 */
export function bridgeSummary() {
  const s = liveBridge.status();
  return {
    ...s,
    mode: s.ready ? 'live' : 'headless',
    /** 一句话说清现在是哪种情况（排障用；`connected` 与 `ready` 的区别见 BridgeStatus 注释） */
    situation: s.ready
      ? 'live：编辑器已接入，调用走编辑器实例'
      : s.hubNoEditor
        ? 'headless：中转可达、但编辑器未接入（编辑器没开或菜单里没开桥接）'
        : s.connected
          ? 'handshake：中转已连、还没问出编辑器状态'
          : 'headless：连不上中转（editor-mcp 的 hub 没起或被占端口）',
    hint: s.ready
      ? undefined
      : '编辑器未开启 MCP 桥接（菜单「帮助 → 开启 MCP 桥接」），当前所有操作走无头模式并标记 degraded=true',
  };
}

/**
 * 资源用：**先确保本侧真的去连过中转**再报状态。
 * ★不这么做会出现"假阴性"：编辑器明明接上了，但因为本侧还没连，
 *   没有任何人把"编辑器已接入"告诉它，`ready` 一直是 false（阶段八端到端就卡在这）。
 */
export async function bridgeSummaryLive(timeoutMs = 500) {
  await liveBridge.ensureReady(timeoutMs);
  return bridgeSummary();
}
