/**
 * 组件：页码（pageNumber，文档常用）——样式可选的页码行；文档模式下由页脚统一渲染，
 * 这里作为可插入的占位/独立页码行使用。
 */
import { Hash } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asEnum, asNumber, asString } from '../../../utils/id';
import { alignOf, defaultsOf, fontFamilyProp, fontSizeProp, marginProp } from '../shared';

const schema: PropSchemaItem[] = [
  {
    key: 'format',
    label: '格式',
    control: 'select',
    group: '内容',
    defaultValue: '第N页/共M页',
    options: [
      { label: '第 N 页 / 共 M 页', value: '第N页/共M页' },
      { label: 'N / M', value: 'N/M' },
      { label: 'Page N', value: 'PageN' },
      { label: '— N —', value: 'dashN' },
    ],
  },
  { key: 'page', label: '当前页', control: 'number', group: '内容', defaultValue: 1, min: 1, max: 9999 },
  { key: 'total', label: '总页数', control: 'number', group: '内容', defaultValue: 1, min: 1, max: 9999 },
  fontFamilyProp(),
  fontSizeProp(10.5),
  { key: 'color', label: '颜色', control: 'color', group: '排版', defaultValue: '#5b6472' },
  { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'center' },
  marginProp(),
];

const FORMATS: Record<string, (p: number, t: number) => string> = {
  '第N页/共M页': (p, t) => `第 ${p} 页 / 共 ${t} 页`,
  'N/M': (p, t) => `${p} / ${t}`,
  PageN: (p) => `Page ${p}`,
  dashN: (p) => `— ${p} —`,
};

export const pageNumberComponent: ComponentDefinition = {
  type: 'pageNumber',
  label: '页码',
  category: 'Word 常用',
  supportedModes: ['document', 'web'],
  icon: Hash,
  description: '页码行：第 N 页 / 共 M 页 等四种格式',
  defaultFrame: { x: 40, y: 700, w: 640, h: 24 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 10.5)) : asNumber(props.fontSize, 10.5);
    const fmt = FORMATS[asEnum(props.format, ['第N页/共M页', 'N/M', 'PageN', 'dashN'] as const, '第N页/共M页')];
    return (
      <div
        style={{
          fontFamily: asString(props.fontFamily) || undefined,
          fontSize: size,
          color: asString(props.color, '#5b6472'),
          textAlign: alignOf(props.align),
        }}
      >
        {fmt(asNumber(props.page, 1), asNumber(props.total, 1))}
      </div>
    );
  },
};
