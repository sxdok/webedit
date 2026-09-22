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
        <div className="pointer-events-auto absolute inset-0">
          <ResizeHandles w={frame.w} h={frame.h} onStart={onHandleDown} />
        </div>
      )}
    </div>
  );
}
