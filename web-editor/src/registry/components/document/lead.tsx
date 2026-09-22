/**
 * 组件：导语（lead）
 * 来自 A4 编辑器的「导语 lead」：段首无缩进、字号略大，用于章节开头点题。
 */
import { AlignLeft } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, alignOf, defaultsOf } from '../shared';
import { asNumber, asString } from '../../../utils/id';

function LeadBody(props: ComponentProps, ctx: RenderContext) {
  const size = asNumber(props.fontSize, 12.5);
  return (
    <p
      style={{
        margin: 0,
        fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
        lineHeight: asNumber(props.lineHeight, 1.6),
        color: asString(props.color, '#3f5570'),
        textAlign: alignOf(props.align),
        textIndent: 0,
        fontWeight: asNumber(props.fontWeight, 400),
        whiteSpace: 'pre-wrap',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {asString(props.text, '这里是导语：用一两句话点出本章要解决的问题。')}
    </p>
  );
}

const propSchema: PropSchemaItem[] = [
  { key: 'text', label: '文字', control: 'textarea', group: GROUP.content, defaultValue: '这里是导语：用一两句话点出本章要解决的问题。' },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 12.5, unit: 'pt', min: 6, max: 30 },
  { key: 'fontWeight', label: '字重', control: 'slider', group: GROUP.typography, defaultValue: 400, min: 300, max: 900, step: 100 },
  { key: 'lineHeight', label: '行距', control: 'slider', group: GROUP.typography, defaultValue: 1.6, min: 1, max: 3, step: 0.1 },
  { key: 'align', label: '对齐', control: 'align', group: GROUP.typography, defaultValue: 'left' },
  { key: 'color', label: '文字颜色', control: 'color', group: GROUP.appearance, defaultValue: '#3f5570' },
];

export const leadComponent: ComponentDefinition = {
  type: 'lead',
  label: '导语',
  category: 'Word 常用',
  supportedModes: ['document', 'web'],
  icon: AlignLeft,
  description: '章节开头的导语/提要：段首无缩进、字号略大',
  defaultFrame: { x: 40, y: 80, w: 560, h: 60 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => LeadBody(props, ctx),
};
