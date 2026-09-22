/**
 * 组件：输入框（input，Web 专用）。渲染真实 <input> 外观（含 prefix/suffix），编辑态不接收真实输入。
 */
import { TextCursorInput } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';

const SIZES = [
  { label: '小 sm', value: 'sm' },
  { label: '中 md', value: 'md' },
  { label: '大 lg', value: 'lg' },
];

export const inputComponent: ComponentDefinition = {
  type: 'input',
  label: '输入框',
  category: 'Web 专用 / 基础控件',
  supportedModes: ['web'],
  icon: TextCursorInput,
  description: '真实 input 外观，支持前后缀、尺寸、圆角',
  defaultFrame: { x: 40, y: 90, w: 260, h: 32 },
  defaultProps: {
    placeholder: '请输入内容',
    value: '',
    size: 'md',
    disabled: false,
    prefix: '',
    suffix: '',
    borderRadius: 6,
  },
  propSchema: [
    { key: 'placeholder', label: '占位文字', control: 'text', group: '内容', defaultValue: '请输入内容' },
    { key: 'value', label: '默认值', control: 'text', group: '内容', defaultValue: '' },
    { key: 'prefix', label: '前缀', control: 'text', group: '内容', defaultValue: '' },
    { key: 'suffix', label: '后缀', control: 'text', group: '内容', defaultValue: '' },
    { key: 'size', label: '尺寸', control: 'select', group: '外观', defaultValue: 'md', options: SIZES },
    { key: 'borderRadius', label: '圆角', control: 'number', group: '外观', defaultValue: 6, min: 0, max: 30 },
    { key: 'disabled', label: '禁用', control: 'switch', group: '高级', defaultValue: false },
  ],
  render: (props) => {
    const size = asEnum(props.size, ['sm', 'md', 'lg'] as const, 'md');
    const height = size === 'sm' ? 26 : size === 'lg' ? 38 : 32;
    const disabled = asBool(props.disabled, false);
    const radius = asNumber(props.borderRadius, 6);
    return (
      <div
        className="flex items-center gap-1.5"
        style={{
          height,
          borderRadius: radius,
          border: '1px solid #d0d5dd',
          background: disabled ? '#f5f5f5' : '#fff',
          padding: '0 8px',
          fontSize: size === 'lg' ? 15 : 14,
          color: disabled ? '#9ca3af' : '#1f2329',
        }}
      >
        {asString(props.prefix) && <span className="text-gray-400">{asString(props.prefix)}</span>}
        <input
          readOnly
          disabled={disabled}
          placeholder={asString(props.placeholder)}
          defaultValue={asString(props.value)}
          className="w-full border-0 bg-transparent outline-none placeholder:text-gray-300"
        />
        {asString(props.suffix) && <span className="text-gray-400">{asString(props.suffix)}</span>}
      </div>
    );
  },
};
