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
import { useEditorStore } from '../../store/editorStore';
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
  /**
   * 按下节点（拖动/排序由画布交互层处理）。
   * ★第二个参数必须是**这个节点自己的 id**：容器里的子节点复用的是同一份回调，
   *   若把它绑成"顶层节点 id"传下去，点子组件会变成选中/拖动它的祖先容器
   *   （用户 2026-09-23 反馈"放进容器里的组件选不中"就是这个根因）。
   */
  onNodePointerDown?: (e: ReactPointerEvent, id: string) => void;
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

  const childNodes: ReactNode = def?.isContainer
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

  /**
   * ★未注册组件（比如外部插件被删掉、或旧存档里的组件没了）：
   *   以前这里**直接 return 一个红框**，它没有 data-node-id、也没有选中/删除入口 ——
   *   结果就是"红框删不掉"（用户 2026-09-23 反馈）。
   *   现在红色提示渲染在**同一个包装节点内部**：能点选、能进组件树、能按 Delete，
   *   并且就地给一个「删除该节点」按钮，不必先猜它在哪。
   */
  const content = def ? (
    <NodeErrorBoundary type={node.type}>
      <NodeBody
        def={def}
        props={node.props}
        /* 图表按章编号（B11）：把本节点的编号（如「图 1-2」）注进 ctx，组件在自己的图题/表题里显示 */
        rctx={{ ...ctx, isSelected: selected, autoLabel: ctx.numbering?.[node.id] }}
        childNodes={childNodes}
      />
    </NodeErrorBoundary>
  ) : (
    <div
      data-node-unregistered={node.type}
      className="flex items-center gap-2 rounded border border-dashed border-red-300 bg-red-50 px-2 py-1 text-2xs text-red-600"
    >
      <span className="min-w-0 flex-1 truncate">
        未注册组件：{node.type}
        {(node.children?.length ?? 0) > 0 ? `（含 ${node.children?.length} 个子节点）` : ''}
        —— 点选后按 Delete 删除，或
      </span>
      <button
        type="button"
        data-remove-unregistered="1"
        className="shrink-0 rounded border border-red-300 bg-white px-1.5 py-0.5 text-2xs text-red-600 hover:bg-red-100"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          useEditorStore.getState().removeComponent(node.id);
        }}
      >
        删除该节点
      </button>
    </div>
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
              onNodePointerDown?.(e, node.id);
            }
      }
    >
      {content}
    </div>
  );
}

export const NodeView = memo(NodeViewInner);
