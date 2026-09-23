/**
 * 职责：**画布上双击单元格直接改字**（Excel 的 F2 / 双击体验）。
 *
 * 挂在 Canvas 的"缩放层"上（`ref` 那个 div）：
 *   · 双击捕获阶段认出 `[data-cell]` → 从 `data-node-id` 找到组件 → 读出那一格的文字；
 *   · 在**缩放层内部**绝对定位一个 `<input>`（坐标 = 格子的 clientRect 减去缩放层 rect，再除以 zoom），
 *     这样输入框跟着纸张/画布一起缩放、平移，不会"浮"在外面；
 *   · `Enter` 提交、`Esc` 取消、失焦提交；写回走 `setCellText` + `serializeTableData`
 *     （与属性面板「单元格内容」框同一条路径，转义一致）。
 *
 * 命中不了 `[data-cell]`（被合并覆盖的格、非表格节点）时原样放行，不影响其它双击行为。
 */
import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { parseTableData, serializeTableData, setCellText } from '../../registry/components/common/tableKit';
import { findNode, getForest } from '../../store/treeUtils';
import { useEditorStore } from '../../store/editorStore';

interface CellEditState {
  nodeId: string;
  r: number;
  c: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** 进入编辑时的原文（Esc 取消要还原） */
  original: string;
}

export function useCellEdit(zoom: number, originRef: RefObject<HTMLDivElement | null>): {
  onDoubleClickCapture: (e: React.MouseEvent) => void;
  editor: ReactNode;
} {
  const [edit, setEdit] = useState<CellEditState | null>(null);
  const [draft, setDraft] = useState('');
  /** 提交后不要再被 blur 重复触发（Enter 提交 → blur 会再跑一次） */
  const doneRef = useRef(false);

  const write = useCallback((nodeId: string, r: number, c: number, text: string) => {
    const live = useEditorStore.getState();
    const node = findNode(getForest(live.doc), nodeId);
    if (!node) return;
    const rows = setCellText(parseTableData(node.props.data), r, c, text);
    live.updateProps(nodeId, { data: serializeTableData(rows) });
  }, []);

  const onDoubleClickCapture = useCallback(
    (e: React.MouseEvent) => {
      const cell = (e.target as HTMLElement | null)?.closest?.('[data-cell]') as HTMLElement | null;
      if (!cell) return;
      const nodeId = cell.closest('[data-node-id]')?.getAttribute('data-node-id');
      const key = cell.dataset.cell ?? '';
      const [r, c] = key.split(',').map((n) => Number(n));
      const origin = originRef.current?.getBoundingClientRect();
      if (!nodeId || !Number.isFinite(r) || !Number.isFinite(c) || !origin) return;
      const S = useEditorStore.getState();
      const node = findNode(getForest(S.doc), nodeId);
      if (!node) return;
      const original = parseTableData(node.props.data)[r]?.[c] ?? '';
      const rect = cell.getBoundingClientRect();
      const z = zoom || 1;
      S.selectComponent([nodeId]);
      S.selectTableCells(nodeId, [key]);
      doneRef.current = false;
      setDraft(original);
      setEdit({
        nodeId,
        r,
        c,
        left: (rect.left - origin.left) / z,
        top: (rect.top - origin.top) / z,
        width: rect.width / z,
        height: rect.height / z,
        original,
      });
      // 别让双击继续冒泡（否则会触发"选中整表/进入容器"等逻辑）
      e.preventDefault();
      e.stopPropagation();
    },
    [originRef, zoom],
  );

  const commit = useCallback(() => {
    if (!edit || doneRef.current) return;
    doneRef.current = true;
    if (draft !== edit.original) write(edit.nodeId, edit.r, edit.c, draft);
    setEdit(null);
  }, [draft, edit, write]);

  const cancel = useCallback(() => {
    if (!edit) return;
    doneRef.current = true;
    setEdit(null);
  }, [edit]);

  const editor = edit
    ? (
        <input
          data-cell-editor="1"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
            // 方向键留在输入框里移动光标（别让画布的键盘导航抢走）
            e.stopPropagation();
          }}
          style={{
            position: 'absolute',
            left: edit.left,
            top: edit.top,
            width: Math.max(24, edit.width),
            height: Math.max(20, edit.height),
            zIndex: 40,
            fontSize: 12,
            lineHeight: '16px',
            padding: '0 4px',
            border: '2px solid var(--c-primary, #2563eb)',
            borderRadius: 2,
            background: '#fff',
            color: '#111',
            boxShadow: '0 2px 8px rgba(0,0,0,.18)',
            outline: 'none',
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
      )
    : null;

  return { onDoubleClickCapture, editor };
}
