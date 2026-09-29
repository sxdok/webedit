/**
 * 表格渲染内核（tableKit）—— 被「表格」与三个预设（两列参数表 / 明细表 / 核对表）共用。
 * 抽出来的原因：A4 编辑器的 4 个表格组件（table / t3 / cap2 / tl / tk）在那边是 4 份重复实现，
 * 这里只保留一份渲染逻辑，靠 variant 切换线条风格、靠预设提供首发数据。
 *
 * variant：
 *   normal    全框线表格（默认，边框合并 + 表头浅底 + 斑马纹）
 *   threeLine 三线表：只有顶线、表头线、底线（学术/技术文档常用）
 *   hLines    横线表：只有行间横线，没有竖线
 */
import type { ComponentProps, PropSchemaItem, RenderContext, SelectOption } from '../../types';
import { GROUP } from '../shared';
import { asBool, asNumber, asString } from '../../../utils/id';

/**
 * ★P1④「表格内核同源」：数据模型的**纯函数**已搬到 `tableKit.pure.ts`（唯一手写来源）。
 * `export *` 让既有 `import { parseTableData } from '.../tableKit'` 照旧可用；
 * **但必须同时显式 import** —— `export * from` 只做再导出，**不会**在本模块建立本地绑定，
 * 少了这行下面所有本地调用都会报 "Cannot find name"（我第一版就是这么踩的）。
 * MCP 侧 `editor-mcp/src/engine/tableKit.ts` 由 `tools/sync-contracts.mjs` **原样复制**同一份文件生成
 * （机械护栏 `--check`，语义护栏是 65 例一致性测试）。本文件只留**编辑器专属**部分：
 * React 渲染、线条/表头样式、行高列宽的展示解析、排序与选区助手等。
 */
export * from './tableKit.pure';
/* 只 import **本文件真正用到**的那几个 —— `export *` 已保证对外可见性，
   多导入反而触发 noUnusedLocals（TS6133），所以收窄到实际使用面。 */
import {
  cellStyleKeyAt,
  parseA1,
  parseCellStyles,
  parseColWidths,
  parseTableData,
  serializeTableData,
} from './tableKit.pure';

export type TableVariant = 'normal' | 'threeLine' | 'hLines';

export const TABLE_VARIANT_OPTIONS: SelectOption[] = [
  { label: '全框线（普通表格）', value: 'normal' },
  { label: '三线表', value: 'threeLine' },
  { label: '横线表（无竖线）', value: 'hLines' },
];

/**
 * 行高：**纯数字按毫米**（"9" → 9mm），其余原样；写到每个单元格的 height 上（表头 + 数据行一起）。
 * 与 A4 编辑器 setRowHeight 同一套语义。留空 = 不设行高（由内容撑开）。
 */
export function parseRowHeight(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  return /^\d+(\.\d+)?$/.test(v) ? `${v}mm` : v;
}

/**
 * **按行行高**：`props.rowHeights = { "2": "12", "4": "9.5" }` —— 键是 **1 基行号**（与 A1 记法同一口径，
 * 含表头行时第 1 行就是表头），值同 `rowHeight`（纯数字按 mm）。
 *
 * 为什么要按行：`rowHeight` 是"整表默认"，但拖某一条行边界时用户期望**只改那一行**
 * （2026-09-23 用户反馈："拖哪一条都整表一起变" → 改为按行覆盖，未覆盖的行仍用整表默认）。
 */
export function parseRowHeights(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const row = Number(k);
    const css = parseRowHeight(v);
    if (Number.isFinite(row) && row >= 1 && css) out[row] = css;
  }
  return out;
}


/**
 * 任意形态的表格数据（二维数组 / 文本）→ **规范文本**。
 * ★组件默认属性里早期写的是二维数组，而属性面板的「数据」是文本域：
 *   数组进去会被 `String()` 成 "a,b,c,d" 这种逗号串（等于"表格数据不显示"）。
 *   统一在入口处转成文本，面板、导出、MCP 三条路看到的就是同一份内容。
 */
export function toTableText(raw: unknown): string {
  return typeof raw === 'string' ? raw : serializeTableData(parseTableData(raw));
}


