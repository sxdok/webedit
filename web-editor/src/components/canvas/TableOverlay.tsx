/**
 * 职责：表格在画布上的**编辑器覆盖层**（两部分，都只属于编辑态，带 no-print）：
 *   ① TableCellOverlay  —— 画出被选中单元格的选框（"选中了哪些格子"是编辑器态，不进文档）；
 *   ② TableColumnHandles —— 表格竖线拖拽手柄：拖列边界实时改相邻两列的列宽百分比
 *      （与 A4 编辑器 js/48-handles.js 的表格列宽手柄同一套做法：只动相邻两列、每列 8mm 保底）。
 *
 * 坐标：覆盖层挂在纸张/设备画布内部（它们是 position:relative），所以所有矩形都换算成
 * "相对定位祖先"的坐标；用 offsetWidth（布局 px，不含缩放）做百分比计算，用 getBoundingClientRect
 * 做位置计算，两者比例不受画布缩放影响。
 */
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { findNode, getForest } from '../../store/treeUtils';
import { mmToPx } from '../../utils/units';
import { log } from '../../utils/logger';
import {
  parseTableData,
  readCellBlock,
  serializeTableData,
  writeCellBlock,
} from '../../registry/components/common/tableKit';
import { fillSeries } from '../../registry/components/common/tableFill';

/** 选区键集合 → 0 基矩形（含端点）；空集合返回 null */
function cellRangeOf(cells: string[]): { r0: number; c0: number; r1: number; c1: number } | null {
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Geo {
  key: string;
  cells: Rect[];
  /** 选中格的**并集矩形**（填充柄挂它的右下角；没有选中格时为 null） */
  selBox: Rect | null;
  /** 每个格的矩形（"行,列" → Rect）：填充预览框要按目标范围算并集 */
  byKey: Record<string, Rect>;
  /** 每列右边界（最后一列除外）→ 手柄位置 */
  borders: { x: number; top: number; height: number }[];
  /** 每条行边界（最后一行除外）→ 行高手柄位置（B8：行高是整表一个值，拖任一条都改全表） */
  rowBars: { y: number; x: number; width: number; rowIndex: number; rowHeightPx: number }[];
}

const EMPTY: Geo = { key: '', cells: [], selBox: null, byKey: {}, borders: [], rowBars: [] };

/** 一组格子的并集矩形（range 里的格都在 byKey 里） */
function unionOf(byKey: Record<string, Rect>, range: { r0: number; c0: number; r1: number; c1: number }): Rect {
  const list: Rect[] = [];
  for (let r = range.r0; r <= range.r1; r += 1) {
    for (let c = range.c0; c <= range.c1; c += 1) {
      const rect = byKey[`${r},${c}`];
      if (rect) list.push(rect);
    }
  }
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...list.map((r) => r.x));
  const y = Math.min(...list.map((r) => r.y));
  return { x, y, w: Math.max(...list.map((r) => r.x + r.w)) - x, h: Math.max(...list.map((r) => r.y + r.h)) - y };
}

/**
 * 填充预览框的矩形：目标范围可能**超出**现有表格（填充会长出新行/新列），
 * 所以先并集现有格，再按最后一行/最后一列的实测尺寸把多出来的行、列加上去。
 */
function extendedRect(geo: Geo, range: { r0: number; c0: number; r1: number; c1: number }): Rect {
  const keys = Object.keys(geo.byKey);
  if (!keys.length) return { x: 0, y: 0, w: 0, h: 0 };
  const rows = keys.map((k) => Number(k.split(',')[0]));
  const cols = keys.map((k) => Number(k.split(',')[1]));
  const maxRow = Math.max(...rows);
  const maxCol = Math.max(...cols);
  const base = unionOf(geo.byKey, { r0: range.r0, c0: range.c0, r1: Math.min(range.r1, maxRow), c1: Math.min(range.c1, maxCol) });
  const lastRowH = geo.byKey[`${maxRow},${range.c0}`]?.h ?? geo.byKey[`${maxRow},0`]?.h ?? 20;
  const lastColW = geo.byKey[`${range.r0},${maxCol}`]?.w ?? geo.byKey[`0,${maxCol}`]?.w ?? 60;
  return {
    x: base.x,
    y: base.y,
    w: base.w + Math.max(0, range.c1 - maxCol) * lastColW,
    h: base.h + Math.max(0, range.r1 - maxRow) * lastRowH,
  };
}

