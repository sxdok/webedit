/**
 * 表格域 Tools：table.*（规格 §5.8，15 个）—— 重点域。
 *
 * 全部 `viaBridge`：编辑器开着就由它的 store 执行（画布立刻变），否则改无头文档里的
 * `data`（文本）/ `cellStyles`（A1 键）/ `colWidths` / `variant`。语义与编辑器 `tableKit` 一致
 * （`|` 分列、`\|` 与 `\n` 转义、A1 记法、插入删除平移格式、合并写范围键）。
 */
import { z } from 'zod';
import { readDocument } from '../bridge/headless.js';
import {
  a1Key,
  cellStyleKeyAt,
  keysInRange,
  parseA1,
  parseCellStyles,
  parseColWidths,
  parseTableData,
  serializeTableData,
  shiftCellKeys,
  type A1Range,
  type CellStyle,
} from '../engine/tableKit.js';
import { commitDoc, findNodeInDoc, getCurrentDoc, getSelection, setSelection } from '../engine/session.js';
import { viaBridge } from './helper.js';

const docIdParam = z.string().optional().describe('文档 id；缺省"当前文档"');
const idParam = z.string().describe('表格节点 id');
const rangeParam = z.string().describe("A1 范围，如 'B2' 或 'B2:C3'（也兼容旧写法 '1,1'）");
const withDoc = <T extends { docId?: string }>(args: T): T & { docId: string } => ({
  ...args,
  docId: args.docId ?? (getCurrentDoc() ?? ''),
});

/** 取表格节点 + 它的数据/格式，供每个 Tool 复用 */
async function tableOf(docId: string, id: string) {
  const doc = await readDocument(docId);
  const node = findNodeInDoc(doc, id);
  if (!node) throw new Error(`NODE_NOT_FOUND: 找不到节点 ${id}`);
  if (node.type !== 'table' && !/Table$/.test(node.type)) {
    throw new Error(`INVALID_PROP_VALUE: 节点 ${id} 是 ${node.type}，不是表格类组件`);
  }
  return {
    doc,
    node,
    rows: parseTableData(node.props.data),
    styles: parseCellStyles(node.props.cellStyles),
  };
}

function writeTable(node: { props: Record<string, unknown> }, rows: string[][], styles: Record<string, CellStyle>, extra: Record<string, unknown> = {}) {
  node.props = { ...node.props, data: serializeTableData(rows), cellStyles: styles, ...extra };
}

function rangeOf(key: string): A1Range {
  const p = parseA1(key);
  if (!p) throw new Error(`TABLE_RANGE_INVALID: 解析不了范围「${key}」，应形如 B2 或 B2:C3`);
  return p;
}

function padRect(rows: string[][], cols: number): string[][] {
  const width = Math.max(cols, rows.reduce((n, r) => Math.max(n, r.length), 0));
  return rows.map((r) => {
    const copy = [...r];
    while (copy.length < width) copy.push('');
    return copy;
  });
}

/* ══════════════ 数据 ══════════════ */

export const tableGetDataSchema = { id: idParam, docId: docIdParam, asText: z.boolean().default(false).describe('true = 返回 "a | b" 文本；false = 返回二维数组') };

export async function tableGetData(args: { id: string; docId?: string; asText?: boolean }) {
  const a = withDoc(args);
  return viaBridge('table.getData', a, async () => {
    const { node, rows, styles } = await tableOf(a.docId, a.id);
    const headerRow = node.props.headerRow !== false;
    const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
    return {
      rows: a.asText ? undefined : rows,
      text: a.asText ? serializeTableData(rows) : undefined,
      headerRow,
      rowCount: rows.length,
      colCount: cols,
      dataRowCount: Math.max(0, rows.length - (headerRow ? 1 : 0)),
      styledCells: Object.keys(styles).length,
      colWidths: parseColWidths(node.props.colWidths),
      variant: node.props.variant ?? 'normal',
    };
  });
}

