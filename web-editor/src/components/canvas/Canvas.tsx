/**
 * 职责：画布区——上方是**分页标签**（每页一份独立文档，各自可选模式），下面是画布视口：
 *   · 标尺**脱离画布**固定在视口的顶部/左侧（只随平移量移动刻度，自己不滚走）；
 *   · 画布内容放在**平移层**里（PS 式手抓：空格/中键/滚轮平移，**不夹边界**）；
 *   · 按模式分派 PaperCanvas / WebCanvas，并承载缩放（Ctrl+滚轮以指针为锚点）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RenderContext } from '../../registry/types';
import { selectForest, selectMode, useEditorStore } from '../../store/editorStore';
import { mmToPx, ptToPx } from '../../utils/units';
import { PaperCanvas } from './PaperCanvas';
import { PageTabs } from './PageTabs';
import { Ruler } from './Ruler';

/** 标尺条的固定厚度（px；**不随缩放变**，与 PS 一致） */
const RULER_H = 18;
import { WebCanvas } from './WebCanvas';
import { useCanvasInteraction } from './useCanvasInteraction';
import { useCellEdit } from './useCellEdit';

/**
 * 量出内容真实尺寸（**未缩放**；文档模式下就是所有纸张叠起来的总高）。
 * 返回 `size` 供调用方用：内容是"一页"还是"很多页"，标尺长度与滚动范围都要按它算。
 *
 * ★`scope`（就是当前模式）标记这个实测值是**哪个模式**下量的 —— 两种模式的内容尺寸完全不同
 *   （文档模式 A4 = 794px 宽，Web 模式是画布宽，示例里 1440px），而 `contentW` 又会被写回被测量
 *   元素自身的宽度，于是换模式后**旧的实测值会自我锁定**：Web→文档时 contentW 一直停在 1440，
 *   `margin:0 auto` 失效，A4 贴在视口左边（用户 2026-09-23 反馈："切回文档模式画布偏移到 0,0"）。
 *   所以换模式就作废：本次渲染按纸张/画布尺寸兜底，紧接着布局阶段量出真实值。
 */
function useScaledBox(zoom: number, deps: unknown[], scope: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scope: string; w: number; h: number }>({ scope, w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ scope, w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, scope]);

  const size = box.scope === scope ? { w: box.w, h: box.h } : { w: 0, h: 0 };
  return { ref, size, outerW: size.w * zoom, outerH: size.h * zoom };
}

function PrintDebugPanel() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /** 采集一次：tag 标记数据来源（sc=屏幕态 / pt=打印态） */
    const collect = (tag: string) => {
      const rows: string[] = [];
      const cs = getComputedStyle(document.documentElement);
      rows.push(`[${tag}] media=${window.matchMedia('print').matches ? 'print' : 'screen'} innerH=${window.innerHeight}`);
      rows.push(`[${tag}] --print-paper-h=${cs.getPropertyValue('--print-paper-h').trim() || '(未注入)'}`);
      const vp = document.getElementById('canvas-viewport');
      if (vp) {
        const st = getComputedStyle(vp);
        rows.push(`[${tag}] viewport display=${st.display} overflow=${st.overflow} h=${st.height} pad=${st.paddingTop}/${st.paddingBottom}`);
      }
      const stack = document.querySelector('.canvas-stack');
      if (stack) {
        const st = getComputedStyle(stack);
        rows.push(`[${tag}] canvas-stack display=${st.display} h=${st.height} ovf=${st.overflow}`);
      }
      const root = document.querySelector('.app-root');
      if (root) {
        const st = getComputedStyle(root);
        rows.push(`[${tag}] app-root display=${st.display} h=${st.height} ovf=${st.overflow}`);
      }
      const papers = [...document.querySelectorAll<HTMLElement>('[data-paper],[data-device]')];
      papers.forEach((p, i) => {
        const st = getComputedStyle(p);
        rows.push(
          `[${tag}] paper[${i}] cssH=${st.height} offH=${p.offsetHeight} box=${st.boxSizing} ` +
            `m=${st.marginTop}/${st.marginBottom} pad=${st.paddingTop}/${st.paddingBottom} ` +
            `brkBefore=${st.breakBefore} brkAfter=${st.breakAfter} brkInside=${st.breakInside} ovf=${st.overflow} disp=${st.display}`,
        );
        const parent = p.parentElement;
        if (parent && i === 0) {
          const ps = getComputedStyle(parent);
          rows.push(`[${tag}] paperParent disp=${ps.display} h=${ps.height} fl=${ps.flexDirection}`);
        }
        const grand = p.parentElement?.parentElement;
        if (grand && i === 0) {
          const gs = getComputedStyle(grand);
          rows.push(`[${tag}] paperGrand disp=${gs.display} h=${gs.height} tf=${gs.transform}`);
        }
      });
      if (ref.current) ref.current.textContent = rows.join('\n');
    };

    collect('sc'); // 屏幕态
    const onBefore = () => collect('pt'); // ★打印态（同步写 DOM）
    window.addEventListener('beforeprint', onBefore);
    const t = window.setTimeout(() => collect('sc'), 900);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.clearTimeout(t);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-print-debug="1"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 99999,
        background: '#fff',
        color: '#000',
        font: '9px/1.35 monospace',
        padding: 4,
        whiteSpace: 'pre',
        maxWidth: '95vw',
      }}
    />
  );
}