function measure(host: HTMLElement, nodeId: string | null, selected: string[], zoom: number): Geo {
  const box = host.parentElement;
  if (!box) return EMPTY;
  // ★必须限定在**被选中的那个节点**里量：同页可能有多张表，用整页 querySelector('table')
  //   会拿到页面第一张表 —— 手柄画在 A 上、拖动却按 A 的几何写回 B，选框也会串到 A。
  const tableHost = (nodeId ? box.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`) : null) ?? box;
  const table = tableHost.querySelector<HTMLTableElement>('table');
  const firstRow = table?.rows?.[0];
  if (!table || !firstRow || !firstRow.cells.length) return EMPTY;

  // ★屏幕坐标 → 覆盖层自身的布局坐标：画布整体被 scale(zoom) 包着，
  //   getBoundingClientRect 拿到的是**已缩放**的值，而 left/top 写的是未缩放值 —— 必须除回 zoom，
  //   否则缩放 ≠100% 时手柄会离列边界越来越远（双重缩放）。
  const z = zoom || 1;
  const boxRect = box.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const top = (tableRect.top - boxRect.top) / z;
  const height = Math.min(tableRect.height / z, boxRect.height / z - top);

  const cells: Rect[] = [];
  if (selected.length) {
    tableHost.querySelectorAll<HTMLElement>('[data-cell]').forEach((el) => {
      if (!selected.includes(el.dataset.cell ?? '')) return;
      const r = el.getBoundingClientRect();
      cells.push({
        x: (r.left - boxRect.left) / z,
        y: (r.top - boxRect.top) / z,
        w: r.width / z,
        h: r.height / z,
      });
    });
  }

  const rects = [...firstRow.cells].map((c) => c.getBoundingClientRect());
  const borders = rects.slice(0, -1).map((r) => ({ x: (r.right - boxRect.left) / z, top, height }));

  // 行边界：**每一行**的下边都给一个手柄（改成"按行行高"之后，最后一行也该能单独拖高 ——
  // 以前排除最后一行是因为行高是整表一个值，拖它没有意义）
  const rowRects = [...table.rows].map((r) => r.getBoundingClientRect());
  const left = (tableRect.left - boxRect.left) / z;
  const width = tableRect.width / z;
  const rowBars = rowRects.map((r, i) => ({
    y: (r.bottom - boxRect.top) / z,
    x: left,
    width,
    rowIndex: i,
    rowHeightPx: r.height / z,
  }));

  // 全部格子的矩形（预览框按目标范围算并集），以及选中格的并集（填充柄挂它右下角）
  const byKey: Record<string, Rect> = {};
  tableHost.querySelectorAll<HTMLElement>('[data-cell]').forEach((el) => {
    const key = el.dataset.cell ?? '';
    if (!key) return;
    const r = el.getBoundingClientRect();
    byKey[key] = { x: (r.left - boxRect.left) / z, y: (r.top - boxRect.top) / z, w: r.width / z, h: r.height / z };
  });
  const selRange = cellRangeOf(selected);
  const selBox: Rect | null = selRange
    ? unionOf(byKey, selRange)
    : cells.length
      ? {
          x: Math.min(...cells.map((c) => c.x)),
          y: Math.min(...cells.map((c) => c.y)),
          w: Math.max(...cells.map((c) => c.x + c.w)) - Math.min(...cells.map((c) => c.x)),
          h: Math.max(...cells.map((c) => c.y + c.h)) - Math.min(...cells.map((c) => c.y)),
        }
      : null;

  return {
    key: `${nodeId ?? ''}#${selected.join('|')}#${Math.round(z * 100)}#${borders.map((b) => Math.round(b.x)).join(',')}#${Math.round(top)},${Math.round(height)}#${rowBars.map((b) => Math.round(b.y)).join(',')}`,
    cells,
    selBox,
    byKey,
    borders,
    rowBars,
  };
}

