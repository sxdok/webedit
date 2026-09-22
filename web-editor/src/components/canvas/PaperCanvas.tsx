/**
 * 职责：文档模式画布——按物理尺寸渲染纸张（mm → px @96DPI）、页边距辅助线、页眉页脚、
 *       文档流组件（NodeView），并做**多页分页预览**（超过版心高的内容自动排到下一张纸）与
 *       拖动排序（插入指示线）+ 面板拖入按落点插入。
 * 分页用"离屏测量"：把全部节点放在一个隐藏容器里量高度，再按版心高切页（不切断单个块）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  fillBandTokens,
  pageBand,
  type ComponentNode,
  type DocumentPageConfig,
  type PageBandConfig,
  type RenderContext,
} from '../../registry/types';
import { mmToPx } from '../../utils/units';
import { useEditorStore } from '../../store/editorStore';
import { NodeView } from './NodeView';
import { InsertIndicator } from './InsertIndicator';
import type { CanvasInteractionApi } from './useCanvasInteraction';

const RELAYOUT_MS = 120;

export function PaperCanvas({
  nodes,
  ctx,
  page,
  showGuides,
  zoom,
  selectedIds,
  hoveredId,
  showChrome,
  onSelect,
  onHover,
  onPointerMove,
  canvasRef,
  it,
}: {
  nodes: ComponentNode[];
  ctx: RenderContext;
  page: DocumentPageConfig;
  showGuides: boolean;
  zoom: number;
  selectedIds: string[];
  hoveredId: string | null;
  showChrome: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onHover: (id: string | null) => void;
  onPointerMove: (x: number, y: number) => void;
  canvasRef: React.RefObject<HTMLDivElement>;
  it: CanvasInteractionApi;
}) {
  const w = mmToPx(page.width);
  // ★-1px：mm→px 换算（96DPI）会比物理页高多出不到 1px，打印时会挤出一张近乎空白的页
  //   （实测：A4 纸张 1123.2px vs 物理页 1122.5px）→ 取整减 1 后正好落在页内。
  const h = Math.max(40, Math.floor(mmToPx(page.height)) - 1);
  const pad = useMemo(
    () => ({
      top: mmToPx(page.margin.top),
      right: mmToPx(page.margin.right),
      bottom: mmToPx(page.margin.bottom),
      left: mmToPx(page.margin.left),
    }),
    [page.margin],
  );
  const contentWidth = Math.max(40, w - pad.left - pad.right);
  const contentHeight = Math.max(40, h - pad.top - pad.bottom);
  const visible = nodes.filter((n) => !n.hidden);

  /* ── 离屏测量 → 切页 ── */
  const measureRef = useRef<HTMLDivElement>(null);
  const [slices, setSlices] = useState<number[][]>([[0]]);
  const signature = useMemo(() => visible.map((n) => n.id).join('|') + `#${Math.round(contentHeight)}#${Math.round(contentWidth)}`, [visible, contentHeight, contentWidth]);
  const lastSig = useRef('');

  const recompute = () => {
    const host = measureRef.current;
    if (!host) return;
    const items = [...host.querySelectorAll<HTMLElement>('[data-measure-item="1"]')];
    const pages: number[][] = [[]];
    let used = 0;
    items.forEach((el, i) => {
      // ★分页符：从这里另起一页（自身标记放在新页顶部，不占高度）
      if (visible[i]?.type === 'pageBreak') {
        if (pages[pages.length - 1].length) pages.push([]);
        used = 0;
        pages[pages.length - 1].push(i);
        return;
      }
      // ★offsetHeight 不含 margin：刚加的"上/下边距"必须计入，否则分页高度偏小 → 内容压到页脚上
      const cs = getComputedStyle(el);
      const mt = Number.parseFloat(cs.marginTop) || 0;
      const mb = Number.parseFloat(cs.marginBottom) || 0;
      const height = el.offsetHeight + mt + mb;
      if (used > 0 && used + height > contentHeight) {
        pages.push([]);
        used = 0;
      }
      pages[pages.length - 1].push(i);
      used += height;
    });
    // 结果不变就不更新，避免 ResizeObserver 触发循环
    setSlices((prev) => (JSON.stringify(prev) === JSON.stringify(pages) ? prev : pages));
  };

  useLayoutEffect(() => {
    if (lastSig.current === signature) return;
    lastSig.current = signature;
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // 内容编辑后（属性变化）延迟重排一次，避免每次输入都重排
  useEffect(() => {
    const t = window.setTimeout(() => {
      lastSig.current = '';
      recompute();
    }, RELAYOUT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // ★尺寸变化后必须重测：图片是异步加载的（加载前测得矮、加载后变高），
  //   字体/换行也会改变高度；测量失真就会把内容压到页脚上（用户反馈过）。
  useEffect(() => {
    const host = measureRef.current;
    if (!host) return;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        lastSig.current = '';
        recompute();
      }, 60);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    [...host.querySelectorAll<HTMLElement>('[data-measure-item="1"]')].forEach((el) => ro.observe(el));
    const imgs = [...host.querySelectorAll('img')];
    imgs.forEach((im) => im.addEventListener('load', schedule));
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
      imgs.forEach((im) => im.removeEventListener('load', schedule));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, contentHeight, contentWidth]);

  // 把当前页数回写到 store（页面属性面板显示"当前 N 页"用）
  useEffect(() => {
    useEditorStore.getState().setDocPageCount(slices.length);
  }, [slices]);

  /* ── 拖动排序的指示线位置 ── */
  const [indicatorTop, setIndicatorTop] = useState<number | null>(null);
  useEffect(() => {
    const host = canvasRef.current;
    if (!host || it.dropIndex == null) {
      setIndicatorTop(null);
      return;
    }
    const blocks = [...host.querySelectorAll<HTMLElement>('[data-node-id]')].filter(
      (b) => !b.parentElement?.closest('[data-node-id]'),
    );
    const hostTop = host.getBoundingClientRect().top;
    if (!blocks.length) {
      setIndicatorTop(8);
      return;
    }
    const idx = Math.min(it.dropIndex, blocks.length);
    const el = blocks[idx] as HTMLElement | undefined;
    const top = el
      ? el.getBoundingClientRect().top - hostTop
      : (blocks[blocks.length - 1] as HTMLElement).getBoundingClientRect().bottom - hostTop;
    setIndicatorTop(top / zoom);
  }, [it.dropIndex, canvasRef, zoom, nodes]);

  const renderFlow = (indices: number[], pageIndex: number) => (
    <div
      className="page-flow absolute"
      style={{
        left: pad.left,
        top: pad.top,
        width: contentWidth,
        height: contentHeight,
        fontFamily: page.defaultFont,
        fontSize: `${page.defaultFontSize}pt`,
        lineHeight: page.lineHeight,
        color: '#000',
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect('', false);
      }}
      onMouseMove={(e) => {
        if (pageIndex !== 0) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPointerMove(
          Math.round(((e.clientX - r.left) / zoom / mmToPx(1)) * 10) / 10,
          Math.round(((e.clientY - r.top) / zoom / mmToPx(1)) * 10) / 10,
        );
      }}
    >
      {indices.length === 0 && pageIndex === 0 && visible.length === 0 && (
        <p className="pt-16 text-center text-2xs text-gray-300">
          从左侧组件面板拖拽或双击组件，插入到这张纸上
        </p>
      )}
      {indices.map((i) => {
        const n = visible[i];
        if (!n) return null;
        return (
          <NodeView
            key={n.id}
            node={n}
            ctx={ctx}
            mode="document"
            selectedIds={selectedIds}
            hoveredId={hoveredId}
            showChrome={showChrome}
            onSelect={onSelect}
            onHover={onHover}
            onNodePointerDown={(e) => it.onNodePointerDown(e, n.id)}
          />
        );
      })}
    </div>
  );

  /** 页眉/页脚：页面级设置（读页面配置，支持 {page}/{total}/{date} 变量，左/中/右三段） */
  const band = (cfg: PageBandConfig, place: 'head' | 'foot', pageNo: number, total: number) => (
    <div
      className={`page-${place} absolute ${
        cfg.showBorder ? (place === 'head' ? 'border-b border-gray-300' : 'border-t border-dashed border-gray-300') : ''
      } ${place === 'head' ? 'pb-1' : 'pt-1'}`}
      style={{
        left: pad.left,
        right: pad.right,
        // 位置可调：页眉距上边缘 / 页脚距下边缘（页面属性里的 offset，mm）
        ...(place === 'head' ? { top: mmToPx(cfg.offset) } : { bottom: mmToPx(cfg.offset) }),
        color: cfg.color,
        fontSize: `${cfg.fontSize}pt`,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <span style={{ flex: 1, textAlign: 'left' }}>{fillBandTokens(cfg.left, pageNo, total)}</span>
      <span style={{ flex: 1, textAlign: 'center' }}>{fillBandTokens(cfg.center, pageNo, total)}</span>
      <span style={{ flex: 1, textAlign: 'right' }}>{fillBandTokens(cfg.right, pageNo, total)}</span>
    </div>
  );

  const pageChrome = (pageNo: number, total: number) => (
    <>
      {showGuides && (
        <>
          <div
            className="no-print pointer-events-none absolute border border-dashed border-primary/30"
            style={{ left: pad.left, top: pad.top, width: contentWidth, height: contentHeight }}
          />
          <div className="no-print pointer-events-none absolute border-t border-dashed border-primary/20" style={{ left: 0, top: pad.top, width: w }} />
          <div className="no-print pointer-events-none absolute border-t border-dashed border-primary/20" style={{ left: 0, top: h - pad.bottom, width: w }} />
        </>
      )}
      {page.showHeader && band(pageBand(page, 'header'), 'head', pageNo, total)}
      {/* ★页脚必须排在"内容"之后：屏幕上它是绝对定位看不出差别，
          但打印时会被退化成普通流，写在内容前就会印到标题上面（用户反馈过）。 */}
    </>
  );

  return (
    <div className="canvas-stack flex flex-col">
      {/* 离屏测量容器：渲染全部节点量高度（不可交互、不占位） */}
      <div
        ref={measureRef}
        data-measure="1"
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: -99999,
          top: 0,
          width: contentWidth,
          visibility: 'hidden',
          fontFamily: page.defaultFont,
          fontSize: `${page.defaultFontSize}pt`,
          lineHeight: page.lineHeight,
          color: '#000',
        }}
      >
        {visible.map((n) => (
          <NodeView
            key={`m-${n.id}`}
            node={n}
            ctx={ctx}
            mode="document"
            selectedIds={[]}
            hoveredId={null}
            showChrome={false}
            onSelect={() => {}}
            onHover={() => {}}
            measure
          />
        ))}
      </div>

      <div ref={canvasRef} className="relative" onDragOver={it.onDragOver} onDrop={it.onDrop}>
        {slices.map((indices, i) => (
          <div
            key={i}
            data-paper="1"
            data-last={i === slices.length - 1 ? '1' : undefined}
            data-page={i + 1}
            onPointerDown={(e) => {
              // ★点纸张任意空白处（内容区、页边距区、页眉页脚区）都取消选中 → 属性面板回到"页面属性"
              if (!(e.target as HTMLElement).closest('[data-node-id]')) onSelect('', false);
            }}
            className="paper-shadow relative mb-4 shrink-0"
            style={{ width: w, height: h, background: page.background }}
          >
            {pageChrome(i, slices.length)}
            {renderFlow(indices, i)}
            {/* 页脚排在内容之后（打印成流时顺序才对，见 pageChrome 里的说明） */}
            {page.showFooter && band(pageBand(page, 'footer'), 'foot', i + 1, slices.length)}
          </div>
        ))}

        {indicatorTop != null && (
          <InsertIndicator top={indicatorTop} left={pad.left} width={contentWidth} />
        )}
      </div>

      <div className="no-print py-2 text-center text-2xs text-gray-400">
        纸张 {page.width}×{page.height}mm · {Math.round(w)}×{Math.round(h)}px @96DPI ·{' '}
        {page.orientation === 'portrait' ? '纵向' : '横向'} · 共 {slices.length} 页（拖动块可调整顺序）
        <br />
        打印设置：A4、缩放 100%、边距「无/默认」、勾选「背景图形」
      </div>
    </div>
  );
}
