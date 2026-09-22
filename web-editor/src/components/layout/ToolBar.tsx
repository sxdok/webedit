/**
 * 职责：工具栏（模式切换、撤销/重做、对齐、层级、网格、预览）。
 *       注意：**缩放只保留画布右下角一处**（工具栏不再放缩放，避免两处冲突）。
 * 对齐与层级按钮直接调 store；对齐的批量计算留给阶段三（多选）实现。
 */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Eye,
  Grid3x3,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { selectCanRedo, selectCanUndo, useEditorStore } from '../../store/editorStore';
import { ModeSwitcher } from './ModeSwitcher';
import { ToolButton, ToolDivider } from '../ui/ToolButton';

export function ToolBar() {
  const ui = useEditorStore((s) => s.ui);
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const hasSelection = useEditorStore((s) => s.doc.selectedIds.length > 0);

  const S = () => useEditorStore.getState();
  const ids = () => S().doc.selectedIds;

  return (
    <div
      data-toolbar="1"
      className="no-print flex flex-wrap items-center gap-1 border-b border-line bg-white px-2 py-1"
    >
      <ModeSwitcher />
      <ToolDivider />

      <ToolButton title="撤销 Ctrl+Z" disabled={!canUndo} onClick={() => S().undo()}>
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="重做 Ctrl+Shift+Z" disabled={!canRedo} onClick={() => S().redo()}>
        <Redo2 className="h-4 w-4" />
      </ToolButton>
      <ToolDivider />

      <ToolButton title="左对齐" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().updateFrame(id, { x: 0 }))}>
        <AlignStartVertical className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="水平居中" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().updateFrame(id, { x: Math.round((canvas.width - 240) / 2) }))}>
        <AlignCenterVertical className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="右对齐" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().updateFrame(id, { x: canvas.width - 240 }))}>
        <AlignEndVertical className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="顶对齐" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().updateFrame(id, { y: 0 }))}>
        <AlignStartHorizontal className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="垂直居中" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().updateFrame(id, { y: Math.round((canvas.height - 40) / 2) }))}>
        <AlignCenterHorizontal className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="底对齐" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().updateFrame(id, { y: canvas.height - 40 }))}>
        <AlignEndHorizontal className="h-4 w-4" />
      </ToolButton>
      <ToolDivider />

      <ToolButton title="置顶" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().bringToFront(id))}>
        <ArrowUpToLine className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="上移一层" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().bringForward(id))}>
        <ChevronUp className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="下移一层" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().sendBackward(id))}>
        <ChevronDown className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="置底" disabled={!hasSelection} onClick={() => ids().forEach((id) => S().sendToBack(id))}>
        <ArrowDownToLine className="h-4 w-4" />
      </ToolButton>
      <ToolDivider />

      <ToolButton active={ui.showGrid} title="显示网格" onClick={() => S().toggleUI('showGrid')}>
        <Grid3x3 className="h-4 w-4" />
      </ToolButton>
      <ToolButton active={ui.showTree} title="显示组件树" onClick={() => S().toggleUI('showTree')}>
        <span className="px-0.5 text-xs font-semibold">树</span>
      </ToolButton>
      <ToolButton active={ui.preview} title="预览（隐藏编辑态边框与手柄）" onClick={() => S().toggleUI('preview')}>
        <Eye className="h-4 w-4" />
      </ToolButton>
      <ToolDivider />

      <ToolButton title="删除选中 Delete" disabled={!hasSelection} danger onClick={() => ids().forEach((id) => S().removeComponent(id))}>
        <Trash2 className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}
