/**
 * 职责：选中框（Web 模式：2px 描边 + 尺寸标签 + 缩放手柄；文档模式：行内描边 + 左侧类型标签）。
 * 计算与交互在 useCanvasInteraction，本文件只渲染。
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getComponent } from '../../registry';
import { ResizeHandles, type HandleDir } from './ResizeHandles';

export function SelectionBox({
  nodeId,
  nodeType,
  frame,
  mode,
  showHandles = true,
  onHandleDown,
}: {
  nodeId: string;
  nodeType: string;
  mode: 'document' | 'web';
  frame?: { x: number; y: number; w: number; h: number; rotation?: number };
  showHandles?: boolean;
  onHandleDown: (e: ReactPointerEvent, dir: HandleDir) => void;
}) {
  const label = getComponent(nodeType)?.label ?? nodeType;

  if (mode === 'document') {
    return (
      <div className="no-print pointer-events-none absolute -left-1 right-0 top-0 z-30 h-full border border-primary/60">
        <span className="absolute -left-px -top-4 rounded-t bg-primary px-1 text-[10px] leading-4 text-white">
          {label}
        </span>
      </div>
    );
  }

  if (!frame) return null;
  return (
    <div
      data-selection-box={nodeId}
      className="no-print pointer-events-none absolute z-30"
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.w,
        height: frame.h,
        transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
        outline: '2px solid #1677ff',
        outlineOffset: 0,
      }}
    >
      <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-primary px-1 text-[10px] leading-4 text-white">
        {label} · {Math.round(frame.w)}×{Math.round(frame.h)}
      </span>
      {showHandles && (
        /* ★这里**不能**再套一层 `pointer-events-auto absolute inset-0` 的透明层：
           它会把整个选中节点盖住，导致"选中后就再也点不到节点/表格单元格/容器里的子组件"
           （用户 2026-09-23 反馈的三个 Web 模式问题都是这个根因）。
           手柄自己带 pointer-events-auto，只有手柄那 8×8 的区域吃事件。 */
        <ResizeHandles w={frame.w} h={frame.h} onStart={onHandleDown} />
      )}
    </div>
  );
}
