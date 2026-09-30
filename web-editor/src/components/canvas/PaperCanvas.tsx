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
  pageLabel,
  pageNumbering,
  type ComponentNode,
  type DocumentPageConfig,
  type PageBandConfig,
  type RenderContext,
} from '../../registry/types';
import { mmToPx } from '../../utils/units';
import { getComponent } from '../../registry';
import { useEditorStore } from '../../store/editorStore';
import { NodeView } from './NodeView';
import { InsertIndicator } from './InsertIndicator';
import { computeNumbering } from '../../registry/numbering';
import { TableOverlay } from './TableOverlay';
import { WidthOverlay } from './WidthOverlay';
import { useTableCellSelect } from './useTableCellSelect';
import type { CanvasInteractionApi } from './useCanvasInteraction';

const RELAYOUT_MS = 120;

/**
 * 一页里的一个**段**：某个顶层节点的一整块，或（表格类）它的某一段数据行。
 * `from/to` 是**数据行**下标（口径与「数据」文本域一致，含表头行）；不写 = 整块。
 */
interface Segment {
  index: number;
  from?: number;
  to?: number;
}

/** 块高度：offsetHeight 不含 margin（"上/下边距"必须计入，否则分页高度偏小 → 内容压到页脚上） */
function blockHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return el.offsetHeight + (Number.parseFloat(cs.marginTop) || 0) + (Number.parseFloat(cs.marginBottom) || 0);
}
/**
 * 离屏测量容器里的**顶层**节点。
 * ★容器的子节点也会带 `data-measure-item`（NodeView 把 measure 透传下去了），
 *   如果一起收进来：① 下标与 `visible` 错位（分页符判断会看错节点）；
 *   ② 父子高度重复计入 → 分页凭空多出空白。必须只取顶层。
 */
