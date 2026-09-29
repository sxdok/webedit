/**
 * 编辑器侧的**握手契约**（ARCHITECTURE §5.1）。
 *
 * ★这里的常量必须与 `editor-mcp/src/bridge/protocolGate.ts` 一致 —— verify 有一条跨包断言守着。
 *   为什么现在是"两处 + 断言"而不是"一处生成"：现阶段不改目录（P1 结论），
 *   等 P2 的 `contracts/` 落地后再由 `tools/sync-contracts.mjs` 生成；在那之前**断言**就是防漂移的手段。
 */

/** 桥接协议版本：**只有破坏性协议变更才 +1**（与产品版本无关） */
export const EDITOR_PROTOCOL = 2;

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
