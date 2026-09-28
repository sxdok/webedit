/**
 * 控件：frame —— 位置与尺寸 x/y/w/h + 旋转角（规格 §5，整行式；仅 Web 模式有用）。
 */
import { asNumber } from '../../utils/id';
import type { ControlProps } from './index';

const KEYS = ['x', 'y', 'w', 'h'] as const;

export function FrameControl({ value, onChange }: ControlProps) {
  const v = (value ?? {}) as Record<string, unknown>;
  const set = (k: string, n: number) => onChange({ ...v, [k]: n });
  return (
    <>
      <div className="grid flex-1 grid-cols-4 gap-1">
        {KEYS.map((k) => (
          <label key={k} className="flex min-w-0 items-center gap-0.5">
            <span className="text-2xs uppercase text-gray-400">{k}</span>
            <input
              type="number"
              data-frame={k}
              className="h-7 w-full min-w-0 rounded-md border border-line bg-white px-1 text-right text-xs tabular-nums outline-none focus:border-primary"
              value={asNumber(v[k])}
              onChange={(e) => set(k, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <label className="flex shrink-0 items-center gap-0.5" data-tip-text="旋转角（度）">
        <span className="text-2xs text-gray-400">旋转</span>
        <input
          type="number"
          data-frame="rotation"
          className="h-7 w-12 rounded-md border border-line bg-white px-1 text-right text-xs tabular-nums outline-none focus:border-primary"
          value={asNumber(v.rotation)}
          onChange={(e) => set('rotation', Number(e.target.value))}
        />
      </label>
    </>
  );
}
