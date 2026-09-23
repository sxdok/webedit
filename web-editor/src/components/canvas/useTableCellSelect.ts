/**
 * 职责：表格单元格的**选择交互**（Excel 式），文档画布与 Web 画布共用。
 *
 *   · 单击 → 选中该格（活动单元格成为"锚点"）
 *   · 拖拽 → 从锚点拖出一片**矩形区域**（Excel 的框选）
 *   · Shift + 单击 → 从锚点扩展到该格
 *   · Ctrl/Cmd + 单击 → 追加一个不相邻的格子
 *
 * 选择结果写进 store.ui.tableCells（**编辑器态**：不进文档、不导出、打印不显示）。
 * 用捕获阶段是为了抢在 NodeView 的"选中整个组件"之前处理，并阻止它把选中改回整表。
 */
import { useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { rectKeys } from '../../registry/components/common/tableKit';

export function useTableCellSelect(onSelect: (id: string, additive: boolean) => void) {
  const selectTableCells = useEditorStore((s) => s.selectTableCells);
  const sel = useEditorStore((s) => s.ui.tableCells);
  const selectedIds = useEditorStore((s) => s.doc.selectedIds);
  const anchorRef = useRef<string | null>(null);
  // 事件回调里要读最新值（React 重渲染前可能连续触发）；用 ref 兜住
  const selRef = useRef(sel);
  selRef.current = sel;

  const onPointerDownCapture = (e: React.PointerEvent) => {
    const cell = (e.target as HTMLElement | null)?.closest?.('[data-cell]') as HTMLElement | null;
    if (!cell) return;
    const nodeId = cell.closest('[data-node-id]')?.getAttribute('data-node-id');
    if (!nodeId) return;
    const key = cell.dataset.cell ?? '';
    const cur = selRef.current;
    const same = cur?.nodeId === nodeId;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive && (e.ctrlKey || e.metaKey) && same ? cur!.cells : [];

    const anchor = e.shiftKey && same ? (anchorRef.current ?? key) : key;
    const cells = e.shiftKey && same ? rectKeys(anchor, key) : [...base, key];
    anchorRef.current = anchor;
    selectTableCells(nodeId, cells);
    if (!selectedIds.includes(nodeId)) onSelect(nodeId, false);

    // ── 拖选一片（Excel 的框选）──
    // 用 elementsFromPoint（整叠元素）而不是 elementFromPoint（最顶层）：画布上可能有透明覆盖层
    // （选框层/辅助线/纸张装饰）压在最上面，只取顶层会拿不到格子，拖选就断了。
    const cellUnder = (x: number, y: number): HTMLElement | null => {
      for (const el of document.elementsFromPoint(x, y) as HTMLElement[]) {
        const c = (el.dataset?.cell ? el : el.closest?.('[data-cell]')) as HTMLElement | null;
        if (c) return c;
      }
      return null;
    };
    const onMove = (ev: PointerEvent) => {
      const over = cellUnder(ev.clientX, ev.clientY);
      if (!over) return;
      if (over.closest('[data-node-id]')?.getAttribute('data-node-id') !== nodeId) return;
      const focus = over.dataset.cell ?? '';
      selectTableCells(nodeId, [...base, ...rectKeys(anchor, focus)]);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    // 不要让 NodeView / 画布再把它当成"选中整表"或框选
    e.preventDefault();
    e.stopPropagation();
  };

  return onPointerDownCapture;
}
