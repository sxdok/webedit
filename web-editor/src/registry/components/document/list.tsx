/**
 * 组件：列表（list，文档专用）。每行一项，支持项目符号/编号、缩进、字号。
 */
import { List as ListIcon } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { asBool, asNumber } from '../../../utils/id';

export const listComponent: ComponentDefinition = {
  type: 'list',
  label: '列表',
  category: '文档专用',
  supportedModes: ['document'],
  icon: ListIcon,
  description: '项目符号或编号列表，每行一项',
  defaultProps: {
    items: '第一项\n第二项\n第三项',
    ordered: false,
    indent: 2,
    fontSize: 12,
  },
  propSchema: [
    { key: 'items', label: '条目（每行一项）', control: 'textarea', group: '内容', defaultValue: '第一项\n第二项\n第三项' },
    { key: 'ordered', label: '使用编号', control: 'switch', group: '内容', defaultValue: false },
    { key: 'indent', label: '缩进(em)', control: 'slider', group: '排版', defaultValue: 2, min: 0, max: 6, step: 0.5 },
    { key: 'fontSize', label: '字号', control: 'unit', group: '排版', defaultValue: 12, unit: 'pt', min: 6, max: 36 },
  ],
  render: (props, ctx) => {
    const items = String(props.items ?? '')
      .split('\n')
      .filter((s) => s.trim() !== '');
    const ordered = asBool(props.ordered, false);
    const Tag = ordered ? 'ol' : 'ul';
    return (
      <Tag
        style={{
          margin: 0,
          paddingLeft: `${asNumber(props.indent, 2)}em`,
          fontSize: ctx.ptToPx(asNumber(props.fontSize, 12)),
          lineHeight: 1.5,
        }}
      >
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </Tag>
    );
  },
};