export const tableSetDataSchema = {
  id: idParam,
  docId: docIdParam,
  data: z.union([z.string(), z.array(z.array(z.string()))]).describe('二维数组，或 "a | b\\nc | d" 文本（`\\|` 表示格内竖线，`\\n` 表示格内换行）'),
  keepStyles: z.boolean().default(true).describe('是否保留超出新尺寸之外的旧格式键（默认保留，只做裁剪）'),
};

export async function tableSetData(args: { id: string; docId?: string; data: string | string[][]; keepStyles?: boolean }) {
  const a = withDoc(args);
  return viaBridge(
    'table.setData',
    a as unknown as Record<string, unknown>,
    async () => {
      const { doc, node, styles } = await tableOf(a.docId, a.id);
      const rows = parseTableData(a.data);
      const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
      const kept: Record<string, CellStyle> = {};
      for (const [k, st] of Object.entries(styles)) {
        const p = parseA1(k);
        if (!p) continue;
        if (p.r1 < rows.length && p.c1 < cols) kept[k] = st;
      }
      writeTable(node, padRect(rows, cols), a.keepStyles === false ? {} : kept);
      await commitDoc(doc);
      return { rowCount: rows.length, colCount: cols, styledCells: Object.keys(kept).length };
    },
    { changed: ['data', 'cellStyles'] },
  );
}

export const tableSetCellSchema = {
  id: idParam,
  row: z.number().int().min(0).describe('行号（0 基；含表头时第 0 行就是表头行）'),
  col: z.number().int().min(0).describe('列号（0 基）'),
  value: z.string().describe('单元格文字；换行写 \\n'),
  docId: docIdParam,
};

export async function tableSetCell(args: { id: string; row: number; col: number; value: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.setCell',
    a,
    async () => {
      const { doc, node, rows, styles } = await tableOf(a.docId, a.id);
      const cols = Math.max(a.col + 1, rows.reduce((n, r) => Math.max(n, r.length), 0));
      const padded = padRect(rows, cols);
      while (padded.length <= a.row) padded.push(Array.from({ length: cols }, () => ''));
      padded[a.row][a.col] = a.value;
      writeTable(node, padded, styles);
      await commitDoc(doc);
      return { row: a.row, col: a.col, cell: a1Key(a.row, a.col, a.row, a.col), value: a.value };
    },
    { changed: ['data'] },
  );
}

/** 插入/删除行列：同步平移格式键与列宽（和编辑器一致） */
async function insertRows(docId: string, id: string, at: number, count: number) {
  const { doc, node, rows, styles } = await tableOf(docId, id);
  const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
  const next = padRect(rows, cols);
  for (let i = 0; i < count; i += 1) next.splice(at, 0, Array.from({ length: cols }, () => ''));
  writeTable(node, next, shiftCellKeys(styles, 'row', at, count));
  await commitDoc(doc);
  return { rowCount: next.length, at, count };
}

async function deleteRows(docId: string, id: string, at: number, count: number) {
  const { doc, node, rows, styles } = await tableOf(docId, id);
  if (rows.length - count < 1) throw new Error(`INVALID_PROP_VALUE: 至少要留一行（当前 ${rows.length} 行，要删 ${count} 行）`);
  const next = rows.filter((_, i) => i < at || i >= at + count);
  writeTable(node, next, shiftCellKeys(styles, 'row', at, -count));
  await commitDoc(doc);
  return { rowCount: next.length, at, count };
}

