/**
 * 职责：**分页符规范化**（ARCHITECTURE §7.5 E2-补 的 B2）—— 三个出口（打印 / 导出 HTML / 导出 Word）共用。
 *
 * 为什么需要：`pageBreak` 在两种情况下会**凭空多出一页空白**：
 *   ① 文档**以分页符结尾**（最常见：MCP 的 `page.addBreak` 缺省就是追加到末尾）；
 *   ② **两个分页符相邻**（手动加过、或"末尾追加"之后再追加）。
 * 人眼看"多了一张白纸"很难定位，所以必须在一个**共同出口**统一处理，而不是指望每条渲染路径自觉。
 *
 * ★边界（刻意保守）：**只动分页符，绝不删别的节点** —— 空段落/空容器也是用户内容（可能承担间距），
 *   误删比多一页空白严重得多。
 */
import type { ComponentNode } from '../registry/types';

/** 分页符的组件 type（编辑器里只有这一个） */
export const PAGE_BREAK_TYPE = 'pageBreak';

const isBreak = (n: ComponentNode): boolean => n.type === PAGE_BREAK_TYPE;

/**
 * 规范化**顶层**节点序列（返回新数组，不修改入参）：
 *   · 开头的分页符 → 删（前面没内容，换页无意义）；
 *   · 连续分页符 → 合并成一个；
 *   · 末尾的分页符 → 删（后面没内容，必然多一张空白页）。
 * 说明：只处理顶层 —— 分页符本来就只该出现在顶层。
 */
export function normalizeBreaks(nodes: ComponentNode[]): ComponentNode[] {
  const out: ComponentNode[] = [];
  for (const node of nodes) {
    if (!isBreak(node)) {
      out.push(node);
      continue;
    }
    if (out.length === 0) continue; // ① 开头的分页符：丢
    if (isBreak(out[out.length - 1])) continue; // ② 连续分页符：合并
    out.push(node);
  }
  while (out.length && isBreak(out[out.length - 1])) out.pop(); // ③ 末尾分页符：丢
  return out;
}
