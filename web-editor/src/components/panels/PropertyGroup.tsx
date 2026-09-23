/**
 * 职责：**单个可折叠分组**（Qt Designer 属性编辑器风格）。
 *
 * 规格（提示词 §3）：
 *   · 分组标题高 26px，左对齐，前置 ▶/▼ 三角（8px），文字 12px 半粗 #6b7280，右侧显示项数 (18)；
 *   · 点击标题整行切换折叠；
 *   · 悬停分组标题弹出该组用途说明（如「只作用于选中的单元格」）。
 *
 * 折叠状态由父级（PropertyPanel）持有并持久化，本组件只负责渲染与回调。
 */
import { memo, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

interface Props {
  name: string;
  count: number;
  open: boolean;
  /** 分组用途说明（悬停气泡） */
  hint?: string;
  /** 在本组之前画一条细分隔线（第一个分组不画）—— 规格 §8.1 的"分区分割线" */
  divider?: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function PropertyGroupInner({ name, count, open, hint, divider, onToggle, children }: Props) {
  return (
    <div
      className={`mb-1.5 ${divider ? 'mt-2 border-t border-line/70 pt-1.5' : ''}`}
      data-prop-group="1"
      data-group-name={name}
      data-group-open={open ? '1' : '0'}
      data-group-divider={divider ? '1' : '0'}
    >
      <button
        type="button"
        onClick={onToggle}
        className="prop-group-head ui-ink-3 flex w-full items-center gap-1 rounded px-2 text-left text-[12px] font-semibold"
      >
        {open ? <ChevronDown className="h-2 w-2 shrink-0" /> : <ChevronRight className="h-2 w-2 shrink-0" />}
        <Tooltip content={hint ? { name, detail: [hint] } : { name }} side="right">
          <span className={`flex-1 truncate ${hint ? 'cursor-help' : ''}`}>{name}</span>
        </Tooltip>
        <span className="shrink-0 text-[10px] font-normal text-gray-400">{count}</span>
      </button>
      {open && (
        <div className="mt-1" data-prop-list="1">
          {children}
        </div>
      )}
    </div>
  );
}

export const PropertyGroup = memo(PropertyGroupInner);
