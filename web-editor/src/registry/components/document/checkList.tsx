/**
 * 组件：核对清单（checkList）
 * 来自 A4 编辑器的「核对清单 checks」：空心方框 + 条目，适合"待确认项 / 检查项"，
 * 打印是纸面清单，所以方框用 CSS 边框而不是可勾选的 input。
 */
import { CircleCheckBig } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf, lines } from '../shared';
import { asBool, asNumber, asString } from '../../../utils/id';

function CheckListBody(props: ComponentProps, ctx: RenderContext) {
  const size = asNumber(props.fontSize, 10.5);
  const box = asNumber(props.boxSize, 11);
  const items = lines(props.items);
  const data = items.length ? items : ['核对项一', '核对项二'];
  const color = asString(props.color, '#1f2329');
  const checked = asBool(props.checked, false);
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
        lineHeight: asNumber(props.lineHeight, 1.9),
        color,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {data.map((t, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span
            style={{
              flex: 'none',
              width: box,
              height: box,
              marginTop: 3,
              border: `1.5px solid ${color}`,
              borderRadius: 2,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: box * 0.8,
              lineHeight: 1,
            }}
          >
            {checked ? '✓' : ''}
          </span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

const propSchema: PropSchemaItem[] = [
  { key: 'items', label: '条目（每行一条）', control: 'textarea', group: GROUP.content, defaultValue: '核对项一\n核对项二', placeholder: '每行一条' },
  { key: 'checked', label: '全部打勾', control: 'switch', group: GROUP.content, defaultValue: false },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
  { key: 'lineHeight', label: '行距', control: 'slider', group: GROUP.typography, defaultValue: 1.9, min: 1, max: 3, step: 0.1 },
  { key: 'boxSize', label: '方框大小 px', control: 'number', group: GROUP.size, defaultValue: 11, min: 8, max: 24 },
  { key: 'color', label: '文字/方框颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1f2329' },
];

export const checkListComponent: ComponentDefinition = {
  type: 'checkList',
  label: '核对清单',
  category: 'Word 常用',
  supportedModes: ['document', 'web'],
  icon: CircleCheckBig,
  description: '空心方框 + 条目的核对清单（适合待确认项 / 检查项）',
  defaultFrame: { x: 40, y: 80, w: 420, h: 100 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => CheckListBody(props, ctx),
};
