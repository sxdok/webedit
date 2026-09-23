/**
 * 职责：**图表按章编号**（B11）—— 在**整篇文档顺序**上算出每个图/表的编号，如「图 1-2」「表 2-1」。
 *
 * 规则（与 Word 的"题注 + 章节号"一致）：
 *   · 章号 = 该节点之前出现过的 `heading(level=1)` 个数（标题一 = 第 1 章）；
 *   · 章内**图**与**表**各自从 1 开始计数，遇到新章各自归零；
 *   · 标题一出现之前的部分算"无章"：此时用连续编号（图 1、图 2…）而不是「图 0-1」；
 *   · 跨页续排的"续表"是同一个节点（同一个 id），编号沿用第一次算出来的那个（页面上再显示时带"续表"字样）。
 */
import type { ComponentNode } from './types';

/** 算作"图"的组件：图片、并排双图、柱状图 */
const FIGURE_TYPES = new Set(['image', 'imagePair', 'chartBar']);
/** 算作"表"的组件：表格与它的几个预设 */
const TABLE_TYPES = new Set(['table', 'threeLineTable', 'paramTable', 'detailTable', 'checkTable']);

export interface Numbering {
  /** nodeId → 编号文字（如 "图 1-2"） */
  labels: Record<string, string>;
  /** 图的总数 / 表的总数（面板或诊断可以显示） */
  figures: number;
  tables: number;
  /** 算出来的章数（level=1 的标题个数） */
  chapters: number;
}

export function computeNumbering(forest: ComponentNode[]): Numbering {
  const labels: Record<string, string> = {};
  let chapter = 0;
  let figures = 0;
  let tables = 0;
  let inChapterFigures = 0;
  let inChapterTables = 0;

  const walk = (list: ComponentNode[]): void => {
    for (const node of list) {
      if (node.type === 'heading' && Number(node.props.level ?? 2) === 1) {
        chapter += 1;
        inChapterFigures = 0;
        inChapterTables = 0;
      } else if (FIGURE_TYPES.has(node.type)) {
        figures += 1;
        inChapterFigures += 1;
        labels[node.id] = chapter > 0 ? `图 ${chapter}-${inChapterFigures}` : `图 ${figures}`;
      } else if (TABLE_TYPES.has(node.type)) {
        tables += 1;
        inChapterTables += 1;
        labels[node.id] = chapter > 0 ? `表 ${chapter}-${inChapterTables}` : `表 ${tables}`;
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(forest);

  return { labels, figures, tables, chapters: chapter };
}
