/**
 * 职责：组件树面板（视图菜单开关）。显示当前模式的层级结构（含容器嵌套），点击选中。
 *       支持**拖拽改层级**：拖到行的上/下半区＝同层排序，拖到容器行的中间＝放进该容器。
 */
import { useState } from 'react';
import { ChevronRight, Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import { getComponent } from '../../registry';
import { selectForest, useEditorStore } from '../../store/editorStore';
import { findParentId, flatten, isDescendant } from '../../store/treeUtils';
import type { ComponentNode } from '../../registry/types';
import { log } from '../../utils/logger';

const DRAG_MIME = 'application/x-editor-tree-node';

type DropZone = 'before' | 'after' | 'into';

export function ComponentTree() {
  const forest = useEditorStore(selectForest);
  const selectedIds = useEditorStore((s) => s.doc.selectedIds);
  const selectComponent = useEditorStore((s) => s.selectComponent);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const rows = flatten(forest);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);

  /** 直接子节点列表（用于算同层插入序号） */
  const siblingsOf = (id: string): ComponentNode[] => {
    const parentId = findParentId(forest, id);
    if (!parentId) return forest;
    const find = (list: ComponentNode[]): ComponentNode | null => {
      for (const n of list) {
        if (n.id === parentId) return n;
        const hit = n.children ? find(n.children) : null;
        if (hit) return hit;
      }
      return null;
    };
    return find(forest)?.children ?? forest;
  };

  const zoneAt = (e: React.DragEvent, node: ComponentNode): DropZone => {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - r.top) / Math.max(1, r.height);
    const isContainer = !!getComponent(node.type)?.isContainer;
    if (isContainer && ratio > 0.28 && ratio < 0.72) return 'into';
    return ratio < 0.5 ? 'before' : 'after';
  };

  const handleDrop = () => {
    if (!dragId || !drop) return;
    const S = useEditorStore.getState();
    const target = rows.find((r) => r.node.id === drop.id)?.node;
    if (!target || target.id === dragId) return;
    if (isDescendant(forest, target.id, dragId)) {
      log.warn('tree', '不能把节点拖进自己的子树', { dragId, targetId: target.id });
      return;
    }
    if (drop.zone === 'into') {
      S.reparentComponent(dragId, target.id);
    } else {
      const parentId = findParentId(forest, target.id);
      const sibs = siblingsOf(target.id);
      const at = sibs.findIndex((n) => n.id === target.id);
      S.moveComponent(dragId, parentId, Math.max(0, at + (drop.zone === 'after' ? 1 : 0)));
    }
    setDragId(null);
    setDrop(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-2">
        <span className="panel-title">组件树</span>
        <span className="ml-2 text-2xs text-gray-400">可拖拽调整层级</span>
      </div>
      <div className="thin-scroll flex-1 overflow-auto py-1">
        {rows.length === 0 && (
          <p className="px-3 py-2 text-2xs text-gray-400">当前模式还没有组件。</p>
        )}
        {rows.map(({ node, depth }) => {
          const def = getComponent(node.type);
          const Icon = def?.icon;
          const active = selectedIds.includes(node.id);
          const zone = drop?.id === node.id ? drop.zone : null;
          return (
            <div
              key={node.id}
              data-tree-row="1"
              /* 行上带节点 id：自检要能"按节点"找到行来模拟拖拽（原来只能按顺序猜） */
              data-tree-node={node.id}
              draggable
              onDragStart={(e) => {
                setDragId(node.id);
                e.dataTransfer.setData(DRAG_MIME, node.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragId(null);
                setDrop(null);
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === node.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const z = zoneAt(e, node);
                setDrop((prev) => (prev?.id === node.id && prev.zone === z ? prev : { id: node.id, zone: z }));
              }}
              onDragLeave={() => setDrop((prev) => (prev?.id === node.id ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop();
              }}
              onClick={(e) => (e.shiftKey ? toggleSelect(node.id) : selectComponent([node.id]))}
              className={`flex cursor-pointer items-center gap-1 py-1 pr-2 text-[13px] ${
                active ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100'
              } ${dragId === node.id ? 'opacity-50' : ''} ${
                zone === 'into' ? 'bg-primary/5 ring-1 ring-inset ring-primary' : ''
              } ${zone === 'before' ? 'border-t-2 border-primary' : ''} ${
                zone === 'after' ? 'border-b-2 border-primary' : ''
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {depth > 0 && <ChevronRight className="h-3 w-3 text-gray-300" />}
              {Icon ? <Icon className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
              <span className="truncate">{def?.label ?? node.type}</span>
              <span className="ml-auto flex items-center gap-1 text-gray-300">
                {node.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                {node.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
