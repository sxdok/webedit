/**
 * 组件：输入框（input，Web 专用）。渲染真实 <input> 外观（含 prefix/suffix），编辑态不接收真实输入。
 *
 * ★2026-09-24 两个修正（用户反馈"深色主题下图里的输入框变黑 / 画布改深色后输入框不能调颜色"）：
 *   ① 颜色**全部走内联样式 + 属性**：外层 div 用 `props.background/color/borderColor`，
 *      内层 <input> 的占位色走 `--input-ph`（配 `.input-ph::placeholder`），
 *      这样画布内容不受编辑器主题影响（主题的重映射规则碰不到内联样式）；
 *   ② 新增「背景色 / 文字颜色 / 占位文字颜色 / 边框颜色 / 边框宽」五个属性 ——
 *      画布背景改成深色时，输入框也能跟着配成深色。
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
  category: 'Web 控件',
  supportedModes: ['web'],
  icon: TextCursorInput,
  description: '真实 input 外观，支持前后缀、尺寸、圆角，**背景/文字/占位/边框颜色都能调**',
  defaultFrame: { x: 40, y: 90, w: 260, h: 32 },
  defaultProps: {
    placeholder: '请输入内容',
    value: '',
    size: 'md',
    disabled: false,
    prefix: '',
    suffix: '',
    borderRadius: 6,
    background: '#ffffff',
    color: '#1f2329',
    placeholderColor: '#9ca3af',
    borderColor: '#d0d5dd',
    borderWidth: 1,
  },
  propSchema: [
    { key: 'placeholder', label: '占位文字', control: 'text', group: '内容', defaultValue: '请输入内容' },
    { key: 'value', label: '默认值', control: 'text', group: '内容', defaultValue: '' },
    { key: 'prefix', label: '前缀', control: 'text', group: '内容', defaultValue: '' },
    { key: 'suffix', label: '后缀', control: 'text', group: '内容', defaultValue: '' },
    { key: 'background', label: '背景色', control: 'color', group: '外观', defaultValue: '#ffffff' },
    { key: 'color', label: '文字颜色', control: 'color', group: '外观', defaultValue: '#1f2329' },
    { key: 'placeholderColor', label: '占位文字颜色', control: 'color', group: '外观', defaultValue: '#9ca3af' },
    { key: 'borderColor', label: '边框颜色', control: 'color', group: '外观', defaultValue: '#d0d5dd' },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: '外观', defaultValue: 1, min: 0, max: 8 },
    { key: 'size', label: '尺寸', control: 'select', group: '外观', defaultValue: 'md', options: SIZES },
    { key: 'borderRadius', label: '圆角', control: 'number', group: '外观', defaultValue: 6, min: 0, max: 30 },
    { key: 'disabled', label: '禁用', control: 'switch', group: '高级', defaultValue: false },
  ],
  render: (props) => {
    const size = asEnum(props.size, ['sm', 'md', 'lg'] as const, 'md');
    const height = size === 'sm' ? 26 : size === 'lg' ? 38 : 32;
    const disabled = asBool(props.disabled, false);
    const radius = asNumber(props.borderRadius, 6);
    const borderWidth = asNumber(props.borderWidth, 1);
    /** 禁用态压暗一档（仍然由属性推导，不读主题） */
    const background = disabled ? '#f5f5f5' : asString(props.background, '#ffffff');
    const color = disabled ? '#9ca3af' : asString(props.color, '#1f2329');
    const placeholderColor = asString(props.placeholderColor, '#9ca3af');
    const borderColor = asString(props.borderColor, '#d0d5dd');
    return (
      <div
        className="flex items-center gap-1.5"
        style={{
          height,
          borderRadius: radius,
          border: `${borderWidth}px solid ${borderColor}`,
          background,
          padding: '0 8px',
          fontSize: size === 'lg' ? 15 : 14,
          color,
        }}
      >
        {asString(props.prefix) && <span style={{ color: placeholderColor }}>{asString(props.prefix)}</span>}
        <input
          readOnly
          disabled={disabled}
          placeholder={asString(props.placeholder)}
          defaultValue={asString(props.value)}
          className="input-ph w-full border-0 bg-transparent outline-none"
          style={{ color, '--input-ph': placeholderColor } as React.CSSProperties}
        />
        {asString(props.suffix) && <span style={{ color: placeholderColor }}>{asString(props.suffix)}</span>}
      </div>
    );
  },
};
