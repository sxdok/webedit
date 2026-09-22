/**
 * 职责：单个组件节点的渲染包装。由注册表的 def.render(props, ctx) 产出真实最终外观，
 *       再套上选中/悬停/预览态的外壳；容器节点把 children 注入到容器元素**内部**（flex/grid 才生效）。
 * measure=true 时用于"离屏测量"（分页用），不带任何数据属性与交互，避免被交互逻辑命中。
 * 所见即所得：非选中、非悬停状态下不加任何编辑器专属边框（§五 渲染要求）。
 */
import { cloneElement, isValidElement, memo, type ReactElement, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { getComponent } from '../../registry';
import { asNumber } from '../../utils/id';
import type { ComponentNode, EditorMode, RenderContext } from '../../registry/types';

export interface NodeViewProps {
  node: ComponentNode;
  ctx: RenderContext;
  mode: EditorMode;
  selectedIds: string[];
  hoveredId: string | null;
  showChrome: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onHover: (id: string | null) => void;
  /** 按下节点（拖动/排序由画布交互层处理） */
  onNodePointerDown?: (e: ReactPointerEvent) => void;
  /** 离屏测量模式：无交互、无数据属性 */
  measure?: boolean;
}

function NodeViewInner({
  node,
  ctx,
  mode,
  selectedIds,
  hoveredId,
  showChrome,
  onSelect,
  onHover,
  onNodePointerDown,
  measure,
}: NodeViewProps) {
  const def = getComponent(node.type);
  if (!def) {
    return (
      <div className="rounded border border-dashed border-red-300 bg-red-50 px-2 py-1 text-2xs text-red-500">
        未注册组件：{node.type}
      </div>
    );
  }
  if (node.hidden) return null;

  const selected = !measure && selectedIds.includes(node.id);
  const hovered = !measure && hoveredId === node.id;
  const inner = def.render(node.props, { ...ctx, isSelected: selected });
  const chrome = showChrome && !measure ? (selected ? 'node-selected' : hovered ? 'node-hover' : '') : '';

  // ★上/下边距：所有组件统一属性（注册表自动补齐），在文档模式下按 mm 换算为 px 生效
  const mt = asNumber(node.props.marginTop, 0);
  const mb = asNumber(node.props.marginBottom, 0);
  const spacing: React.CSSProperties =
    mode === 'document' && (mt || mb)
      ? { marginTop: ctx.mmToPx(mt), marginBottom: ctx.mmToPx(mb) }
      : {};

  const webChild = mode === 'web' && node.frame;
  const style: React.CSSProperties = webChild
    ? {
        position: 'absolute',
        left: node.frame?.x ?? 0,
        top: node.frame?.y ?? 0,
        width: node.frame?.w,
        height: node.frame?.h,
        transform: node.frame?.rotation ? `rotate(${node.frame.rotation}deg)` : undefined,
      }
    : {};

  const childNodes: ReactNode = def.isContainer
    ? (node.children ?? []).map((child) => (
        <NodeView
          key={child.id}
          node={child}
          ctx={ctx}
          mode={mode}
          selectedIds={selectedIds}
          hoveredId={hoveredId}
          showChrome={showChrome}
          onSelect={onSelect}
          onHover={onHover}
          onNodePointerDown={onNodePointerDown}
          measure={measure}
        />
      ))
    : null;

  const content =
    def.isContainer && isValidElement(inner) ? (
      cloneElement(inner as ReactElement<{ children?: ReactNode }>, {}, childNodes)
    ) : (
      <>
        {inner}
        {childNodes}
      </>
    );

  const extra = measure
    ? { 'data-measure-item': '1' }
    : {
        'data-node-id': node.id,
        'data-node-type': node.type,
      };

  return (
    <div
      {...extra}
      className={`${chrome} ${webChild ? '' : 'relative'}`}
      style={{ ...style, ...spacing }}
      onMouseEnter={measure ? undefined : () => onHover(node.id)}
      onMouseLeave={measure ? undefined : () => onHover(null)}
      onPointerDown={
        measure
          ? undefined
          : (e) => {
              e.stopPropagation();
              onSelect(node.id, e.shiftKey);
              onNodePointerDown?.(e);
            }
      }
    >
      {content}
    </div>
  );
}

export const NodeView = memo(NodeViewInner);
