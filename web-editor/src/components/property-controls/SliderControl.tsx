/**
 * 控件：slider —— 滑块 + 右侧数值框（规格 §5）。
 * 行为：拖动实时更新（store 300ms 防抖合并成一条历史）；数值框可直接输入。
 */
import { asNumber } from '../../utils/id';
import type { ControlProps } from './index';

export function SliderControl({ item, value, onChange }: ControlProps) {
  const min = item.min ?? 0;
  const max = item.max ?? 100;
  const step = item.step ?? 1;
  const v = asNumber(value, min);
  return (
    <>
      <input
        type="range"
        className="min-w-0 flex-1 accent-primary"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        className="h-7 w-12 shrink-0 rounded-md border border-line bg-white px-1 text-right text-xs tabular-nums outline-none focus:border-primary"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      {item.unit && <span className="shrink-0 text-2xs text-gray-400">{item.unit}</span>}
    </>
  );
}
