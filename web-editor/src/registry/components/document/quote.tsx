/**
 * 组件：引用块（quote，文档常用）——左边框 + 斜体/灰底，可附出处。
 */
import { Quote as QuoteIcon } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontProps, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'text', label: '引用内容', control: 'textarea', group: '内容', defaultValue: '引用的原文或标准条文，可在此填写。' },
  { key: 'source', label: '出处', control: 'text', group: '内容', defaultValue: '' },
  ...fontProps(12),
  { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#3d4653' },
  { key: 'accent', label: '左边框色', control: 'color', group: '外观', defaultValue: '#b9c9da' },
  { key: 'indent', label: '左右缩进 px', control: 'number', group: '尺寸', defaultValue: 0, min: 0, max: 120 },
  widthProp(),
  marginProp(),
];

export const quoteComponent: ComponentDefinition = {
  type: 'quote',
  label: '引用块',
  category: 'Word 常用',
  supportedModes: ['document', 'web'],
  icon: QuoteIcon,
  description: '文档引用块：左边框 + 出处，适合标准条文/原文',
  defaultFrame: { x: 60, y: 130, w: 520, h: 90 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    const indent = asNumber(props.indent, 0);
    return (
      <blockquote
        style={{
          margin: `${0}px ${indent}px`,
          padding: '6px 0 6px 12px',
          borderLeft: `3px solid ${asString(props.accent, '#b9c9da')}`,
          background: '#fafcfe',
          fontFamily: asString(props.fontFamily) || undefined,
          fontSize: size,
          fontWeight: asNumber(props.fontWeight, 400),
          lineHeight: asNumber(props.lineHeight, 1.6),
          color: asString(props.color, '#3d4653'),
          width: `${asNumber(props.width, 100)}%`,
        }}
      >
        {asString(props.text)}
        {asString(props.source) && (
          <footer style={{ marginTop: 4, fontSize: size * 0.9, color: '#8a94a6' }}>—— {asString(props.source)}</footer>
        )}
      </blockquote>
    );
  },
};
