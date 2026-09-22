/**
 * 控件：select / font —— 下拉选择（规格 §5）。
 * select：选项来自 schema.options；原生 `<select>` 自带首字母跳转与键盘操作。
 * font：内置字体清单，选项用对应字体渲染（预览）。
 */
import { asString } from '../../utils/id';
import { inputCls } from './controlStyles';
import type { ControlProps } from './index';

export function SelectControl({ item, value, onChange }: ControlProps) {
  return (
    <select
      className={inputCls}
      value={String(value ?? '')}
      onChange={(e) => {
        const raw = e.target.value;
        const opt = item.options?.find((o) => String(o.value) === raw);
        onChange(opt ? opt.value : raw);
      }}
    >
      {(item.options ?? []).map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const FONTS = ['宋体', '黑体', '楷体', '仿宋', '微软雅黑', 'Times New Roman', 'Arial'];

export function FontControl({ value, onChange }: ControlProps) {
  return (
    <select
      className={inputCls}
      style={{ fontFamily: asString(value, '宋体') }}
      value={asString(value, '宋体')}
      onChange={(e) => onChange(e.target.value)}
    >
      {FONTS.map((f) => (
        <option key={f} value={f} style={{ fontFamily: f }}>
          {f}
        </option>
      ))}
    </select>
  );
}
