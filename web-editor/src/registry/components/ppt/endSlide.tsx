/**
 * 组件：结束页（endSlide，PPT 常用）——"谢谢观看" + 副标题 + 装饰色条。
 */
import { CircleCheckBig } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, fontWeightProp, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'title', label: '主文字', control: 'text', group: '内容', defaultValue: '谢谢观看' },
  { key: 'subtitle', label: '副标题', control: 'text', group: '内容', defaultValue: '欢迎交流指正' },
  { key: 'contact', label: '联系方式', control: 'text', group: '内容', defaultValue: '' },
  fontSizeProp(28),
  fontWeightProp(700),
  { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#1f2329' },
  { key: 'accent', label: '主色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  { key: 'showBar', label: '显示色条', control: 'switch', group: '外观', defaultValue: true },
  widthProp(),
  marginProp(),
];

export const endSlideComponent: ComponentDefinition = {
  type: 'endSlide',
  label: '结束页',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: CircleCheckBig,
  description: 'PPT 结束页：谢谢观看 + 副标题 + 联系方式',
  defaultFrame: { x: 80, y: 140, w: 560, h: 180 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 28)) : asNumber(props.fontSize, 28);
    return (
      <div style={{ width: `${asNumber(props.width, 100)}%`, textAlign: 'center', padding: '22px 0' }}>
        <div style={{ fontSize: size, fontWeight: asNumber(props.fontWeight, 700), color: asString(props.color, '#1f2329') }}>
          {asString(props.title, '谢谢观看')}
        </div>
        {asBool(props.showBar, true) && (
          <div style={{ width: 56, height: 3, background: asString(props.accent, '#1677ff'), borderRadius: 2, margin: '12px auto' }} />
        )}
        {asString(props.subtitle) && <div style={{ fontSize: size * 0.45, color: '#5b6472' }}>{asString(props.subtitle)}</div>}
        {asString(props.contact) && (
          <div style={{ marginTop: 12, fontSize: size * 0.38, color: '#8a94a6' }}>{asString(props.contact)}</div>
        )}
      </div>
    );
  },
};
