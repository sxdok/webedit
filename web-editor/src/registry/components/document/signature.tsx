/**
 * 组件：签名区（signature，文档常用）——「签字：____ 日期：____」式的签署栏，可两列。
 */
import { PenLine } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'leftLabel', label: '左签署人标签', control: 'text', group: '内容', defaultValue: '甲方（签字）' },
  { key: 'rightLabel', label: '右签署人标签', control: 'text', group: '内容', defaultValue: '乙方（签字）' },
  { key: 'dateLabel', label: '日期标签', control: 'text', group: '内容', defaultValue: '日期' },
  { key: 'lineWidth', label: '签字线宽 px', control: 'number', group: '尺寸', defaultValue: 140, min: 60, max: 400 },
  { key: 'gap', label: '两栏间距 px', control: 'number', group: '布局', defaultValue: 48, min: 0, max: 200 },
  fontSizeProp(12),
  { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#1f2329' },
  widthProp(),
  marginProp(),
];

export const signatureComponent: ComponentDefinition = {
  type: 'signature',
  label: '签名区',
  category: '文档专用',
  supportedModes: ['document', 'web'],
  icon: PenLine,
  description: '签署栏：甲方/乙方签字 + 日期，带下划线',
  defaultFrame: { x: 60, y: 480, w: 520, h: 90 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    const lw = asNumber(props.lineWidth, 140);
    const line = (label: string, withDate: boolean) => (
      <div style={{ fontSize: size, color: asString(props.color, '#1f2329') }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <span style={{ whiteSpace: 'nowrap' }}>{label}：</span>
          <span style={{ display: 'inline-block', width: lw, borderBottom: '1px solid #8a94a6', height: size * 1.4 }} />
        </div>
        {withDate && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 10 }}>
            <span style={{ whiteSpace: 'nowrap' }}>{asString(props.dateLabel, '日期')}：</span>
            <span style={{ display: 'inline-block', width: lw * 0.7, borderBottom: '1px solid #8a94a6', height: size * 1.4 }} />
          </div>
        )}
      </div>
    );
    return (
      <div style={{ display: 'flex', gap: asNumber(props.gap, 48), width: `${asNumber(props.width, 100)}%` }}>
        {line(asString(props.leftLabel, '甲方（签字）'), true)}
        {line(asString(props.rightLabel, '乙方（签字）'), true)}
      </div>
    );
  },
};
