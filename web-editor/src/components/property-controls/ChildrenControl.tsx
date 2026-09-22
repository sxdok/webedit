/**
 * 职责：children 属性控件——容器节点的子项列表编辑器（选中 / 上移 / 下移 / 删除 / 追加提示）。
 * 直接在画布上拖拽调整父子关系属于阶段三交互；这里提供面板侧的等价操作。
 */
import { ArrowDown, ArrowUp, MousePointerClick, Trash2 } from 'lucide-react';
import { getComponent } from '../../registry';
import { selectForest, useEditorStore } from '../../store/editorStore';
import { findNode } from '../../store/treeUtils';

export function ChildrenControl({ nodeId }: { nodeId?: string }) {
  const forest = useEditorStore(selectForest);
  const removeComponent = useEditorStore((s) => s.removeComponent);
  const moveComponent = useEditorStore((s) => s.moveComponent);
  const selectComponent = useEditorStore((s) => s.selectComponent);

  const node = nodeId ? findNode(forest, nodeId) : null;
  const children = node?.children ?? [];

  const move = (id: string, dir: -1 | 1) => {
    if (!nodeId) return;
    const index = children.findIndex((c) => c.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= children.length) return;
    moveComponent(id, nodeId, target);
  };

  return (
    <div className="mb-2">
      <span className="mb-1 block text-2xs text-gray-500">子组件（{children.length}）</span>
      {children.length === 0 ? (
        <p className="rounded border border-dashed border-line px-2 py-1.5 text-2xs text-gray-400">
          容器内还没有子组件：从左侧组件面板拖到该容器上即可放入。
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-line">
          {children.map((c, i) => {
            const def = getComponent(c.type);
            const Icon = def?.icon;
            return (
              <div
                key={c.id}
                className="flex items-center gap-1 border-b border-line bg-white px-1.5 py-1 last:border-0 hover:bg-gray-50"
              >
                {Icon ? <Icon className="h-3.5 w-3.5 text-gray-400" /> : null}
                <span className="flex-1 truncate text-[13px] text-gray-700">
                  {def?.label ?? c.type}
                </span>
                <button
                  type="button"
                  title="选中"
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-primary"
                  onClick={() => selectComponent([c.id])}
                >
                  <MousePointerClick className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="上移"
                  disabled={i === 0}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-primary disabled:opacity-30"
                  onClick={() => move(c.id, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="下移"
                  disabled={i === children.length - 1}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-primary disabled:opacity-30"
                  onClick={() => move(c.id, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="删除"
                  className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => removeComponent(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
