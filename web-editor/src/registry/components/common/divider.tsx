/**
 * 组件：分割线（divider）。支持实线/虚线/点线、粗细、颜色、宽度百分比、上下外边距。
 * 两种模式都支持。
 */
import { Minus } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { asEnum, asNumber, asString } from '../../../utils/id';

export const dividerComponent: ComponentDefinition = {
  type: 'divider',
  label: '分割线',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: Minus,
  description: '实线/虚线/点线，可设粗细与颜色',
  defaultFrame: { x: 40, y: 400, w: 520, h: 2 },
  defaultProps: {
    style: 'solid',
    thickness: 1,
    color: '#dcdfe6',
    width: 100,
    marginTop: 8,
    marginBottom: 8,
  },
  propSchema: [
    {
      key: 'style',
      label: '线型',
      control: 'select',
      group: '外观',
      defaultValue: 'solid',
      options: [
        { label: '实线', value: 'solid' },
        { label: '虚线', value: 'dashed' },
        { label: '点线', value: 'dotted' },
      ],
    },
    { key: 'thickness', label: '粗细', control: 'number', group: '外观', defaultValue: 1, min: 1, max: 12 },
    { key: 'color', label: '颜色', control: 'color', group: '外观', defaultValue: '#dcdfe6' },
    { key: 'width', label: '宽度 %', control: 'slider', group: '尺寸', defaultValue: 100, min: 10, max: 100, step: 5 },
    { key: 'marginTop', label: '上间距', control: 'number', group: '尺寸', defaultValue: 8, min: 0, max: 120 },
    { key: 'marginBottom', label: '下间距', control: 'number', group: '尺寸', defaultValue: 8, min: 0, max: 120 },
  ],
  render: (props) => (
    <hr
      style={{
        width: `${asNumber(props.width, 100)}%`,
        borderTop: `${asNumber(props.thickness, 1)}px ${asEnum(props.style, ['solid', 'dashed', 'dotted'] as const, 'solid')} ${asString(props.color, '#dcdfe6')}`,
        borderRight: 'none',
        borderBottom: 'none',
        borderLeft: 'none',
        margin: `${asNumber(props.marginTop, 8)}px 0 ${asNumber(props.marginBottom, 8)}px`,
      }}
    />
  ),
};
