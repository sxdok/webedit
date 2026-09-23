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
import { asBool, asMatrix, asNumber, asString } from '../../../utils/id';

export type TableVariant = 'normal' | 'threeLine' | 'hLines';

export const TABLE_VARIANT_OPTIONS: SelectOption[] = [
  { label: '全框线（普通表格）', value: 'normal' },
  { label: '三线表', value: 'threeLine' },
  { label: '横线表（无竖线）', value: 'hLines' },
];

/**
 * 列宽：逗号/顿号/空白分隔；**纯数字按百分比**（"20,50,30" → 20%/50%/30%），也可写 `35mm`、`40%`。
 * 与 A4 编辑器 `js/30-tables.js` 的 setColWidths 同一套语义（写进 colgroup 的每个 col）。
 */
export function parseColWidths(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((w) => (/^\d+(\.\d+)?$/.test(w) ? `${w}%` : w));
}

/**
 * 行高：**纯数字按毫米**（"9" → 9mm），其余原样；写到每个单元格的 height 上（表头 + 数据行一起）。
 * 与 A4 编辑器 setRowHeight 同一套语义。留空 = 不设行高（由内容撑开）。
 */
export function parseRowHeight(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  return /^\d+(\.\d+)?$/.test(v) ? `${v}mm` : v;
}

/** 把 data 属性（二维数组或 "a | b" 文本）解析成行
 *  ★空行**要保留**（Excel 里空行就是一行空单元格）：只把"末尾换行"这个书写残留去掉，
 *    中间和末尾的空行都算真实行 —— 否则"插入空行"会看不见、行列数量也对不上。 */
export function parseTableData(raw: unknown): string[][] {
  if (Array.isArray(raw)) return asMatrix(raw);
  const text = String(raw ?? '');
  if (!text) return [];
  let lines = text.split('\n');
  if (text.endsWith('\n')) lines = lines.slice(0, -1);
  if (lines.every((l) => l.trim() === '')) return [];
  return lines.map((l) => l.split('|').map((c) => c.trim()));
}

/**
 * 单元格级格式（Excel 的"单元格覆盖表格默认"）：`{ "B2": { 各覆盖项 }, "B2:C3": { merged: true } }`。
 * 键用 **Excel A1 记法**（列字母 + 行号，行号**从 1 起**；范围键 `B2:C3` 表示合并区）。
 * 兼容旧数据：早期版本用 `"行,列"`（0 基），读取时自动换算成 A1。
 * 没写的项就沿用表格级属性（cellAlign / fontSize / cellPadding / headerBackground），
 * 与 Excel 里"单元格格式覆盖列/表默认格式"是同一套逻辑。
 */
export interface CellStyle {
  background?: string;
  color?: string;
  /** pt */
  fontSize?: number;
  bold?: boolean;
  /** 字重（400/600/700）；写了就以它为准，bold 是旧字段 */
  fontWeight?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  /** 垂直对齐（Excel 的"垂直居中"） */
  valign?: 'top' | 'middle' | 'bottom';
  /** px */
  padding?: number;
  /** 单元格边框（四边独立，宽度 px） */
  border?: { top?: number; right?: number; bottom?: number; left?: number; color?: string };
  /** 合并区（写在范围键上，如 "B2:C3"） */
  merged?: boolean;
}

const CELL_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
const CELL_VALIGNS = ['top', 'middle', 'bottom'] as const;

