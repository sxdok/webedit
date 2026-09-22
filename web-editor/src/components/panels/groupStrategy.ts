/**
 * 职责：**分类 → 分组策略**（规格 §6）。不同类别的组件分组顺序、默认展开项、分组说明不同，
 *       全部在这里声明；PropertyPanel 只查表，不写 `if (type === 'table')`。
 *
 * 三处来源：
 *   ① 分组顺序 order（未列出的分组落到全局兜底顺序）；
 *   ② 默认展开 defaultOpen（表格类另有「单元格」组的"选中即展开"逻辑，见 PropertyPanel）；
 *   ③ 分组说明 hints（悬停分组标题的气泡；缺省回落到 GROUP_HINTS 的通用文案）。
 */

/** 全局兜底顺序（规格 §3：表格 → 单元格 → 内容 → 排版 → 外观 → 尺寸 → 布局 → 高级） */
export const GROUP_ORDER = ['表格', '单元格', '内容', '排版', '外观', '尺寸', '布局', '高级'];

/** 表格类组件的默认展开组（类别策略没命中时的兜底） */
export const DEFAULT_OPEN_GROUP = '表格';

/** 全局分组说明（类别策略里没写该分组时用它；悬停分组标题弹气泡） */
export const GROUP_HINTS: Record<string, string> = {
  表格: '整张表格的属性。下面「单元格」组里针对个别格子做的设置会覆盖这里的默认值。',
  单元格: '只作用于画布上选中的单元格（点选/拖选一片）。没被覆盖的项沿用「表格」组的默认值。',
  内容: '组件的内容与文字。',
  排版: '字体、字号、行距、字距、对齐等文字样式。',
  外观: '背景、边框、圆角、阴影等外观。',
  尺寸: '宽高与上下边距。',
  布局: '位置与排布方式。',
  高级: '不常用项。',
};

export interface CategoryStrategy {
  order: string[];
  defaultOpen: string[];
  hints?: Record<string, string>;
}

/** 通用属性（注册表统一补的上下边距）不参与专有属性分组，单独渲染在「通用属性」抽屉 */
export const UNIVERSAL_KEYS = new Set(['marginTop', 'marginBottom']);

export const CATEGORY_STRATEGY: Record<string, CategoryStrategy> = {
  'Word 常用': {
    order: ['内容', '排版', '外观', '尺寸', '布局', '高级'],
    defaultOpen: ['内容'],
  },
  'PPT 专用': {
    order: ['内容', '排版', '外观', '尺寸', '布局', '高级'],
    defaultOpen: ['内容'],
    hints: {
      内容: '演示页显示的内容与文字。',
      排版: '字体、字号、字重、行距、字距、对齐。',
      外观: '主色、色条、背景、边框、圆角、阴影。',
      尺寸: '宽高、内边距与上下边距。',
      布局: '分列数、间距、方向、时间列宽等。',
    },
  },
  'Excel 表格': {
    order: ['表格', '单元格', '尺寸'],
    defaultOpen: ['表格'],
    hints: {
      表格: '整张表格的属性。下面「单元格」组里针对个别格子做的设置会覆盖这里的默认值。',
      单元格: '只作用于画布上选中的单元格（点选 / 拖选一片）。未被覆盖的项沿用「表格」组的默认值。',
      尺寸: '宽高与上下边距。',
    },
  },
  'Web 控件': {
    order: ['内容', '外观', '尺寸', '高级'],
    defaultOpen: ['内容'],
    hints: {
      内容: '控件上显示的文字、占位符、默认值。',
      外观: '变体、尺寸、圆角、背景色、文字色。',
      尺寸: '宽高、占满整行、上下边距。',
      高级: '禁用等不常用项。',
    },
  },
  'Web 容器': {
    order: ['内容', '外观', '尺寸', '布局', '高级'],
    // 规格：容器类「外观」也默认展开（卡片/容器的外观是最常调的）
    defaultOpen: ['内容', '外观'],
    hints: {
      内容: '卡片标题、右上角内容。',
      外观: '背景、边框、圆角、阴影。',
      尺寸: '内边距、宽高、上下边距。',
      布局: '显示方式、主轴方向、对齐、列数、间距。',
      高级: '子组件列表。',
    },
  },
};

/** 兜底策略（类别没登记时用）：全局顺序 + 只展开第一组 */
export const FALLBACK_STRATEGY: CategoryStrategy = { order: GROUP_ORDER, defaultOpen: [] };

export function strategyFor(category: string): CategoryStrategy {
  return CATEGORY_STRATEGY[category] ?? FALLBACK_STRATEGY;
}

/** 按策略排序分组名；未在策略 order 里的分组按全局兜底顺序排到后面 */
export function orderGroups(groups: string[], category: string): string[] {
  const order = strategyFor(category).order;
  const rank = (g: string) => {
    const i = order.indexOf(g);
    if (i >= 0) return i;
    const j = GROUP_ORDER.indexOf(g);
    return (j < 0 ? 99 : j) + 100; // 未登记的排最后，但仍保持稳定
  };
  return [...groups].sort((a, b) => rank(a) - rank(b));
}

/** 该类别下某分组是否默认展开 */
export function isDefaultOpen(category: string, group: string): boolean {
  return strategyFor(category).defaultOpen.includes(group);
}

/** 分组说明：优先用类别专属文案，其次全局通用文案 */
export function hintFor(category: string, group: string, globalHints: Record<string, string>): string | undefined {
  return strategyFor(category).hints?.[group] ?? globalHints[group];
}