async function insertCols(docId: string, id: string, at: number, count: number) {
  const { doc, node, rows, styles } = await tableOf(docId, id);
  const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
  const width = cols + count;
  const next = rows.map((r) => {
    const copy: string[] = [];
    for (let c = 0; c < width; c += 1) copy.push(c < at ? (r[c] ?? '') : c < at + count ? '' : (r[c - count] ?? ''));
    return copy;
  });
  const pct = parseColWidths(node.props.colWidths).map((w) => Number.parseFloat(w) || 100 / cols);
  const base = pct.length === cols ? pct : Array.from({ length: cols }, () => 100 / cols);
  for (let i = 0; i < count; i += 1) base.splice(at, 0, (base[at] ?? 100 / cols) / 2);
  const sum = base.reduce((n, x) => n + x, 0);
  writeTable(node, padRect(next, width), shiftCellKeys(styles, 'col', at, count), {
    colWidths: base.map((p) => ((p / sum) * 100).toFixed(1)).join(','),
  });
  await commitDoc(doc);
  return { colCount: width, at, count };
}

async function deleteCols(docId: string, id: string, at: number, count: number) {
  const { doc, node, rows, styles } = await tableOf(docId, id);
  const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
  if (cols - count < 1) throw new Error(`INVALID_PROP_VALUE: 至少要留一列（当前 ${cols} 列，要删 ${count} 列）`);
  const keep = (c: number) => c < at || c >= at + count;
  const next = rows.map((r) => Array.from({ length: cols }, (_, c) => c).filter(keep).map((c) => r[c] ?? ''));
  const pct = parseColWidths(node.props.colWidths).map((w) => Number.parseFloat(w) || 0);
  const base = pct.length === cols ? pct.filter((_, c) => keep(c)) : Array.from({ length: cols - count }, () => 100 / (cols - count));
  const sum = base.reduce((n, x) => n + x, 0) || 1;
  writeTable(node, next, shiftCellKeys(styles, 'col', at, -count), {
    colWidths: base.map((p) => ((p / sum) * 100).toFixed(1)).join(','),
  });
  await commitDoc(doc);
  return { colCount: cols - count, at, count };
}

export const tableInsertRowSchema = { id: idParam, at: z.number().int().min(0).describe('插入位置（0 基，插在这一行之前）'), count: z.number().int().min(1).max(50).default(1), docId: docIdParam };

