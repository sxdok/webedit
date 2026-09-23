/**
 * 职责：选中框的 8 个缩放手柄 + 1 个旋转手柄。只负责渲染与 pointerdown 上报方向，
 *       具体的缩放/旋转计算在 useCanvasInteraction。
 */
import type { PointerEvent as ReactPointerEvent } from 'react';

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type HandleDir = ResizeDir | 'rotate';

const CURSOR: Record<ResizeDir, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

const SIZE = 8;

export function ResizeHandles({
  w,
  h,
  onStart,
}: {
  w: number;
  h: number;
  onStart: (e: ReactPointerEvent, dir: HandleDir) => void;
}) {
  const positions: { dir: ResizeDir; x: number; y: number }[] = [
    { dir: 'nw', x: 0, y: 0 },
    { dir: 'n', x: w / 2, y: 0 },
    { dir: 'ne', x: w, y: 0 },
    { dir: 'e', x: w, y: h / 2 },
    { dir: 'se', x: w, y: h },
    { dir: 's', x: w / 2, y: h },
    { dir: 'sw', x: 0, y: h },
    { dir: 'w', x: 0, y: h / 2 },
  ];

  return (
    <>
      {positions.map((p) => (
        <div
          key={p.dir}
          data-handle={p.dir}
          /* 手柄自己吃事件（外层选中框是 pointer-events-none，只有手柄可交互） */
          className="pointer-events-auto absolute z-40 bg-white"
          style={{
            left: p.x - SIZE / 2,
            top: p.y - SIZE / 2,
            width: SIZE,
            height: SIZE,
            border: '1.5px solid #1677ff',
            borderRadius: 1,
            cursor: CURSOR[p.dir],
          }}
          onPointerDown={(e) => onStart(e, p.dir)}
        />
      ))}
      {/* 旋转手柄：顶边上方（按住 Shift 吸附 15°） */}
      <div
        data-handle="rotate"
        title="旋转（按住 Shift 吸附 15°）"
        className="pointer-events-auto absolute z-40 rounded-full bg-white"
        style={{
          left: w / 2 - 5,
          top: -24,
          width: 10,
          height: 10,
          border: '1.5px solid #1677ff',
          cursor: 'grab',
        }}
        onPointerDown={(e) => onStart(e, 'rotate')}
      />
      <div
        className="pointer-events-none absolute z-30"
        style={{ left: w / 2, top: -14, width: 1, height: 14, background: '#1677ff' }}
      />
    </>
  );
}
