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

/**
 * 气泡/提示条里的**极简富文本**：只认 `**加粗**`。
 *
 * 为什么需要：说明文案里常写 `**不会**`／`**第 N 行**` 来强调，但气泡是纯文本渲染，
 * 于是星号**原样显示**（审计出 9 处：TableOverlay、TableSortControl、TableCellsControl、
 * input 组件 description、tableKit、MarkdownDialog、MultiSelectPanel、MenuBar…）。
 * 与其逐处删星号，不如让气泡认这一种标记 —— 故意**不做**通用 Markdown（那是另一个坑）。
 */
export function richText(text: string): ReactNode {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part));
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
  const visible = pos != null;

  /**
   * ★兜底隐藏（2026-09-30 修用户报的"鼠标移走了气泡还在"）：
   * 只靠 `onMouseLeave` 不够 —— 指针直接移出窗口、锚点被重渲染/移除、或事件路径被遮挡时都不会触发 leave，
   * 气泡就**赖在屏幕上**。这里在气泡可见期间盯住 document 的 mousemove：指针一旦离开触发元素的范围就收起。
   */
  useEffect(() => {
    if (!visible) return;
    const onDocMove = (e: MouseEvent): void => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) {
        clear();
        return;
      }
      const inside = e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
      if (!inside) clear();
    };
    document.addEventListener('mousemove', onDocMove, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('mousemove', onDocMove, true);
      window.removeEventListener('blur', clear);
    };
  }, [visible]);

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
              {richText(d)}
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
  /** 最新气泡状态（给"跟随鼠标"用；见下面为什么不把 state 放进 effect 依赖） */
  const stateRef = useRef<LayerState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * ★监听只绑一次（依赖 `[]`）。
   *
   * 原来依赖是 `[state]`：气泡状态一变 → React 跑上一次 effect 的 cleanup → cleanup 里 `clear()`
   * → 刚设好的 state 立刻被清空 → **气泡"闪现即消失"**。
   * 实测（MutationObserver 抓 DOM）：气泡在 408ms 被加入、**同一毫秒**被移除，存活 0ms，
   * 所以 `data-tip-text` 这条路一直等于"不显示"（属性面板用的是 React 版 `<Tooltip>`，所以没被发现）。
   * 现在把 state 读进 `stateRef`，effect 只在挂载时绑一次，气泡能稳定停留到鼠标移出。
   */
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

    /**
     * ★菜单里不弹气泡（2026-09-30 用户报"气泡挡住菜单了"）：
     * 气泡层是 `z-[9999]`，比菜单（`z-50/60`）高，鼠标停在「导出 ▸」这类项上时气泡会**盖住刚展开的子菜单**。
     * 菜单项的名字本身就是动作，不需要解释 —— 锚点在菜单里就整条不弹。
     */
    const inMenuChrome = (el: Element): boolean => !!el.closest('[data-menubar],[data-menu-panel],[data-menu]');

    /** 指针是否还在锚点范围内（留 2px 余量）；锚点被移除/重渲染（isConnected=false）也算离开 */
    const stillOnAnchor = (x: number, y: number): boolean => {
      const el = anchor.current;
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      return x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
    };

    const schedule = (el: Element, x: number, y: number): void => {
      if (inMenuChrome(el)) {
        clear();
        return;
      }
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
    /**
     * ★mousemove 是**兜底收口**（用户报"鼠标移走了气泡还在"）：
     * 只靠 `mouseout` 会漏 —— 指针直接移出窗口、锚点被重渲染/移除、或从某个不吃事件的浮层上划过去都收不到 mouseout，
     * 气泡就赖在屏幕上。这里每次都校验"指针是否还在锚点上"，不在就立刻收起（顺带覆盖计时未到就移开的情形）。
     */
    const onMove = (e: MouseEvent): void => {
      if (anchor.current && !stillOnAnchor(e.clientX, e.clientY)) {
        clear();
        return;
      }
      const cur = stateRef.current; // ← 从 ref 读最新状态（不能闭包捕获 state，否则 effect 得依赖它）
      if (!cur) return; // 只在气泡已显示时跟随，避免高频 setState
      setState({ ...place(e.clientX, e.clientY, cur.lines.length), lines: cur.lines });
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
    /* ★依赖必须是空数组：见上面的说明 —— 依赖 state 会让 cleanup 把刚弹出的气泡清掉。 */
  }, []);

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
          {richText(d)}
        </span>
      ))}
    </span>
  );
}

