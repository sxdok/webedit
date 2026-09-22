/**
 * 组件：数据卡片组（kpiCards，PPT 常用）——每行一个指标「标签|数值|说明」，等宽分列。
 */
import { LayoutDashboard } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asNumber, asString } from '../../../utils/id';
import { backgroundProp, borderProps, defaultsOf, fontSizeProp, marginProp, paddingProp, rows, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'items', label: '指标（每行：标签|数值|说明）', control: 'textarea', group: '内容', defaultValue: '设备数量|128|台\n在线率|99.6|%\n平均节拍|42|秒/单\n异常告警|3|条/日' },
  { key: 'columns', label: '每行列数', control: 'number', group: '布局', defaultValue: 4, min: 1, max: 6 },
  { key: 'gap', label: '卡片间距', control: 'number', group: '布局', defaultValue: 12, min: 0, max: 48 },
  fontSizeProp(12),
  { key: 'valueColor', label: '数值颜色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  backgroundProp('#ffffff'),
  ...borderProps(),
  { key: 'shadow', label: '阴影', control: 'switch', group: '外观', defaultValue: true },
  paddingProp(14),
  widthProp(),
  marginProp(),
];

export const kpiCardsComponent: ComponentDefinition = {
  type: 'kpiCards',
  label: '数据卡片',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: LayoutDashboard,
  description: 'PPT 数据卡片组：标签/数值/说明，自动等宽分列',
  defaultFrame: { x: 40, y: 120, w: 620, h: 120 },
  defaultProps: defaultsOf(schema, { padding: { value: 14, unit: 'px' } }),
  propSchema: schema,
  render: (props, ctx) => {
    const cols = Math.max(1, asNumber(props.columns, 4));
    const bw = asNumber(props.borderWidth, 0);
    const card = {
      background: asString(props.background, '#ffffff'),
      border: bw ? `${bw}px solid ${asString(props.borderColor, '#e5e7eb')}` : '1px solid #eef1f5',
      borderRadius: asNumber(props.borderRadius, 8),
      boxShadow: asBool(props.shadow, true) ? '0 1px 6px rgba(0,0,0,.06)' : undefined,
      padding: `${asNumber((props.padding as { value?: number } | undefined)?.value, 14)}px`,
    };
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`,
          gap: asNumber(props.gap, 12),
          width: `${asNumber(props.width, 100)}%`,
          margin: undefined,
        }}
      >
        {rows(props.items).map((r, i) => (
          <div key={i} style={card}>
            <div style={{ fontSize: size * 0.92, color: '#7a8496' }}>{r[0] ?? ''}</div>
            <div
              style={{
                fontSize: size * 2,
                fontWeight: 700,
                color: asString(props.valueColor, '#1677ff'),
                lineHeight: 1.3,
              }}
            >
              {r[1] ?? ''}
            </div>
            {r[2] && <div style={{ fontSize: size * 0.85, color: '#98a2b3' }}>{r[2]}</div>}
          </div>
        ))}
      </div>
    );
  },
};
