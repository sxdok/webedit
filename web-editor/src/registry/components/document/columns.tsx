/**
 * 组件：分栏（columns，文档常用）——2/3 栏排版，每栏一段文字，可设栏间距与比例。
 * 容器组件：子组件会注入到每一栏里（默认放在第一栏）。
 */
import { Columns3 } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asEnum, asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, lineHeightProp, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'col1', label: '第 1 栏内容', control: 'textarea', group: '内容', defaultValue: '第一栏：适用于要点并列说明。' },
  { key: 'col2', label: '第 2 栏内容', control: 'textarea', group: '内容', defaultValue: '第二栏：与左栏等宽，可对比。' },
  { key: 'col3', label: '第 3 栏内容（3 栏时用）', control: 'textarea', group: '内容', defaultValue: '' },
  {
    key: 'count',
    label: '栏数',
    control: 'select',
    group: '布局',
    defaultValue: 2,
    options: [
      { label: '2 栏', value: 2 },
      { label: '3 栏', value: 3 },
    ],
  },
  {
    key: 'ratio',
    label: '比例',
    control: 'select',
    group: '布局',
    defaultValue: '1:1',
    options: [
      { label: '1:1 等宽', value: '1:1' },
      { label: '1:2', value: '1:2' },
      { label: '2:1', value: '2:1' },
    ],
  },
  { key: 'gap', label: '栏间距 px', control: 'number', group: '布局', defaultValue: 16, min: 0, max: 80 },
  fontSizeProp(12),
  lineHeightProp(1.5),
  { key: 'divider', label: '显示栏间分隔线', control: 'switch', group: '外观', defaultValue: false },
  widthProp(),
  marginProp(),
];

export const columnsComponent: ComponentDefinition = {
  type: 'columns',
  label: '分栏',
  category: '布局分页',
  supportedModes: ['document', 'web'],
  icon: Columns3,
  isContainer: true,
  description: '文档分栏：2/3 栏，可设比例与栏间距',
  defaultFrame: { x: 40, y: 140, w: 620, h: 160 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const count = asNumber(props.count, 2) === 3 ? 3 : 2;
    const ratio = asEnum(props.ratio, ['1:1', '1:2', '2:1'] as const, '1:1');
    const fr = (i: number) => {
      if (count === 3 || ratio === '1:1') return 1;
      const first = ratio === '1:2' ? 1 : 2;
      return i === 0 ? first : 3 - first;
    };
    const texts = [asString(props.col1), asString(props.col2), count === 3 ? asString(props.col3) : ''];
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: Array.from({ length: count }, (_, i) => `${fr(i)}fr`).join(' '),
          gap: asNumber(props.gap, 16),
          width: `${asNumber(props.width, 100)}%`,
          fontSize: size,
          lineHeight: asNumber(props.lineHeight, 1.5),
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            data-col={i}
            style={{
              minWidth: 0,
              paddingLeft: i > 0 && props.divider === true ? 12 : undefined,
              borderLeft: i > 0 && props.divider === true ? '1px solid #e5e7eb' : undefined,
            }}
          >
            {texts[i].split('\n').filter(Boolean).map((t, j) => (
              <p key={j} style={{ margin: '0 0 6px' }}>
                {t}
              </p>
            ))}
          </div>
        ))}
      </div>
    );
  },
};
