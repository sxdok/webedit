/**
 * 组件：间隔块（spacer，文档常用）——固定高度的空白占位，用于撑开版面。
 */
import { MoveVertical } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asNumber } from '../../../utils/id';
import { defaultsOf } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'height', label: '高度', control: 'unit', group: '尺寸', defaultValue: 12, unit: 'mm', min: 1, max: 300 },
  { key: 'showHint', label: '显示占位提示（打印不显示）', control: 'switch', group: '高级', defaultValue: true },
];

export const spacerComponent: ComponentDefinition = {
  type: 'spacer',
  label: '间隔块',
  category: '布局分页',
  supportedModes: ['document', 'web'],
  icon: MoveVertical,
  description: '文档间隔：按 mm 撑开高度',
  defaultFrame: { x: 40, y: 300, w: 600, h: 48 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const mm = asNumber(props.height, 12);
    const px = ctx.mode === 'document' ? ctx.mmToPx(mm) : mm * 3.78;
    return (
      <div
        data-tip-text={`间隔 ${mm}mm`}
        style={{
          height: px,
          borderLeft: props.showHint === true ? '2px dotted #d0d5dd' : undefined,
          background: props.showHint === true ? 'repeating-linear-gradient(45deg,#fafafa,#fafafa 6px,#f2f4f7 6px,#f2f4f7 12px)' : undefined,
        }}
      />
    );
  },
};
