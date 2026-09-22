/**
 * 组件：表格（table）。渲染真实 <table>（border-collapse），数据为二维数组，支持表头行、斑马纹、单元格内边距。
 * 两种模式都支持。
 */
import { Table as TableIcon } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { asBool, asNumber, asString, asMatrix } from '../../../utils/id';

const DEFAULT_DATA: string[][] = [
  ['项目', '取值', '说明'],
  ['示例一', '—', '—'],
  ['示例二', '—', '—'],
];

export const tableComponent: ComponentDefinition = {
  type: 'table',
  label: '表格',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: TableIcon,
  description: '真实 table 元素，边框合并，可设表头与斑马纹',
  defaultFrame: { x: 40, y: 240, w: 560, h: 160 },
  defaultProps: {
    data: DEFAULT_DATA,
    headerRow: true,
    borderWidth: 1,
    borderColor: '#c9d6e2',
    cellPadding: 6,
    stripe: true,
    fontSize: 10.5,
    width: 100,
  },
  propSchema: [
    {
      key: 'data',
      label: '数据（每行一条，用 | 分列）',
      control: 'textarea',
      group: '内容',
      defaultValue: DEFAULT_DATA.map((r) => r.join(' | ')).join('\n'),
      placeholder: '列1 | 列2 | 列3',
    },
    { key: 'headerRow', label: '首行为表头', control: 'switch', group: '内容', defaultValue: true },
    { key: 'width', label: '表宽 %', control: 'slider', group: '尺寸', defaultValue: 100, min: 20, max: 100, step: 5 },
    { key: 'cellPadding', label: '单元格内边距', control: 'number', group: '尺寸', defaultValue: 6, min: 0, max: 24 },
    { key: 'fontSize', label: '字号', control: 'unit', group: '排版', defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    { key: 'stripe', label: '斑马纹', control: 'switch', group: '外观', defaultValue: true },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: '外观', defaultValue: 1, min: 0, max: 6 },
    { key: 'borderColor', label: '边框色', control: 'color', group: '外观', defaultValue: '#c9d6e2' },
  ],
  render: (props, ctx) => {
    // data 既可能是二维数组（默认值/导入），也可能是 textarea 里的 "a | b" 文本
    const raw = props.data;
    const rows: string[][] = Array.isArray(raw)
      ? asMatrix(raw)
      : String(raw ?? '')
          .split('\n')
          .filter((l) => l.trim() !== '')
          .map((l) => l.split('|').map((c) => c.trim()));

    const headerRow = asBool(props.headerRow, true);
    const bw = asNumber(props.borderWidth, 1);
    const bc = asString(props.borderColor, '#c9d6e2');
    const pad = asNumber(props.cellPadding, 6);
    const fontSize = asNumber(props.fontSize, 10.5);
    const [head, ...body] = rows;

    const cell: React.CSSProperties = {
      border: bw ? `${bw}px solid ${bc}` : 'none',
      padding: pad,
      textAlign: 'left',
      verticalAlign: 'middle',
    };

    return (
      <table
        style={{
          width: `${asNumber(props.width, 100)}%`,
          borderCollapse: 'collapse',
          fontSize: ctx.mode === 'document' ? ctx.ptToPx(fontSize) : fontSize,
          lineHeight: 1.4,
        }}
      >
        {headerRow && head && (
          <thead>
            <tr>
              {head.map((c, i) => (
                <th key={i} style={{ ...cell, background: '#e8f1f9', fontWeight: 600 }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {(headerRow ? body : rows).map((r, ri) => (
            <tr key={ri} style={{ background: asBool(props.stripe, true) && ri % 2 ? '#fafcfe' : undefined }}>
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
  },
};
