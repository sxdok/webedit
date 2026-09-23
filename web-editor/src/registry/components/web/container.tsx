/**
 * 组件：容器（container，Web 专用，isContainer）。支持 block/flex/grid、对齐、间距、内边距（spacing）、
 * 背景、圆角、边框、阴影；子元素坐标相对容器左上角。
 */
import { Box } from 'lucide-react';
import type { ComponentDefinition, ComponentProps } from '../../types';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';

function spacingToCss(v: unknown, fallback = 12): string {
  const o = (v ?? {}) as Record<string, unknown>;
  const value = asNumber(o.value, fallback);
  const unit = asString(o.unit, 'px');
  return `${value}${unit}`;
}

function containerStyle(props: ComponentProps): React.CSSProperties {
  const display = asEnum(props.display, ['block', 'flex', 'grid'] as const, 'flex');
  return {
    display,
    flexDirection: asEnum(props.flexDirection, ['row', 'column'] as const, 'column'),
    justifyContent: asEnum(
      props.justifyContent,
      ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'] as const,
      'flex-start',
    ),
    alignItems: asEnum(props.alignItems, ['stretch', 'flex-start', 'center', 'flex-end'] as const, 'stretch'),
    gap: asNumber(props.gap, 12),
    gridTemplateColumns: display === 'grid' ? `repeat(${asNumber(props.columns, 2)}, minmax(0,1fr))` : undefined,
    padding: spacingToCss(props.padding, 12),
    background: asString(props.background, '#ffffff'),
    borderRadius: asNumber(props.borderRadius, 8),
    border: asNumber(props.borderWidth, 1) ? `${asNumber(props.borderWidth, 1)}px solid ${asString(props.borderColor, '#e5e7eb')}` : 'none',
    boxShadow: asBool(props.shadow, false) ? '0 2px 10px rgba(0,0,0,.08)' : undefined,
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
  };
}

export const containerComponent: ComponentDefinition = {
  type: 'container',
  label: '容器',
  category: 'Web 容器',
  supportedModes: ['web'],
  icon: Box,
  isContainer: true,
  description: 'block/flex/grid 容器，可嵌套子组件',
  defaultFrame: { x: 40, y: 40, w: 420, h: 260 },
  defaultProps: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    gap: 12,
    columns: 2,
    padding: { value: 12, unit: 'px' },
    background: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadow: false,
  },
  propSchema: [
    {
      key: 'display',
      label: '显示方式',
      control: 'select',
      group: '布局',
      defaultValue: 'flex',
      options: [
        { label: 'block', value: 'block' },
        { label: 'flex', value: 'flex' },
        { label: 'grid', value: 'grid' },
      ],
    },
    {
      key: 'flexDirection',
      label: '主轴方向',
      control: 'select',
      group: '布局',
      defaultValue: 'column',
      options: [
        { label: '纵向 column', value: 'column' },
        { label: '横向 row', value: 'row' },
      ],
      visibleWhen: (p) => p.display === 'flex',
    },
    {
      key: 'justifyContent',
      label: '主轴对齐',
      control: 'select',
      group: '布局',
      defaultValue: 'flex-start',
      options: [
        { label: '起点', value: 'flex-start' },
        { label: '居中', value: 'center' },
        { label: '终点', value: 'flex-end' },
        { label: '两端', value: 'space-between' },
        { label: '环绕', value: 'space-around' },
      ],
      visibleWhen: (p) => p.display === 'flex',
    },
    {
      key: 'alignItems',
      label: '交叉轴对齐',
      control: 'select',
      group: '布局',
      defaultValue: 'stretch',
      options: [
        { label: '拉伸', value: 'stretch' },
        { label: '起点', value: 'flex-start' },
        { label: '居中', value: 'center' },
        { label: '终点', value: 'flex-end' },
      ],
      visibleWhen: (p) => p.display === 'flex',
    },
    { key: 'columns', label: '列数', control: 'number', group: '布局', defaultValue: 2, min: 1, max: 6, visibleWhen: (p) => p.display === 'grid' },
    { key: 'gap', label: '子项间距', control: 'number', group: '布局', defaultValue: 12, min: 0, max: 80 },
    { key: 'padding', label: '内边距', control: 'spacing', group: '尺寸', defaultValue: { value: 12, unit: 'px' } },
    { key: 'background', label: '背景', control: 'color', group: '外观', defaultValue: '#ffffff' },
    { key: 'borderRadius', label: '圆角', control: 'number', group: '外观', defaultValue: 8, min: 0, max: 60 },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: '外观', defaultValue: 1, min: 0, max: 10 },
    { key: 'borderColor', label: '边框色', control: 'color', group: '外观', defaultValue: '#e5e7eb' },
    { key: 'shadow', label: '阴影', control: 'switch', group: '外观', defaultValue: false },
    { key: 'children', label: '子组件', control: 'children', group: '高级', defaultValue: null },
  ],
  // 子组件由画布作为**第三个参数**传入（规格 §3.1/§8.1），容器负责放到自己的 DOM 位置上
  render: (props, _ctx, children) => <div style={containerStyle(props)}>{children}</div>,
};
