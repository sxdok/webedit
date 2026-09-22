/**
 * 组件：大字引用页（quoteSlide，PPT 常用）——一句结论/金句 + 出处，居中大字。
 */
import { Quote } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, fontWeightProp, lineHeightProp, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'text', label: '引用文字', control: 'textarea', group: '内容', defaultValue: '让搬运这件事，变得可预期。' },
  { key: 'source', label: '出处/说明', control: 'text', group: '内容', defaultValue: '— 项目组' },
  fontSizeProp(28),
  fontWeightProp(700),
  lineHeightProp(1.4),
  { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#1f2329' },
  { key: 'accent', label: '装饰色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  widthProp(),
  marginProp(),
];

export const quoteSlideComponent: ComponentDefinition = {
  type: 'quoteSlide',
  label: '引用页',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: Quote,
  description: 'PPT 金句/结论页：居中大字 + 出处',
  defaultFrame: { x: 80, y: 120, w: 560, h: 180 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 28)) : asNumber(props.fontSize, 28);
    return (
      <div style={{ width: `${asNumber(props.width, 100)}%`, textAlign: 'center', padding: '18px 0' }}>
        <div style={{ fontSize: size * 1.6, lineHeight: 1, color: asString(props.accent, '#1677ff'), opacity: 0.35 }}>“</div>
        <div
          style={{
            fontSize: size,
            fontWeight: asNumber(props.fontWeight, 700),
            lineHeight: asNumber(props.lineHeight, 1.4),
            color: asString(props.color, '#1f2329'),
          }}
        >
          {asString(props.text)}
        </div>
        {asString(props.source) && (
          <div style={{ marginTop: 10, fontSize: size * 0.45, color: '#8a94a6' }}>{asString(props.source)}</div>
        )}
      </div>
    );
  },
};
