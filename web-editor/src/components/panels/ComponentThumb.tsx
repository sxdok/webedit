/**
 * 职责：组件箱的**真渲染缩略图**（B9）。
 *
 * 不是画个图标代替，而是把组件的 `render` 真跑一遍，塞进一个固定尺寸的"取景框"里缩放着看：
 *   · 取景框宽固定 640px（等于一张 A4 版心的量级），再按 `scale` 缩到卡片宽度 → 版式比例与画布一致；
 *   · 组件按 `def.defaultProps` 渲染，容器类不传子节点（显示为空容器）；
 *   · `pointer-events: none` + `aria-hidden`：缩略图**不参与交互**，点击/拖拽仍旧落在卡片按钮上；
 *   · 每个缩略图各自套一个错误边界：某个组件渲染炸了只影响它自己那一格，面板照常可用。
 *   · `memo`：组件定义没变就不重渲染（面板一有输入就整棵重渲染，49 个缩略图不能跟着跑）。
 */
import { Component, memo, type ReactNode } from 'react';
import type { ComponentDefinition, ComponentProps, RenderContext } from '../../registry/types';

class ThumbErrorBoundary extends Component<{ type: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <div className="px-2 py-1 text-2xs text-red-500">渲染失败：{this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

/** 取景框宽度（px）：缩略图内部按这个宽度排版，再整体缩放 */
const STAGE_W = 640;

function ComponentThumbInner({
  def,
  ctx,
  height = 54,
}: {
  def: ComponentDefinition;
  ctx: RenderContext;
  height?: number;
}) {
  const scale = 0.32;
  let body: ReactNode;
  try {
    body = def.render(structuredClone(def.defaultProps) as ComponentProps, ctx, undefined);
  } catch (err) {
    body = <div className="px-2 py-1 text-2xs text-red-500">渲染失败：{(err as Error).message}</div>;
  }
  return (
    <div
      data-comp-thumb={def.type}
      aria-hidden
      className="pointer-events-none relative w-full select-none overflow-hidden rounded border border-line/70 bg-white"
      style={{ height }}
    >
      <div
        style={{
          width: STAGE_W,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          padding: 6,
          color: '#1f2329',
          fontSize: 14,
        }}
      >
        <ThumbErrorBoundary type={def.type}>{body}</ThumbErrorBoundary>
      </div>
    </div>
  );
}

export const ComponentThumb = memo(ComponentThumbInner);
