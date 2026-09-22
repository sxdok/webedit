/**
 * 职责：属性控件的**共用样式常量**（规格 §5：高度 28–32px、圆角 6px、边框 #d9dde3、聚焦 #1677ff）。
 * 独立成文件，避免 18 个控件各写一遍。
 */
export const inputCls =
  'h-7 w-full min-w-0 rounded-md border border-line bg-white px-2 text-[13px] text-gray-800 outline-none focus:border-primary';

/** 数字输入：右对齐 + 等宽数字（规格 §3「数字输入右对齐」） */
export const numCls = `${inputCls} text-right tabular-nums`;

export const smallBtnCls =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-white text-gray-600 hover:border-primary hover:text-primary';

export const badgeCls =
  'flex h-7 min-w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gray-50 px-1 text-2xs text-gray-500';

export const btnCls =
  'h-6 shrink-0 rounded-md border border-line px-1.5 text-2xs hover:border-primary hover:text-primary disabled:opacity-40';

/** 焦点态统一：数字/文本输入聚焦时加 2px 外发光 */
export const focusRing = 'focus:ring-2 focus:ring-primary/20';
