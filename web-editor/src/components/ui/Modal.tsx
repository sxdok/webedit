/**
 * 职责：通用小弹窗（帮助/快捷键说明、确认框等）。不引入 UI 库。
 */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 560,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div
      className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[80vh] overflow-hidden rounded-lg bg-white shadow-2xl" style={{ width }}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-[13px] font-semibold text-gray-700">{title}</span>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <div className="thin-scroll max-h-[65vh] overflow-auto px-4 py-3 text-[13px] leading-6 text-gray-700">
          {children}
        </div>
      </div>
    </div>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['Delete / Backspace', '删除选中组件'],
  ['Ctrl/Cmd + Z', '撤销'],
  ['Ctrl/Cmd + Shift + Z', '重做'],
  ['Ctrl/Cmd + C / V', '复制 / 粘贴'],
  ['Ctrl/Cmd + D', '原地复制'],
  ['Ctrl/Cmd + A', '全选'],
  ['↑ / ↓', '微调顺序（文档模式）或位置 1px（Web 模式）'],
  ['Shift + ↑ / ↓', '快速移动（10px）'],
  ['Ctrl/Cmd + = / -', '放大 / 缩小'],
  ['Ctrl/Cmd + 0', '恢复 100%'],
  ['Ctrl/Cmd + Shift + M', '切换模式'],
  ['Esc', '取消选中'],
];
