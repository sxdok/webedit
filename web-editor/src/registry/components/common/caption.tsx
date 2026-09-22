/**
 * 组件：题注（caption）—— 图题 / 表题
 * 来自 A4 编辑器的「图题 figcap」「表题 tabcap」两个组件（variant 区分）：
 * 图题放在图片下方、表题放在表格上方（A4 排版约定）。编号当前是**手填**，
 * 自动"按章编号"（图 X-Y）尚未实现——见 README「验收 / 未做项」。
 */
import { Quote } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf } from '../shared';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';

function CaptionBody(props: ComponentProps, ctx: RenderContext) {
  const kind = asEnum(props.kind, ['fig', 'table'] as const, 'fig');
  const size = asNumber(props.fontSize, 10.5);
  const number = asString(props.number);
  const prefix = `${kind === 'fig' ? '图' : '表'}${number ? ` ${number}` : ''}`;
  return (
    <div
      style={{
        textAlign: asEnum(props.align, ['left', 'center', 'right', 'justify'] as const, 'center'),
        fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
        fontWeight: asBool(props.bold, true) ? 600 : 400,
        color: asString(props.color, '#1f2329'),
        lineHeight: 1.5,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {prefix}
      {asString(props.text) ? `　${asString(props.text)}` : ''}
    </div>
  );
}

const propSchema: PropSchemaItem[] = [
  {
    key: 'kind',
    label: '类型',
    control: 'select',
    group: GROUP.content,
    defaultValue: 'fig',
    options: [
      { label: '图题（放图片下方）', value: 'fig' },
      { label: '表题（放表格上方）', value: 'table' },
    ],
  },
  { key: 'number', label: '编号（如 3-1，留空则不编号）', control: 'text', group: GROUP.content, defaultValue: '' },
  { key: 'text', label: '题注文字', control: 'text', group: GROUP.content, defaultValue: '这里是题注' },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
  { key: 'bold', label: '加粗', control: 'switch', group: GROUP.typography, defaultValue: true },
  { key: 'align', label: '对齐', control: 'align', group: GROUP.typography, defaultValue: 'center' },
  { key: 'color', label: '文字颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1f2329' },
];

export const captionComponent: ComponentDefinition = {
  type: 'caption',
  label: '图题/表题',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: Quote,
  description: '图题（图片下方）/ 表题（表格上方），编号手填；自动按章编号尚未实现',
  defaultFrame: { x: 40, y: 400, w: 400, h: 24 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => CaptionBody(props, ctx),
};
