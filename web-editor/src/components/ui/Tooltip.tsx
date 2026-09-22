/**
 * 职责：自研气泡提示（**禁止用原生 title**）。属性名、分组标题共用。
 *
 * 规格（右侧属性编辑器提示词 §7）：
 *   · 延迟 400ms 弹出，移出立即消失；
 *   · 跟随鼠标右下 12px，靠近视口边缘自动翻转；
 *   · 深色底 rgba(0,0,0,.82)、白字、圆角 6px、内边距 8/10、最大宽 280px；
 *   · 内容结构：① 中文名（粗）② key（等宽小字）③ 说明 ④ 默认值 / 取值范围 / 单位；
 *   · 说明为空时只显示名称与 key。
 *
 * 为什么 `position: fixed`：属性面板/组件面板都是 `overflow: auto` 的滚动容器，
 * 绝对定位的气泡会被裁掉（这个坑在页眉页脚编辑区踩过一次）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

const DELAY_MS = 400;
const OFFSET = 12;
const MAX_W = 280;

export interface TipContent {
  /** 中文名（粗体显示的第一行） */
  name: string;
  /** 属性 key（等宽小字） */
  keyText?: string;
  /** 说明、默认值、取值范围、单位等，一行一条 */
  detail?: string[];
}

interface Pos {
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
}

export function Tooltip({
  content,
  children,
  side = 'cursor',
  wrapClassName = 'inline-flex min-w-0',
}: {
  content?: TipContent;
  children: ReactNode;
  /** cursor=跟随鼠标（属性名用）；right=贴着触发元素右侧（分组标题用） */
  side?: 'cursor' | 'right';
  /** 包装元素的类名：**必须与它替换掉的原元素一致**，否则会改变布局 */
  wrapClassName?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const clear = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPos(null);
  };
  useEffect(() => clear, []);

  const lines = content ? [content.name, content.keyText, ...(content.detail ?? [])].filter(Boolean).length : 0;
  const estH = 16 + lines * 17;

  const place = (x: number, y: number): Pos => {
    const flipX = x + OFFSET + MAX_W > window.innerWidth;
    const flipY = y + OFFSET + estH > window.innerHeight;
    return {
      x: flipX ? Math.max(8, x - OFFSET - MAX_W) : x + OFFSET,
      y: flipY ? Math.max(8, y - OFFSET - estH) : y + OFFSET,
      flipX,
      flipY,
    };
  };

  const schedule = (x: number, y: number) => {
    if (!content) return;
    if (timer.current != null) return; // 已在计时：只更新位置，不重排计时
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPos(place(x, y));
    }, DELAY_MS);
  };

  const onEnter = (e: React.MouseEvent) => {
    if (side === 'right') {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) schedule(r.right, r.top);
      return;
    }
    schedule(e.clientX, e.clientY);
  };
  const onFocus = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) schedule(side === 'right' ? r.right : r.left, r.top);
  };
  const onMove = (e: React.MouseEvent) => {
    if (side !== 'cursor' || !pos) return;
    setPos(place(e.clientX, e.clientY));
  };

  return (
    <span
      ref={wrapRef}
      data-tip="1"
      className={wrapClassName}
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onMouseLeave={clear}
      onFocus={onFocus}
      onBlur={clear}
    >
      {children}
      {pos && content && (
        <span
          role="tooltip"
          data-tooltip="1"
          className="pointer-events-none fixed z-[9999] max-w-[280px] whitespace-normal rounded-md text-left text-[11px] leading-[17px] text-white shadow-lg"
          style={{ left: pos.x, top: pos.y, background: 'rgba(0,0,0,.82)', padding: '8px 10px' }}
        >
          <span className="block font-semibold">{content.name}</span>
          {content.keyText && <span className="block font-mono text-[10px] opacity-80">{content.keyText}</span>}
          {(content.detail ?? []).map((d, i) => (
            <span key={i} className="block opacity-95">
              {d}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
