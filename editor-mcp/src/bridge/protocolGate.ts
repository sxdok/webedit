/**
 * 编辑器 ↔ MCP 的**握手判据**（ARCHITECTURE §5.1：用"协议 + 能力"替换"版本全等"）。
 *
 * 为什么要换掉"版本全等"：产品版本（0.3.0 这种）按发布节奏走，**任何一次发版都会让 Live 直接废掉**
 * （`编辑器 v0.1.0 / MCP v0.2.0 → 拒绝使用 Live Bridge`）。而真正影响互通的是**协议版本**与
 * **能力集**：协议相同就该能用 Live，缺某个能力时只有"依赖该能力的方法"退回无头。
 *
 * 判据做成**纯函数**：它是跨进程契约的一部分，必须能被单测穷举（协议相同/不同/未报、能力缺失），
 * 而不是埋在 WebSocket 消息处理里靠联调碰运气。
 */

/** 当前桥接协议版本。**破坏性变更才 +1**（不是产品版本）。 */
export const EDITOR_PROTOCOL = 2;

/** 能力名（契约的一部分；页面侧 `web-editor/src/mcp/protocol.ts` 必须一致，verify 有断言） */
export type FeatureKey = 'exportDocx' | 'liveSelection' | 'realtime';

/** 编辑器能力集 */
export interface EditorFeatures {
  /** 编辑器能导出 .docx 字节（付费档能力，Live 时由编辑器产出） */
  exportDocx?: boolean;
  /** 编辑器能报当前选择（Live 选择态） */
  liveSelection?: boolean;
  /** 编辑器能推实时变更（供看板/预览跟随） */
  realtime?: boolean;
  /** 允许将来加能力而不用改类型（但**列进 METHOD_FEATURE 的必须是上面的具名能力**） */
  [k: string]: boolean | undefined;
}

/** 方法 → 依赖的编辑器能力。没列出的方法 = 不依赖特定能力。 */
export const METHOD_FEATURE: Record<string, FeatureKey | undefined> = {
  'export.docx': 'exportDocx',
  'export.html': 'exportDocx', // 同一套渲染能力（都在编辑器里产出 HTML）
  'selection.get': 'liveSelection',
  'selection.set': 'liveSelection',
};

export interface EditorHandshake {
  /** 编辑器自报的协议版本；老编辑器可能不报（undefined） */
  protocol?: number;
  version?: string;
  features?: EditorFeatures;
}

export interface GateDecision {
  /** 是否可用 Live（协议相同、或不同但允许尝试；完全拿不到 hello 时不适用本函数） */
  live: boolean;
  /** 协议与我们对不上（含"没报协议"）→ 调用前要按能力逐个判 */
  protocolMismatch: boolean;
  /** 给人看的一句话（写进日志/诊断） */
  note: string;
}

/**
 * 判据：
 *   · 协议相同      → Live，版本不同**只记 info**；
 *   · 协议不同/未报 → **仍然尝试 Live**，但标 `protocolMismatch`，调用前按 `features` 逐方法判；
 *   · 完全拿不到 hello（编辑器没接入）→ 不由本函数决定，走无头 + `degraded`（现状）。
 */
export function evaluateHandshake(h: EditorHandshake, mcpVersion: string, mcpProtocol: number = EDITOR_PROTOCOL): GateDecision {
  const p = h.protocol;
  if (typeof p !== 'number') {
    return {
      live: true,
      protocolMismatch: true,
      note: `编辑器未上报桥接协议版本（偏旧）→ 允许尝试 Live，但逐个方法按能力判定；建议一起升级`,
    };
  }
  if (p === mcpProtocol) {
    return h.version && h.version !== mcpVersion
      ? { live: true, protocolMismatch: false, note: `编辑器 v${h.version} / MCP v${mcpVersion}，协议 v${p} 兼容` }
      : { live: true, protocolMismatch: false, note: `协议 v${p} 一致` };
  }
  return {
    live: true,
    protocolMismatch: true,
    note: `编辑器协议 v${p} ≠ MCP v${mcpProtocol}：仍尝试 Live，缺失的能力走无头并提示「编辑器协议偏旧，请一起升级」`,
  };
}

/**
 * 该方法在给定握手信息下是否**缺能力**（缺则调用走无头并注明原因）。规则四条，按序：
 *   ① 该方法不依赖特定能力 → 不缺；
 *   ② 编辑器**明确报**支持 → 不缺；
 *   ③ 编辑器**明确报**不支持 → 缺（不论协议）；
 *   ④ 编辑器**没报**这项：协议一致 → 视为不缺（协议一致即能力集由协议定义）；协议不一致 → **保守视为缺**
 *      （老编辑器没报的就是我们不知道的，宁可走无头，也不赌）。
 * @returns 缺失的能力名；不缺返回 null
 */
export function missingFeature(method: string, features: EditorFeatures | undefined, protocolMismatch: boolean): FeatureKey | null {
  const need = METHOD_FEATURE[method];
  if (!need) return null;
  const reported = features?.[need];
  if (reported === true) return null;
  if (reported === false) return need;
  return protocolMismatch ? need : null;
}
