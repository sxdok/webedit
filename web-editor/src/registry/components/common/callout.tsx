/**
 * 组件：提示 / 示意 / 警示框（callout）
 * 由 A4 编辑器的「提示框 note」「示意框 flow」「警示框 warn」三个组件合并而来（用 variant 区分），
 * 渲染为"左侧色条 + 浅底色"的标注框，两种编辑模式都可用。
 */
import { Megaphone } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf, spacingCss } from '../shared';
import { asEnum, asNumber, asString } from '../../../utils/id';

const LOOK = {
  note: { border: '#34a853', bg: '#f0f9f2' },
  flow: { border: '#2f7fd1', bg: '#eef6fd' },
  warn: { border: '#f0932b', bg: '#fff7ec' },
} as const;

function CalloutBody(props: ComponentProps, ctx: RenderContext) {
  const variant = asEnum(props.variant, ['note', 'flow', 'warn'] as const, 'note');
  const look = LOOK[variant];
  const bw = asNumber(props.borderWidth, 3);
  const size = asNumber(props.fontSize, 10.5);
  return (
    <div
      style={{
        borderLeft: `${bw}px solid ${look.border}`,
        background: look.bg,
        padding: spacingCss(props.padding, 10),
        fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
        lineHeight: asNumber(props.lineHeight, 1.5),
        color: asString(props.color, '#1f2329'),
        whiteSpace: 'pre-wrap',
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      {asString(props.text, '')}
    </div>
  );
}

const propSchema: PropSchemaItem[] = [
  {
    key: 'variant',
    label: '类型',
    control: 'select',
    group: GROUP.content,
    defaultValue: 'note',
    options: [
      { label: '提示（绿边）', value: 'note' },
      { label: '示意（蓝边）', value: 'flow' },
      { label: '警示（橙边）', value: 'warn' },
    ],
  },
  { key: 'text', label: '内容', control: 'textarea', group: GROUP.content, defaultValue: '这里写提示内容…' },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
  { key: 'lineHeight', label: '行距', control: 'slider', group: GROUP.typography, defaultValue: 1.5, min: 1, max: 3, step: 0.1 },
  { key: 'color', label: '文字颜色', control: 'color', group: GROUP.typography, defaultValue: '#1f2329' },
  { key: 'borderWidth', label: '色条宽度', control: 'number', group: GROUP.appearance, defaultValue: 3, min: 1, max: 12 },
  { key: 'padding', label: '内边距', control: 'spacing', group: GROUP.size, defaultValue: { value: 10, unit: 'px' } },
];

export const calloutComponent: ComponentDefinition = {
  type: 'callout',
  label: '提示/示意/警示框',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: Megaphone,
  description: '左侧色条 + 浅底的三类标注框：提示（绿）/ 示意（蓝）/ 警示（橙）',
  defaultFrame: { x: 40, y: 120, w: 420, h: 72 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => CalloutBody(props, ctx),
};
