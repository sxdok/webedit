/**
 * 组件：印章（stamp，文档常用）——圆形/方形印章占位：文字沿圈排布或居中 + 可选旋转。
 */
import { Stamp } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asEnum, asNumber, asString } from '../../../utils/id';
import { defaultsOf, marginProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'text', label: '印章文字', control: 'text', group: '内容', defaultValue: '江苏誉创智能科技' },
  { key: 'subText', label: '副文字（居中）', control: 'text', group: '内容', defaultValue: '' },
  { key: 'size', label: '直径 px', control: 'number', group: '尺寸', defaultValue: 110, min: 48, max: 260 },
  {
    key: 'shape',
    label: '形状',
    control: 'select',
    group: '外观',
    defaultValue: 'circle',
    options: [
      { label: '圆形', value: 'circle' },
      { label: '方形', value: 'square' },
    ],
  },
  { key: 'color', label: '印章颜色', control: 'color', group: '外观', defaultValue: '#c0392b' },
  { key: 'rotation', label: '旋转角度', control: 'slider', group: '外观', defaultValue: -12, min: -90, max: 90, step: 1 },
  { key: 'filled', label: '实心（文字反白）', control: 'switch', group: '外观', defaultValue: false },
  marginProp(),
];

export const stampComponent: ComponentDefinition = {
  type: 'stamp',
  label: '印章',
  category: '文档专用',
  supportedModes: ['document', 'web'],
  icon: Stamp,
  description: '印章占位：圆形/方形、可旋转、可实心',
  defaultFrame: { x: 420, y: 480, w: 110, h: 110 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props) => {
    const size = asNumber(props.size, 110);
    const color = asString(props.color, '#c0392b');
    const circle = asEnum(props.shape, ['circle', 'square'] as const, 'circle') === 'circle';
    const filled = props.filled === true;
    return (
      <div
        title="印章"
        style={{
          width: size,
          height: size,
          borderRadius: circle ? '50%' : 6,
          border: `2.5px solid ${color}`,
          background: filled ? color : 'transparent',
          color: filled ? '#fff' : color,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          transform: `rotate(${asNumber(props.rotation, -12)}deg)`,
          textAlign: 'center',
          padding: 8,
          boxSizing: 'border-box',
          opacity: 0.9,
        }}
      >
        <span style={{ fontSize: size * 0.13, fontWeight: 700, lineHeight: 1.25 }}>{asString(props.text)}</span>
        {asString(props.subText) && <span style={{ fontSize: size * 0.11 }}>{asString(props.subText)}</span>}
      </div>
    );
  },
};
