/**
 * 组件：定义列表（defList）
 * 来自 A4 编辑器的「定义列表 dl」：每行"术语|解释"渲染成 术语 — 解释 的对照行。
 */
import { List } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf, rows } from '../shared';
import { asNumber, asString } from '../../../utils/id';

function DefListBody(props: ComponentProps, ctx: RenderContext) {
  const size = asNumber(props.fontSize, 10.5);
  const termWidth = asNumber(props.termWidth, 32);
  const list = rows(props.entries);
  const data = list.length ? list : [['术语一', '解释一'], ['术语二', '解释二']];
  return (
    <dl
      style={{
        margin: 0,
        fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
        lineHeight: asNumber(props.lineHeight, 1.7),
        color: asString(props.color, '#1f2329'),
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {data.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', borderTop: i ? '1px dotted #d8e0ea' : undefined, paddingTop: i ? 4 : 0, marginTop: i ? 4 : 0 }}>
          <dt style={{ width: `${termWidth}%`, flex: 'none', fontWeight: 600 }}>{r[0] ?? ''}</dt>
          <dd style={{ margin: 0, flex: 1 }}>{r[1] ?? ''}</dd>
        </div>
      ))}
    </dl>
  );
}

const propSchema: PropSchemaItem[] = [
  {
    key: 'entries',
    label: '条目（每行一条，术语|解释）',
    control: 'textarea',
    group: GROUP.content,
    defaultValue: '术语一 | 解释一\n术语二 | 解释二',
    placeholder: '术语 | 解释',
  },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
  { key: 'lineHeight', label: '行距', control: 'slider', group: GROUP.typography, defaultValue: 1.7, min: 1, max: 3, step: 0.1 },
  { key: 'termWidth', label: '术语列宽 %', control: 'slider', group: GROUP.size, defaultValue: 32, min: 10, max: 60, step: 2 },
  { key: 'color', label: '文字颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1f2329' },
];

export const defListComponent: ComponentDefinition = {
  type: 'defList',
  label: '定义列表',
  category: '文档专用',
  supportedModes: ['document', 'web'],
  icon: List,
  description: '术语 — 解释 的对照列表，每行填"术语|解释"',
  defaultFrame: { x: 40, y: 80, w: 560, h: 120 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => DefListBody(props, ctx),
};
