/**
 * 组件：按钮（button，Web 专用）。渲染真实 <button>，有 hover 态，编辑态禁用默认事件。
 */
import { MousePointerClick } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';

const VARIANTS = [
  { label: '主按钮 primary', value: 'primary' },
  { label: '默认 default', value: 'default' },
  { label: '虚线 dashed', value: 'dashed' },
  { label: '文字 text', value: 'text' },
  { label: '链接 link', value: 'link' },
];
const SIZES = [
  { label: '小 sm', value: 'sm' },
  { label: '中 md', value: 'md' },
  { label: '大 lg', value: 'lg' },
];

export const buttonComponent: ComponentDefinition = {
  type: 'button',
  label: '按钮',
  category: 'Web 控件',
  supportedModes: ['web'],
  icon: MousePointerClick,
  description: '真实 button 元素，5 种变体 / 3 种尺寸，可设圆角与颜色',
  defaultFrame: { x: 40, y: 40, w: 120, h: 32 },
  defaultProps: {
    text: '按钮',
    variant: 'primary',
    size: 'md',
    block: false,
    disabled: false,
    borderRadius: 6,
    bgColor: '',
    textColor: '',
  },
  propSchema: [
    { key: 'text', label: '文字', control: 'text', group: '内容', defaultValue: '按钮' },
    { key: 'variant', label: '变体', control: 'select', group: '外观', defaultValue: 'primary', options: VARIANTS },
    { key: 'size', label: '尺寸', control: 'select', group: '外观', defaultValue: 'md', options: SIZES },
    { key: 'borderRadius', label: '圆角', control: 'number', group: '外观', defaultValue: 6, min: 0, max: 30 },
    { key: 'bgColor', label: '背景色（留空用变体色）', control: 'color', group: '外观', defaultValue: '' },
    { key: 'textColor', label: '文字色（留空用变体色）', control: 'color', group: '外观', defaultValue: '' },
    { key: 'block', label: '占满整行', control: 'switch', group: '尺寸', defaultValue: false },
    { key: 'disabled', label: '禁用', control: 'switch', group: '高级', defaultValue: false },
  ],
  render: (props) => {
    const variant = asEnum(props.variant, ['primary', 'default', 'dashed', 'text', 'link'] as const, 'primary');
    const size = asEnum(props.size, ['sm', 'md', 'lg'] as const, 'md');
    const bg = asString(props.bgColor);
    const fg = asString(props.textColor);

    const palette: Record<string, React.CSSProperties> = {
      primary: { background: bg || '#1677ff', color: fg || '#fff', border: '1px solid transparent' },
      default: { background: bg || '#fff', color: fg || '#1f2329', border: '1px solid #d0d5dd' },
      dashed: { background: bg || '#fff', color: fg || '#1f2329', border: '1px dashed #d0d5dd' },
      text: { background: bg || 'transparent', color: fg || '#1677ff', border: '1px solid transparent' },
      link: { background: bg || 'transparent', color: fg || '#1677ff', border: '1px solid transparent', textDecoration: 'underline' },
    };
    const pad = size === 'sm' ? '0 10px' : size === 'lg' ? '0 18px' : '0 14px';
    const height = size === 'sm' ? 26 : size === 'lg' ? 38 : 32;

    return (
      <button
        type="button"
        disabled={asBool(props.disabled, false)}
        onClick={(e) => e.preventDefault()}
        style={{
          ...palette[variant],
          height,
          padding: pad,
          borderRadius: asNumber(props.borderRadius, 6),
          fontSize: size === 'lg' ? 15 : 14,
          width: asBool(props.block, false) ? '100%' : undefined,
          cursor: 'pointer',
          opacity: asBool(props.disabled, false) ? 0.5 : 1,
          transition: 'filter .15s',
        }}
      >
        {asString(props.text, '按钮')}
      </button>
    );
  },
};
