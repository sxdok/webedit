/**
 * 职责：画布区分派——按当前模式渲染 PaperCanvas / WebCanvas；承载缩放外壳（transform scale +
 *       高度同步修正，避免缩小时留白）、标尺开关、以及阶段三交互钩子（拖动/缩放/旋转/吸附/框选/插入位置）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RenderContext } from '../../registry/types';
import { selectForest, selectMode, useEditorStore } from '../../store/editorStore';
import { mmToPx, ptToPx } from '../../utils/units';
import { PaperCanvas } from './PaperCanvas';
import { Ruler } from './Ruler';

/** 标尺条的基准高度（布局高度按 zoom 缩放，保证与缩放后的内容对齐） */
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

  const { ref, outerW, outerH } = useScaledBox(zoom, [
    mode,
    page,
    canvas,
    nodes.length,
    ui.showRuler,
    JSON.stringify(selectedIds),
  ]);
  const viewportRef = useRef<HTMLDivElement>(null);

  /** 适应宽度（只算画布预览的缩放，不动编辑器界面） */
  const fitWidth = () => {
    const el = viewportRef.current;
    const contentW = mode === 'document' ? mmToPx(page.width) : canvas.width;
    const avail = (el?.clientWidth ?? contentW) - 48;
    return Math.max(0.1, Math.min(4, Math.floor((avail / contentW) * 100) / 100));
  };

  // 切换模式时重置为 100%（用户要求默认 100%；需要铺满可用宽度时点「适应宽度」）
  useEffect(() => {
    useEditorStore.getState().setZoom(1);
  }, [mode]);

  // ★Ctrl/Cmd + 滚轮：只缩放"画布预览"，并阻止浏览器整页缩放
  //   （浏览器自带缩放会把菜单栏/面板一起放大，用户反馈过；这里 preventDefault 接管该手势）
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // 普通滚轮仍用于滚动
      e.preventDefault();
      const st = useEditorStore.getState();
      const next = st.zoom + (e.deltaY > 0 ? -0.08 : 0.08);
      st.setZoom(Math.max(0.1, Math.min(4, Math.round(next * 100) / 100)));
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
  return (
    <div
      id="canvas-viewport"
      ref={viewportRef}
      className="thin-scroll relative flex-1 overflow-auto bg-canvasbg px-6 pb-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) selectComponent([]);
      }}
    >
      <div className="mx-auto" style={{ width: outerW || undefined, height: outerH || undefined }}>
        {/* ★标尺必须放在缩放层**外面**：sticky 在有 transform 祖先的容器里不生效（会跟着内容一起滚）。
            这里让标尺自己带 scale，既贴顶又与缩放后的纸张对齐。 */}
        {ui.showRuler && (
          <div className="no-print sticky top-0 z-20" style={{ height: RULER_H * zoom }}>
            <div
              style={{
                width: mode === 'document' ? mmToPx(page.width) : canvas.width,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              <Ruler
                mode={mode}
                length={mode === 'document' ? mmToPx(page.width) : canvas.width}
                zoom={zoom}
                orientation="horizontal"
              />
            </div>
          </div>
        )}
        <div
          ref={ref}
          className="print-reset"
          style={{
            width: mode === 'document' ? mmToPx(page.width) : canvas.width,
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
          }}
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
      {/* 画布缩放控件：只影响"画布预览"，不像浏览器缩放那样把整个编辑器界面一起放大 */}
      <div className="zoom-pill no-print sticky bottom-2 z-30 ml-auto mr-2 flex w-max items-center gap-1 rounded-full border px-2 py-1 text-2xs shadow">
        <button
          type="button"
          className="h-6 w-6 rounded hover:bg-gray-100"
          title="缩小（Ctrl+- 或 Ctrl+滚轮）"
          onClick={() => useEditorStore.getState().setZoom(Math.max(0.1, Math.round((zoom - 0.1) * 100) / 100))}
        >
          −
        </button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="h-6 w-6 rounded hover:bg-gray-100"
          title="放大（Ctrl+= 或 Ctrl+滚轮）"
          onClick={() => useEditorStore.getState().setZoom(Math.min(4, Math.round((zoom + 0.1) * 100) / 100))}
        >
          ＋
        </button>
        <span className="mx-0.5 h-4 w-px bg-line" />
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-gray-100"
          title="适应宽度"
          onClick={() => useEditorStore.getState().setZoom(fitWidth())}
        >
          适应宽度
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-gray-100"
          title="实际大小"
          onClick={() => useEditorStore.getState().setZoom(1)}
        >
          100%
        </button>
      </div>

      {printDebug ? <PrintDebugPanel /> : null}
    </div>
  );
}
