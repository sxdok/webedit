/**
 * 组件：分页符（pageBreak，文档专用）——强制"从这里另起一页"。
 * 说明：文档模式下内容超出纸张版心会自动排到下一页；分页符用于**手动**另起一页
 *      （相当于 Word 的 Ctrl+Enter）。屏幕上显示一条虚线标记，打印/导出时不出现，
 *      分页动作由分页器（PaperCanvas）与打印的 break-after 规则实现。
 */
import { Scissors } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asString } from '../../../utils/id';
import { defaultsOf } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'label', label: '标记文字（仅编辑态可见）', control: 'text', group: '内容', defaultValue: '分页符 —— 以下内容从新的一页开始' },
  { key: 'showLabel', label: '显示标记', control: 'switch', group: '外观', defaultValue: true },
];

export const pageBreakComponent: ComponentDefinition = {
  type: 'pageBreak',
  label: '分页符',
  category: '布局分页',
  supportedModes: ['document'],
  icon: Scissors,
  description: '强制另起一页（屏幕显示虚线标记，打印不出现）',
  defaultFrame: { x: 40, y: 300, w: 600, h: 24 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props) => (
    <div
      className="no-print"
      data-tip-text="分页符：以下内容从新的一页开始"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 22,
        margin: '4px 0',
        color: '#98a2b3',
        fontSize: 10,
        userSelect: 'none',
      }}
    >
      <span style={{ flex: '0 0 auto', borderTop: '1px dashed #c7ccd6', width: 40 }} />
      <span style={{ flex: 1, borderTop: '1px dashed #c7ccd6' }} />
      {asBool(props.showLabel, true) && (
        <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}>{asString(props.label, '分页符')}</span>
      )}
      <span style={{ flex: 1, borderTop: '1px dashed #c7ccd6' }} />
    </div>
  ),
};
