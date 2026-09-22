/**
 * 组件：表格（table）—— 通用表格，线条风格可选：全框线 / 三线表 / 横线表。
 * 渲染逻辑在 tableKit.tsx（与三个表格预设共用一份实现）。
 * 两种模式都支持。
 */
import { Table as TableIcon } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { renderTable, tableSchema } from './tableKit';

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
  description: '真实 table 元素：全框线 / 三线表 / 横线表，可设表头、斑马纹、对齐',
  defaultFrame: { x: 40, y: 240, w: 560, h: 160 },
  propSchema: tableSchema(DEFAULT_DATA, 'normal'),
  defaultProps: {
    data: DEFAULT_DATA,
    headerRow: true,
    variant: 'normal',
    width: 100,
    colWidths: '',
    rowHeight: '',
    cellPadding: 6,
    cellAlign: 'left',
    fontSize: 10.5,
    stripe: true,
    borderWidth: 1,
    borderColor: '#c9d6e2',
    headerBackground: '#e8f1f9',
    headerColor: '#1f2329',
  },
  render: (props, ctx) => renderTable(props, ctx),
};
