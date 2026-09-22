/**
 * 职责：轻量气泡提示（说明默认**全部隐藏**，鼠标移上去才弹出）。
 *
 * 为什么不用原生 `title=`：原生提示样式不可控、延迟长、深色主题下也不统一。
 * 为什么用 `position: fixed`：属性面板/组件面板都是 `overflow: auto` 的滚动容器，
 * 绝对定位的气泡会被裁掉（这个坑在页眉页脚编辑区已经踩过一次）。
 */
import { useRef, useState, type ReactNode } from 'react';

const BUBBLE_MAX_W = 268;
const BUBBLE_EST_H = 48;

export function Tooltip({
  text,
  children,
  side = 'bottom',
}: {
  /** 鼠标移上去显示的文字；为空则完全不启用（不占位、不弹） */
  text?: string;
  children: ReactNode;
  side?: 'bottom' | 'right';
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    if (!text) return;
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const maxX = Math.max(8, window.innerWidth - BUBBLE_MAX_W - 8);
    // 下方放不下就翻到上方，避免贴着窗口底边看不见
    const below = side === 'bottom';
    const flip = below && r.bottom + BUBBLE_EST_H > window.innerHeight;
    setPos(
      side === 'right'
        ? { x: Math.min(r.right + 8, maxX), y: r.top }
        : { x: Math.min(r.left, maxX), y: flip ? Math.max(8, r.top - BUBBLE_EST_H) : r.bottom + 6 },
    );
  };

  return (
    <span
      ref={wrapRef}
      data-tip="1"
      className="inline-flex min-w-0"
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos && text && (
        <span
          role="tooltip"
          data-tooltip="1"
          className="pointer-events-none fixed z-[9999] max-w-[268px] whitespace-normal rounded border border-line bg-panel px-2 py-1 text-2xs leading-relaxed text-gray-700 shadow-lg"
          style={{ left: pos.x, top: pos.y }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
