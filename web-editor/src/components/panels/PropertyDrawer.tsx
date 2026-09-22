/**
 * 职责：**抽屉式分区**（规格 §4）—— 面板的顶层分区，内部才是分组。
 *   通用属性抽屉（所有组件都有：位置与尺寸 / 上下边距 / 显示 / 锁定）
 *   专有属性抽屉（组件自己的 schema 分组）
 *   状态抽屉（只读：类型 / ID / 父容器 / 同级序号 / 选中范围 / 数据来源）
 *
 * 与分组的区别：抽屉是**面板级**结构（少而固定），分组来自组件 schema（多且随组件变）。
 */
import { memo, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

interface Props {
  name: string;
  open: boolean;
  onToggle: () => void;
  /** 右侧小字（如项数、状态摘要） */
  badge?: string;
  hint?: string;
  children: ReactNode;
}

function PropertyDrawerInner({ name, open, onToggle, badge, hint, children }: Props) {
  return (
    <div className="mb-1.5 border-t border-line pt-1 first:border-t-0" data-drawer="1" data-drawer-name={name} data-drawer-open={open ? '1' : '0'}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-100"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Tooltip content={hint ? { name, detail: [hint] } : { name }} side="right">
          <span className={`flex-1 truncate ${hint ? 'cursor-help' : ''}`}>{name}</span>
        </Tooltip>
        {badge && <span className="shrink-0 text-[10px] font-normal normal-case text-gray-400">{badge}</span>}
      </button>
      {open && (
        <div className="mt-1" data-drawer-body="1">
          {children}
        </div>
      )}
    </div>
  );
}

export const PropertyDrawer = memo(PropertyDrawerInner);
