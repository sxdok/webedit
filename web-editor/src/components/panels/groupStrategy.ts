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

/* ══════════════ 页面（未选中组件）属性 ══════════════
   页面属性不是组件，没有"类别"，但分组规则**同一套**（规格 §6）：默认展开与分组说明在这里
   声明，`PagePropertyPanel` 只查表（分组顺序即该文件里抽屉内的书写顺序）。 */

/** 页面属性默认展开的分组：最常用的纸张与分页；页边距/版式/页眉/页脚默认折叠（面板不做成一面墙） */
export const PAGE_DEFAULT_OPEN = ['纸张', '分页', '分节页码'];

/** 页面属性的分组说明（悬停分组标题弹气泡） */
export const PAGE_GROUP_HINTS: Record<string, string> = {
  纸张: '纸张尺寸与方向，宽高单位 mm；A4 为默认。',
  页边距: '版心四边留白，按 上 / 右 / 下 / 左 的顺序，单位 mm。',
  版式: '纸张底色、默认字体字号与正文行距。',
  分页: '在当前内容末尾手动插入分页符（相当于 Word 的 Ctrl+Enter）；内容超出纸张版心会自动分页。',
  分节页码: '三段式页码：封面不显示 → 目录用罗马数字 → 正文从指定页号起用阿拉伯数字。',
  页眉: '页眉区域：左/中/右三段文字 + 距页顶、字号、颜色、分隔线。',
  页脚: '页脚区域：左/中/右三段文字 + 距页底、字号、颜色、分隔线。',
};

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
