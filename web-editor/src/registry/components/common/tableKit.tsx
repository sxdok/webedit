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

/** 把 data 属性（二维数组或 "a | b" 文本）解析成行 */
export function parseTableData(raw: unknown): string[][] {
  if (Array.isArray(raw)) return asMatrix(raw);
  return String(raw ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => l.split('|').map((c) => c.trim()));
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

  const cell: React.CSSProperties = {
    padding: pad,
    textAlign: align,
    verticalAlign: 'middle',
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

  const stripe = asBool(props.stripe, true) && variant === 'normal';

  return (
    <table style={tableStyle}>
      {headerRow && head && (
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} style={headCell}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {(headerRow ? body : rows).map((r, ri) => (
          <tr key={ri} style={{ background: stripe && ri % 2 ? '#fafcfe' : undefined }}>
            {r.map((c, ci) => (
              <td key={ci} style={cell}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 生成表格类组件的属性 schema（预设组件只换默认数据与默认 variant） */
export function tableSchema(defaultData: string[][], variantDefault: TableVariant, withVariant = true): PropSchemaItem[] {
  const items: PropSchemaItem[] = [
    {
      key: 'data',
      label: '数据（每行一条，用 | 分列）',
      control: 'textarea',
      group: GROUP.content,
      defaultValue: defaultData.map((r) => r.join(' | ')).join('\n'),
      placeholder: '列1 | 列2 | 列3',
    },
    { key: 'headerRow', label: '首行为表头', control: 'switch', group: GROUP.content, defaultValue: true },
  ];
  if (withVariant) {
    items.push({
      key: 'variant',
      label: '线条风格',
      control: 'select',
      group: GROUP.appearance,
      defaultValue: variantDefault,
      options: TABLE_VARIANT_OPTIONS,
    });
  }
  items.push(
    { key: 'width', label: '表宽 %', control: 'slider', group: GROUP.size, defaultValue: 100, min: 20, max: 100, step: 5 },
    { key: 'cellPadding', label: '单元格内边距', control: 'number', group: GROUP.size, defaultValue: 6, min: 0, max: 24 },
    { key: 'cellAlign', label: '单元格对齐', control: 'align', group: GROUP.typography, defaultValue: 'left' },
    { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    { key: 'stripe', label: '斑马纹（仅全框线）', control: 'switch', group: GROUP.appearance, defaultValue: true },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: GROUP.appearance, defaultValue: 1, min: 0, max: 6 },
    { key: 'borderColor', label: '边框色', control: 'color', group: GROUP.appearance, defaultValue: '#c9d6e2' },
    { key: 'headerBackground', label: '表头底色', control: 'color', group: GROUP.appearance, defaultValue: '#e8f1f9' },
    { key: 'headerColor', label: '三线表线条色', control: 'color', group: GROUP.appearance, defaultValue: '#1f2329' },
  );
  return items;
}
