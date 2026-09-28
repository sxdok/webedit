/**
 * 控件：switch —— 紧凑开关（规格 §5）。点击即切换；样式做成开关而非原生复选框。
 */
import type { ControlProps } from './index';

export function SwitchControl({ value, onChange }: ControlProps) {
  const on = value === true;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-switch={on ? '1' : '0'}
      onClick={() => onChange(!on)}
      className={`relative ml-auto h-4 w-8 shrink-0 rounded-full border transition-colors ${
        on ? 'border-primary bg-primary' : 'border-line bg-gray-200'
      }`}
      data-tip-text={on ? '开' : '关'}
    >
      <span
        className="absolute top-[1px] h-3 w-3 rounded-full bg-white transition-all"
        style={{ left: on ? 16 : 2 }}
      />
    </button>
  );
}
