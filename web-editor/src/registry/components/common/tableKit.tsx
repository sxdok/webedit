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
 * 单元格级格式（Excel 的"单元格覆盖表格默认"）：`{ "行,列": { 各覆盖项 } }`。
 * 行列从 0 起，**含表头时第 0 行就是表头行**（与"数据"文本域的第一行一致）。
 * 没写的项就沿用表格级属性（cellAlign / fontSize / cellPadding / headerBackground），
 * 与 Excel 里"单元格格式覆盖列/表默认格式"是同一套逻辑。
 */
export interface CellStyle {
  background?: string;
  color?: string;
  /** pt */
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  /** px */
  padding?: number;
}

const CELL_ALIGNS = ['left', 'center', 'right'] as const;

export function parseCellStyles(raw: unknown): Record<string, CellStyle> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, CellStyle> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+,\d+$/.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const src = v as Record<string, unknown>;
    const st: CellStyle = {};
    const bg = String(src.background ?? '').trim();
    if (bg) st.background = bg;
    const color = String(src.color ?? '').trim();
    if (color) st.color = color;
    const fs = Number(src.fontSize);
    if (Number.isFinite(fs) && fs > 0) st.fontSize = fs;
    if (src.bold === true) st.bold = true;
    const align = String(src.align ?? '');
    if ((CELL_ALIGNS as readonly string[]).includes(align)) st.align = align as CellStyle['align'];
    const pad = Number(src.padding);
    if (Number.isFinite(pad) && pad >= 0 && src.padding !== '' && src.padding != null) st.padding = pad;
    if (Object.keys(st).length) out[k] = st;
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
  const [head, ...body] = rows;
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

  /** 单元格级覆盖：以表格级样式为底，再叠加该格的 CellStyle（Excel 的"单元格覆盖默认"） */
  const styleFor = (key: string, base: React.CSSProperties): React.CSSProperties => {
    const st = styles[key];
    if (!st) return base;
    const out: React.CSSProperties = { ...base };
    if (st.background) out.background = st.background;
    if (st.color) out.color = st.color;
    if (st.fontSize) out.fontSize = ctx.mode === 'document' ? ctx.ptToPx(st.fontSize) : st.fontSize;
    if (st.bold) out.fontWeight = 700;
    if (st.align) out.textAlign = st.align;
    if (typeof st.padding === 'number') out.padding = st.padding;
    return out;
  };

  const stripe = asBool(props.stripe, true) && variant === 'normal';
  const caption = asString(props.caption);
  const captionAlign = asString(props.captionAlign, 'left') as React.CSSProperties['textAlign'];

  return (
    <table style={tableStyle}>
      {/* 表题：由**表格自己**承载（与图片的图题同一做法），不再需要单独的"题注"组件 */}
      {caption && (
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
      {headerRow && head && (
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} data-cell={`0,${i}`} data-cell-row={0} data-cell-col={i} style={styleFor(`0,${i}`, headCell)}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {(headerRow ? body : rows).map((r, ri) => {
          // 行号口径：含表头时第 0 行 = 表头，所以数据行从 1 开始 —— 与"数据"文本域的行一一对应
          const rowIndex = headerRow ? ri + 1 : ri;
          return (
            <tr key={ri} style={{ background: stripe && ri % 2 ? '#fafcfe' : undefined }}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  data-cell={`${rowIndex},${ci}`}
                  data-cell-row={rowIndex}
                  data-cell-col={ci}
                  style={styleFor(`${rowIndex},${ci}`, cell)}
                >
                  {c}
                </td>
              ))}
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
      group: GROUP.content,
      defaultValue: defaultData.map((r) => r.join(' | ')).join('\n'),
      placeholder: '列1 | 列2 | 列3',
    },
    { key: 'headerRow', label: '首行为表头', control: 'switch', group: GROUP.content, defaultValue: true },
    { key: 'caption', label: '表题（显示在表格上方）', control: 'text', group: GROUP.content, defaultValue: '' },
    { key: 'captionAlign', label: '表题对齐', control: 'align', group: GROUP.content, defaultValue: 'left' },
    { key: 'captionSize', label: '表题字号', control: 'unit', group: GROUP.content, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    {
      key: 'variant',
      label: '线条风格',
      control: 'select',
      group: GROUP.appearance,
      defaultValue: variantDefault,
      options: TABLE_VARIANT_OPTIONS,
    },
    { key: 'width', label: '表宽 %', control: 'slider', group: GROUP.size, defaultValue: 100, min: 20, max: 100, step: 5 },
    {
      key: 'colWidths',
      label: '列宽（如 20,50,30；纯数字按 %，也可写 35mm）',
      control: 'text',
      group: GROUP.size,
      defaultValue: defaults.colWidths ?? '',
      placeholder: '20,50,30',
    },
    {
      key: 'rowHeight',
      label: '行高（如 9；纯数字按 mm）',
      control: 'text',
      group: GROUP.size,
      defaultValue: defaults.rowHeight ?? '',
      placeholder: '9',
    },
    { key: 'cellPadding', label: '内边距', control: 'number', group: GROUP.size, defaultValue: 6, min: 0, max: 24 },
    {
      key: 'tableSize',
      label: '行 / 列数量',
      control: 'tableSize',
      group: GROUP.content,
      defaultValue: null,
    },
    {
      key: 'cellStyles',
      label: '单元格格式（先在画布上点选单元格）',
      control: 'cells',
      group: GROUP.content,
      defaultValue: {},
    },
    { key: 'cellAlign', label: '单元格对齐', control: 'align', group: GROUP.typography, defaultValue: 'left' },
    { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    { key: 'stripe', label: '斑马纹（仅全框线）', control: 'switch', group: GROUP.appearance, defaultValue: true },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: GROUP.appearance, defaultValue: 1, min: 0, max: 6 },
    { key: 'borderColor', label: '边框色', control: 'color', group: GROUP.appearance, defaultValue: '#c9d6e2' },
    { key: 'headerBackground', label: '表头底色', control: 'color', group: GROUP.appearance, defaultValue: '#e8f1f9' },
    { key: 'headerColor', label: '三线表线条色', control: 'color', group: GROUP.appearance, defaultValue: '#1f2329' },
  ];
}
