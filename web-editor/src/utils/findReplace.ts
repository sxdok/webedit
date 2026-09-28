/**
 * 职责：**查找 / 替换**的单一来源（M-9）。UI（编辑 → 查找/替换… / Ctrl+F）只负责输入与跳转，
 * "哪些地方能命中、替换后长什么样"都在这里 —— 这样自检能直接调纯函数验，不用模拟打字。
 *
 * 搜索范围：**文档的文本类属性**（`text` / `html` / `caption` / `title` / `label` / 列表项 / 表格 `data`）。
 *   · Markdown 源码视图是**由同一份组件树生成**的（只读），所以覆盖这些属性就等于覆盖了它；
 *   · 只碰字符串：`frame`/`visible`/数值类属性一律不动（改错了比找不到更糟）；
 *   · 表格 `data` 支持两种形态：字符串（`a | b\nc | d`，用 tableKit 解析/序列化）与二维数组。
 */
import type { ComponentNode, EditorDocument } from '../registry/types';
import { getForest } from '../store/treeUtils';
import { parseTableData, serializeTableData } from '../registry/components/common/tableKit';

/** 单值字符串属性（命中就直接替换） */
const TEXT_KEYS = ['text', 'html', 'caption', 'title', 'label', 'content', 'alt', 'subtitle', 'desc', 'note'] as const;
/** 字符串数组属性（逐项匹配/替换） */
const LIST_KEYS = ['items', 'lines', 'rows', 'labels'] as const;
/** 表格数据属性（字符串或二维数组） */
const TABLE_KEYS = ['data'] as const;

export interface FindOptions {
  /** 默认 false = 不区分大小写（中文场景下大小写多数时候没意义） */
  caseSensitive?: boolean;
}

export interface FindHit {
  nodeId: string;
  /** 组件类型（列表里给人看） */
  type: string;
  /** 命中的属性路径：`text` / `items[2]` / `data` */
  path: string;
  /** 该处命中次数 */
  count: number;
}

export interface ReplacePatch {
  nodeId: string;
  /** 直接喂给 store 的 `updateProps(nodeId, patch)` */
  patch: Record<string, unknown>;
  count: number;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 计数（非重叠） */
function countIn(haystack: string, needle: string, caseSensitive: boolean): number {
  if (!needle) return 0;
  const re = new RegExp(escapeRe(needle), caseSensitive ? 'g' : 'gi');
  return (haystack.match(re) ?? []).length;
}

/** 替换（非重叠、按字面量） */
function replaceIn(haystack: string, needle: string, replacement: string, caseSensitive: boolean): string {
  if (!needle) return haystack;
  const re = new RegExp(escapeRe(needle), caseSensitive ? 'g' : 'gi');
  return haystack.replace(re, replacement);
}

/** 遍历文档里所有节点（含嵌套容器） */
function walkNodes(doc: EditorDocument): ComponentNode[] {
  const out: ComponentNode[] = [];
  const visit = (list: ComponentNode[]): void => {
    for (const n of list) {
      out.push(n);
      if (n.children?.length) visit(n.children);
    }
  };
  visit(getForest(doc));
  return out;
}

/** 只读查找：返回命中清单（节点 + 属性路径 + 次数） */
export function findMatches(doc: EditorDocument, query: string, opts: FindOptions = {}): FindHit[] {
  const q = query;
  if (!q) return [];
  const cs = opts.caseSensitive === true;
  const hits: FindHit[] = [];
  for (const node of walkNodes(doc)) {
    const props = (node.props ?? {}) as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const v = props[key];
      if (typeof v === 'string') {
        const count = countIn(v, q, cs);
        if (count) hits.push({ nodeId: node.id, type: node.type, path: key, count });
      }
    }
    for (const key of LIST_KEYS) {
      const v = props[key];
      if (!Array.isArray(v)) continue;
      v.forEach((item, i) => {
        if (typeof item !== 'string') return;
        const count = countIn(item, q, cs);
        if (count) hits.push({ nodeId: node.id, type: node.type, path: `${key}[${i}]`, count });
      });
    }
    for (const key of TABLE_KEYS) {
      const v = props[key];
      if (typeof v === 'string') {
        const rows = parseTableData(v);
        const count = rows.reduce((n, row) => n + row.reduce((m, cell) => m + countIn(cell, q, cs), 0), 0);
        if (count) hits.push({ nodeId: node.id, type: node.type, path: key, count });
      } else if (Array.isArray(v)) {
        const rows = v as unknown[][];
        let count = 0;
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          for (const cell of row) if (typeof cell === 'string') count += countIn(cell, q, cs);
        }
        if (count) hits.push({ nodeId: node.id, type: node.type, path: key, count });
      }
    }
  }
  return hits;
}

/**
 * 计算替换补丁（**不改文档**）。
 * 调用方（对话框）把每个 patch 喂给 `updateProps(nodeId, patch)` —— 那样才走 store 的历史/日志，
 * 而且连续替换会按 `props:<id>` 合并成一步（Ctrl+Z 一次回退整批）。
 */
export function computeReplacements(
  doc: EditorDocument,
  query: string,
  replacement: string,
  opts: FindOptions = {},
): ReplacePatch[] {
  if (!query) return [];
  const cs = opts.caseSensitive === true;
  const patches: ReplacePatch[] = [];
  for (const node of walkNodes(doc)) {
    const props = (node.props ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let count = 0;

    for (const key of TEXT_KEYS) {
      const v = props[key];
      if (typeof v !== 'string') continue;
      const n = countIn(v, query, cs);
      if (!n) continue;
      patch[key] = replaceIn(v, query, replacement, cs);
      count += n;
    }
    for (const key of LIST_KEYS) {
      const v = props[key];
      if (!Array.isArray(v)) continue;
      let hit = false;
      const next = v.map((item) => {
        if (typeof item !== 'string') return item;
        const n = countIn(item, query, cs);
        if (!n) return item;
        hit = true;
        count += n;
        return replaceIn(item, query, replacement, cs);
      });
      if (hit) patch[key] = next;
    }
    for (const key of TABLE_KEYS) {
      const v = props[key];
      if (typeof v === 'string') {
        const rows = parseTableData(v).map((row) => row.map((cell) => replaceIn(cell, query, replacement, cs)));
        const n = rows.reduce((m, row) => m + row.reduce((k, cell) => k + countIn(cell, query, cs), 0), 0);
        if (n) {
          patch[key] = serializeTableData(rows);
          count += n;
        }
      } else if (Array.isArray(v)) {
        let hit = false;
        const next = (v as unknown[][]).map((row) => {
          if (!Array.isArray(row)) return row;
          return row.map((cell) => {
            if (typeof cell !== 'string') return cell;
            const n = countIn(cell, query, cs);
            if (!n) return cell;
            hit = true;
            count += n;
            return replaceIn(cell, query, replacement, cs);
          });
        });
        if (hit) patch[key] = next;
      }
    }
    if (count) patches.push({ nodeId: node.id, patch, count });
  }
  return patches;
}

/** 命中总数（对话框里显示「共 N 处」） */
export function totalHits(hits: FindHit[]): number {
  return hits.reduce((n, h) => n + h.count, 0);
}
