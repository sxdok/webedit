/**
 * 职责：工具栏按钮/分隔线的通用外观（28–32px 高、6px 圆角，§八）。
 */
import type { ReactNode } from 'react';

export function ToolButton({
  children,
  title,
  onClick,
  disabled,
  active,
  danger,
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 min-w-7 items-center justify-center gap-1 rounded px-1.5 text-[13px] transition-colors ${
        disabled
          ? 'cursor-not-allowed text-gray-300'
          : danger
            ? 'text-red-600 hover:bg-red-50'
            : active
              ? 'bg-primary/10 text-primary'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  );
}

export function ToolDivider() {
  return <span className="mx-1 h-5 w-px bg-line" />;
}
