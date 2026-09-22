/**
 * 组件：流程步骤（process，PPT 常用）——每行一步，横向箭头连接或纵向排列，可带序号。
 */
import { Workflow } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, lines, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'items', label: '步骤（每行一步）', control: 'textarea', group: '内容', defaultValue: '接收任务\n分配车辆\n执行搬运\n回充待命' },
  {
    key: 'direction',
    label: '方向',
    control: 'select',
    group: '布局',
    defaultValue: 'horizontal',
    options: [
      { label: '横向 horizontal', value: 'horizontal' },
      { label: '纵向 vertical', value: 'vertical' },
    ],
  },
  { key: 'numbered', label: '显示序号', control: 'switch', group: '内容', defaultValue: true },
  { key: 'arrow', label: '显示箭头', control: 'switch', group: '外观', defaultValue: true },
  fontSizeProp(12),
  { key: 'accent', label: '主色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  widthProp(),
  marginProp(),
];

export const processComponent: ComponentDefinition = {
  type: 'process',
  label: '流程步骤',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: Workflow,
  description: 'PPT 流程图：步骤 + 箭头，横/纵向可切换',
  defaultFrame: { x: 40, y: 150, w: 640, h: 90 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    const accent = asString(props.accent, '#1677ff');
    const horizontal = asEnum(props.direction, ['horizontal', 'vertical'] as const, 'horizontal') === 'horizontal';
    const items = lines(props.items);
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: horizontal ? 'center' : 'flex-start',
          gap: horizontal ? 0 : 8,
          width: `${asNumber(props.width, 100)}%`,
          fontSize: size,
        }}
      >
        {items.map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 8,
                background: '#f2f7ff',
                border: `1px solid ${accent}33`,
                color: '#1f2329',
                whiteSpace: 'nowrap',
              }}
            >
              {asBool(props.numbered, true) && (
                <span
                  style={{
                    width: size * 1.4,
                    height: size * 1.4,
                    lineHeight: `${size * 1.4}px`,
                    textAlign: 'center',
                    borderRadius: '50%',
                    background: accent,
                    color: '#fff',
                    fontSize: size * 0.8,
                    flex: 'none',
                  }}
                >
                  {i + 1}
                </span>
              )}
              {s}
            </div>
            {asBool(props.arrow, true) && i !== items.length - 1 && (
              <span style={{ color: accent, padding: horizontal ? '0 6px' : 0, transform: horizontal ? undefined : 'rotate(90deg)' }}>➜</span>
            )}
          </div>
        ))}
      </div>
    );
  },
};
