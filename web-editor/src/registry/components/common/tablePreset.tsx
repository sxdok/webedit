/**
 * 表格预设（tablePreset）—— 对齐 A4 编辑器「图表」组里的四个表格组件：
 *   三线表 t3 / 两列参数表 cap2 / 明细表 tl / 核对表 tk
 * 它们与「表格」共用同一个渲染内核（tableKit.renderTable），只是首发数据与默认线条风格不同，
 * 所以不存在四份重复实现；每个预设仍可继续改线条风格与数据。
 */
import { LayoutDashboard, List, ShieldCheck, Table as TableIcon } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { renderTable, tableSchema } from './tableKit';

const THREE_LINE_DATA: string[][] = [
  ['项目', '指标', '依据'],
  ['示例指标', '—', '—'],
  ['示例指标', '—', '—'],
];

const PARAM_DATA: string[][] = [
  ['参数', '取值'],
  ['工作电压', 'DC 24 V'],
  ['防护等级', 'IP54'],
  ['通信接口', 'Ethernet / Wi-Fi'],
];

const DETAIL_DATA: string[][] = [
  ['序号', '名称', '规格', '数量', '备注'],
  ['1', '—', '—', '1', '—'],
  ['2', '—', '—', '1', '—'],
];

const CHECK_DATA: string[][] = [
  ['序号', '核对项', '结果', '备注'],
  ['1', '—', '√', '—'],
  ['2', '—', '√', '—'],
];

function presetProps(data: string[][], variant: string, colWidths = '', rowHeight = '', caption = '') {
  return {
    data,
    headerRow: true,
    caption,
    captionAlign: 'left',
    captionSize: 10.5,
    variant,
    width: 100,
    colWidths,
    rowHeight,
    cellPadding: 6,
    cellAlign: 'left',
    fontSize: 10.5,
    stripe: true,
    borderWidth: 1,
    borderColor: '#c9d6e2',
    headerBackground: '#e8f1f9',
    headerColor: '#1f2329',
  };
}

export const threeLineTableComponent: ComponentDefinition = {
  type: 'threeLineTable',
  label: '三线表',
  category: 'Excel 表格',
  supportedModes: ['document', 'web'],
  icon: TableIcon,
  splittable: 'rows',
  description: '学术/技术文档常用：只有顶线、表头线、底线',
  defaultFrame: { x: 40, y: 240, w: 560, h: 140 },
  propSchema: tableSchema(THREE_LINE_DATA, 'threeLine'),
  defaultProps: presetProps(THREE_LINE_DATA, 'threeLine'),
  render: (props, ctx) => renderTable(props, ctx),
};

export const paramTableComponent: ComponentDefinition = {
  type: 'paramTable',
  label: '两列参数表',
  category: 'Excel 表格',
  supportedModes: ['document', 'web'],
  icon: LayoutDashboard,
  splittable: 'rows',
  description: '参数 — 取值 的两列对照表（列宽 35% / 65%）',
  defaultFrame: { x: 40, y: 240, w: 420, h: 140 },
  propSchema: tableSchema(PARAM_DATA, 'hLines', { colWidths: '35,65' }),
  defaultProps: presetProps(PARAM_DATA, 'hLines', '35,65'),
  render: (props, ctx) => renderTable(props, ctx),
};

export const detailTableComponent: ComponentDefinition = {
  type: 'detailTable',
  label: '明细表',
  category: 'Excel 表格',
  supportedModes: ['document', 'web'],
  icon: List,
  splittable: 'rows',
  description: '序号 / 名称 / 规格 / 数量 / 备注 的明细表（列宽 8/30/30/12/20）',
  defaultFrame: { x: 40, y: 240, w: 600, h: 160 },
  propSchema: tableSchema(DETAIL_DATA, 'normal', { colWidths: '8,30,30,12,20' }),
  defaultProps: presetProps(DETAIL_DATA, 'normal', '8,30,30,12,20'),
  render: (props, ctx) => renderTable(props, ctx),
};

export const checkTableComponent: ComponentDefinition = {
  type: 'checkTable',
  label: '核对表',
  category: 'Excel 表格',
  supportedModes: ['document', 'web'],
  icon: ShieldCheck,
  splittable: 'rows',
  description: '序号 / 核对项 / 结果 / 备注 的核对表（列宽 8/52/12/28）',
  defaultFrame: { x: 40, y: 240, w: 560, h: 160 },
  propSchema: tableSchema(CHECK_DATA, 'normal', { colWidths: '8,52,12,28' }),
  defaultProps: presetProps(CHECK_DATA, 'normal', '8,52,12,28'),
  render: (props, ctx) => renderTable(props, ctx),
};
