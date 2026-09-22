/**
 * 控件：edge —— 四边独立数值 + **联动锁**（规格 §5）。
 * 锁定时改任意一边即四边同步（值相同）。
 */
import { useState } from 'react';
import { Link, Unlink } from 'lucide-react';
import { asNumber } from '../../utils/id';
import { smallBtnCls } from './controlStyles';
import type { ControlProps } from './index';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function EdgeControl({ value, onChange }: ControlProps) {
  const v = (value ?? {}) as Record<string, unknown>;
  const [locked, setLocked] = useState(false);
  const set = (k: string, n: number) => {
    if (locked) onChange({ top: n, right: n, bottom: n, left: n });
    else onChange({ ...v, [k]: n });
  };
  return (
    <>
      <div className="grid flex-1 grid-cols-4 gap-1">
        {SIDES.map((k) => (
          <input
            key={k}
            type="number"
            data-edge={k}
            title={k}
            className="h-7 w-full min-w-0 rounded-md border border-line bg-white px-1 text-center text-xs tabular-nums outline-none focus:border-primary"
            value={asNumber(v[k])}
            onChange={(e) => set(k, Number(e.target.value))}
          />
        ))}
      </div>
      <button
        type="button"
        data-edge-lock={locked ? '1' : '0'}
        className={`${smallBtnCls} ${locked ? 'border-primary bg-primary/10 text-primary' : ''}`}
        title={locked ? '已联动：改一边四边同步' : '联动锁：四边同步'}
        onClick={() => setLocked((x) => !x)}
      >
        {locked ? <Link className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
      </button>
    </>
  );
}
