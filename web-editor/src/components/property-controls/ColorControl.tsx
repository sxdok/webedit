/**
 * 控件：color —— 色块 + #rrggbb 输入 + **自研取色器**（规格 §5）。
 * 取色器内容：预设色板 + 最近使用（localStorage）+ 吸管（可用时用 EyeDropper API）。
 * 弹出层用 position:fixed，避免被面板滚动容器裁掉。
 */
import { useEffect, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import { asString } from '../../utils/id';
import { inputCls } from './controlStyles';
import type { ControlProps } from './index';

const RECENT_KEY = 'visual-editor-recent-colors';
const PALETTE = [
  '#1f2329', '#5b6472', '#9aa4b2', '#e5e7eb', '#ffffff',
  '#1677ff', '#0e7490', '#22a06b', '#a6e22e', '#eab308',
  '#fd971f', '#f92672', '#a855f7', '#1d4e79', '#e8f1f9',
  '#fff2cc', '#f0f9f2', '#eef6fd', '#fff7ec', '#ffe4e6',
];

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pushRecent(c: string): string[] {
  const next = [c, ...loadRecent().filter((x) => x !== c)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 忽略 */
  }
  return next;
}

export function ColorControl({ value, onChange }: ControlProps) {
  const cur = asString(value, '#000000');
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-color-pop="1"]') && e.target !== btnRef.current) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (c: string) => {
    onChange(c);
    setRecent(pushRecent(c));
  };

  const eyedrop = async () => {
    type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
    const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!Ctor) return;
    try {
      const r = await new Ctor().open();
      if (r?.sRGBHex) pick(r.sRGBHex);
    } catch {
      /* 用户取消 */
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-color-swatch="1"
        className="h-7 w-8 shrink-0 cursor-pointer rounded-md border border-line"
        style={{ background: cur }}
        title={cur}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 208)), y: r.bottom + 6 });
          setOpen((v) => !v);
        }}
      />
      <input className={inputCls} value={cur} onChange={(e) => onChange(e.target.value)} />

      {open && pos && (
        <div
          data-color-pop="1"
          className="fixed z-[9999] w-48 rounded-md border border-line bg-panel p-2 shadow-lg"
          style={{ left: pos.x, top: pos.y }}
        >
          <div className="mb-1 text-2xs text-gray-400">色板</div>
          <div className="grid grid-cols-10 gap-1">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                data-palette={c}
                className="h-3.5 w-3.5 rounded-sm border border-line"
                style={{ background: c }}
                title={c}
                onClick={() => pick(c)}
              />
            ))}
          </div>
          {recent.length > 0 && (
            <>
              <div className="mb-1 mt-2 text-2xs text-gray-400">最近使用</div>
              <div className="flex gap-1">
                {recent.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-3.5 w-3.5 rounded-sm border border-line"
                    style={{ background: c }}
                    title={c}
                    onClick={() => pick(c)}
                  />
                ))}
              </div>
            </>
          )}
          <div className="mt-2 flex items-center gap-1">
            <input
              type="color"
              className="h-6 w-8 cursor-pointer rounded border border-line bg-white p-0.5"
              value={cur}
              onChange={(e) => pick(e.target.value)}
            />
            <span className="font-mono text-2xs text-gray-500">{cur}</span>
            <button
              type="button"
              className="ml-auto flex h-6 items-center gap-0.5 rounded-md border border-line px-1 text-2xs hover:border-primary hover:text-primary disabled:opacity-40"
              disabled={!(window as unknown as { EyeDropper?: unknown }).EyeDropper}
              title={(window as unknown as { EyeDropper?: unknown }).EyeDropper ? '吸管取色' : '当前浏览器不支持吸管'}
              onClick={() => void eyedrop()}
            >
              <Pipette className="h-3 w-3" />
              吸管
            </button>
          </div>
        </div>
      )}
    </>
  );
}
