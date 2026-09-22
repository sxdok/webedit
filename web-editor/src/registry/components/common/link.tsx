/**
 * 组件：链接（link）
 * 来自 A4 编辑器的「链接」组件：文字 + 地址；打印时保留下划线（A4 排版里"打印带下划线"是刻意行为）。
 */
import { Link2 } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, alignOf, defaultsOf } from '../shared';
import { asNumber, asString } from '../../../utils/id';

function LinkBody(props: ComponentProps, ctx: RenderContext) {
  const size = asNumber(props.fontSize, 12);
  return (
    <div style={{ textAlign: alignOf(props.align), width: '100%', boxSizing: 'border-box' }}>
      <a
        href={asString(props.href, '#') || '#'}
        target={asString(props.target, '_blank') || undefined}
        rel="noreferrer"
        style={{
          color: asString(props.color, '#1a5fb4'),
          textDecoration: 'underline',
          fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
          wordBreak: 'break-all',
        }}
      >
        {asString(props.text, '链接文字')}
      </a>
    </div>
  );
}

const propSchema: PropSchemaItem[] = [
  { key: 'text', label: '链接文字', control: 'text', group: GROUP.content, defaultValue: '链接文字' },
  { key: 'href', label: '链接地址', control: 'text', group: GROUP.content, defaultValue: 'https://', placeholder: 'https://…' },
  {
    key: 'target',
    label: '打开方式',
    control: 'select',
    group: GROUP.content,
    defaultValue: '_blank',
    options: [
      { label: '新窗口', value: '_blank' },
      { label: '当前窗口', value: '_self' },
    ],
  },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 12, unit: 'pt', min: 6, max: 36 },
  { key: 'align', label: '对齐', control: 'align', group: GROUP.typography, defaultValue: 'left' },
  { key: 'color', label: '链接颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1a5fb4' },
];

export const linkComponent: ComponentDefinition = {
  type: 'link',
  label: '链接',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: Link2,
  description: '文字 + 地址的超链接，打印时保留下划线',
  defaultFrame: { x: 40, y: 80, w: 220, h: 26 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => LinkBody(props, ctx),
};
