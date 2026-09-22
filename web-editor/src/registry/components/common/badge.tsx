/**
 * 组件：徽章 / 按键标签（badge）
 * 由 A4 编辑器的「徽章」「按键标签」两个组件合并而来（variant 区分）。
 * 行内样式的小标签：徽章=圆角浅蓝底，按键标签=等宽字体的"键盘键"外观。
 */
import { Star } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, alignOf, defaultsOf } from '../shared';
import { asEnum, asNumber, asString } from '../../../utils/id';

function BadgeBody(props: ComponentProps, ctx: RenderContext) {
  const variant = asEnum(props.variant, ['badge', 'kbd'] as const, 'badge');
  const isKbd = variant === 'kbd';
  const size = asNumber(props.fontSize, isKbd ? 10 : 9);
  const box: React.CSSProperties = {
    display: 'inline-block',
    padding: isKbd ? '1px 6px' : '2px 10px',
    borderRadius: isKbd ? 4 : 10,
    background: isKbd ? '#f3f4f6' : asString(props.background, '#e8f1f9'),
    color: isKbd ? '#374151' : asString(props.color, '#1d4e79'),
    border: isKbd ? '1px solid #d1d5db' : `1px solid ${asString(props.color, '#1d4e79')}33`,
    fontFamily: isKbd ? 'Consolas, "Courier New", monospace' : undefined,
    fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
    lineHeight: 1.6,
    whiteSpace: 'nowrap',
  };
  return (
    <div style={{ textAlign: alignOf(props.align), width: '100%', boxSizing: 'border-box' }}>
      <span style={box}>{asString(props.text, isKbd ? 'Ctrl+S' : '徽章')}</span>
    </div>
  );
}

const propSchema: PropSchemaItem[] = [
  {
    key: 'variant',
    label: '类型',
    control: 'select',
    group: GROUP.content,
    defaultValue: 'badge',
    options: [
      { label: '徽章 / 标签', value: 'badge' },
      { label: '按键 / 术语标签', value: 'kbd' },
    ],
  },
  { key: 'text', label: '文字', control: 'text', group: GROUP.content, defaultValue: '徽章' },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 9, unit: 'pt', min: 6, max: 24 },
  { key: 'align', label: '对齐', control: 'align', group: GROUP.typography, defaultValue: 'left' },
  { key: 'background', label: '底色', control: 'color', group: GROUP.appearance, defaultValue: '#e8f1f9' },
  { key: 'color', label: '文字颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1d4e79' },
];

export const badgeComponent: ComponentDefinition = {
  type: 'badge',
  label: '徽章/按键标签',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: Star,
  description: '行内小标签：徽章（圆角浅底）/ 按键标签（等宽字体 + 边框）',
  defaultFrame: { x: 40, y: 80, w: 160, h: 28 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => BadgeBody(props, ctx),
};
