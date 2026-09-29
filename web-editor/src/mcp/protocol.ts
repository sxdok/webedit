/**
 * 编辑器侧的**握手契约**（ARCHITECTURE §5.1）。
 *
 * ★`EDITOR_PROTOCOL` 不再手写：它由 `tools/sync-contracts.mjs` 从 MCP 的判据模块
 *   （`editor-mcp/src/bridge/protocolGate.ts`，协议号的唯一权威）生成到 `web-editor/src/version.ts`。
 *   verify 里有断言盯着"生成物 ↔ 双方声明"三者一致。
 */
import { EDITOR_PROTOCOL, VERSION } from '../version';

export { EDITOR_PROTOCOL, VERSION };

/**
 * 编辑器自报的能力集。MCP 用它决定"某个方法能不能走 Live"：
 * 协议一致时能力集由协议定义；协议不一致时 MCP 对**没报**的能力采取保守策略（走无头）。
 */
export const EDITOR_FEATURES: Record<string, boolean> = {
  /** 能在编辑器里产出 .docx 字节（付费档能力；无头也有实现，但 Live 才是"所见即所得"） */
  exportDocx: true,
  /** 能报当前选择（Live 选择态） */
  liveSelection: true,
  /** 能推实时变更（供预览/看板跟随） */
  realtime: true,
};
