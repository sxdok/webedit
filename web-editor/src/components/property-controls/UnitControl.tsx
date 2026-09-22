/**
 * 控件：unit —— 数值 + 单位徽标（规格 §5）。单位只读，由 schema.unit 决定。
 */
import { asNumber } from '../../utils/id';
import { badgeCls, numCls } from './controlStyles';
import type { ControlProps } from './index';

export function UnitControl({ item, value, onChange }: ControlProps) {
  return (
    <>
      <input
        type="number"
        className={numCls}
        step={item.step ?? 1}
        min={item.min}
        max={item.max}
        value={asNumber(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      <span className={badgeCls}>{item.unit ?? 'px'}</span>
    </>
  );
}
