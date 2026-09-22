/**
 * 组件：时间轴（timeline，PPT/文档常用）——每行「时间|事件」，纵向节点 + 竖线。
 */
import { GitCommitHorizontal } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, lineHeightProp, marginProp, rows, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'items', label: '节点（每行：时间|事件）', control: 'textarea', group: '内容', defaultValue: '第 1 月|需求确认与现场勘察\n第 2 月|设备进场与安装\n第 3 月|联调与试运行\n第 4 月|验收与培训' },
  fontSizeProp(12),
  lineHeightProp(1.5),
  { key: 'accent', label: '主色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  { key: 'lineColor', label: '轴线颜色', control: 'color', group: '外观', defaultValue: '#dce7f2' },
  { key: 'timeWidth', label: '时间列宽 px', control: 'number', group: '布局', defaultValue: 88, min: 40, max: 240 },
  widthProp(),
  marginProp(),
];

export const timelineComponent: ComponentDefinition = {
  type: 'timeline',
  label: '时间轴',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: GitCommitHorizontal,
  description: 'PPT 时间轴：时间|事件 逐行，节点圆点 + 竖线',
  defaultFrame: { x: 60, y: 120, w: 520, h: 220 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    const accent = asString(props.accent, '#1677ff');
    const line = asString(props.lineColor, '#dce7f2');
    const items = rows(props.items);
    return (
      <div style={{ width: `${asNumber(props.width, 100)}%`, fontSize: size, lineHeight: asNumber(props.lineHeight, 1.5) }}>
        {items.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: i === items.length - 1 ? 0 : 14 }}>
            <div style={{ width: asNumber(props.timeWidth, 88), flex: 'none', color: '#7a8496', textAlign: 'right' }}>{r[0] ?? ''}</div>
            <div style={{ position: 'relative', width: 12, flex: 'none' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 2,
                  top: size * 0.45,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: accent,
                }}
              />
              {i !== items.length - 1 && (
                <span style={{ position: 'absolute', left: 5.5, top: size * 0.45 + 10, bottom: -6, width: 1, background: line }} />
              )}
            </div>
            <div style={{ flex: 1, color: '#1f2329' }}>{r[1] ?? r[0] ?? ''}</div>
          </div>
        ))}
      </div>
    );
  },
};