/** 列号 → 列字母（0→A、25→Z、26→AA） */
export function colName(c: number): string {
  let n = Math.max(0, Math.floor(c));
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** (行,列) 0 基 → A1（如 (1,1) → B2） */
export function a1(r: number, c: number): string {
  return `${colName(c)}${r + 1}`;
}

/** 范围 → A1 键：单格给 "B2"，多格给 "B2:C3" */
export function a1Key(r0: number, c0: number, r1: number, c1: number): string {
  return r0 === r1 && c0 === c1 ? a1(r0, c0) : `${a1(r0, c0)}:${a1(r1, c1)}`;
}

export interface A1Range {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** 解析 A1 键或旧版 "行,列" 键 → 0 基范围；解析不了返回 null */
export function parseA1(key: string): A1Range | null {
  const legacy = key.match(/^(\d+),(\d+)$/);
  if (legacy) {
    const r = Number(legacy[1]);
    const c = Number(legacy[2]);
    return { r0: r, c0: c, r1: r, c1: c };
  }
  const one = (s: string): { r: number; c: number } | null => {
    const m = s.match(/^([A-Za-z]+)(\d+)$/);
    if (!m) return null;
    let c = 0;
    for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { r: Number(m[2]) - 1, c: c - 1 };
  };
  const parts = key.split(':');
  const a = one(parts[0] ?? '');
  const b = one(parts[1] ?? parts[0] ?? '');
  if (!a || !b) return null;
  return {
    r0: Math.min(a.r, b.r),
    c0: Math.min(a.c, b.c),
    r1: Math.max(a.r, b.r),
    c1: Math.max(a.c, b.c),
  };
}

/** 归一化键：旧版 "行,列" → A1；范围内单格 → 单格键 */
export function normalizeKey(key: string): string | null {
  const p = parseA1(key);
  return p ? a1Key(p.r0, p.c0, p.r1, p.c1) : null;
}

export function parseCellStyles(raw: unknown): Record<string, CellStyle> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, CellStyle> = {};
  for (const [rawKey, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeKey(rawKey);
    if (!key || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const src = v as Record<string, unknown>;
    const st: CellStyle = {};
    const bg = String(src.background ?? '').trim();
    if (bg) st.background = bg;
    const color = String(src.color ?? '').trim();
    if (color) st.color = color;
    const fs = Number(src.fontSize);
    if (Number.isFinite(fs) && fs > 0) st.fontSize = fs;
    if (src.bold === true) st.bold = true;
    const fw = Number(src.fontWeight);
    if (Number.isFinite(fw) && fw >= 100) st.fontWeight = fw;
    const align = String(src.align ?? '');
    if ((CELL_ALIGNS as readonly string[]).includes(align)) st.align = align as CellStyle['align'];
    const va = String(src.valign ?? '');
    if ((CELL_VALIGNS as readonly string[]).includes(va)) st.valign = va as CellStyle['valign'];
    const pad = Number(src.padding);
    if (Number.isFinite(pad) && pad >= 0 && src.padding !== '' && src.padding != null) st.padding = pad;
    if (src.merged === true) st.merged = true;
    if (src.border && typeof src.border === 'object' && !Array.isArray(src.border)) {
      const b = src.border as Record<string, unknown>;
      const nb: NonNullable<CellStyle['border']> = {};
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const n = Number(b[side]);
        if (Number.isFinite(n) && n > 0) nb[side] = n;
      }
      const bc = String(b.color ?? '').trim();
      if (bc) nb.color = bc;
      if (Object.keys(nb).length) st.border = nb;
    }
    if (Object.keys(st).length) out[key] = st;
  }
  return out;
}

/** 取某格的样式键：优先该格自己的键；否则若它落在某个合并区里，用该区的键 */
export function cellStyleKeyAt(styles: Record<string, CellStyle>, r: number, c: number): string | null {
  const own = a1(r, c);
  if (styles[own]) return own;
  for (const key of Object.keys(styles)) {
    const p = parseA1(key);
    if (!p) continue;
    if (r >= p.r0 && r <= p.r1 && c >= p.c0 && c <= p.c1) return key;
  }
  return null;
}

/** 插入/删除行列后平移所有键（含范围键）；落在删除范围内的键被移除，被切开的合并区不再合并 */
export function shiftCellKeys(
  styles: Record<string, CellStyle>,
  axis: 'row' | 'col',
  at: number,
  count: number,
): Record<string, CellStyle> {
  const out: Record<string, CellStyle> = {};
  const map1 = (r: number, c: number): { r: number; c: number } | null => {
    const idx = axis === 'row' ? r : c;
    if (count < 0) {
      const del = -count;
      if (idx >= at && idx < at + del) return null;
      const ni = idx >= at + del ? idx - del : idx;
      return axis === 'row' ? { r: ni, c } : { r, c: ni };
    }
    const ni = idx >= at ? idx + count : idx;
    return axis === 'row' ? { r: ni, c } : { r, c: ni };
  };
  for (const [key, st] of Object.entries(styles)) {
    const p = parseA1(key);
    if (!p) continue;
    const a = map1(p.r0, p.c0);
    const b = map1(p.r1, p.c1);
    if (!a || !b) continue;
    out[a1Key(a.r, a.c, b.r, b.c)] = st;
  }
  return out;
}


export function renderTable(props: ComponentProps, ctx: RenderContext, forceVariant?: TableVariant): React.ReactNode {
  const rows = parseTableData(props.data);
  const variant = forceVariant ?? (asString(props.variant, 'normal') as TableVariant);
  const headerRow = asBool(props.headerRow, true);
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
  const styles = parseCellStyles(props.cellStyles);
  // 兼容旧数据：早期只有"按格填背景"（cellFills），读进来当背景覆盖
  const legacyFills = (props.cellFills && typeof props.cellFills === 'object' ? props.cellFills : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(legacyFills)) {
    const c = String(v ?? '').trim();
    if (/^\d+,\d+$/.test(k) && c && !styles[k]?.background) styles[k] = { ...(styles[k] ?? {}), background: c };
  }
  const maxCols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const colCount = Math.max(1, maxCols, colWidths.length);

  const cell: React.CSSProperties = {
    padding: pad,
    textAlign: align,
    verticalAlign: 'middle',
    // ★像 HTML/Word 的单元格那样：内容**在格内换行填满**，长词/长串也换行，
    //   而不是把列撑宽（用户反馈"内容填充观感不符合直觉"）
    overflowWrap: 'break-word',
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
    const key = cellStyleKeyAt(styles, r, c);
    const st = key ? styles[key] : undefined;
    if (!st) return base;
    const out: React.CSSProperties = { ...base };
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
  const captionAlign = asString(props.captionAlign, 'left') as React.CSSProperties['textAlign'];

  return (
    <table style={tableStyle}>
      {/* 表题：由**表格自己**承载（与图片的图题同一做法），不再需要单独的"题注"组件。
          跨页续排时只在**首段**显示，续排段不重复表题。 */}
      {caption && showCaption && (
        <caption
          data-table-caption="1"
          style={{
            captionSide: 'top',
            textAlign: captionAlign,
            fontWeight: 600,
            fontSize: ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.captionSize, fontSize)) : asNumber(props.captionSize, fontSize),
            paddingBottom: 4,
          }}
        >
          {caption}
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
                return (
                  <td
                    key={ci}
                    data-cell={k}
                    data-cell-row={rowIndex}
                    data-cell-col={ci}
                    colSpan={sp?.cs}
                    rowSpan={sp?.rs}
                    style={styleFor(rowIndex, ci, cell)}
                  >
                    {c}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 生成表格类组件的属性 schema（预设组件只换默认数据、默认线条风格与默认列宽/行高） */
export function tableSchema(
  defaultData: string[][],
  variantDefault: TableVariant,
  defaults: { colWidths?: string; rowHeight?: string } = {},
): PropSchemaItem[] {
  return [
    {
      key: 'data',
      label: '数据（每行一条，用 | 分列）',
      control: 'textarea',
      group: GROUP.whole,
      defaultValue: defaultData.map((r) => r.join(' | ')).join('\n'),
      placeholder: '列1 | 列2 | 列3',
    },
    { key: 'headerRow', label: '首行为表头', control: 'switch', group: GROUP.whole, defaultValue: true },
    { key: 'caption', label: '表题（显示在表格上方）', control: 'text', group: GROUP.whole, defaultValue: '' },
    { key: 'captionAlign', label: '表题对齐', control: 'align', group: GROUP.whole, defaultValue: 'left' },
    { key: 'captionSize', label: '表题字号', control: 'unit', group: GROUP.whole, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    {
      key: 'variant',
      label: '线条风格',
      control: 'select',
      group: GROUP.whole,
      defaultValue: variantDefault,
      options: TABLE_VARIANT_OPTIONS,
    },
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
      label: '行高（如 9；纯数字按 mm）',
      control: 'text',
      group: GROUP.whole,
      defaultValue: defaults.rowHeight ?? '',
      placeholder: '9',
    },
    { key: 'cellPadding', label: '内边距（默认值）', control: 'number', group: GROUP.whole, defaultValue: 6, min: 0, max: 24 },
    {
      key: 'tableSize',
      label: '行 / 列数量',
      control: 'tableSize',
      group: GROUP.whole,
      defaultValue: null,
    },
    {
      key: 'cellStyles',
      label: '单元格格式（先在画布上点选单元格）',
      control: 'cells',
      group: GROUP.cell,
      defaultValue: {},
    },
    { key: 'cellAlign', label: '单元格对齐（默认值）', control: 'align', group: GROUP.whole, defaultValue: 'left' },
    { key: 'fontSize', label: '字号（默认值）', control: 'unit', group: GROUP.whole, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    { key: 'stripe', label: '斑马纹（仅全框线）', control: 'switch', group: GROUP.whole, defaultValue: true },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: GROUP.whole, defaultValue: 1, min: 0, max: 6 },
    { key: 'borderColor', label: '边框色', control: 'color', group: GROUP.whole, defaultValue: '#c9d6e2' },
    { key: 'headerBackground', label: '表头底色', control: 'color', group: GROUP.whole, defaultValue: '#e8f1f9' },
    { key: 'headerColor', label: '三线表线条色', control: 'color', group: GROUP.whole, defaultValue: '#1f2329' },
  ];
}
