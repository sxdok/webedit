/**
 * 职责：tableSize 属性控件 —— 表格的**行 / 列数量与行列增删**（尽量贴合 Excel）。
 *
 * 语义：数量 / 增删都是**真实结构**，会重写表格的 `data`（插入空行空列、删掉整行整列），
 * 并同步**平移/裁剪 `cellStyles`**（插入时把后面的格子格式往后挪，删除时把该行该列的格式一起删掉），
 * 列宽也会跟着平移 —— 否则格式与列宽会和内容错位。
 *
 * Excel 对齐点：
 *   · 「插入行 / 删除行 / 插入列 / 删除列」作用在**选中区域**上（选中 2 行就插/删 2 行，同 Excel）；
 *   · 没选中单元格时按钮禁用并提示"先在画布上点一个单元格"（Excel 也是先有活动单元格）；
 *   · 行数/列数输入是"把整张表改成这么多行/列"（等价于把末尾补空 / 截掉）。
 *
 * ⚠ 输入**在失焦或回车时才提交**：直接按 keystroke 提交的话，想把 3 改成 12、刚敲下 "1"
 * 就会先把表格删成 1 行（不可逆的误删）。这是刻意的取舍。
 */
import { useEffect, useState } from 'react';
import { findNode, getForest } from '../../store/treeUtils';
import { useEditorStore } from '../../store/editorStore';
import { mmToPx } from '../../utils/units';
import { parseCellStyles, parseTableData, type CellStyle } from '../../registry/components/common/tableKit';
import type { ControlProps } from './index';

const MAX_ROWS = 200;
const MAX_COLS = 40;
const numInput = 'h-6 w-12 shrink-0 rounded border border-line bg-white px-1 text-center text-xs';
const btn = 'h-6 shrink-0 rounded border border-line px-1.5 text-2xs hover:border-primary hover:text-primary disabled:opacity-40';