export function TableOverlay({ nodeId, zoom }: { nodeId: string | null; zoom: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tableCells = useEditorStore((s) => s.ui.tableCells);
  const updateProps = useEditorStore((s) => s.updateProps);
  const [geo, setGeo] = useState<Geo>(EMPTY);
  const [dragging, setDragging] = useState<number | null>(null);
  const [rowDrag, setRowDrag] = useState(false);
  /** 填充柄拖拽中的预览（目标范围，0 基，含端点） */
  const [fillPreview, setFillPreview] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  const [fillDragging, setFillDragging] = useState(false);

  const selected = tableCells && tableCells.nodeId === nodeId ? tableCells.cells : [];
  const selectedKey = selected.join('|');

  // 每次渲染后重新量一次；几何没变就保持原 state（避免 setState → 渲染 → setState 的死循环）
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !nodeId) {
      setGeo((p) => (p.key ? EMPTY : p));
      return;
    }
    const next = measure(host, nodeId, selectedKey ? selectedKey.split('|') : [], zoom);
    setGeo((prev) => (prev.key === next.key ? prev : next));
  });

  /* ── 列宽拖拽 ──
     监听必须在 pointerdown 里**同步**挂上：若放到 useEffect（等一次重渲染）再挂，
     按下后就立刻移动的那一下会丢事件（手快/自动化都复现）。 */
  const drag = useRef<{ i: number; startX: number; w0: number; w1: number; tableW: number; minPct: number; all: number[] } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  /** 填充柄拖动中的目标范围（onUp 里要读最新值，state 在闭包里是旧的） */
  const fillPreviewRef = useRef<{ r0: number; c0: number; r1: number; c1: number } | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const startDrag = (e: React.PointerEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    const host = hostRef.current;
    const box = host?.parentElement;
    const tableHost = (nodeId ? box?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`) : null) ?? box;
    const table = tableHost?.querySelector<HTMLTableElement>('table');
    const cells = table?.rows?.[0]?.cells;
    if (!table || !cells || cells.length < 2 || i >= cells.length - 1) return;
    const all = [...cells].map((c) => c.offsetWidth);
    const tableW = table.offsetWidth || all.reduce((a, b) => a + b, 0);
    if (!tableW) return;
    drag.current = {
      i,
      startX: e.clientX,
      w0: all[i],
      w1: all[i + 1],
      tableW,
      minPct: (mmToPx(8) / tableW) * 100 || 4,
      all,
    };
    setDragging(i);

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || !nodeId) return;
      // ★全程用"布局 px"算：屏幕位移 ÷ 缩放 = 布局位移；列宽本身也是 px。
      //   （早先这里把"百分比增量"直接加到"像素宽度"上 —— 单位混用，拖动只生效了 1/5）
      const dPx = (ev.clientX - d.startX) / (zoom || 1);
      const minPx = (d.minPct / 100) * d.tableW;
      const maxFirst = d.w0 + d.w1 - minPx;
      const first = Math.min(Math.max(d.w0 + dPx, minPx), Math.max(minPx, maxFirst));
      const second = d.w0 + d.w1 - first;
      const pct = d.all.map((w, idx) => {
        const px = idx === d.i ? first : idx === d.i + 1 ? second : w;
        return ((px / d.tableW) * 100).toFixed(1);
      });
      updateProps(nodeId, { colWidths: pct.join(',') });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cleanupRef.current = null;
      drag.current = null;
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cleanupRef.current = onUp;
  };

  const showHandles = !!nodeId && geo.borders.length > 0;

  /* ── 填充柄（B16）──
     选区右下角的小方块：往下/往右拖 → 按 `tableFill.continueSeries` 的规则续出内容
     （数字 +1 递增、日期 +1 天、恒定差分继续等差、其它按源循环），松手时**一次**写回 props.data。
     拖动过程中只画预览框（不写数据），所以历史里只有一条记录。 */
  const startFill = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nodeId || !geo.selBox) return;
    const range = cellRangeOf(selected);
    if (!range) return;
    const box = geo.selBox;
    const rowH = Math.max(8, box.h / Math.max(1, range.r1 - range.r0 + 1));
    const colW = Math.max(8, box.w / Math.max(1, range.c1 - range.c0 + 1));
    const startX = e.clientX;
    const startY = e.clientY;
    const z = zoom || 1;
    setFillDragging(true);
    fillPreviewRef.current = null;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / z;
      const dy = (ev.clientY - startY) / z;
      // 主方向判定：往哪边拖得多就按哪个轴续
      // ★不夹到"现有行列"：填充柄本来就会**长出新的行/列**（writeCellBlock 会自动补行补列），
      //   只做一个防手抖的上限（+200 行 / +50 列）。
      const next =
        Math.abs(dy) >= Math.abs(dx)
          ? (() => {
              const n = Math.min(200, Math.max(0, Math.round(dy / rowH)));
              return n > 0 ? { r0: range.r0, c0: range.c0, r1: range.r1 + n, c1: range.c1 } : null;
            })()
          : (() => {
              const n = Math.min(50, Math.max(0, Math.round(dx / colW)));
              return n > 0 ? { r0: range.r0, c0: range.c0, r1: range.r1, c1: range.c1 + n } : null;
            })();
      fillPreviewRef.current = next;
      setFillPreview(next);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cleanupRef.current = null;
      setFillDragging(false);
      const target = fillPreviewRef.current;
      fillPreviewRef.current = null;
      setFillPreview(null);
      if (!target) return;
      // 源块 → 按规则续出目标块 → 一次写回（拖动过程中只画预览，不动数据，所以历史里只有一条）
      const live = useEditorStore.getState();
      const node = findNode(getForest(live.doc), nodeId);
      const rows = parseTableData(node?.props.data);
      const source = readCellBlock(rows, range.r0, range.c0, range.r1, range.c1);
      const down = target.r1 > range.r1;
      const count = down ? target.r1 - range.r1 : target.c1 - range.c1;
      const block = fillSeries(source, count, down ? 'down' : 'right');
      if (!block.length) return;
      const anchorR = down ? range.r1 + 1 : range.r0;
      const anchorC = down ? range.c0 : range.c1 + 1;
      live.updateProps(nodeId, { data: serializeTableData(writeCellBlock(rows, anchorR, anchorC, block)) });
      log.action('fillCells', { nodeId, count, dir: down ? 'down' : 'right' });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cleanupRef.current = onUp;
  };

  /* ── 行高拖拽（B8）──
     ★只改**被拖的那一行**（`props.rowHeights[行号]`，行号 1 基、与 A1 记法同一口径）：
     2026-09-23 用户反馈"拖哪一条都整表一起变"，说明"行高是整表一个值"这个设计不对 ——
     现在 `props.rowHeight` 退化为"整表默认行高"，按行覆盖写在 `rowHeights` 里，互不影响。
     起点：该行已有覆盖就用它，否则用**量到的这一行**高度。 */
  const startRowDrag = (e: React.PointerEvent, rowIndex: number, startPx: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nodeId) return;
    const live = useEditorStore.getState();
    const node = findNode(getForest(live.doc), nodeId);
    const overrides = (node?.props.rowHeights && typeof node.props.rowHeights === 'object'
      ? (node.props.rowHeights as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const rawRow = String(overrides[String(rowIndex + 1)] ?? '').trim();
    const rawDefault = String(node?.props.rowHeight ?? '').trim();
    const startMm = /^\d+(\.\d+)?$/.test(rawRow)
      ? Number(rawRow)
      : startPx / mmToPx(1) || (/^\d+(\.\d+)?$/.test(rawDefault) ? Number(rawDefault) : 0);
    const startY = e.clientY;
    setRowDrag(true);
    const onMove = (ev: PointerEvent) => {
      const dMm = (ev.clientY - startY) / (zoom || 1) / mmToPx(1);
      const next = Math.min(Math.max(Math.round((startMm + dMm) * 10) / 10, 4), 200);
      // 只写这一行（其它行的高度原样保留）
      updateProps(nodeId, { rowHeights: { ...overrides, [String(rowIndex + 1)]: String(next) } });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cleanupRef.current = null;
      setRowDrag(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cleanupRef.current = onUp;
  };

  return (
    <div ref={hostRef} data-table-overlay="1" className="no-print pointer-events-none absolute inset-0 z-20">
      {geo.cells.map((c, i) => (
        <div
          key={i}
          data-cell-selected="1"
          className="absolute"
          style={{
            left: c.x,
            top: c.y,
            width: c.w,
            height: c.h,
            border: '2px solid #1677ff',
            background: 'rgba(22,119,255,.10)',
          }}
        />
      ))}

      {showHandles &&
        geo.borders.map((b, i) => (
          <div
            key={i}
            data-col-handle="1"
            data-col-index={i}
            title="拖动调整相邻两列列宽"
            onPointerDown={(e) => startDrag(e, i)}
            className="pointer-events-auto absolute"
            style={{
              left: b.x - 3,
              top: b.top,
              width: 6,
              height: b.height,
              cursor: 'col-resize',
              background: dragging === i ? 'rgba(22,119,255,.35)' : 'transparent',
            }}
          />
        ))}

      {/* 填充柄（B16）：选区右下角的小方块，往下/往右拖按规则续内容（松手才写数据）
          ★不依赖 `showHandles`：单列表格没有列边界手柄，但填充柄照样要有 */}
      {!!nodeId && geo.selBox && (
        <>
          <div
            data-fill-handle="1"
            title="拖动填充：数字递增、日期 +1 天、恒定差分继续等差，其它按源循环"
            onPointerDown={startFill}
            className="pointer-events-auto absolute"
            style={{
              left: geo.selBox.x + geo.selBox.w - 4,
              top: geo.selBox.y + geo.selBox.h - 4,
              width: 8,
              height: 8,
              border: '1.5px solid #1677ff',
              background: fillDragging ? '#1677ff' : '#fff',
              cursor: 'crosshair',
            }}
          />
          {fillPreview && (
            <div
              data-fill-preview="1"
              className="pointer-events-none absolute"
              style={{
                left: extendedRect(geo, fillPreview).x,
                top: extendedRect(geo, fillPreview).y,
                width: extendedRect(geo, fillPreview).w,
                height: extendedRect(geo, fillPreview).h,
                border: '1.5px dashed #1677ff',
                background: 'rgba(22,119,255,.06)',
              }}
            />
          )}
        </>
      )}
      {/* 行高手柄（B8）：每条行边界一个，拖任意一条都改**整表**行高（props.rowHeight，mm） */}
      {showHandles &&
        geo.rowBars.map((b) => (
          <div
            key={`row-${b.rowIndex}`}
            data-row-handle="1"
            data-row-index={b.rowIndex}
            title={`拖动调整**第 ${b.rowIndex + 1} 行**的行高（单位 mm，只影响这一行）`}
            onPointerDown={(e) => startRowDrag(e, b.rowIndex, b.rowHeightPx)}
            className="pointer-events-auto absolute"
            style={{
              left: b.x - 26,
              top: b.y - 3,
              width: 24,
              height: 6,
              borderRadius: 3,
              background: rowDrag ? '#1677ff' : 'rgba(22,119,255,.55)',
              cursor: 'ns-resize',
            }}
          />
        ))}
    </div>
  );
}
