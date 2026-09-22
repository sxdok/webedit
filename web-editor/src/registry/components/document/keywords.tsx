/**
 * 组件：关键词（keywords）
 * 来自 A4 编辑器的「关键词 keywords」：一行"关键词：a；b；c"。标签加粗，条目用分隔符连接。
 */
import { Hash } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf } from '../shared';
import { asNumber, asString } from '../../../utils/id';

function KeywordsBody(props: ComponentProps, ctx: RenderContext) {
  const size = asNumber(props.fontSize, 10.5);
  const sep = asString(props.separator, '；') || '；';
  const items = asString(props.items)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div
      style={{
        fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
        lineHeight: asNumber(props.lineHeight, 1.6),
        color: asString(props.color, '#1f2329'),
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <strong style={{ fontWeight: 700, letterSpacing: 1 }}>{asString(props.label, '关键词：')}</strong>
      <span>{items.length ? items.join(sep) : '关键词一；关键词二'}</span>
    </div>
  );
}

const propSchema: PropSchemaItem[] = [
  { key: 'items', label: '关键词（每行一个）', control: 'textarea', group: GROUP.content, defaultValue: '关键词一\n关键词二', placeholder: '每行一个' },
  { key: 'label', label: '标签文字', control: 'text', group: GROUP.content, defaultValue: '关键词：' },
  { key: 'separator', label: '分隔符', control: 'text', group: GROUP.content, defaultValue: '；' },
  { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
  { key: 'lineHeight', label: '行距', control: 'slider', group: GROUP.typography, defaultValue: 1.6, min: 1, max: 3, step: 0.1 },
  { key: 'color', label: '文字颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1f2329' },
];

export const keywordsComponent: ComponentDefinition = {
  type: 'keywords',
  label: '关键词',
  category: 'Word 常用',
  supportedModes: ['document', 'web'],
  icon: Hash,
  description: '一行"关键词：a；b；c"，每行填一个关键词',
  defaultFrame: { x: 40, y: 80, w: 560, h: 28 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => KeywordsBody(props, ctx),
};
