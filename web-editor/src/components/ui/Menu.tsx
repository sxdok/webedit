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

/**
 * ★二级菜单**关闭宽限**（2026-09-29 用户报"鼠标放到导出上弹出正常，移到具体导出项时快速消失点不到"）：
 * 父项包装 div 只有**一行高**，而子面板挂在它右侧（`left-full`）—— 鼠标斜着往下面几项走时，
 * 会先经过「父行下方 + 面板左侧」那块**既不属于父项、也不属于面板**的区域（实测那里是旁边的兄弟菜单行），
 * 于是 `mouseleave` 立刻 `setOpen(false)`：实测**离开 21ms 面板就没了**，人在 21ms 内到不了面板。
 * 现在留 280ms 宽限：只要在这段时间内进入面板（或回到父项）就取消关闭。
 */
const CLOSE_DELAY_MS = 280;

/**
 * ★"被兄弟子菜单抢走"也要宽限（同一次修复的后半段）：
 * 用户从「导出」往自己的面板斜下方走时，路径可能**掠过**兄弟子菜单行（实测：导出下面就是「组件包」）。
 * 原来兄弟一 `show()` 就立刻把「导出」关掉（实测 21ms），于是"路过一下就把菜单弄没了"。
 * 现在收到兄弟广播先等 160ms：这段时间内指针若回到本子菜单/面板（`show()`/`cancelClose`）就取消，
 * 停住不动才真的切过去 —— 既不会"路过被抢"，又保留了"停在别的子菜单上就切过去"的直觉。
 */
const SWITCH_DELAY_MS = 240;

/** 打开某个子菜单时广播，让**兄弟子菜单**在宽限后收起（见 SWITCH_DELAY_MS） */
const SUBMENU_OPEN_EVENT = 'webedit:submenu-open';

/** 子菜单：悬停/聚焦展开（带关闭宽限），右缘不够就向左翻；点中任一项后连同父菜单一起关 */
function SubMenu({ entry, onPicked }: { entry: MenuItem; onPicked: () => void }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = (): void => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const show = (): void => {
    cancelClose();
    const r = ref.current?.getBoundingClientRect();
    if (r) setFlip(r.right + SUB_PANEL_W > window.innerWidth);
    setOpen(true);
    /* 通知别的子菜单立刻收起（自己收到就忽略） */
    window.dispatchEvent(new CustomEvent(SUBMENU_OPEN_EVENT, { detail: entry.key }));
  };

  /** 离开父项**不立刻关**：留宽限让指针能斜穿到面板上（见 CLOSE_DELAY_MS 的说明） */
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  useEffect(() => {
    const onOther = (e: Event): void => {
      if ((e as CustomEvent).detail === entry.key) return;
      /* 兄弟子菜单开了：**不立刻关**（路过也算），等 SWITCH_DELAY_MS；期间指针回来就取消 */
      cancelClose();
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setOpen(false);
      }, SWITCH_DELAY_MS);
    };
    window.addEventListener(SUBMENU_OPEN_EVENT, onOther);
    return () => {
      window.removeEventListener(SUBMENU_OPEN_EVENT, onOther);
      cancelClose();
    };
  }, [entry.key]);

  return (
    <div ref={ref} className="relative" onMouseEnter={show} onMouseLeave={scheduleClose}>
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
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
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
