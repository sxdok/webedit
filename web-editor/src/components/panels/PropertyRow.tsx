/**
 * 职责：**单个属性行**（Qt Designer 属性编辑器风格）。
 *
 * 规格（提示词 §3 / §5）：
 *   · 行高 28px；左列**固定 96px** 属性名、右列 flex-1 控件；行间无分割线；
 *   · 鼠标悬停整行背景 #f2f4f7；
 *   · 属性名 12px，超长省略号，悬停弹气泡（含 中文名 / key / 说明 / 默认值 / 取值范围 / 单位）；
 *   · 整行式控件（textarea / richtext / spacing / edge / frame / children / cells / tableSize）：
 *     标签在上、控件在下、行高自适应；
 *   · **编辑反馈**：值变化后整行背景闪一下 #e6f4ff（150ms）。
 *
 * 行级 memo：只有该行 item 或 value 变化才重渲染（气泡延迟/闪烁状态都在行内部）。
 */
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PropSchemaItem } from '../../registry/types';
import { splitLabel } from '../../utils/label';
import { Tooltip, type TipContent } from '../ui/Tooltip';

function fmtDefault(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') {
    const s = v.replace(/\n/g, ' ⏎ ');
    return s === '' ? '（空）' : s.length > 40 ? `${s.slice(0, 40)}…` : s;
  }
  if (typeof v === 'object') {
    try {
      const j = JSON.stringify(v);
      return j.length > 40 ? `${j.slice(0, 40)}…` : j;
    } catch {
      return '（对象）';
    }
  }
  return String(v);
}

/** 气泡内容：① 中文名 ② key ③ 说明 ④ 默认值 / 取值范围 / 单位（规格 §7） */
export function tipOf(item: PropSchemaItem): TipContent {
  const { hint } = splitLabel(item.label);
  const detail: string[] = [];
  if (hint) detail.push(hint);
  detail.push(`默认值：${fmtDefault(item.defaultValue)}`);
  const range =
    item.min !== undefined || item.max !== undefined
      ? `取值范围：${item.min ?? '—'} ~ ${item.max ?? '—'}${item.unit ? ` ${item.unit}` : ''}`
      : item.unit
        ? `单位：${item.unit}`
        : '';
  if (range) detail.push(range);
  if (item.options?.length) detail.push(`可选：${item.options.map((o) => String(o.label)).join(' / ')}`);
  return { name: item.label, keyText: item.key, detail };
}

interface Props {
  item: PropSchemaItem;
  /** 当前值（用于气泡与"编辑反馈"闪烁判断） */
  value: unknown;
  wide?: boolean;
  children: ReactNode;
}

function PropertyRowInner({ item, value, wide, children }: Props) {
  const [flash, setFlash] = useState(false);
  const first = useRef(true);
  const sig = typeof value === 'object' ? JSON.stringify(value ?? null) : String(value ?? '');

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 150);
    return () => window.clearTimeout(t);
  }, [sig]);

  const { short } = splitLabel(item.label);
  const tip = tipOf(item);
  const cls = `prop-row${flash ? ' prop-row-flash' : ''}`;
  // 控件本体气泡（规格 §7）：控件类型 + 当前值。包装元素类名必须与原布局一致，否则会改变排版
  const controlTip: TipContent = {
    name: `控件：${item.control}`,
    detail: [`当前值：${typeof value === 'object' ? JSON.stringify(value ?? null) : String(value ?? '—')}`],
  };

  if (wide) {
    return (
      <div className={`${cls} mb-1.5`} data-prop-row="1" data-prop-wide="1">
        <div className="mb-0.5 flex items-baseline gap-1 text-[12px]" data-prop-label="1">
          <Tooltip content={tip}>
            <span className="cursor-help truncate text-[12px] text-[#374151]">{short}</span>
          </Tooltip>
        </div>
        <Tooltip content={controlTip} wrapClassName="block w-full">
          {children}
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={`${cls} flex h-7 items-center gap-2`} data-prop-row="1">
      <Tooltip content={tip}>
        <span
          className="w-24 shrink-0 cursor-help truncate text-[12px] text-[#374151]"
          data-prop-label="1"
          style={{ width: 96 }}
        >
          {short}
        </span>
      </Tooltip>
      <Tooltip content={controlTip} wrapClassName="flex min-w-0 flex-1 items-center gap-1">
        {children}
      </Tooltip>
    </div>
  );
}

export const PropertyRow = memo(PropertyRowInner);
