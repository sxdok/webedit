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

/* ══════════════ 事件委托层：给已有元素加气泡，**不改 DOM 结构** ══════════════
 *
 * 背景（D16，2026-09-28 审计）：属性面板与控件里散着 24 处**原生 `title`**（截断值、按钮说明、
 * 色板、对齐按钮…）。规格 §7 明确"禁止用原生 title"（原生提示丑、延迟由系统定、不能带结构、
 * 和自研气泡风格不一致）。但逐个用 `<Tooltip>` 包一层会**改变 DOM 结构与布局**
 * （Tooltip 会多出一个 `<span>`，行内元素/弹性布局都会受影响）。
 *
 * 做法：元素上只写 `data-tip-text="…"`，本层在 document 上做**事件委托**，用与 Tooltip 完全相同的
 * 气泡样式渲染（`position: fixed` → 不被滚动容器裁剪；`createPortal` 之外的方案都动 DOM，故不用）。
 *   · 400ms 延迟、移出/按下/滚动立即消失、跟随鼠标右下 12px、边缘自动翻转；
 *   · 多行文案用 `\n` 分隔：首行加粗（当作"名称"），其余行按说明逐行显示 —— 与结构化气泡一致；
 *   · 键盘可达：`focusin`/`focusout` 同样触发（按钮的键盘用户也能看到说明）。
 *
 * 挂载点：`App.tsx` 里挂一次即可（verify 有断言盯它还在）。
 */
export const TIP_ATTR = 'data-tip-text';

interface LayerState {
  x: number;
  y: number;
  lines: string[];
}

export function TooltipLayer() {
  const [state, setState] = useState<LayerState | null>(null);
  const timer = useRef<number | null>(null);
  const anchor = useRef<Element | null>(null);
  const pointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const clear = (): void => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      anchor.current = null;
      setState(null);
    };

    const estH = (lines: number): number => 16 + lines * 17;
    const place = (x: number, y: number, lines: number): { x: number; y: number } => {
      const h = estH(lines);
      return {
        x: x + OFFSET + MAX_W > window.innerWidth ? Math.max(8, x - OFFSET - MAX_W) : x + OFFSET,
        y: y + OFFSET + h > window.innerHeight ? Math.max(8, y - OFFSET - h) : y + OFFSET,
      };
    };

    const targetOf = (node: EventTarget | null): Element | null =>
      node instanceof Element ? node.closest(`[${TIP_ATTR}]`) : null;

    const schedule = (el: Element, x: number, y: number): void => {
      if (anchor.current === el) return; // 同一元素（含其子元素间移动）不重排计时
      clear();
      anchor.current = el;
      const text = el.getAttribute(TIP_ATTR) ?? '';
      if (!text.trim()) return;
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setState({ ...place(x, y, lines.length), lines });
      }, DELAY_MS);
    };

    const onOver = (e: MouseEvent): void => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const el = targetOf(e.target);
      if (!el) {
        if (anchor.current) clear();
        return;
      }
      schedule(el, e.clientX, e.clientY);
    };
    const onMove = (e: MouseEvent): void => {
      if (!state) return; // 只在气泡已显示时跟随，避免高频 setState
      const lines = state.lines.length;
      setState({ ...place(e.clientX, e.clientY, lines), lines: state.lines });
    };
    const onFocusIn = (e: FocusEvent): void => {
      const el = targetOf(e.target);
      if (!el) return;
      const r = el.getBoundingClientRect();
      schedule(el, r.left, r.top);
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('mouseout', clear, true);
    document.addEventListener('focusout', clear, true);
    document.addEventListener('mousedown', clear, true);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('mouseout', clear, true);
      document.removeEventListener('focusout', clear, true);
      document.removeEventListener('mousedown', clear, true);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [state]);

  if (!state) return null;
  return (
    <span
      role="tooltip"
      data-tooltip="1"
      className="pointer-events-none fixed z-[9999] max-w-[280px] whitespace-normal rounded-md text-left text-[11px] leading-[17px] text-white shadow-lg"
      style={{ left: state.x, top: state.y, background: 'rgba(0,0,0,.82)', padding: '8px 10px' }}
    >
      {state.lines.map((d, i) => (
        <span key={i} className={i === 0 ? 'block font-semibold' : 'block opacity-95'}>
          {d}
        </span>
      ))}
    </span>
  );
}

