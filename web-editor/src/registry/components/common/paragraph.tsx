/**
 * 组件：正文段落（paragraph）。支持富文本 html、对齐、字号、行距、字距、颜色、首行缩进（text-indent）。
 * 两种模式都支持。
 */
import { AlignLeft } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';

export const paragraphComponent: ComponentDefinition = {
  type: 'paragraph',
  label: '正文段落',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: AlignLeft,
  description: '富文本段落，首行缩进用 text-indent 实现',
  defaultFrame: { x: 40, y: 100, w: 520, h: 64 },
  defaultProps: {
    html: '在这里输入正文内容。',
    align: 'left',
    fontSize: 12,
    lineHeight: 1.5,
    letterSpacing: 0,
    color: '#1f2329',
    firstLineIndent: 2,
    rich: true,
  },
  propSchema: [
    { key: 'html', label: '内容', control: 'richtext', group: '内容', defaultValue: '在这里输入正文内容。' },
    { key: 'rich', label: '启用富文本', control: 'switch', group: '内容', defaultValue: true },
    { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'left' },
    { key: 'fontSize', label: '字号', control: 'unit', group: '排版', defaultValue: 12, unit: 'pt', min: 6, max: 72 },
    { key: 'lineHeight', label: '行距', control: 'slider', group: '排版', defaultValue: 1.5, min: 1, max: 3, step: 0.1 },
    { key: 'letterSpacing', label: '字距', control: 'number', group: '排版', defaultValue: 0, min: -2, max: 10, step: 0.5 },
    { key: 'firstLineIndent', label: '首行缩进(em)', control: 'slider', group: '排版', defaultValue: 2, min: 0, max: 4, step: 0.5 },
    { key: 'color', label: '颜色', control: 'color', group: '外观', defaultValue: '#1f2329' },
  ],
  render: (props, ctx) => {
    const fontSize = asNumber(props.fontSize, 12);
    const indent = asNumber(props.firstLineIndent, 2);
    return (
      <p
        style={{
          margin: 0,
          textAlign: asEnum(props.align, ['left', 'center', 'right', 'justify'] as const, 'left'),
          fontSize: ctx.mode === 'document' ? ctx.ptToPx(fontSize) : fontSize,
          lineHeight: asNumber(props.lineHeight, 1.5),
          letterSpacing: asNumber(props.letterSpacing, 0),
          color: asString(props.color, '#1f2329'),
          textIndent: indent ? `${indent}em` : undefined,
        }}
        {...(asBool(props.rich, true)
          ? { dangerouslySetInnerHTML: { __html: asString(props.html) } }
          : { children: asString(props.html) })}
      />
    );
  },
};
