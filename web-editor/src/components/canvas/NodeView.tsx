/**
 * 职责：单个组件节点的渲染包装。由注册表的 def.render(props, ctx) 产出真实最终外观，
 *       再套上选中/悬停/预览态的外壳；容器节点把 children 注入到容器元素**内部**（flex/grid 才生效）。
 * measure=true 时用于"离屏测量"（分页用），不带任何数据属性与交互，避免被交互逻辑命中。
 * 所见即所得：非选中、非悬停状态下不加任何编辑器专属边框（§五 渲染要求）。
 *
 * ★每个节点外面套一层**节点级错误边界**：某个组件（尤其是外部热加载组件）render 抛错时，
 *   只把该节点降级成一块红色提示，不会把整个编辑器拖垮（内置组件与外部组件一视同仁）。
 */
import {
  Component,
  cloneElement,
  isValidElement,
  memo,
  type ErrorInfo,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { getComponent } from '../../registry';
import type { ComponentDefinition } from '../../registry/types';
import { asNumber } from '../../utils/id';
import { log } from '../../utils/logger';
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
  /** 本块是"跨页续表"（表格第 2..n 段）：标记 data-node-split，拖动排序要忽略 */
  continuation?: boolean;
}

/** 真正调用 def.render 的地方——必须是独立组件，否则 render 抛错时错误边界抓不到 */
function NodeBody({
  def,
  props,
  rctx,
  childNodes,
}: {
  def: ComponentDefinition;
  props: ComponentNode['props'];
  rctx: RenderContext;
  childNodes: ReactNode;
}) {
  // ★规格 §3.1/§8.1：容器组件的子节点作为**第三个参数**交给 render，由组件自己决定放在哪。
  const inner = def.render(props, rctx, def.isContainer ? childNodes : undefined);
  if (def.isContainer && isValidElement(inner)) {
    const el = inner as ReactElement<{ children?: ReactNode }>;
    // 兼容兜底：容器没自己放 children（老写法 / 外部组件）时，仍旧挂到根元素上，避免子组件"消失"
    if (el.props.children == null) return cloneElement(el, {}, childNodes);
  }
  return <>{inner}</>;
}

class NodeErrorBoundary extends Component<{ type: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('render', `组件渲染失败（已就地降级，不影响其它节点）：${this.props.type}`, {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          data-node-render-error={this.props.type}
          className="rounded border border-red-300 bg-red-50 px-2 py-1 text-2xs text-red-600"
        >
          组件「{this.props.type}」渲染失败：{this.state.error.message}（已就隔离，其它内容不受影响）
        </div>
      );
    }
    return this.props.children;
  }
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
  continuation,
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

  const content = (
    <NodeErrorBoundary type={node.type}>
      <NodeBody def={def} props={node.props} rctx={{ ...ctx, isSelected: selected }} childNodes={childNodes} />
    </NodeErrorBoundary>
  );

  const extra = measure
    ? { 'data-measure-item': '1' }
    : {
        'data-node-id': node.id,
        'data-node-type': node.type,
        // ★表格跨页续排的"续表"：同一节点在第 2..n 页上的部分，带上标记，
        //   拖动排序/落点计算要忽略它，否则一个表格会被当成两块
        ...(continuation ? { 'data-node-split': '1' } : {}),
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
