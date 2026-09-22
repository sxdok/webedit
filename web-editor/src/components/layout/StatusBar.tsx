/**
 * 职责：底部状态栏（模式 / 画布尺寸 / 缩放 / 光标位置 / 选中组件）。
 */
import { useEditorStore } from '../../store/editorStore';
import { getComponent } from '../../registry';
import { sizeLabel } from '../canvas/fitZoom';

export function StatusBar({ pointer }: { pointer: { x: number; y: number } }) {
  const mode = useEditorStore((s) => s.doc.mode);
  const page = useEditorStore((s) => s.doc.document.page);
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  const zoom = useEditorStore((s) => s.zoom);
  const selectedIds = useEditorStore((s) => s.doc.selectedIds);
  // ★只选原始值：zustand v5 默认用 Object.is 比较，selector 里每次 new 一个对象会导致
  //   "getSnapshot should be cached" 无限重渲染（有选中项时整棵 React 树会崩掉）
  const primaryId = useEditorStore((s) => s.doc.selectedIds[0] ?? null);
  const primaryType = useEditorStore((s) => {
    const id = s.doc.selectedIds[0];
    return id ? findType(s, id) : null;
  });

  const def = primaryType ? getComponent(primaryType) : undefined;
  const unit = mode === 'document' ? 'mm' : 'px';
  const primary = primaryId ? { id: primaryId, type: primaryType ?? '未知' } : null;

  return (
    <div className="no-print flex items-center gap-4 border-t border-line bg-white px-3 py-1 text-2xs text-gray-500">
      <span className="font-medium text-gray-700">{mode === 'document' ? '文档模式' : 'Web 模式'}</span>
      <span>画布：{sizeLabel(mode, page, canvas)}</span>
      <span>缩放：{Math.round(zoom * 100)}%</span>
      <span>
        光标：{pointer.x} × {pointer.y} {unit}
      </span>
      <span className="truncate">
        选中：{primary ? `${def?.label ?? primary.type}（${primary.id}）` : '无'}
        {selectedIds.length > 1 ? ` 等 ${selectedIds.length} 个` : ''}
      </span>
      <span className="ml-auto text-gray-400">
        布局参照 Qt Designer · 左侧组件面板 / 中间画布 / 右侧属性面板
      </span>
    </div>
  );
}

function findType(s: ReturnType<typeof useEditorStore.getState>, id: string): string | null {
  const forest =
    s.doc.mode === 'web' ? (s.doc.web.root.children ?? []) : s.doc.document.components;
  const stack = [...forest];
  while (stack.length) {
    const n = stack.shift();
    if (!n) continue;
    if (n.id === id) return n.type;
    if (n.children?.length) stack.push(...n.children);
  }
  return null;
}
