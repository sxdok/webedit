/**
 * 组件：柱状图（chartBar，PPT/文档常用）——每行「标签|值」，纯 SVG 绘制（不引入图表库）。
 */
import { BarChart3 } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, marginProp, rows, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'items', label: '数据（每行：标签|值）', control: 'textarea', group: '内容', defaultValue: '一月|120\n二月|180\n三月|150\n四月|210' },
  { key: 'max', label: '纵轴最大值（0=自动）', control: 'number', group: '内容', defaultValue: 0, min: 0, max: 100000 },
  { key: 'height', label: '图高 px', control: 'number', group: '尺寸', defaultValue: 180, min: 60, max: 600 },
  { key: 'accent', label: '柱色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  { key: 'showValue', label: '显示数值', control: 'switch', group: '外观', defaultValue: true },
  { key: 'showAxis', label: '显示基线', control: 'switch', group: '外观', defaultValue: true },
  fontSizeProp(10.5),
  widthProp(),
  marginProp(),
];

export const chartBarComponent: ComponentDefinition = {
  type: 'chartBar',
  label: '柱状图',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: BarChart3,
  description: 'PPT 数据页：SVG 柱状图，数据来自"标签|值"',
  defaultFrame: { x: 40, y: 140, w: 600, h: 240 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const data = rows(props.items).map((r) => ({ label: r[0] ?? '', value: asNumber(r[1], 0) }));
    const autoMax = Math.max(1, ...data.map((d) => d.value));
    const max = asNumber(props.max, 0) > 0 ? asNumber(props.max, autoMax) : autoMax;
    const H = asNumber(props.height, 180);
    const accent = asString(props.accent, '#1677ff');
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 10.5)) : asNumber(props.fontSize, 10.5);
    const labelH = size * 1.6;
    const chartH = Math.max(30, H - labelH - (asBool(props.showValue, true) ? size * 1.4 : 0));
    const w = 100; // 百分比布局：每个柱用一个 flex 单元，内部用 SVG 无意义，直接 div 高度即可
    void w;
    return (
      <div style={{ width: `${asNumber(props.width, 100)}%`, fontSize: size }}>
        {asBool(props.showAxis, true) && <div style={{ height: 1, background: '#e5e7eb', marginBottom: 2 }} />}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: chartH }}>
          {data.map((d, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
              {asBool(props.showValue, true) && (
                <div style={{ textAlign: 'center', color: '#5b6472', marginBottom: 2 }}>{d.value}</div>
              )}
              <div
                title={`${d.label}：${d.value}`}
                style={{
                  height: `${Math.max(2, (d.value / max) * 100)}%`,
                  background: accent,
                  borderRadius: '3px 3px 0 0',
                  opacity: 0.9,
                }}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {data.map((d, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', color: '#7a8496' }}>
              {d.label}
            </div>
          ))}
        </div>
      </div>
    );
  },
};