function topMeasureItems(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[data-measure-item="1"]')].filter(
    (el) => !el.parentElement?.closest('[data-measure-item="1"]'),
  );
}

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
  /* 图表按章编号（B11）：整篇顺序算一次，塞进 ctx 供组件取用（开关在"视图"菜单里） */
  const autoNumber = useEditorStore((s) => s.ui.autoNumber ?? false);
  const numbering = useMemo(() => (autoNumber ? computeNumbering(nodes).labels : undefined), [autoNumber, nodes]);
  const docCtx = useMemo<RenderContext>(() => (numbering ? { ...ctx, numbering } : ctx), [ctx, numbering]);
  const contentHeight = Math.max(40, h - pad.top - pad.bottom);
  const visible = nodes.filter((n) => !n.hidden);

  /* ── 表格单元格：Excel 式点选 / Shift 扩展 / 拖选一片（捕获阶段，先于 NodeView 的选中处理）── */
  const onCellPointerDownCapture = useTableCellSelect(onSelect);

  /* ── 离屏测量 → 切页 ── */
  const measureRef = useRef<HTMLDivElement>(null);
  const [slices, setSlices] = useState<Segment[][]>([[{ index: 0 }]]);
  const signature = useMemo(() => visible.map((n) => n.id).join('|') + `#${Math.round(contentHeight)}#${Math.round(contentWidth)}`, [visible, contentHeight, contentWidth]);
  const lastSig = useRef('');

  const recompute = () => {
    const host = measureRef.current;
    if (!host) return;
    const items = topMeasureItems(host);
    const pages: Segment[][] = [[]];
    const flush = () => {
      pages.push([]);
      used = 0;
    };
    let used = 0;

    /** 表格续排的测量信息：各 tr 高度 + 表外开销（表题/边框/margin）+ 表头行高 */
    const tableInfo = (el: HTMLElement) => {
      const trs = [...el.querySelectorAll('tr')] as HTMLElement[];
      if (trs.length < 2) return null;
      const rows = trs.map((tr) => tr.offsetHeight);
      const headCount = el.querySelectorAll('thead tr').length;
      const total = blockHeight(el);
      const sum = rows.reduce((n, x) => n + x, 0);
      return { trs, rows, headCount, overhead: Math.max(0, total - sum) };
    };

    /** 段 [from,to) 的高度：续排段要额外算上**重复的表头** */
    const segHeight = (info: ReturnType<typeof tableInfo>, from: number, to: number): number => {
      if (!info) return 0;
      const cont = from > 0 && info.headCount > 0 ? info.rows[0] ?? 0 : 0;
      let h = info.overhead + cont;
      for (let k = from; k < to; k += 1) h += info.rows[k] ?? 0;
      return h;
    };

    /**
     * 合并单元格安全的切点：若某个格子的 rowSpan 跨过 to，就把 to 退到该格所在行之前
     * （否则续排段会缺锚点格，列会错位）。用**渲染好的 DOM** 判断，不依赖表格内部实现。
     */
    const safeCut = (info: NonNullable<ReturnType<typeof tableInfo>>, from: number, to: number): number => {
      let limit = to;
      for (let r = from; r < to; r += 1) {
        const cells = [...(info.trs[r]?.children ?? [])] as HTMLTableCellElement[];
        for (const c of cells) {
          const span = c.rowSpan || 1;
          if (span > 1 && r + span > to) limit = Math.min(limit, r);
        }
      }
      return limit;
    };

    items.forEach((el, i) => {
      const node = visible[i];
      // ★分页符：从这里另起一页（自身标记放在新页顶部，不占高度）
      if (node?.type === 'pageBreak') {
        if (pages[pages.length - 1].length) pages.push([]);
        used = 0;
        pages[pages.length - 1].push({ index: i });
        return;
      }
      const height = blockHeight(el);
      // 放得下（或本页还是空的）→ 整块放上去
      if (!(used > 0 && used + height > contentHeight)) {
        pages[pages.length - 1].push({ index: i });
        used += height;
        return;
      }
      /**
       * ★放不下：能按行续排的表（getComponent().splittable === 'rows'）就**拆开填满本页**，
       *   剩下的行排到下一页（续表重复表头）—— Word/HTML 的表格跨页行为。
       *   这就是"大面积空白"的正解：以前整块推到下一页，本页剩下的空间全空着。
       */
      const info = getComponent(node?.type ?? '')?.splittable === 'rows' ? tableInfo(el) : null;
      if (info) {
        let from = 0;
        while (from < info.rows.length) {
          const room = contentHeight - used;
          const isCont = from > 0 && info.headCount > 0;
          const base = info.overhead + (isCont ? info.rows[0] ?? 0 : 0);
          let to = from;
          let acc = base;
          while (to < info.rows.length && acc + (info.rows[to] ?? 0) <= room + 0.5) {
            acc += info.rows[to] ?? 0;
            to += 1;
          }
          to = safeCut(info, from, to);
          // 本页一行都放不下 → 另起一页（新页上空，除非单行比整页还高）
          if (to <= from) {
            if (used > 0) {
              flush();
              continue;
            }
            to = Math.min(info.rows.length, from + 1);
          }
          pages[pages.length - 1].push({ index: i, from, to });
          used += segHeight(info, from, to);
          from = to;
          // 还有剩下的行 → 排到下一页
          if (from < info.rows.length) flush();
        }
        return;
      }
      flush();
      pages[pages.length - 1].push({ index: i });
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
    topMeasureItems(host).forEach((el) => ro.observe(el));
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
      (b) => !b.parentElement?.closest('[data-node-id]') && !b.hasAttribute('data-node-split'),
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

  const renderFlow = (segments: Segment[], pageIndex: number) => (
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
      {segments.length === 0 && pageIndex === 0 && visible.length === 0 && (
        <p className="pt-16 text-center text-2xs text-gray-300">
          从左侧组件面板拖拽或双击组件，插入到这张纸上
        </p>
      )}
      {segments.map((seg) => {
        const n = visible[seg.index];
        if (!n) return null;
        const cont = seg.from != null && seg.from > 0;
        // 表格续排段：只渲染 [from,to) 这段数据行（续表由表格自己重复表头）
        const segCtx: RenderContext =
          seg.from != null && seg.to != null ? { ...docCtx, tableRowRange: { from: seg.from, to: seg.to } } : docCtx;
        return (
          <NodeView
            key={`${n.id}#${seg.from ?? 0}-${seg.to ?? 0}`}
            node={n}
            ctx={segCtx}
            mode="document"
            selectedIds={selectedIds}
            hoveredId={hoveredId}
            showChrome={showChrome}
            continuation={cont}
            onSelect={onSelect}
            onHover={onHover}
            onNodePointerDown={it.onNodePointerDown}
          />
        );
      })}
    </div>
  );

  /** 页眉/页脚：页面级设置（读页面配置，支持 {page}/{total}/{date} 变量，左/中/右三段）
   *  pageText 是"分节计算后的页码文字"（可能是罗马数字，也可能是空串=该页不显示页码） */
  const band = (cfg: PageBandConfig, place: 'head' | 'foot', pageText: string, total: number) => (
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
      <span style={{ flex: 1, textAlign: 'left' }}>{fillBandTokens(cfg.left, pageText, total)}</span>
      <span style={{ flex: 1, textAlign: 'center' }}>{fillBandTokens(cfg.center, pageText, total)}</span>
      <span style={{ flex: 1, textAlign: 'right' }}>{fillBandTokens(cfg.right, pageText, total)}</span>
    </div>
  );

  /** 三段式页码：物理第 i 页 → 该页应显示的页码文字（空串 = 不显示，如封面） */
  const pageNum = pageNumbering(page);
  const labelOf = (i: number) => pageLabel(i, pageNum);

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
      {/* 页码为空（如封面）时整块页眉/页脚不渲染，等同 Word 的"首页不同"，避免出现"第  页 / 共 N 页" */}
      {page.showHeader && labelOf(pageNo) !== '' && band(pageBand(page, 'header'), 'head', labelOf(pageNo), total)}
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
            ctx={docCtx}
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
            onPointerDownCapture={onCellPointerDownCapture}
          >
            {pageChrome(i, slices.length)}
            {renderFlow(indices, i)}
            {/* 页脚排在内容之后（打印成流时顺序才对，见 pageChrome 里的说明） */}
            {page.showFooter && labelOf(i + 1) !== '' && band(pageBand(page, 'footer'), 'foot', labelOf(i + 1), slices.length)}
            {/* 表格覆盖层：单元格选框 + 列宽拖拽手柄（编辑态，no-print） */}
            <TableOverlay nodeId={showChrome ? (selectedIds[0] ?? null) : null} zoom={zoom} />
            {/* 宽度手柄：文档模式没有 frame，宽度只能改组件属性（mm）（编辑态，no-print） */}
            <WidthOverlay nodeId={showChrome ? (selectedIds[0] ?? null) : null} zoom={zoom} />
          </div>
        ))}

        {indicatorTop != null && (
          <InsertIndicator top={indicatorTop} left={pad.left} width={contentWidth} />
        )}
      </div>

      <div className="no-print py-2 text-center text-2xs text-gray-400">
        纸张 {page.width}×{page.height}mm · {Math.round(w)}×{Math.round(h)}px @96DPI ·{' '}
        {page.orientation === 'portrait' ? '纵向' : '横向'} · 共 {slices.length} 页（拖动块可调整顺序）
        {/* 原来这里还有一行「打印设置：A4、缩放 100%、边距「无/默认」、勾选「背景图形」」——
            那是操作指引不是读数，已移进菜单「文件 → 打印…」的气泡（D16 审计 2026-09-30）。 */}
      </div>
    </div>
  );
}