/** 选中区域（行列都从 0 起，闭区间） */
interface Range {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

function rangeOf(cells: string[]): Range | null {
  const pts = cells
    .map((k) => k.split(',').map((n) => Number(n)))
    .filter((p) => p.length === 2 && p.every((n) => Number.isFinite(n)));
  if (!pts.length) return null;
  return {
    r0: Math.min(...pts.map((p) => p[0])),
    r1: Math.max(...pts.map((p) => p[0])),
    c0: Math.min(...pts.map((p) => p[1])),
    c1: Math.max(...pts.map((p) => p[1])),
  };
}

/** 插入/删除行后，把单元格格式的行列键一起平移（删掉的行列其格式一并移除） */
function shiftStyles(styles: Record<string, CellStyle>, axis: 'row' | 'col', at: number, count: number): Record<string, CellStyle> {
  const out: Record<string, CellStyle> = {};
  for (const [k, v] of Object.entries(styles)) {
    const [r, c] = k.split(',').map((n) => Number(n));
    const idx = axis === 'row' ? r : c;
    const other = axis === 'row' ? c : r;
    if (count < 0) {
      const del = -count;
      if (idx >= at && idx < at + del) continue; // 落在删除范围内 → 格式一起删掉
      const ni = idx >= at + del ? idx - del : idx;
      out[axis === 'row' ? `${ni},${other}` : `${other},${ni}`] = v;
    } else {
      const ni = idx >= at ? idx + count : idx;
      out[axis === 'row' ? `${ni},${other}` : `${other},${ni}`] = v;
    }
  }
  return out;
}

export function TableSizeControl({ nodeId }: ControlProps) {
  const doc = useEditorStore((s) => s.doc);
  const updateProps = useEditorStore((s) => s.updateProps);
  const sel = useEditorStore((s) => s.ui.tableCells);
  const node = nodeId ? findNode(getForest(doc), nodeId) : null;
  const rows = parseTableData(node?.props.data);
  const headerRow = node?.props.headerRow !== false;
  const dim = {
    rows: Math.max(1, rows.length),
    cols: Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0)),
  };
  const range = sel && sel.nodeId === nodeId ? rangeOf(sel.cells) : null;

  const [rowInput, setRowInput] = useState(String(dim.rows));
  const [colInput, setColInput] = useState(String(dim.cols));
  // 外部（textarea 改数据 / 撤销重做）变了就同步回输入框
  useEffect(() => {
    setRowInput(String(dim.rows));
    setColInput(String(dim.cols));
  }, [dim.rows, dim.cols]);

  /** 当前各列的百分比（从画布实测；拿不到就按等分），用于插入/删除列时平移列宽 */
  const currentPct = (cols: number): number[] => {
    const table = nodeId ? (document.querySelector(`[data-node-id="${nodeId}"] table`) as HTMLTableElement | null) : null;
    const cells = table?.rows?.[0]?.cells;
    if (cells && cells.length === cols) {
      const w = [...cells].map((c) => c.offsetWidth);
      const sum = w.reduce((a, b) => a + b, 0);
      if (sum > 0) return w.map((x) => (x / sum) * 100);
    }
    return Array.from({ length: cols }, () => 100 / cols);
  };

  const write = (next: string[][], styles: Record<string, CellStyle>, pct?: number[]) => {
    if (!nodeId) return;
    const patch: Record<string, unknown> = {
      data: next.map((r) => r.join(' | ')).join('\n'),
      cellStyles: styles,
    };
    if (pct) patch.colWidths = pct.map((p) => p.toFixed(1)).join(',');
    updateProps(nodeId, patch);
  };

  /** 把整张表改成 nRows × nCols（末尾补空 / 截断） */
  const applySize = (nRows: number, nCols: number) => {
    if (!nodeId || (nRows === dim.rows && nCols === dim.cols)) return;
    const next: string[][] = Array.from({ length: nRows }, (_, r) =>
      Array.from({ length: nCols }, (_, c) => rows[r]?.[c] ?? ''),
    );
    const styles = parseCellStyles(node?.props.cellStyles);
    const kept: Record<string, CellStyle> = {};
    for (const [k, v] of Object.entries(styles)) {
      const [r, c] = k.split(',').map((x) => Number(x));
      if (r < nRows && c < nCols) kept[k] = v;
    }
    write(next, kept, nCols !== dim.cols ? Array.from({ length: nCols }, () => 100 / nCols) : undefined);
  };

  /** Excel 式：在选中区域处插入 / 删除整行、整列 */
  const insertRowsAt = () => {
    if (!nodeId || !range) return;
    const n = range.r1 - range.r0 + 1;
    const next = [...rows];
    for (let i = 0; i < n; i++) next.splice(range.r0, 0, Array.from({ length: dim.cols }, () => ''));
    write(next, shiftStyles(parseCellStyles(node?.props.cellStyles), 'row', range.r0, n));
  };
  const deleteRowsAt = () => {
    if (!nodeId || !range) return;
    const n = range.r1 - range.r0 + 1;
    if (dim.rows - n < 1) return; // 至少留一行
    const next = rows.filter((_, i) => i < range.r0 || i > range.r1);
    write(next, shiftStyles(parseCellStyles(node?.props.cellStyles), 'row', range.r0, -n));
  };
  const insertColsAt = () => {
    if (!nodeId || !range) return;
    const n = range.c1 - range.c0 + 1;
    const next = Array.from({ length: dim.rows }, (_, r) =>
      Array.from({ length: dim.cols + n }, (_, c) => (c < range.c0 ? (rows[r]?.[c] ?? '') : c < range.c0 + n ? '' : (rows[r]?.[c - n] ?? ''))),
    );
    const pct = currentPct(dim.cols);
    for (let i = 0; i < n; i++) pct.splice(range.c0, 0, (pct[range.c0] ?? 100 / dim.cols) / 2);
    const sum = pct.reduce((a, b) => a + b, 0);
    write(next, shiftStyles(parseCellStyles(node?.props.cellStyles), 'col', range.c0, n), pct.map((p) => (p / sum) * 100));
  };
  const deleteColsAt = () => {
    if (!nodeId || !range) return;
    const n = range.c1 - range.c0 + 1;
    if (dim.cols - n < 1) return;
    const keep = (c: number) => c < range.c0 || c > range.c1;
    const order = Array.from({ length: dim.cols }, (_, c) => c).filter(keep);
    const next = rows.map((r) => order.map((c) => r[c] ?? ''));
    const pct0 = currentPct(dim.cols).filter((_, c) => keep(c));
    const sum = pct0.reduce((a, b) => a + b, 0) || 1;
    write(next, shiftStyles(parseCellStyles(node?.props.cellStyles), 'col', range.c0, -n), pct0.map((p) => (p / sum) * 100));
  };

  const clamp = (v: string, fallback: number, max: number) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(max, n);
  };
  const commit = () => applySize(clamp(rowInput, dim.rows, MAX_ROWS), clamp(colInput, dim.cols, MAX_COLS));

  /** 列宽自适应（整表操作）：先清空列宽让浏览器按内容排版，量出实际列宽后写回百分比（短列 13mm 保底） */
  const autofit = () => {
    if (!nodeId) return;
    updateProps(nodeId, { colWidths: '' });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const table = document.querySelector(`[data-node-id="${nodeId}"] table`) as HTMLTableElement | null;
        const firstRow = table?.rows?.[0];
        if (!table || !firstRow || !firstRow.cells.length) return;
        const widths = [...firstRow.cells].map((c) => c.offsetWidth);
        const sum = widths.reduce((a, b) => a + b, 0) || table.offsetWidth;
        if (!sum) return;
        const minPct = (mmToPx(13) / sum) * 100;
        const pcts = widths.map((w) => Math.max(minPct, (w / sum) * 100));
        const total = pcts.reduce((a, b) => a + b, 0);
        updateProps(nodeId, { colWidths: pcts.map((p) => ((p / total) * 100).toFixed(1)).join(',') });
      }),
    );
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
      commit();
    }
    if (e.key === 'Escape') {
      setRowInput(String(dim.rows));
      setColInput(String(dim.cols));
    }
  };

  const rowsSelected = range ? range.r1 - range.r0 + 1 : 0;
  const colsSelected = range ? range.c1 - range.c0 + 1 : 0;

  return (
    <div className="space-y-1" data-table-size="1">
      <div className="flex items-center gap-1">
        <span className="w-8 shrink-0 text-2xs text-gray-400">行数</span>
        <input
          type="number"
          data-table-rows="1"
          min={1}
          max={MAX_ROWS}
          className={numInput}
          value={rowInput}
          onChange={(e) => setRowInput(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          title="把整张表改成这么多行（含表头）；回车或失焦生效"
        />
        <span className="ml-2 w-8 shrink-0 text-2xs text-gray-400">列数</span>
        <input
          type="number"
          data-table-cols="1"
          min={1}
          max={MAX_COLS}
          className={numInput}
          value={colInput}
          onChange={(e) => setColInput(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          title="把整张表改成这么多列；回车或失焦生效"
        />
      </div>

      <div className="text-2xs text-gray-500">
        {range ? (
          <>
            选中 {rowsSelected} 行 × {colsSelected} 列（第 {range.r0 + 1}–{range.r1 + 1} 行、
            第 {range.c0 + 1}–{range.c1 + 1} 列）
          </>
        ) : (
          <span className="text-gray-400">在画布上点单元格（可拖选一片）后即可插入/删除行列</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button type="button" data-table-ins-row="1" className={btn} disabled={!range} onClick={insertRowsAt} title="在选中行上方插入">
          插入行
        </button>
        <button type="button" data-table-del-row="1" className={btn} disabled={!range || dim.rows - rowsSelected < 1} onClick={deleteRowsAt}>
          删除行
        </button>
        <button type="button" data-table-ins-col="1" className={btn} disabled={!range} onClick={insertColsAt} title="在选中列左侧插入">
          插入列
        </button>
        <button type="button" data-table-del-col="1" className={btn} disabled={!range || dim.cols - colsSelected < 1} onClick={deleteColsAt}>
          删除列
        </button>
        <button type="button" className={`${btn} ml-auto`} title="按内容重算各列宽度（整表操作）" onClick={autofit}>
          列宽自适应
        </button>
      </div>

      <p className="text-2xs leading-relaxed text-gray-400">
        当前 {dim.rows} × {dim.cols}
        {headerRow ? '（含表头）' : ''}；行数/列数在**失焦或回车**时生效。插入/删除会同步平移单元格格式与列宽（可 Ctrl+Z 撤销）。
      </p>
    </div>
  );
}
