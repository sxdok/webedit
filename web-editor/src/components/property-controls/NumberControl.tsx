/**
 * 控件：number —— 数字输入（规格 §5 / §3）。
 * 行为：右对齐、等宽数字；**鼠标滚轮 ±step**（仅聚焦时，避免劫持页面滚动）；
 *       ↑/↓ ±step，Shift+↑/↓ ±10×step；Enter 提交并失焦；Esc 还原。
 * 校验：非有限数或越界的值**不写入 store**，并给红框提示（规格 §5「值非法时红框提示」）。
 */
import { useEffect, useRef, useState } from 'react';
import { asNumber } from '../../utils/id';
import { numCls } from './controlStyles';
import type { ControlProps } from './index';

export function NumberControl({ item, value, onChange }: ControlProps) {
  const step = item.step ?? 1;
  const [local, setLocal] = useState(() => String(asNumber(value)));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setLocal(String(asNumber(value)));
  }, [value]);

  const clampInfo = (n: number): { ok: boolean; v: number } => {
    if (!Number.isFinite(n)) return { ok: false, v: asNumber(value) };
    if (item.min !== undefined && n < item.min) return { ok: false, v: n };
    if (item.max !== undefined && n > item.max) return { ok: false, v: n };
    return { ok: true, v: n };
  };

  const commit = (raw: string) => {
    setLocal(raw);
    const n = Number(raw);
    const { ok, v } = clampInfo(n);
    setBad(raw.trim() !== '' && !ok);
    if (ok) onChange(v);
  };

  const nudge = (dir: 1 | -1, big: boolean) => {
    const base = Number(local);
    const next = (Number.isFinite(base) ? base : asNumber(value)) + dir * step * (big ? 10 : 1);
    const { ok, v } = clampInfo(next);
    if (!ok) return;
    setLocal(String(v));
    setBad(false);
    onChange(v);
  };

  return (
    <input
      type="number"
      className={`${numCls} ${bad ? 'border-red-400' : ''}`}
      min={item.min}
      max={item.max}
      step={step}
      value={local}
      data-tip-text={bad ? '值超出允许范围，未写入' : undefined}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => {
        focused.current = false;
        setLocal(String(asNumber(value)));
        setBad(false);
      }}
      onWheel={(e) => {
        if (document.activeElement !== e.currentTarget) return; // 仅聚焦时响应滚轮
        e.preventDefault();
        nudge(e.deltaY < 0 ? 1 : -1, e.shiftKey);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
        }
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setLocal(String(asNumber(value)));
          setBad(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
