/**
 * 职责：spacing 属性控件——单一间距值 + 单位，联动应用于四边（值形如 { value, unit }）。
 * 需要四边各自独立时用 edge 控件。
 */
import type { ControlProps } from './index';
import { asNumber, asString } from '../../utils/id';

const UNITS = ['px', 'mm', '%', 'pt'] as const;

export function SpacingControl({ item, value, onChange }: ControlProps) {
  const v = (value ?? {}) as Record<string, unknown>;
  const num = asNumber(v.value, 0);
  const unit = asString(v.unit, item.unit ?? 'px');

  const set = (patch: { value?: number; unit?: string }) =>
    onChange({ value: patch.value ?? num, unit: patch.unit ?? unit });

  return (
    <label className="mb-1.5 block">
      <span className="mb-0.5 block text-2xs text-gray-500">{item.label}（四边联动）</span>
      <div className="flex gap-1">
        <input
          type="number"
          className="h-7 w-full rounded border border-line bg-white px-2 text-[13px] outline-none focus:border-primary"
          step={item.step ?? 1}
          min={item.min}
          max={item.max}
          value={num}
          onChange={(e) => set({ value: Number(e.target.value) })}
        />
        <select
          className="h-7 w-14 rounded border border-line bg-white px-1 text-xs outline-none focus:border-primary"
          value={unit}
          onChange={(e) => set({ unit: e.target.value })}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}
