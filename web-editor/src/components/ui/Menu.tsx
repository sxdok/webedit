/**
 * 职责：轻量下拉菜单原语（菜单栏用）。点击展开、点击外部/Esc 关闭、支持分隔线与勾选项，
 * 不引入任何 UI 库（§12）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  key: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

export type MenuEntry = MenuItem | { key: string; separator: true };

function isSeparator(e: MenuEntry): e is { key: string; separator: true } {
  return 'separator' in e;
}

export function DropdownMenu({ label, items }: { label: string; items: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-7 rounded px-2.5 text-[13px] transition-colors ${
          open ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-50 w-max min-w-[220px] max-w-[420px] rounded-md border border-line bg-white py-1 shadow-lg">
          {items.map((entry) =>
            isSeparator(entry) ? (
              <div key={entry.key} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={entry.key}
                type="button"
                disabled={entry.disabled}
                onClick={() => {
                  setOpen(false);
                  entry.onClick?.();
                }}
                className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[13px] ${
                  entry.disabled
                    ? 'cursor-not-allowed text-gray-300'
                    : entry.danger
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="w-3 text-primary">{entry.checked ? '✓' : ''}</span>
                <span className="flex-1 pr-3">{entry.label}</span>
                {entry.shortcut && <span className="flex-none text-2xs text-gray-400">{entry.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function MenuBarShell({ children }: { children: ReactNode }) {
  return (
    <div className="no-print flex items-center gap-0.5 border-b border-line bg-white px-2 py-1">{children}</div>
  );
}
