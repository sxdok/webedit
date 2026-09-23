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

/** 量出内容真实高度（未缩放），把外壳高度同步缩小后的大小 */
function useScaledBox(zoom: number, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, outerW: size.w * zoom, outerH: size.h * zoom };
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

  const { ref } = useScaledBox(zoom, [
    mode,
    page,
    canvas,
    nodes.length,
    ui.showRuler,
    JSON.stringify(selectedIds),
  ]);
  const viewportRef = useRef<HTMLDivElement>(null);
  /** 平移画布（PS 式手抓工具）：按住空格 + 拖拽，或中键拖拽；偏移存 store.ui.pan，**不夹边界** */
  const pan = useEditorStore((s) => s.ui.pan) ?? { x: 0, y: 0 };
  const setPan = useEditorStore((s) => s.setPan);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
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
  }, []);

  /** 平移起手：只有"空格按住"或"中键"才接管（否则交给节点拖拽/框选） */
  const startPan = (e: React.PointerEvent): boolean => {
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

  // 切换模式 / 换页时：缩放回 100%，并把画布重新摆到视口中间
  useEffect(() => {
    useEditorStore.getState().setZoom(1);
    setPan(centerPan(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activePageId]);

  // ★Ctrl/Cmd + 滚轮：缩放"画布预览"（以指针为锚点，像 PS），并阻止浏览器整页缩放
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = useEditorStore.getState();
      if (!e.ctrlKey && !e.metaKey) {
        // 普通滚轮 → 平移画布（自由，不夹边界）
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
      const cur = st.ui.pan ?? { x: 0, y: 0 };
      const cx = (px - cur.x) / st.zoom;
      const cy = (py - cur.y) / st.zoom;
      st.setZoom(next);
      st.setPan({ x: Math.round(px - cx * next), y: Math.round(py - cy * next) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onSelect = (id: string, additive: boolean) => {
    if (!id) {
      selectComponent([]);
      return;
    }
    if (additive) toggleSelect(id);
    else selectComponent([id]);
  };

  const printDebug = new URLSearchParams(location.search).get('printdebug');
  const contentW = mode === 'document' ? mmToPx(page.width) : canvas.width;
  const contentH = mode === 'document' ? mmToPx(page.height) : canvas.height;
  const R = ui.showRuler ? RULER_H : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── 画布上方的分页（每页一份独立文档，各自可选模式）── */}
      <PageTabs />

      <div className="relative min-h-0 flex-1 bg-canvasbg" data-canvas-body="1">
        {/* ★标尺**脱离画布**固定在视口顶部/左侧（不随画布平移移动，只按平移量移动刻度），
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
            <div style={{ transform: `translateX(${pan.x}px)`, width: contentW * zoom }}>
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
            <div style={{ transform: `translateY(${pan.y}px)`, height: contentH * zoom }}>
              <Ruler mode={mode} length={contentH} zoom={zoom} orientation="vertical" thickness={RULER_H} />
            </div>
          </div>
        )}

        <div
          id="canvas-viewport"
          ref={viewportRef}
          data-pan={panning ? '1' : panReady ? 'ready' : '0'}
          className={`absolute overflow-hidden ${panning ? 'cursor-grabbing' : panReady ? 'cursor-grab' : ''}`}
          style={{ left: R, top: R, right: 0, bottom: 0 }}
          onPointerDownCapture={(e) => {
            // 空格/中键 → 平移画布：在捕获阶段接管，别让下面的节点拖拽/框选也响应
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
          {/* 平移层：translate 不夹边界（纸张能拖到视口任意位置） */}
          <div
            data-pan-layer="1"
            className="absolute left-0 top-0"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, width: contentW, height: contentH }}
          >
            <div
              ref={ref}
              className="print-reset"
              style={{ width: contentW, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            >
              {mode === 'document' ? (
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
              )}
            </div>
          </div>
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
              setPan(centerPan(z));
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
              setPan(centerPan(1));
            }}
          >
            100%
          </button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <span className="whitespace-nowrap pr-0.5 text-2xs text-gray-400" title="像 PS 的手抓工具：按住空格拖拽，或按住鼠标中键拖拽；滚轮也可平移">
            空格/中键/滚轮 平移
          </span>
        </div>

        {printDebug ? <PrintDebugPanel /> : null}
      </div>
    </div>
  );
}
