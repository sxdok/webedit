/**
 * 组件：日期（dateField，文档常用）——固定文本或按格式生成今天的日期。
 */
import { CalendarDays } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asNumber, asString } from '../../../utils/id';
import { alignOf, defaultsOf, fontFamilyProp, fontSizeProp, marginProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'prefix', label: '前缀', control: 'text', group: '内容', defaultValue: '日期：' },
  { key: 'manual', label: '手动文本（留空则用今天）', control: 'text', group: '内容', defaultValue: '' },
  {
    key: 'format',
    label: '格式',
    control: 'select',
    group: '内容',
    defaultValue: 'YYYY年M月D日',
    options: [
      { label: '2026年9月22日', value: 'YYYY年M月D日' },
      { label: '2026-09-22', value: 'YYYY-MM-DD' },
      { label: '2026/09/22', value: 'YYYY/MM/DD' },
      { label: '2026年9月', value: 'YYYY年M月' },
    ],
  },
  { key: 'live', label: '使用当天日期', control: 'switch', group: '内容', defaultValue: true },
  fontFamilyProp(),
  fontSizeProp(12),
  { key: 'color', label: '颜色', control: 'color', group: '排版', defaultValue: '#1f2329' },
  { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'left' },
  marginProp(),
];

function formatDate(fmt: string, d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return fmt
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, p2(d.getMonth() + 1))
    .replace(/M/g, String(d.getMonth() + 1))
    .replace(/DD/g, p2(d.getDate()))
    .replace(/D/g, String(d.getDate()));
}

export const dateComponent: ComponentDefinition = {
  type: 'date',
  label: '日期',
  category: 'Word 常用',
  supportedModes: ['document', 'web'],
  icon: CalendarDays,
  description: '日期行：可固定文本或按格式取当天',
  defaultFrame: { x: 40, y: 200, w: 260, h: 24 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    const manual = asString(props.manual);
    const text = manual || formatDate(asString(props.format, 'YYYY年M月D日'), asBool(props.live, true) ? new Date() : new Date(2026, 8, 22));
    return (
      <div
        style={{
          fontFamily: asString(props.fontFamily) || undefined,
          fontSize: size,
          color: asString(props.color, '#1f2329'),
          textAlign: alignOf(props.align),
        }}
      >
        {asString(props.prefix)}
        {text}
      </div>
    );
  },
};
