/**
 * 组件：标题（heading）。渲染真实 h1–h6 语义标签，字号 pt → px（px = pt * 96 / 72）。
 * 两种模式都支持。
 */
import { Heading as HeadingIcon } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { asEnum, asNumber, asString } from '../../../utils/id';

const LEVELS = [
  { label: 'H1 主标题', value: 1 },
  { label: 'H2 章标题', value: 2 },
  { label: 'H3 节标题', value: 3 },
  { label: 'H4 小标题', value: 4 },
  { label: 'H5', value: 5 },
  { label: 'H6', value: 6 },
];

export const headingComponent: ComponentDefinition = {
  type: 'heading',
  label: '标题',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: HeadingIcon,
  description: '真实 h1–h6 语义标签，字号按 pt 换算',
  defaultFrame: { x: 40, y: 40, w: 480, h: 48 },
  defaultProps: {
    text: '标题文字',
    level: 2,
    align: 'left',
    color: '#1f2329',
    fontSize: 18,
    fontWeight: 600,
    marginTop: 12,
    marginBottom: 8,
  },
  propSchema: [
    { key: 'text', label: '文字', control: 'text', group: '内容', defaultValue: '标题文字' },
    { key: 'level', label: '级别', control: 'select', group: '内容', defaultValue: 2, options: LEVELS },
    {
      key: 'align',
      label: '对齐',
      control: 'align',
      group: '排版',
      defaultValue: 'left',
    },
    { key: 'fontSize', label: '字号', control: 'unit', group: '排版', defaultValue: 18, unit: 'pt', min: 6, max: 96 },
    { key: 'fontWeight', label: '字重', control: 'slider', group: '排版', defaultValue: 600, min: 300, max: 900, step: 100 },
    { key: 'color', label: '颜色', control: 'color', group: '外观', defaultValue: '#1f2329' },
    { key: 'marginTop', label: '上边距', control: 'number', group: '尺寸', defaultValue: 12, min: 0, max: 120 },
    { key: 'marginBottom', label: '下边距', control: 'number', group: '尺寸', defaultValue: 8, min: 0, max: 120 },
  ],
  render: (props, ctx) => {
    const level = Math.min(6, Math.max(1, asNumber(props.level, 2)));
    const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    const fontSize = asNumber(props.fontSize, 18);
    return (
      <Tag
        style={{
          margin: `${asNumber(props.marginTop, 12)}px 0 ${asNumber(props.marginBottom, 8)}px`,
          textAlign: asEnum(props.align, ['left', 'center', 'right', 'justify'] as const, 'left'),
          color: asString(props.color, '#1f2329'),
          fontSize: ctx.mode === 'document' ? ctx.ptToPx(fontSize) : fontSize,
          fontWeight: asNumber(props.fontWeight, 600),
          lineHeight: 1.3,
        }}
      >
        {asString(props.text, '标题文字')}
      </Tag>
    );
  },
};
