/**
 * 组件：富文本块（richtext，通用）——contenteditable 编辑的 HTML 容器，属性面板里用富文本工具条改。
 */
import { FileText } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asNumber, asString } from '../../../utils/id';
import { alignOf, defaultsOf, fontProps, marginProp, paddingProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  {
    key: 'html',
    label: '内容',
    control: 'richtext',
    group: '内容',
    defaultValue: '这是一个<strong>富文本</strong>块：支持加粗、斜体、列表、链接与颜色。',
  },
  ...fontProps(12),
  { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#1f2329' },
  { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'left' },
  { key: 'indent', label: '首行缩进(em)', control: 'slider', group: '排版', defaultValue: 0, min: 0, max: 4, step: 0.5 },
  paddingProp(),
  widthProp(),
  marginProp(),
];

export const richtextComponent: ComponentDefinition = {
  type: 'richtext',
  label: '富文本',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: FileText,
  description: '富文本块（HTML），适合整段说明、图文混排',
  defaultFrame: { x: 40, y: 120, w: 520, h: 96 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    return (
      <div
        style={{
          fontFamily: asString(props.fontFamily) || undefined,
          fontSize: size,
          fontWeight: asNumber(props.fontWeight, 400),
          lineHeight: asNumber(props.lineHeight, 1.5),
          color: asString(props.color) || undefined,
          textAlign: alignOf(props.align),
          textIndent: asNumber(props.indent, 0) ? `${asNumber(props.indent, 0)}em` : undefined,
          padding: props.padding ? undefined : undefined,
          width: props.width != null ? `${asNumber(props.width, 100)}%` : undefined,
        }}
        dangerouslySetInnerHTML={{ __html: asString(props.html) }}
      />
    );
  },
};