export async function tableInsertRow(args: { id: string; at: number; count?: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('table.insertRow', a, async () => insertRows(a.docId, a.id, a.at, a.count ?? 1), { changed: ['data'] });
}

export const tableDeleteRowSchema = { id: idParam, at: z.number().int().min(0), count: z.number().int().min(1).max(50).default(1), docId: docIdParam };

export async function tableDeleteRow(args: { id: string; at: number; count?: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('table.deleteRow', a, async () => deleteRows(a.docId, a.id, a.at, a.count ?? 1), { changed: ['data'] });
}

export const tableInsertColSchema = { id: idParam, at: z.number().int().min(0), count: z.number().int().min(1).max(20).default(1), docId: docIdParam };

export async function tableInsertCol(args: { id: string; at: number; count?: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('table.insertCol', a, async () => insertCols(a.docId, a.id, a.at, a.count ?? 1), { changed: ['data', 'colWidths'] });
}

export const tableDeleteColSchema = { id: idParam, at: z.number().int().min(0), count: z.number().int().min(1).max(20).default(1), docId: docIdParam };

export async function tableDeleteCol(args: { id: string; at: number; count?: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('table.deleteCol', a, async () => deleteCols(a.docId, a.id, a.at, a.count ?? 1), { changed: ['data', 'colWidths'] });
}

/* ══════════════ 合并 / 拆分 / 格式 ══════════════ */

export const tableMergeCellsSchema = { id: idParam, range: rangeParam, docId: docIdParam };

export async function tableMergeCells(args: { id: string; range: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.mergeCells',
    a,
    async () => {
      const { doc, node, rows, styles } = await tableOf(a.docId, a.id);
      const r = rangeOf(a.range);
      if (r.r0 === r.r1 && r.c0 === r.c1) throw new Error('TABLE_RANGE_INVALID: 合并至少要选 2 个格子');
      const next: Record<string, CellStyle> = { ...styles };
      for (const k of keysInRange(r)) delete next[k];
      next[a1Key(r.r0, r.c0, r.r1, r.c1)] = { merged: true };
      writeTable(node, rows, next);
      await commitDoc(doc);
      return { key: a1Key(r.r0, r.c0, r.r1, r.c1), rowSpan: r.r1 - r.r0 + 1, colSpan: r.c1 - r.c0 + 1 };
    },
    { changed: ['cellStyles'] },
  );
}

export const tableSplitCellsSchema = { id: idParam, range: rangeParam, docId: docIdParam };

export async function tableSplitCells(args: { id: string; range: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.splitCells',
    a,
    async () => {
      const { doc, node, rows, styles } = await tableOf(a.docId, a.id);
      const r = rangeOf(a.range);
      const next: Record<string, CellStyle> = { ...styles };
      const removed: string[] = [];
      for (const k of Object.keys(next)) {
        const p = parseA1(k);
        if (!p) continue;
        if (p.r0 >= r.r0 && p.r1 <= r.r1 && p.c0 >= r.c0 && p.c1 <= r.c1) {
          delete next[k];
          removed.push(k);
        }
      }
      writeTable(node, rows, next);
      await commitDoc(doc);
      return { removed, remaining: Object.keys(next).length };
    },
    { changed: ['cellStyles'] },
  );
}

export const tableSetCellStyleSchema = {
  id: idParam,
  range: rangeParam,
  style: z
    .object({
      background: z.string().optional(),
      color: z.string().optional(),
      fontSize: z.number().positive().optional().describe('pt'),
      bold: z.boolean().optional(),
      fontWeight: z.number().optional(),
      align: z.enum(['left', 'center', 'right', 'justify']).optional(),
      valign: z.enum(['top', 'middle', 'bottom']).optional(),
      padding: z.number().min(0).optional().describe('px'),
      border: z
        .object({ top: z.number().optional(), right: z.number().optional(), bottom: z.number().optional(), left: z.number().optional(), color: z.string().optional() })
        .optional(),
    })
    .describe('要写入的单元格格式（只传要改的项）'),
  docId: docIdParam,
};

export async function tableSetCellStyle(args: { id: string; range: string; style: CellStyle; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.setCellStyle',
    a as unknown as Record<string, unknown>,
    async () => {
      const { doc, node, rows, styles } = await tableOf(a.docId, a.id);
      const r = rangeOf(a.range);
      const next: Record<string, CellStyle> = { ...styles };
      // 落在合并区里的格子 → 写该区的键（与编辑器"单元格覆盖"一致）
      const targets = new Set<string>();
      for (const k of keysInRange(r)) {
        const p = parseA1(k);
        if (!p) continue;
        targets.add(cellStyleKeyAt(next, p.r0, p.c0) ?? k);
      }
      for (const key of targets) next[key] = { ...(next[key] ?? {}), ...a.style };
      writeTable(node, rows, next);
      await commitDoc(doc);
      return { keys: [...targets], style: a.style };
    },
    { changed: ['cellStyles'] },
  );
}

export const tableClearCellStyleSchema = { id: idParam, range: rangeParam, docId: docIdParam };

export async function tableClearCellStyle(args: { id: string; range: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.clearCellStyle',
    a,
    async () => {
      const { doc, node, rows, styles } = await tableOf(a.docId, a.id);
      const r = rangeOf(a.range);
      const isMergedRangeKey = (k: string) => {
        const p = parseA1(k);
        return !!p && (p.r1 > p.r0 || p.c1 > p.c0);
      };
      const next: Record<string, CellStyle> = {};
      const cleared: string[] = [];
      for (const [k, st] of Object.entries(styles)) {
        const p = parseA1(k);
        const hit = p && p.r0 >= r.r0 && p.r1 <= r.r1 && p.c0 >= r.c0 && p.c1 <= r.c1;
        // 合并区整体落在这个范围里 → 连合并一起去掉；否则只清格式、保留合并
        if (hit) {
          cleared.push(k);
          if (!isMergedRangeKey(k)) continue;
          continue;
        }
        next[k] = st;
      }
      writeTable(node, rows, next);
      await commitDoc(doc);
      return { cleared, remaining: Object.keys(next).length };
    },
    { changed: ['cellStyles'] },
  );
}

export const tableSetVariantSchema = { id: idParam, variant: z.enum(['normal', 'threeLine', 'hLines']).describe('normal 全框线 / threeLine 三线表 / hLines 横线表'), docId: docIdParam };

export async function tableSetVariant(args: { id: string; variant: 'normal' | 'threeLine' | 'hLines'; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.setVariant',
    a,
    async () => {
      const { doc, node } = await tableOf(a.docId, a.id);
      node.props = { ...node.props, variant: a.variant };
      await commitDoc(doc);
      return { variant: a.variant };
    },
    { changed: ['variant'] },
  );
}

export const tableSetColWidthsSchema = {
  id: idParam,
  widths: z.string().describe('列宽：逗号分隔，纯数字按 %（"20,50,30"），也可写 "35mm"、空串=自动'),
  docId: docIdParam,
};

export async function tableSetColWidths(args: { id: string; widths: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.setColWidths',
    a,
    async () => {
      const { doc, node } = await tableOf(a.docId, a.id);
      node.props = { ...node.props, colWidths: a.widths };
      await commitDoc(doc);
      return { colWidths: parseColWidths(a.widths) };
    },
    { changed: ['colWidths'] },
  );
}

export const tableAutoFitSchema = { id: idParam, docId: docIdParam };

export async function tableAutoFit(args: { id: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.autoFit',
    a,
    async () => {
      const { doc, node, rows } = await tableOf(a.docId, a.id);
      // 无头拿不到渲染后的实际列宽（那要浏览器布局）→ 按内容长度估一个比例，并如实说明
      const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
      const weights = Array.from({ length: cols }, (_, c) => {
        const max = rows.reduce((n, r) => Math.max(n, String(r[c] ?? '').replace(/\n/g, '').length), 0);
        return Math.max(4, max);
      });
      const sum = weights.reduce((n, x) => n + x, 0);
      const pct = weights.map((w) => ((w / sum) * 100).toFixed(1)).join(',');
      node.props = { ...node.props, colWidths: pct };
      await commitDoc(doc);
      return {
        colWidths: parseColWidths(pct),
        note: '无头按**内容长度**估算列宽；编辑器在线时它会按真实渲染宽度自适应（更准）',
      };
    },
    { changed: ['colWidths'] },
  );
}

/* ══════════════ 单元格选择 ══════════════ */

export const tableGetCellSelectionSchema = { id: idParam, docId: docIdParam };

export async function tableGetCellSelection(args: { id: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('table.getCellSelection', a, async () => {
    const sel = getSelection();
    const mine = sel.docId === a.docId && sel.ids.includes(a.id);
    return {
      cells: mine ? sel.ids.filter((x) => x !== a.id) : [],
      note: mine ? undefined : '无头模式下没有画布选区；这是服务端记住的最近一次选择（编辑器在线时以编辑器为准）',
    };
  });
}

export const tableSetCellSelectionSchema = {
  id: idParam,
  range: rangeParam,
  docId: docIdParam,
};

export async function tableSetCellSelection(args: { id: string; range: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'table.setCellSelection',
    a,
    async () => {
      const r = rangeOf(a.range);
      const cells = keysInRange(r).map((k) => {
        const p = parseA1(k);
        return p ? `${p.r0},${p.c0}` : k; // 编辑器内部用 "行,列" 键表示单元格选择
      });
      setSelection(a.docId, [a.id, ...cells]);
      return { key: a1Key(r.r0, r.c0, r.r1, r.c1), cells: cells.length };
    },
    { changed: [] },
  );
}
