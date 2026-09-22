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
import { mmToPx } from '../../utils/units';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Geo {
  key: string;
  cells: Rect[];
  /** 每列右边界（最后一列除外）→ 手柄位置 */
  borders: { x: number; top: number; height: number }[];
}

const EMPTY: Geo = { key: '', cells: [], borders: [] };

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

  return {
    key: `${nodeId ?? ''}#${selected.join('|')}#${Math.round(z * 100)}#${borders.map((b) => Math.round(b.x)).join(',')}#${Math.round(top)},${Math.round(height)}`,
    cells,
    borders,
  };
}

export function TableOverlay({ nodeId, zoom }: { nodeId: string | null; zoom: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tableCells = useEditorStore((s) => s.ui.tableCells);
  const updateProps = useEditorStore((s) => s.updateProps);
  const [geo, setGeo] = useState<Geo>(EMPTY);
  const [dragging, setDragging] = useState<number | null>(null);

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
    </div>
  );
}
