/**
 * 组件：左右对比（compare，PPT 常用）——两栏标题 + 各自条目，可标出推荐侧。
 */
import { Columns2 } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asEnum, asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, lines, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'leftTitle', label: '左栏标题', control: 'text', group: '内容', defaultValue: '现状' },
  { key: 'leftItems', label: '左栏条目（每行一条）', control: 'textarea', group: '内容', defaultValue: '人工搬运、强度大\n找料耗时\n账实不符' },
  { key: 'rightTitle', label: '右栏标题', control: 'text', group: '内容', defaultValue: '改造后' },
  { key: 'rightItems', label: '右栏条目（每行一条）', control: 'textarea', group: '内容', defaultValue: 'AGV 自动配送\n系统调度、路径最优\n账实同步' },
  {
    key: 'highlight',
    label: '高亮哪一侧',
    control: 'select',
    group: '外观',
    defaultValue: 'right',
    options: [
      { label: '左侧', value: 'left' },
      { label: '右侧', value: 'right' },
      { label: '都不高亮', value: 'none' },
    ],
  },
  fontSizeProp(12),
  { key: 'accent', label: '高亮色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  { key: 'gap', label: '栏间距', control: 'number', group: '布局', defaultValue: 16, min: 0, max: 64 },
  widthProp(),
  marginProp(),
];

export const compareComponent: ComponentDefinition = {
  type: 'compare',
  label: '左右对比',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: Columns2,
  description: 'PPT 对比页：两栏标题 + 条目，可高亮一侧',
  defaultFrame: { x: 40, y: 120, w: 640, h: 200 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    const accent = asString(props.accent, '#1677ff');
    const hl = asEnum(props.highlight, ['left', 'right', 'none'] as const, 'right');
    const col = (title: string, items: string, side: 'left' | 'right') => {
      const on = hl === side;
      return (
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${on ? accent : '#e5e7eb'}`,
            background: on ? `${accent}0f` : '#fff',
          }}
        >
          <div style={{ fontWeight: 700, color: on ? accent : '#1f2329', marginBottom: 6 }}>{title}</div>
          <ul style={{ margin: 0, paddingLeft: '1.2em', color: '#3d4653' }}>
            {lines(items).map((t, i) => (
              <li key={i} style={{ marginBottom: 3 }}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      );
    };
    return (
      <div style={{ display: 'flex', gap: asNumber(props.gap, 16), width: `${asNumber(props.width, 100)}%`, fontSize: size }}>
        {col(asString(props.leftTitle, '现状'), asString(props.leftItems), 'left')}
        {col(asString(props.rightTitle, '改造后'), asString(props.rightItems), 'right')}
      </div>
    );
  },
};
