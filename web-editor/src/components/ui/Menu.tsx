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
  /**
   * 子菜单（§7.3 目标结构里的 `导出 ▸`、`最近打开 ▸`）。
   * 有 `submenu` 时本项**不再触发 onClick**，鼠标悬停/聚焦时向右展开；靠近视口右缘自动向左翻。
   */
  submenu?: MenuEntry[];
}

export type MenuEntry = MenuItem | { key: string; separator: true };

function isSeparator(e: MenuEntry): e is { key: string; separator: true } {
  return 'separator' in e;
}

const SUB_PANEL_W = 260;

/** 子菜单：悬停/聚焦展开，右缘不够就向左翻；点中任一项后连同父菜单一起关 */
function SubMenu({ entry, onPicked }: { entry: MenuItem; onPicked: () => void }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const show = (): void => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setFlip(r.right + SUB_PANEL_W > window.innerWidth);
    setOpen(true);
  };

  return (
    <div ref={ref} className="relative" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        disabled={entry.disabled}
        data-menu-sub={entry.key}
        onClick={show}
        onFocus={show}
        className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[13px] ${
          entry.disabled ? 'cursor-not-allowed text-gray-300' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <span className="w-3 text-primary">{entry.checked ? '✓' : ''}</span>
        <span className="flex-1 pr-3">{entry.label}</span>
        {entry.shortcut && <span className="flex-none text-2xs text-gray-400">{entry.shortcut}</span>}
        <span className="flex-none text-2xs text-gray-400">▸</span>
      </button>
      {open && (
        <div
          data-menu-panel={entry.key}
          className={`absolute top-0 z-[60] w-max min-w-[200px] max-w-[420px] rounded-md border border-line bg-white py-1 shadow-lg ${
            flip ? 'right-full' : 'left-full'
          }`}
        >
          {(entry.submenu ?? []).map((child) =>
            isSeparator(child) ? (
              <div key={child.key} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={child.key}
                type="button"
                disabled={child.disabled}
                data-menu-item={child.key}
                onClick={() => {
                  onPicked();
                  child.onClick?.();
                }}
                className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[13px] ${
                  child.disabled
                    ? 'cursor-not-allowed text-gray-300'
                    : child.danger
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="w-2 shrink-0">
                  {child.checked ? '✓' : child.danger ? '·' : ''}
                </span>
                <span className="flex-1 pr-3">{child.label}</span>
                {child.shortcut && <span className="flex-none text-2xs text-gray-400">{child.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
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
        data-menu={label}
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
            ) : entry.submenu ? (
              <SubMenu key={entry.key} entry={entry} onPicked={() => setOpen(false)} />
            ) : (
              <button
                key={entry.key}
                type="button"
                disabled={entry.disabled}
                data-menu-item={entry.key}
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

/**
 * 菜单栏外壳。
 * 桌面版（Electron 无边框窗口）里这一行同时是**窗口拖拽区**：`.app-drag` 声明可拖，
 * 里面的按钮由 CSS 自动 no-drag（见 index.css 的 `html[data-desktop='1']` 规则）；
 * `.app-titlebar-gap` 给系统的最小化/最大化/关闭按钮留出右上角的位置。
 */
export function MenuBarShell({ children, desktop = false }: { children: ReactNode; desktop?: boolean }) {
  return (
    <div
      data-menubar="1"
      className={`no-print flex items-center gap-0.5 border-b border-line bg-white px-2 py-1${desktop ? ' app-drag app-titlebar-gap' : ''}`}
    >
      {children}
    </div>
  );
}