export function renderTable(props: ComponentProps, ctx: RenderContext, forceVariant?: TableVariant): React.ReactNode {
  const rawRows = parseTableData(props.data);
  const variant = forceVariant ?? (asString(props.variant, 'normal') as TableVariant);
  const headerRow = asBool(props.headerRow, true);
  /* ★按列排序（B12）：`sortBy` ≥ 0 时在**渲染期**排序（不动 props.data），
     单元格格式按行置换搬过去；表头行（首行为表头）不参与排序。 */
  const sortBy = Math.round(asNumber(props.sortBy, -1));
  const sorted =
    sortBy >= 0
      ? sortRows(rawRows, { by: sortBy, dir: asString(props.sortDir, 'asc') === 'desc' ? 'desc' : 'asc', keepHeader: headerRow })
      : null;
  const rows = sorted ? sorted.rows : rawRows;
  /* ★冻结首行（B12）：Web 模式下把表头做成 sticky，并给一层可滚动的高度上限 */
  const stickyHeader = asBool(props.stickyHeader, false) && ctx.mode === 'web';
  /* ★首列为表头（用户 2026-09-23 要求新增）：第一列作为"行标题"，渲染成 <th scope="row">、
     加粗并按全框线的表头底色上色；默认 **false**（默认仍是首行为表头，行为不变）。 */
  const headerCol = asBool(props.headerCol, false);
  const bw = asNumber(props.borderWidth, 1);
  const bc = asString(props.borderColor, '#c9d6e2');
  const pad = asNumber(props.cellPadding, 6);
  const fontSize = asNumber(props.fontSize, 10.5);
  const align = asString(props.cellAlign, 'left') as React.CSSProperties['textAlign'];
  const head = rows[0];
  /* ★跨页续排（ctx.tableRowRange）：只渲染 [from, to) 这段数据行；
     from > 0 的续排段**重复表头**、**不重复表题**（与 Word 表格跨页一致）。 */
  const range = ctx.tableRowRange;
  const from = range ? Math.max(0, Math.min(range.from, rows.length)) : 0;
  const to = range ? Math.max(from, Math.min(range.to, rows.length)) : rows.length;
  const showHead = !!head && headerRow && (from === 0 || !!range);
  const showCaption = !range || from === 0;
  // 正文行：含表头时第 0 行是表头，正文从第 1 行开始
  const bodyFrom = headerRow ? Math.max(from, 1) : from;
  const bodyRows = rows.slice(bodyFrom, to).map((r, i) => ({ r, rowIndex: bodyFrom + i }));
  // 列宽 / 行高（对齐 A4 编辑器的表格属性）+ 单元格级格式（Excel 式覆盖）
  const colWidths = parseColWidths(props.colWidths);
  const rowH = parseRowHeight(props.rowHeight);
  /** 按行行高（拖某一条行边界只改那一行；未覆盖的行用上面的整表默认 rowHeight） */
  const rowHeights = parseRowHeights(props.rowHeights);
  let styles = parseCellStyles(props.cellStyles);
  // 兼容旧数据：早期只有"按格填背景"（cellFills），读进来当背景覆盖
  const legacyFills = (props.cellFills && typeof props.cellFills === 'object' ? props.cellFills : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(legacyFills)) {
    const c = String(v ?? '').trim();
    if (/^\d+,\d+$/.test(k) && c && !styles[k]?.background) styles[k] = { ...(styles[k] ?? {}), background: c };
  }
  // 排版顺序下，单元格格式的 A1 键要跟着行置换走（否则颜色会留在原来的行号上）
  if (sorted) styles = remapCellStylesByOrder(styles, sorted.order).styles;
  const maxCols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const colCount = Math.max(1, maxCols, colWidths.length);

  const cell: React.CSSProperties = {
    padding: pad,
    textAlign: align,
    verticalAlign: 'middle',
    // ★像 HTML/Word 的单元格那样：内容**在格内换行填满**，长词/长串也换行，
    //   而不是把列撑宽（用户反馈"内容填充观感不符合直觉"）
    overflowWrap: 'break-word',
    // 格内换行：data 里写 `\n` 解析成真换行符，这里按 pre-line 渲染成多行（HTML 里就是 <br>）
    whiteSpace: 'pre-line',
    height: rowH ?? undefined,
  };
  if (variant === 'normal') {
    cell.border = bw ? `${bw}px solid ${bc}` : 'none';
  } else if (variant === 'hLines') {
    cell.borderBottom = bw ? `${bw}px solid ${bc}` : 'none';
  }

  const tableStyle: React.CSSProperties = {
    width: `${asNumber(props.width, 100)}%`,
    borderCollapse: 'collapse',
    /**
     * ★列宽策略（对齐"HTML/Word 表格"的直觉）：
     *   · **填了「列宽」** → `table-layout: fixed`：严格按给定比例分列，内容在格内换行填满；
     *   · **没填列宽** → `auto`：由内容自适应（像 HTML/Word 默认），长文本列自然更宽，
     *     再配合 `overflow-wrap: break-word` 保证长串换行、不会把表格顶出版心。
     */
    tableLayout: colWidths.length ? 'fixed' : 'auto',
    fontSize: ctx.mode === 'document' ? ctx.ptToPx(fontSize) : fontSize,
    lineHeight: 1.4,
  };
  if (variant === 'threeLine') {
    tableStyle.borderTop = `2px solid ${asString(props.headerColor, '#1f2329')}`;
    tableStyle.borderBottom = `2px solid ${asString(props.headerColor, '#1f2329')}`;
  }

  const headCell: React.CSSProperties = {
    ...cell,
    fontWeight: 600,
    background: variant === 'normal' ? asString(props.headerBackground, '#e8f1f9') : undefined,
  };
  if (variant === 'threeLine') headCell.borderBottom = `1px solid ${asString(props.headerColor, '#1f2329')}`;
  if (variant === 'hLines') headCell.borderBottom = `1.5px solid ${bc}`;
  // 冻结首行（B12，仅 Web 模式）：表头格 sticky，滚出可视区也钉在顶部
  if (stickyHeader) {
    headCell.position = 'sticky';
    headCell.top = 0;
    headCell.zIndex = 2;
  }

  /** 行标题格（首列为表头）：只加粗 + 底色，**不继承**表头行的线条覆盖（三线表/横线表不会多出横线） */
  const rowHeadCell: React.CSSProperties = {
    ...cell,
    fontWeight: 600,
    background: variant === 'normal' ? asString(props.headerBackground, '#e8f1f9') : undefined,
  };

  /* ── 合并区：范围键（如 "B2:C3"）即合并；被覆盖的非锚点格子不渲染，锚点带 colSpan/rowSpan ── */
  const spans = new Map<string, { rs: number; cs: number }>();
  const covered = new Set<string>();
  for (const [key, st] of Object.entries(styles)) {
    const p = parseA1(key);
    if (!p) continue;
    if (p.r1 > p.r0 || p.c1 > p.c0) {
      spans.set(`${p.r0},${p.c0}`, { rs: p.r1 - p.r0 + 1, cs: p.c1 - p.c0 + 1 });
      for (let r = p.r0; r <= p.r1; r += 1) {
        for (let c = p.c0; c <= p.c1; c += 1) {
          if (r !== p.r0 || c !== p.c0) covered.add(`${r},${c}`);
        }
      }
      void st;
    }
  }

  /** 单元格级覆盖：以表格级样式为底，再叠加该格的 CellStyle（Excel 的"单元格覆盖默认"） */
  const styleFor = (r: number, c: number, base: React.CSSProperties): React.CSSProperties => {
    // ① 按行行高优先（拖行边界改的就是它；键是 1 基行号）
    const perRow = rowHeights[r + 1];
    const key = cellStyleKeyAt(styles, r, c);
    const st = key ? styles[key] : undefined;
    if (!st) return perRow ? { ...base, height: perRow } : base;
    const out: React.CSSProperties = perRow ? { ...base, height: perRow } : { ...base };
    if (st.background) out.background = st.background;
    if (st.color) out.color = st.color;
    if (st.fontSize) out.fontSize = ctx.mode === 'document' ? ctx.ptToPx(st.fontSize) : st.fontSize;
    if (st.fontWeight) out.fontWeight = st.fontWeight;
    else if (st.bold) out.fontWeight = 700;
    if (st.align) out.textAlign = st.align;
    if (st.valign) out.verticalAlign = st.valign;
    if (typeof st.padding === 'number') out.padding = st.padding;
    if (st.border) {
      const bc = st.border.color ?? bc0;
      if (st.border.top) out.borderTop = `${st.border.top}px solid ${bc}`;
      if (st.border.right) out.borderRight = `${st.border.right}px solid ${bc}`;
      if (st.border.bottom) out.borderBottom = `${st.border.bottom}px solid ${bc}`;
      if (st.border.left) out.borderLeft = `${st.border.left}px solid ${bc}`;
    }
    return out;
  };

  const bc0 = bc;
  const stripe = asBool(props.stripe, true) && variant === 'normal';
  const caption = asString(props.caption);
  // 图表按章编号（B11）：表题前带「表 X-Y」；用户没写表题时也补一行编号
  const autoLabel = asString(ctx.autoLabel);
  const captionText = [autoLabel, caption].filter(Boolean).join('  ');
  const captionAlign = asString(props.captionAlign, 'left') as React.CSSProperties['textAlign'];

  const table = (
    <table style={tableStyle}>
      {/* 表题：由**表格自己**承载（与图片的图题同一做法），不再需要单独的"题注"组件。
          跨页续排时只在**首段**显示，续排段不重复表题。 */}
      {captionText && showCaption && (
        <caption
          data-table-caption="1"
          data-auto-label={autoLabel || undefined}
          style={{
            captionSide: 'top',
            textAlign: captionAlign,
            fontWeight: 600,
            fontSize: ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.captionSize, fontSize)) : asNumber(props.captionSize, fontSize),
            paddingBottom: 4,
          }}
        >
          {captionText}
        </caption>
      )}
      {/* 列宽写进 colgroup，与 A4 编辑器一致（未给出的列保持自动宽度） */}
      <colgroup>
        {Array.from({ length: colCount }, (_, i) => (
          <col key={i} style={colWidths[i] ? { width: colWidths[i] } : undefined} />
        ))}
      </colgroup>
      {showHead && head && (
        <thead>
          <tr>
            {head.map((c, i) => {
              const k = `0,${i}`;
              if (covered.has(k)) return null; // 被合并覆盖
              const sp = spans.get(k);
              return (
                <th
                  key={i}
                  data-cell={k}
                  data-cell-row={0}
                  data-cell-col={i}
                  colSpan={sp?.cs}
                  rowSpan={sp?.rs}
                  style={styleFor(0, i, headCell)}
                >
                  {c}
                </th>
              );
            })}
          </tr>
        </thead>
      )}
      <tbody>
        {bodyRows.map(({ r, rowIndex }) => {
          // 行号口径：含表头时第 0 行 = 表头，所以数据行从 1 开始 —— 与"数据"文本域的行一一对应
          // 续排段的斑马纹按**全局行号**取，接上上一页的条纹，不会错位
          const bodyIdx = rowIndex - (headerRow ? 1 : 0);
          return (
            <tr key={rowIndex} style={{ background: stripe && bodyIdx % 2 ? '#fafcfe' : undefined }}>
              {r.map((c, ci) => {
                const k = `${rowIndex},${ci}`;
                if (covered.has(k)) return null; // 被合并覆盖 → 不渲染
                const sp = spans.get(k);
                const isHeadCol = headerCol && ci === 0;
                const Cell = isHeadCol ? 'th' : 'td';
                return (
                  <Cell
                    key={ci}
                    data-cell={k}
                    data-cell-row={rowIndex}
                    data-cell-col={ci}
                    {...(isHeadCol ? { scope: 'row' as const } : {})}
                    colSpan={sp?.cs}
                    rowSpan={sp?.rs}
                    style={styleFor(rowIndex, ci, isHeadCol ? rowHeadCell : cell)}
                  >
                    {c}
                  </Cell>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  /* 冻结首行（B12，仅 Web 模式）：给一层**可纵向滚动**的外壳，
     表头（position: sticky）才会真的钉住；高度超过 `stickyHeight` 才出现滚动条。
     文档模式不加这层（纸张要打印，滚动没有意义）。 */
  if (stickyHeader) {
    return (
      <div
        data-sticky-wrap="1"
        style={{ maxHeight: asNumber(props.stickyHeight, 360), overflowY: 'auto', width: `${asNumber(props.width, 100)}%` }}
      >
        {table}
      </div>
    );
  }
  return table;
}

/**
 * 读取一块矩形区域（0 基，含端点）→ 二维数组；越界取空串。
 * 单元格复制/粘贴用它（`Ctrl+C` / `Ctrl+V`）。
 */
export function readCellBlock(rows: string[][], r0: number, c0: number, r1: number, c1: number): string[][] {
  const out: string[][] = [];
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r += 1) {
    const line: string[] = [];
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c += 1) line.push(rows[r]?.[c] ?? '');
    out.push(line);
  }
  return out;
}

/** 把一块二维数组写到 anchor 位置（自动补足行列）；返回新 rows */
export function writeCellBlock(rows: string[][], anchorR: number, anchorC: number, block: string[][]): string[][] {
  const next = rows.map((r) => [...r]);
  const needCols = anchorC + Math.max(0, ...block.map((b) => b.length));
  const width = Math.max(needCols, next.reduce((n, r) => Math.max(n, r.length), 0), 1);
  while (next.length < anchorR + block.length) next.push(Array.from({ length: width }, () => ''));
  next.forEach((r) => {
    while (r.length < width) r.push('');
  });
  block.forEach((line, i) => {
    const r = next[anchorR + i];
    if (!r) return;
    line.forEach((v, j) => {
      r[anchorC + j] = v;
    });
  });
  return next;
}

/**
 * 改**一格**的文字（保持网格矩形、必要时补行补列；转义交给 `serializeTableData`）。
 * 属性面板的「单元格内容」框与画布上的**双击改字**共用它，保证两条路径行为一致。
 */
export function setCellText(rows: string[][], r: number, c: number, text: string): string[][] {
  const next = rows.map((row) => [...row]);
  const cols = Math.max(1, next.reduce((n, row) => Math.max(n, row.length), 0));
  while (next.length <= r) next.push([]);
  const row = next[r];
  while (row.length < Math.max(cols, c + 1)) row.push('');
  row[c] = text;
  return next;
}

/** 表格的网格尺寸（行数 × 最大列数）；键盘导航用它夹取边界 */
export function tableGrid(rows: string[][]): { rows: number; cols: number } {
  return { rows: Math.max(1, rows.length), cols: Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0)) };
}

/* ══════════════ 排序（B12）══════════════
   排序是**渲染期**行为，不重写 `props.data`：
   · `sortBy` = 按第几列排（0 基，-1 = 不排序），`sortDir` = asc/desc；
   · 开了「首行为表头」时表头行不参与排序（Word/Excel 的"数据包含标题"）；
   · 单元格格式（A1 键）跟着行走：单格键换行号；跨行的合并若排完不再相邻就**放弃那条合并**
     （否则会圈到别的行上），并在返回值里报数，便于自检/诊断。 */

export interface SortSpec {
  /** 0 基列号；-1 = 不排序 */
  by: number;
  dir: 'asc' | 'desc';
  /** 表头行不参与排序（表格开了"首行为表头"时） */
  keepHeader: boolean;
}

/** 单元格文字排序键：两边都像数字就按数值比（"9" < "10"），否则按中文拼音/字母序 */
function compareCell(a: string, b: string): number {
  const na = Number(a.trim());
  const nb = Number(b.trim());
  const aNum = a.trim() !== '' && Number.isFinite(na);
  const bNum = b.trim() !== '' && Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  return a.trim().localeCompare(b.trim(), 'zh-Hans-CN');
}

/**
 * 排序数据行。返回新行数组与**行置换表** `order`（`order[渲染行号] = 原始行号`）。
 * 表头行（keepHeader 且是第 0 行）永远排在最前，`order[0] = 0`。
 */
export function sortRows(rows: string[][], spec: SortSpec): { rows: string[][]; order: number[] } {
  const keep = spec.keepHeader && rows.length > 0 ? 1 : 0;
  if (spec.by < 0 || rows.length <= keep + 0) {
    return { rows, order: rows.map((_, i) => i) };
  }
  const idx = rows.map((_, i) => i).slice(keep);
  idx.sort((x, y) => {
    const c = compareCell(rows[x]?.[spec.by] ?? '', rows[y]?.[spec.by] ?? '');
    return spec.dir === 'desc' ? -c : c;
  });
  const order = [...Array.from({ length: keep }, (_, i) => i), ...idx];
  return { rows: order.map((i) => rows[i] ?? []), order };
}

/**
 * 把 `cellStyles` 的 A1 键按行置换表搬到新行号上。
 * 单格键直接换行；范围键（合并）两个端点都要换，且换完必须**仍然相邻**，否则丢弃并计数。
 */
export function remapCellStylesByOrder<T>(styles: Record<string, T>, order: number[]): { styles: Record<string, T>; dropped: number } {
  const pos = new Map<number, number>();
  order.forEach((srcRow, newRow) => pos.set(srcRow, newRow));
  const same = order.every((src, i) => src === i);
  if (same) return { styles, dropped: 0 };

  const out: Record<string, T> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(styles)) {
    const rng = key.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (rng) {
      const [, c1, r1s, c2, r2s] = rng;
      const a = pos.get(Number(r1s) - 1);
      const b = pos.get(Number(r2s) - 1);
      if (a == null || b == null || Math.abs(a - b) !== Math.abs(Number(r2s) - Number(r1s))) {
        dropped += 1;
        continue;
      }
      const lo = Math.min(a, b) + 1;
      const hi = Math.max(a, b) + 1;
      out[`${c1}${lo}:${c2}${hi}`] = value;
      continue;
    }
    const single = key.match(/^([A-Z]+)(\d+)$/);
    if (single) {
      const [, col, rowS] = single;
      const p = pos.get(Number(rowS) - 1);
      if (p == null) {
        dropped += 1;
        continue;
      }
      out[`${col}${p + 1}`] = value;
      continue;
    }
    out[key] = value;
  }
  return { styles: out, dropped };
}

/** 把 "行,列" 键夹到网格内（方向键/Tab 导航用） */
export function clampCell(r: number, c: number, grid: { rows: number; cols: number }): { r: number; c: number } {
  return {
    r: Math.min(Math.max(0, r), grid.rows - 1),
    c: Math.min(Math.max(0, c), grid.cols - 1),
  };
}

/** 两个格子之间的矩形区域（含端点，行优先）——框选、Shift+方向键扩选共用 */
export function rectKeys(a: string, b: string): string[] {
  const [ar, ac] = a.split(',').map((n) => Number(n));
  const [br, bc] = b.split(',').map((n) => Number(n));
  if (![ar, ac, br, bc].every((n) => Number.isFinite(n))) return [b];
  const out: string[] = [];
  for (let r = Math.min(ar, br); r <= Math.max(ar, br); r += 1) {
    for (let c = Math.min(ac, bc); c <= Math.max(ac, bc); c += 1) out.push(`${r},${c}`);
  }
  return out;
}

/** 生成表格类组件的属性 schema（预设组件只换默认数据、默认线条风格与默认列宽/行高） */
export function tableSchema(
  defaultData: string[][],
  variantDefault: TableVariant,
  defaults: { colWidths?: string; rowHeight?: string } = {},
): PropSchemaItem[] {
  void defaultData; // 默认数据仍由 defaultProps.data 承载；这里不再暴露「数据」属性行
  /* ★属性行顺序（用户 2026-09-23 确认的"规格 §8.1 顺序"）：结构 → 数据/内容 → 线条 → 尺寸 → 文字。
     同一组内的顺序就是面板从上到下的顺序；分组之间的分割线由 PropertyPanel 画（`divider`）。 */
  return [
    /* ★「数据」属性行已删除（用户 2026-09-23：表格内容**以单元格内容为主**）——
       几个扩展表格组件（三线表/两列参数表/明细表/核对表）共用这份 schema，所以一并生效。
       内容改法：① 画布上点选一格 →「单元格格式」组里的「内容」框；
                 ② 行/列数量不够时用「行 / 列数量」增删行列；
                 ③ 需要整块换内容时用「HTML 源码」导入 <table>。
       `props.data` 仍是存储形态（`a | b` 文本），渲染、导出、MCP 都不受影响。 */
    /* —— 结构 —— */
    { key: 'headerRow', label: '首行为表头', control: 'switch', group: GROUP.whole, defaultValue: true },
    { key: 'headerCol', label: '首列为表头（第一列作为行标题：加粗 + 表头底色）', control: 'switch', group: GROUP.whole, defaultValue: false },
    /* ★排序 / 冻结首行（B12）：排序是渲染期行为（不改 props.data）；冻结首行只在 Web 模式有意义 */
    {
      key: 'sortBy',
      label: '排序（按列 A/B/C…；只影响**显示顺序**，原始行序与单元格格式都不动）',
      control: 'tableSort',
      group: GROUP.whole,
      defaultValue: -1,
    },
    { key: 'sortDir', label: '排序方向', control: 'text', group: GROUP.whole, defaultValue: 'asc', visibleWhen: () => false },
    {
      key: 'stickyHeader',
      label: '冻结首行（Web 模式：表头滚动时钉在顶部）',
      control: 'switch',
      group: GROUP.whole,
      defaultValue: false,
      visibleWhen: (_p, ctx) => ctx.mode === 'web',
    },
    {
      key: 'stickyHeight',
      label: '冻结时表格最大高度（px，超出才滚动）',
      control: 'number',
      group: GROUP.whole,
      defaultValue: 360,
      min: 80,
      max: 2000,
      visibleWhen: (p, ctx) => ctx.mode === 'web' && p.stickyHeader === true,
    },
    /* —— 数据 / 内容 —— */
    { key: 'caption', label: '表题（显示在表格上方）', control: 'text', group: GROUP.whole, defaultValue: '' },
    { key: 'captionAlign', label: '表题对齐', control: 'align', group: GROUP.whole, defaultValue: 'left' },
    { key: 'captionSize', label: '表题字号', control: 'unit', group: GROUP.whole, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    {
      key: 'tableSize',
      label:
        '行 / 列数量（含表头行；行数/列数在失焦或回车时生效；插入/删除会同步平移单元格格式与列宽，可 Ctrl+Z 撤销；先在画布上点一个单元格）',
      control: 'tableSize',
      group: GROUP.whole,
      defaultValue: null,
    },
    {
      key: 'html',
      label: 'HTML 源码（粘贴 <table>…</table> 点「导入 HTML」即可变成表格；也能把当前表格生成 HTML）',
      control: 'tableHtml',
      group: GROUP.whole,
      defaultValue: '',
    },
    /* —— 线条 —— */
    {
      key: 'variant',
      label: '线条风格',
      control: 'select',
      group: GROUP.whole,
      defaultValue: variantDefault,
      options: TABLE_VARIANT_OPTIONS,
    },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: GROUP.whole, defaultValue: 1, min: 0, max: 6 },
    { key: 'borderColor', label: '边框色', control: 'color', group: GROUP.whole, defaultValue: '#c9d6e2' },
    { key: 'headerBackground', label: '表头底色', control: 'color', group: GROUP.whole, defaultValue: '#e8f1f9' },
    { key: 'headerColor', label: '三线表线条色', control: 'color', group: GROUP.whole, defaultValue: '#1f2329' },
    /* —— 尺寸 —— */
    { key: 'width', label: '表宽 %', control: 'slider', group: GROUP.whole, defaultValue: 100, min: 20, max: 100, step: 5 },
    {
      key: 'colWidths',
      label: '列宽（如 20,50,30；纯数字按 %，也可写 35mm）',
      control: 'text',
      group: GROUP.whole,
      defaultValue: defaults.colWidths ?? '',
      placeholder: '20,50,30',
    },
    {
      key: 'rowHeight',
      label: '行高（**整表默认**，如 9；纯数字按 mm；单行高度用画布拖行边界或下面那条）',
      control: 'text',
      group: GROUP.whole,
      defaultValue: defaults.rowHeight ?? '',
      placeholder: '9',
    },
    {
      key: 'rowHeights',
      label: '按行行高（画布上拖某一行边界只改那一行；这里可逐条清除）',
      control: 'tableRowHeights',
      group: GROUP.whole,
      defaultValue: {},
    },
    { key: 'cellPadding', label: '内边距（默认值）', control: 'number', group: GROUP.whole, defaultValue: 6, min: 0, max: 24 },
    /* —— 文字 —— */
    { key: 'fontSize', label: '字号（默认值）', control: 'unit', group: GROUP.whole, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    { key: 'cellAlign', label: '单元格对齐（默认值）', control: 'align', group: GROUP.whole, defaultValue: 'left' },
    { key: 'stripe', label: '斑马纹（仅全框线）', control: 'switch', group: GROUP.whole, defaultValue: true },
    /* —— 单元格（另一个分组，永远排在最后）—— */
    {
      key: 'cellStyles',
      label: '单元格格式（先在画布上点选单元格，可拖选一片；没覆盖的项沿用「表格」组的默认值）',
      control: 'cells',
      group: GROUP.cell,
      defaultValue: {},
    },
  ];
}
