/**
 * 组件：脚注（footnote，文档常用）——小字脚注，带上标序号与顶部细线。
 */
import { Asterisk } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asNumber, asString } from '../../../utils/id';
import { alignOf, defaultsOf, fontFamilyProp, fontSizeProp, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'index', label: '序号（如 1 / ①）', control: 'text', group: '内容', defaultValue: '1' },
  { key: 'text', label: '脚注内容', control: 'textarea', group: '内容', defaultValue: '注：此处为数据口径或补充说明。' },
  { key: 'showLine', label: '显示上方细分隔线', control: 'switch', group: '外观', defaultValue: true },
  fontFamilyProp(),
  fontSizeProp(9),
  { key: 'color', label: '颜色', control: 'color', group: '排版', defaultValue: '#5b6472' },
  { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'left' },
  widthProp(),
  marginProp(),
];

export const footnoteComponent: ComponentDefinition = {
  type: 'footnote',
  label: '脚注',
  category: '文档专用',
  supportedModes: ['document', 'web'],
  icon: Asterisk,
  description: '文档脚注：序号 + 小字说明 + 细分隔线',
  defaultFrame: { x: 40, y: 520, w: 600, h: 40 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 9)) : asNumber(props.fontSize, 9);
    return (
      <div
        style={{
          fontFamily: asString(props.fontFamily) || undefined,
          fontSize: size,
          color: asString(props.color, '#5b6472'),
          textAlign: alignOf(props.align),
          borderTop: asBool(props.showLine, true) ? '1px solid #e5e7eb' : undefined,
          paddingTop: asBool(props.showLine, true) ? 4 : undefined,
          width: `${asNumber(props.width, 100)}%`,
          lineHeight: 1.5,
        }}
      >
        {asString(props.index) && (
          <sup style={{ marginRight: 3, color: '#1677ff' }}>{asString(props.index)}</sup>
        )}
        {asString(props.text)}
      </div>
    );
  },
};
