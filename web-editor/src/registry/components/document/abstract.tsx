/**
 * 组件：摘要（abstract）
 * 来自 A4 编辑器的「摘要 abstract」：文档/章节开头的概述框（带"摘要"标签与浅底边框）。
 */
import { FileText } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf, spacingCss } from '../shared';
import { asBool, asNumber, asString } from '../../../utils/id';

function AbstractBody(props: ComponentProps, ctx: RenderContext) {
  const size = asNumber(props.fontSize, 10.5);
  return (
    <section
      style={{
        background: asString(props.background, '#f7f9fc'),
        border: `1px solid ${asString(props.borderColor, '#d6e0ec')}`,
        borderRadius: asNumber(props.borderRadius, 4),
        padding: spacingCss(props.padding, 12),
        fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
        lineHeight: asNumber(props.lineHeight, 1.6),
        color: asString(props.color, '#1f2329'),
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      {asBool(props.showLabel, true) && (
        <div style={{ fontWeight: 700, marginBottom: 4, letterSpacing: 2 }}>{asString(props.label, '摘　要')}</div>
      )}
      <div style={{ whiteSpace: 'pre-wrap' }}>{asString(props.text, '这里是摘要内容。')}</div>
    </section>
  );
}

const propSchema: PropSchemaItem[] = [
  { key: 'text', label: '摘要内容', control: 'textarea', group: GROUP.content, defaultValue: '这里是摘要内容。' },
  { key: 'label', label: '标签文字', control: 'text', group: GROUP.content, defaultValue: '摘　要' },
  { key: 'showLabel', label: '显示标签', control: 'switch', group: GROUP.content, defaultValue: true },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
  { key: 'lineHeight', label: '行距', control: 'slider', group: GROUP.typography, defaultValue: 1.6, min: 1, max: 3, step: 0.1 },
  { key: 'background', label: '底色', control: 'color', group: GROUP.appearance, defaultValue: '#f7f9fc' },
  { key: 'borderColor', label: '边框色', control: 'color', group: GROUP.appearance, defaultValue: '#d6e0ec' },
  { key: 'borderRadius', label: '圆角', control: 'number', group: GROUP.appearance, defaultValue: 4, min: 0, max: 40 },
  { key: 'color', label: '文字颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1f2329' },
  { key: 'padding', label: '内边距', control: 'spacing', group: GROUP.size, defaultValue: { value: 12, unit: 'px' } },
];

export const abstractComponent: ComponentDefinition = {
  type: 'abstract',
  label: '摘要',
  category: '文档专用',
  supportedModes: ['document', 'web'],
  icon: FileText,
  description: '文档/章节开头的摘要框（浅底 + 边框 + 标签）',
  defaultFrame: { x: 40, y: 80, w: 560, h: 120 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => AbstractBody(props, ctx),
};