export function Canvas({ onPointer }: { onPointer: (p: { x: number; y: number }) => void }) {
  const mode = useEditorStore(selectMode);
  const nodes = useEditorStore(selectForest);
  const page = useEditorStore((s) => s.doc.document.page);
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  const zoom = useEditorStore((s) => s.zoom);
  const ui = useEditorStore((s) => s.ui);
  const activePageId = useEditorStore((s) => s.activePageId);
  const selectedIds = useEditorStore((s) => s.doc.selectedIds);
  const selectComponent = useEditorStore((s) => s.selectComponent);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const canvasElRef = useRef<HTMLDivElement>(null);
  const it = useCanvasInteraction({
    mode,
    zoom,
    canvas: { width: canvas.width, height: canvas.height, gridSize: canvas.gridSize },
    snap: ui.snap,
    canvasRef: canvasElRef,
  });

  const ctx: RenderContext = useMemo(
    () => ({
      mode,
      page,
      canvas,
      isEditing: !ui.preview,
      isSelected: false,
      mmToPx,
      ptToPx,
    }),
    [mode, page, canvas, ui.preview],
  );

  const { ref, size } = useScaledBox(
    zoom,
    [mode, page, canvas, nodes.length, ui.showRuler, JSON.stringify(selectedIds)],
    mode, // ★实测值按模式归属；换模式即作废（否则 Web 的 1440 会锁死文档模式的 contentW）
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  /**
   * ★两种模式两套浏览方式（用户 2026-09-23）：
   *   · **文档模式**：回到"滚动条"浏览 —— 视口 `overflow:auto`，滚轮/拖动滚动条看别的页，
   *     **不再空格/中键平移画布**，标尺固定在视口边缘、刻度跟着滚动量走；
   *   · **Web 模式**：不变 —— 自由平移（空格/中键/滚轮），画布可以拖出可视区。
   */
  const isDoc = mode === 'document';
  /**
   * 内容尺寸：文档模式按**实测**（多页时是所有纸张叠起来的总高，标尺才能覆盖全文 ——
   * 以前写死 `page.height`，于是"只渲染了一页的尺寸，其他页不显示"）；
   * Web 模式就是画布尺寸。
   */
  const contentW = isDoc ? Math.max(size.w, mmToPx(page.width)) : canvas.width;
  const contentH = isDoc ? Math.max(size.h, mmToPx(page.height)) : canvas.height;
  /** 文档模式的滚动量（标尺刻度按它偏移；用 ref + 直接改 style，避免每次滚动都重渲染整块画布） */
  const scrollRef = useRef({ x: 0, y: 0 });
  const hTickRef = useRef<HTMLDivElement>(null);
  const vTickRef = useRef<HTMLDivElement>(null);
  /** 跟随用：上一次的内容高度（判断"是不是被外部写长了"） */
  const followRef = useRef({ h: 0 });
  /** 双击画布单元格就地改字（输入框挂在缩放层里，坐标按 zoom 折算；见 useCellEdit） */
  const { onDoubleClickCapture, editor: cellEditor } = useCellEdit(zoom, ref);
  /** 平移画布（PS 式手抓工具）：按住空格 + 拖拽，或中键拖拽；偏移存 store.ui.pan，**不夹边界** */
  const pan = useEditorStore((s) => s.ui.pan) ?? { x: 0, y: 0 };
  const setPan = useEditorStore((s) => s.setPan);
  /**
   * ★文档模式：量出**每一页**在内容里的区间（未缩放 px）。
   *   纵向标尺用它做"逐页从 0 读数" —— 以前是整篇一根连续标尺，26 页就要一路数到 7000+mm，
   *   数字越数越长、越挤（用户 2026-09-24 反馈）。纸张位置只能实测（分页是先量再切片的）。
   */
  const [pageSpans, setPageSpans] = useState<{ start: number; length: number }[]>([]);
  /**
   * ★文档模式：内容比视口窄时 `margin:0 auto` 会把它**居中** —— 横向标尺的 0 必须跟着纸张左边缘走。
   *   以前刻度从"视口左边缘"起算，纸张一居中就差出一个 auto margin（用户 2026-09-24 截图：顶部比例尺偏移）。
   */
  const insetRef = useRef(0);
  const [leadInset, setLeadInset] = useState(0);
  const measureInsets = useCallback((): void => {
    const el = ref.current;
    if (!el || !isDoc) return;
    const layerEl = el.parentElement; // [data-pan-layer]：宽度 = 内容宽 × zoom，auto margin 就是内缩量
    const inset = Math.max(0, Math.round(layerEl?.offsetLeft ?? 0));
    insetRef.current = inset;
    // ★同时**立刻**把横向刻度的 transform 写掉：刻度的位移平时是滚动时直接改 style（不重渲染），
    //   只靠 setState 会在"改了尺寸但 state 没变"时漏掉一帧（用户 2026-09-24 反馈的"位置偏移"就属这类）。
    if (hTickRef.current) {
      hTickRef.current.style.transform = `translateX(${inset - scrollRef.current.x}px)`;
    }
    setLeadInset((prev) => (prev === inset ? prev : inset));
  }, [isDoc, ref]);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    // ★文档模式不玩平移（回到滚动条），所以空格既不该被吃掉、也不该显示"抓手"
    if (isDoc) return;
    const typing = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el?.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target)) return;
      e.preventDefault(); // 别让空格把页面往下滚
      if (!spaceRef.current) {
        spaceRef.current = true;
        setPanReady(true);
      }
    };
    const reset = () => {
      spaceRef.current = false;
      setPanReady(false);
      panRef.current = null;
      setPanning(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      reset();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, [isDoc]);

  /** 平移起手：只有"空格按住"或"中键"才接管（**仅 Web 模式**；文档模式用滚动条） */
  const startPan = (e: React.PointerEvent): boolean => {
    if (isDoc) return false;
    const isMiddle = e.button === 1;
    if (!spaceRef.current && !isMiddle) return false;
    if (!viewportRef.current) return false;
    panRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    setPanning(true);
    return true;
  };
  const movePan = (e: React.PointerEvent): void => {
    const p = panRef.current;
    if (!p) return;
    // 自由平移：不夹边界（纸张可以拖到视口任意位置，甚至拖出可视区）
    setPan({ x: Math.round(p.px + (e.clientX - p.x)), y: Math.round(p.py + (e.clientY - p.y)) });
  };
  const endPan = (): void => {
    panRef.current = null;
    setPanning(false);
  };

  /** 文档模式滚动：标尺刻度跟着滚动量走（直接改 style，不触发整块画布重渲染） */
  const onViewportScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    scrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
    if (hTickRef.current) hTickRef.current.style.transform = `translateX(${insetRef.current - el.scrollLeft}px)`;
    if (vTickRef.current) vTickRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
  };

  /**
   * ★外部（MCP/无头通道）把文档写长了 → 预览要**跟着到下一页**（用户 2026-09-23 反馈）：
   *   以前内容长出去以后画布不跟，得自己滚。现在内容变高且"用户本来就在底部附近"时自动滚到底；
   *   用户在中间看别处时不动他的视线。
   */
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || !isDoc) return;
    const h = el.scrollHeight;
    const prev = followRef.current.h;
    const nearBottom = prev > 0 && prev - el.scrollTop - el.clientHeight <= 80;
    if (prev > 0 && h > prev + 4 && nearBottom) {
      el.scrollTop = Math.max(0, h - el.clientHeight);
      scrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
      if (vTickRef.current) vTickRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    }
    followRef.current.h = h;
  }, [isDoc, contentH, zoom, nodes.length, ui.docPageCount, activePageId]);

  /**
   * 量出文档模式下**每一页**的区间（未缩放 px，相对内容顶）：纵向标尺据此逐页从 0 读数。
   * 纸张位置只能实测（分页是"先量全部节点、再切片"算出来的，量完还可能再变一次），所以补一帧 + 一次延迟兜底。
   * ★提成 callback：**窗口改尺寸**时也要重跑（见下面的 resize 监听）——分页/字体度量一变，
   *   纵向标尺的逐页 0 就会与纸张错位（用户 2026-09-24 反馈的"改尺寸后画布/标尺位置偏移"）。
   */
  const measureSpans = useCallback((): void => {
    const el = ref.current;
    if (!isDoc || !el) return;
    const base = el.getBoundingClientRect();
    const z = useEditorStore.getState().zoom || 1;
    const next = [...el.querySelectorAll('[data-paper]')].map((p) => {
      const r = p.getBoundingClientRect();
      return { start: Math.round((r.top - base.top) / z), length: Math.round(r.height / z) };
    });
    setPageSpans((prev) =>
      prev.length === next.length && prev.every((s, i) => s.start === next[i].start && s.length === next[i].length)
        ? prev
        : next,
    );
  }, [isDoc, ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!isDoc || !el) {
      setPageSpans((prev) => (prev.length ? [] : prev));
      return;
    }
    measureInsets();
    measureSpans();
    const raf = window.requestAnimationFrame(measureSpans);
    const t = window.setTimeout(measureSpans, 180);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [isDoc, ref, zoom, nodes.length, page, activePageId, ui.docPageCount, ui.showRuler, measureInsets, measureSpans]);

  /**
   * 视口尺寸变了 → 重算"居中内缩"（横向标尺的 0）**和逐页区间**（纵向标尺的 0）。
   *
   * 三条触发一起挂，缺一个就会出现"某一侧标尺与纸张错位"：
   *   ① `ResizeObserver` 盯视口本身（拖面板分隔线、窗口改尺寸都会改它的宽）；
   *   ② `window` 的 `resize` 事件兜底（RO 只报**尺寸**变化，窗口只挪位置/只换栅格时它不响）；
   *   ③ 尺寸变完再补一次延迟重算 —— 滚动条出现/消失、字体度量落定都会在下一帧才改完布局。
   */
  useEffect(() => {
    if (!isDoc) return;
    const vp = viewportRef.current;
    const remeasure = (): void => {
      measureInsets();
      measureSpans();
    };
    const ro = vp ? new ResizeObserver(remeasure) : null;
    if (vp && ro) ro.observe(vp);
    let t = 0;
    let raf = 0;
    const onResize = (): void => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
      raf = window.requestAnimationFrame(remeasure);
      t = window.setTimeout(remeasure, 200); // 布局/滚动条/字体度量落定后再补一刀
    };
    window.addEventListener('resize', onResize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [isDoc, measureInsets, measureSpans]);

  /** 字体度量落定后也要重算一次（换字体/系统字体首次可用会改变文字高度 → 分页会变） */
  useEffect(() => {
    if (!isDoc) return;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts?.ready) return;
    let alive = true;
    void fonts.ready.then(() => {
      if (!alive) return;
      measureInsets();
      measureSpans();
    });
    return () => {
      alive = false;
    };
  }, [isDoc, measureInsets, measureSpans]);

  /** 适应宽度（只算画布预览的缩放，不动编辑器界面） */
  const fitWidth = () => {
    const el = viewportRef.current;
    const contentW = mode === 'document' ? mmToPx(page.width) : canvas.width;
    const avail = (el?.clientWidth ?? contentW) - 48;
    return Math.max(0.1, Math.min(4, Math.floor((avail / contentW) * 100) / 100));
  };

  /** 以视口中心为锚点缩放（缩放按钮用；Ctrl+滚轮是以指针为锚点） */
  const setZoomAtCenter = (next: number) => {
    const st = useEditorStore.getState();
    const el = viewportRef.current;
    if (isDoc && el) {
      // 文档模式：以"当前视野中心"为锚点（滚动量参与计算）
      const cx = (el.scrollLeft + el.clientWidth / 2) / st.zoom;
      const cy = (el.scrollTop + el.clientHeight / 2) / st.zoom;
      st.setZoom(next);
      window.requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, cx * next - el.clientWidth / 2);
        el.scrollTop = Math.max(0, cy * next - el.clientHeight / 2);
        scrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
      });
      return;
    }
    const cur = st.ui.pan ?? { x: 0, y: 0 };
    const vw = el?.clientWidth ?? 0;
    const vh = el?.clientHeight ?? 0;
    const cx = (vw / 2 - cur.x) / st.zoom;
    const cy = (vh / 2 - cur.y) / st.zoom;
    st.setZoom(next);
    setPan({ x: Math.round(vw / 2 - cx * next), y: Math.round(vh / 2 - cy * next) });
  };

  /** 把纸张摆到视口中间（放不下时留 24px 边距，左上对齐） */
  const centerPan = useCallback(
    (z = zoom) => {
      const el = viewportRef.current;
      const cw = (mode === 'document' ? mmToPx(page.width) : canvas.width) * z;
      const ch = (mode === 'document' ? mmToPx(page.height) : canvas.height) * z;
      const vw = el?.clientWidth ?? 0;
      const vh = el?.clientHeight ?? 0;
      return {
        x: Math.round(cw + 48 <= vw ? (vw - cw) / 2 : 24),
        y: Math.round(ch + 48 <= vh ? (vh - ch) / 2 : 24),
      };
    },
    [mode, page.width, page.height, canvas.width, canvas.height, zoom],
  );

  // 切换模式 / 换页时：缩放回 100%；文档模式滚回顶部，Web 模式把画布摆到视口中间
  useEffect(() => {
    useEditorStore.getState().setZoom(1);
    const el = viewportRef.current;
    if (isDoc) {
      if (el) el.scrollTo({ left: 0, top: 0 });
      scrollRef.current = { x: 0, y: 0 };
      followRef.current.h = 0; // 换页/换模式后重新学一次内容高度
      if (hTickRef.current) hTickRef.current.style.transform = `translateX(${insetRef.current}px)`;
      if (vTickRef.current) vTickRef.current.style.transform = 'translateY(0px)';
    } else {
      /**
       * ★切到 Web 模式时也要把**视口自身的滚动位置清零**：视口 DOM 节点在两种模式间是复用的，
       *   而 `overflow:hidden` 的容器照样能保留 scrollTop —— 不清零的话，文档模式滚动过的位置会带过来，
       *   Web 画布看起来"一上来就偏了"，纵向平移也会被这个滚动量顶住（真踩过：
       *   视口 top=128 / pan.y=24，图层却出现在 top=2）。
       */
      if (el) el.scrollTo({ left: 0, top: 0 });
      scrollRef.current = { x: 0, y: 0 };
      followRef.current.h = 0;
      setPan(centerPan(1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activePageId]);

  // ★Ctrl/Cmd + 滚轮：缩放"画布预览"（以指针为锚点，像 PS），并阻止浏览器整页缩放
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = useEditorStore.getState();
      if (!e.ctrlKey && !e.metaKey) {
        // 文档模式：普通滚轮交给**原生滚动**（滚动条浏览）；Web 模式才是平移画布
        if (isDoc) return;
        e.preventDefault();
        const cur = st.ui.pan ?? { x: 0, y: 0 };
        st.setPan({ x: Math.round(cur.x - e.deltaX), y: Math.round(cur.y - e.deltaY) });
        return;
      }
      e.preventDefault();
      const next = Math.max(0.1, Math.min(4, Math.round((st.zoom + (e.deltaY > 0 ? -0.08 : 0.08)) * 100) / 100));
      if (next === st.zoom) return;
      // 让指针下的那个内容点保持不动
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (isDoc) {
        const cx = (el.scrollLeft + px) / st.zoom;
        const cy = (el.scrollTop + py) / st.zoom;
        st.setZoom(next);
        window.requestAnimationFrame(() => {
          el.scrollLeft = Math.max(0, cx * next - px);
          el.scrollTop = Math.max(0, cy * next - py);
          scrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
        });
        return;
      }
      const cur = st.ui.pan ?? { x: 0, y: 0 };
      const cx = (px - cur.x) / st.zoom;
      const cy = (py - cur.y) / st.zoom;
      st.setZoom(next);
      st.setPan({ x: Math.round(px - cx * next), y: Math.round(py - cy * next) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isDoc]);

  const onSelect = (id: string, additive: boolean) => {
    if (!id) {
      selectComponent([]);
      return;
    }
    if (additive) toggleSelect(id);
    else selectComponent([id]);
  };

  const printDebug = new URLSearchParams(location.search).get('printdebug');
  /** 标尺刻度的偏移：文档模式=**滚动量的相反数**（内容左移，刻度跟着左移），Web 模式=平移量 */
  const rulerOffset = isDoc ? { x: leadInset - scrollRef.current.x, y: -scrollRef.current.y } : pan;
  const R = ui.showRuler ? RULER_H : 0;

  const canvasBody = isDoc ? (
    <PaperCanvas
      nodes={nodes}
      ctx={ctx}
      page={page}
      showGuides={ui.showGuides}
      zoom={zoom}
      selectedIds={selectedIds}
      hoveredId={hoveredId}
      showChrome={!ui.preview}
      onSelect={onSelect}
      onHover={setHoveredId}
      onPointerMove={(x, y) => onPointer({ x, y })}
      canvasRef={canvasElRef}
      it={it}
    />
  ) : (
    <WebCanvas
      nodes={nodes}
      ctx={ctx}
      canvas={canvas}
      ui={{ showGrid: ui.showGrid }}
      zoom={zoom}
      selectedIds={selectedIds}
      hoveredId={hoveredId}
      showChrome={!ui.preview}
      onSelect={onSelect}
      onHover={setHoveredId}
      onPointerMove={(x, y) => onPointer({ x, y })}
      canvasRef={canvasElRef}
      it={it}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── 画布上方的分页（每页一份独立文档，各自可选模式）── */}
      <PageTabs />

      <div className="relative min-h-0 flex-1 bg-canvasbg" data-canvas-body="1">
        {/* ★标尺**脱离画布**固定在视口顶部/左侧（不随内容滚动/平移移动，只按滚动量或平移量移动刻度），
            左上角留一个交汇格；画布区域从标尺内侧开始。 */}
        {ui.showRuler && (
          <div
            data-ruler-corner="1"
            className="ruler-bg no-print absolute left-0 top-0 z-30 border-b border-r border-line"
            style={{ width: RULER_H, height: RULER_H }}
          />
        )}
        {ui.showRuler && (
          <div
            data-ruler-box="h"
            className="ruler-bg no-print absolute z-20 overflow-hidden border-b border-line"
            style={{ left: RULER_H, top: 0, right: 0, height: RULER_H }}
          >
            <div
              ref={hTickRef}
              data-ruler-ticks="h"
              style={{ transform: `translateX(${rulerOffset.x}px)`, width: contentW * zoom }}
            >
              <Ruler mode={mode} length={contentW} zoom={zoom} orientation="horizontal" thickness={RULER_H} />
            </div>
          </div>
        )}
        {ui.showRuler && (
          <div
            data-ruler-box="v"
            className="ruler-bg no-print absolute z-20 overflow-hidden border-r border-line"
            style={{ left: 0, top: RULER_H, bottom: 0, width: RULER_H }}
          >
            <div
              ref={vTickRef}
              data-ruler-ticks="v"
              style={{ transform: `translateY(${rulerOffset.y}px)`, height: contentH * zoom }}
            >
              <Ruler
                mode={mode}
                length={contentH}
                /* ★文档模式：逐页分段、每页从 0 读数（用户 2026-09-24 要求） */
                spans={isDoc ? pageSpans : undefined}
                zoom={zoom}
                orientation="vertical"
                thickness={RULER_H}
              />
            </div>
          </div>
        )}

        <div
          id="canvas-viewport"
          ref={viewportRef}
          data-pan={panning ? '1' : panReady ? 'ready' : '0'}
          data-scroll={isDoc ? '1' : '0'}
          className={`absolute ${isDoc ? 'overflow-auto' : 'overflow-hidden'} ${
            !isDoc && panning ? 'cursor-grabbing' : !isDoc && panReady ? 'cursor-grab' : ''
          }`}
          style={{ left: R, top: R, right: 0, bottom: 0 }}
          onScroll={isDoc ? onViewportScroll : undefined}
          onPointerDownCapture={(e) => {
            // 空格/中键 → 平移画布（**仅 Web 模式**）：在捕获阶段接管，别让下面的节点拖拽/框选也响应
            if (!startPan(e)) return;
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onPointerLeave={endPan}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) selectComponent([]);
          }}
          /* 中键默认会触发浏览器自动滚动，这里按掉 */
          onAuxClick={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
        >
          {isDoc ? (
            /* 文档模式：这层就是**滚动内容**（不 translate），宽度按缩放后尺寸撑开滚动范围；
               内容比视口窄时 `margin:0 auto` 让它居中 */
            <div
              data-pan-layer="1"
              className="relative"
              style={{ width: contentW * zoom, height: contentH * zoom, margin: '0 auto' }}
            >
              <div
                ref={ref}
                className="print-reset"
                style={{ width: contentW, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                onDoubleClickCapture={onDoubleClickCapture}
              >
                {canvasBody}
                {/* 双击单元格的就地输入框（挂在缩放层里，跟着纸张一起缩放） */}
                {cellEditor}
              </div>
            </div>
          ) : (
            /* Web 模式：平移层（translate 不夹边界，画布能拖到视口任意位置） */
            <div
              data-pan-layer="1"
              className="absolute left-0 top-0"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, width: contentW, height: contentH }}
            >
              <div
                ref={ref}
                className="print-reset"
                style={{ width: contentW, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                onDoubleClickCapture={onDoubleClickCapture}
              >
                {canvasBody}
                {/* 双击单元格的就地输入框（挂在缩放层里，跟着画布一起缩放/平移） */}
                {cellEditor}
              </div>
            </div>
          )}
        </div>

        {/* 画布缩放控件：固定在右下角，只影响"画布预览" */}
        <div className="zoom-pill no-print absolute bottom-2 right-2 z-30 flex w-max items-center gap-1 rounded-full border px-2 py-1 text-2xs shadow">
          <button
            type="button"
            className="h-6 w-6 rounded hover:bg-gray-100"
            title="缩小（Ctrl+- 或 Ctrl+滚轮）"
            onClick={() => setZoomAtCenter(Math.max(0.1, Math.round((zoom - 0.1) * 100) / 100))}
          >
            −
          </button>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="h-6 w-6 rounded hover:bg-gray-100"
            title="放大（Ctrl+= 或 Ctrl+滚轮）"
            onClick={() => setZoomAtCenter(Math.min(4, Math.round((zoom + 0.1) * 100) / 100))}
          >
            ＋
          </button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-gray-100"
            title="适应宽度"
            onClick={() => {
              const z = fitWidth();
              useEditorStore.getState().setZoom(z);
              const el = viewportRef.current;
              if (isDoc) {
                if (el) el.scrollTo({ left: 0, top: el.scrollTop });
                scrollRef.current = { x: el?.scrollLeft ?? 0, y: el?.scrollTop ?? 0 };
              } else {
                setPan(centerPan(z));
              }
            }}
          >
            适应宽度
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-gray-100"
            title="实际大小并居中"
            onClick={() => {
              useEditorStore.getState().setZoom(1);
              const el = viewportRef.current;
              if (isDoc) {
                if (el) el.scrollTo({ left: 0, top: 0 });
                scrollRef.current = { x: 0, y: 0 };
                if (hTickRef.current) hTickRef.current.style.transform = `translateX(${insetRef.current}px)`;
                if (vTickRef.current) vTickRef.current.style.transform = 'translateY(0px)';
              } else {
                setPan(centerPan(1));
              }
            }}
          >
            100%
          </button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <span
            className="whitespace-nowrap pr-0.5 text-2xs text-gray-400"
            title={
              isDoc
                ? '文档模式：滚轮 / 滚动条翻页，标尺固定在视口边缘（不再拖动画布）'
                : '像 PS 的手抓工具：按住空格拖拽，或按住鼠标中键拖拽；滚轮也可平移'
            }
          >
            {isDoc ? '滚轮/滚动条 翻页' : '空格/中键/滚轮 平移'}
          </span>
        </div>

        {printDebug ? <PrintDebugPanel /> : null}
      </div>
    </div>
  );
}
