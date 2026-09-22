/**
 * 组件：幻灯封面页（slideTitle，PPT 常用）——主标题 + 副标题 + 演讲人/日期 + 装饰色条。
 * 属性全部由 shared 的通用片段组合（字体/外观/尺寸同一套词汇）。
 */
import { Presentation } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asNumber, asString } from '../../../utils/id';
import {
  alignOf,
  backgroundProp,
  boxStyle,
  defaultsOf,
  fontFamilyProp,
  fontSizeProp,
  fontWeightProp,
  lineHeightProp,
  marginProp,
  paddingProp,
  widthProp,
} from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'title', label: '主标题', control: 'text', group: '内容', defaultValue: '演示标题' },
  { key: 'subtitle', label: '副标题', control: 'text', group: '内容', defaultValue: '副标题 / 一句话说明' },
  { key: 'presenter', label: '演讲人', control: 'text', group: '内容', defaultValue: '' },
  { key: 'date', label: '日期', control: 'text', group: '内容', defaultValue: '' },
  fontFamilyProp(),
  fontSizeProp(28),
  fontWeightProp(700),
  lineHeightProp(1.25),
  { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'center' },
  { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#1f2329' },
  { key: 'accent', label: '主色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  { key: 'showBar', label: '显示色条', control: 'switch', group: '外观', defaultValue: true },
  backgroundProp(),
  paddingProp(24),
  widthProp(),
  marginProp(),
];

export const slideTitleComponent: ComponentDefinition = {
  type: 'slideTitle',
  label: '幻灯封面',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: Presentation,
  description: 'PPT 封面页：主标题/副标题/演讲人/日期 + 装饰色条',
  defaultFrame: { x: 40, y: 40, w: 640, h: 240 },
  defaultProps: defaultsOf(schema, { padding: { value: 24, unit: 'px' } }),
  propSchema: schema,
  render: (props, ctx) => {
    const accent = asString(props.accent, '#1677ff');
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 28)) : asNumber(props.fontSize, 28);
    const align = alignOf(props.align);
    return (
      <div style={{ ...boxStyle(props), textAlign: align, padding: '24px 8px' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: asString(props.fontFamily) || undefined,
            fontSize: size,
            fontWeight: asNumber(props.fontWeight, 700),
            color: asString(props.color) || '#1f2329',
            lineHeight: asNumber(props.lineHeight, 1.25),
          }}
        >
          {asString(props.title, '演示标题')}
        </h1>
        {asBool(props.showBar, true) && (
          <div
            style={{
              width: 72,
              height: 4,
              background: accent,
              borderRadius: 2,
              margin: align === 'center' ? '14px auto' : '14px 0',
            }}
          />
        )}
        {asString(props.subtitle) && (
          <p style={{ margin: '0 0 10px', fontSize: size * 0.5, color: '#5b6472' }}>{asString(props.subtitle)}</p>
        )}
        {(asString(props.presenter) || asString(props.date)) && (
          <p style={{ margin: 0, fontSize: size * 0.38, color: '#8a94a6' }}>
            {[asString(props.presenter), asString(props.date)].filter(Boolean).join('　·　')}
          </p>
        )}
      </div>
    );
  },
};
