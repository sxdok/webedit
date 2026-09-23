/**
 * 职责：**分类 → 分组策略**（规格 §6）。不同类别的组件分组顺序与分组说明不同，全部在这里声明；
 *       PropertyPanel 只查表，不写 `if (type === 'table')`。
 *
 * 两处来源：
 *   ① 分组顺序 order（未列出的分组落到全局兜底顺序）；
 *   ② 分组说明 hints（悬停分组标题的气泡；缺省回落到 GROUP_HINTS 的通用文案）。
 *
 * ★默认展开规则（用户 2026-09-23）：**只展开排在最前面的那一个分组**，其余默认折叠。
 *   以前是按类别逐个登记 defaultOpen（每加一个类别都要补配置，还容易和顺序脱节），现在统一成
 *   "第一个分组"这一条规则；唯一例外是表格类在画布上选中了单元格时「单元格」组强制展开。
 */

/**
 * 全局兜底顺序。
 * ★「单元格」排在「表格」前面（用户 2026-09-23：表格组件的属性编辑器里，单元格属性放在表格属性上方）。
 */
export const GROUP_ORDER = ['单元格', '表格', '内容', '排版', '外观', '尺寸', '布局', '高级'];

/** 全局分组说明（类别策略里没写该分组时用它；悬停分组标题弹气泡） */
export const GROUP_HINTS: Record<string, string> = {
  单元格: '只作用于画布上选中的单元格（点选/拖选一片）：**文字内容也在这里改**（表格不再有整块「数据」属性），没被覆盖的格式沿用「表格」组的默认值。',
  表格: '整张表格的属性。上面「单元格」组里针对个别格子做的设置会覆盖这里的默认值。',
  内容: '组件的内容与文字。',
  排版: '字体、字号、行距、字距、对齐等文字样式。',
  外观: '背景、边框、圆角、阴影等外观。',
  尺寸: '宽高与上下边距。',
  布局: '位置与排布方式。',
  高级: '不常用项。',
};

export interface CategoryStrategy {
  order: string[];
  hints?: Record<string, string>;
}

/* ══════════════ 页面（未选中组件）属性 ══════════════
   页面属性不是组件，没有"类别"，但分组规则**同一套**（规格 §6）：默认展开与分组说明在这里
   声明，`PagePropertyPanel` 只查表（分组顺序即该文件里抽屉内的书写顺序）。 */

/** 页面属性默认展开的分组（每个抽屉里只展开第一个）：纸张 / 分节页码；其余折叠（面板不做成一面墙） */
export const PAGE_DEFAULT_OPEN = ['纸张', '分节页码'];

/** 页面属性的分组说明（悬停分组标题弹气泡） */
export const PAGE_GROUP_HINTS: Record<string, string> = {
  纸张: '纸张尺寸与方向，宽高单位 mm；A4 为默认。',
  页边距: '版心四边留白，按 上 / 右 / 下 / 左 的顺序，单位 mm。',
  版式: '纸张底色、默认字体字号与正文行距。',
  分节页码: '三段式页码：封面不显示 → 目录用罗马数字 → 正文从指定页号起用阿拉伯数字。',
  页眉: '页眉区域：左/中/右三段文字 + 距页顶、字号、颜色、分隔线。',
  页脚: '页脚区域：左/中/右三段文字 + 距页底、字号、颜色、分隔线。',
};

/** 通用属性（注册表统一补的上下边距）不参与专有属性分组，单独渲染在「通用属性」抽屉 */
export const UNIVERSAL_KEYS = new Set(['marginTop', 'marginBottom']);

export const CATEGORY_STRATEGY: Record<string, CategoryStrategy> = {
  'Word 常用': {
    order: ['内容', '排版', '外观', '尺寸', '布局', '高级'],
  },
  'PPT 专用': {
    order: ['内容', '排版', '外观', '尺寸', '布局', '高级'],
    hints: {
      内容: '演示页显示的内容与文字。',
      排版: '字体、字号、字重、行距、字距、对齐。',
      外观: '主色、色条、背景、边框、圆角、阴影。',
      尺寸: '宽高、内边距与上下边距。',
      布局: '分列数、间距、方向、时间列宽等。',
    },
  },
  'Excel 表格': {
    // ★单元格在表格之前（用户 2026-09-23）
    order: ['单元格', '表格', '尺寸'],
    hints: {
      单元格: '只作用于画布上选中的单元格（点选 / 拖选一片）：文字内容也在这里改。未被覆盖的项沿用「表格」组的默认值。',
      表格: '整张表格的属性。上面「单元格」组里针对个别格子做的设置会覆盖这里的默认值。',
      尺寸: '宽高与上下边距。',
    },
  },
  'Web 控件': {
    order: ['内容', '外观', '尺寸', '高级'],
    hints: {
      内容: '控件上显示的文字、占位符、默认值。',
      外观: '变体、尺寸、圆角、背景色、文字色。',
      尺寸: '宽高、占满整行、上下边距。',
      高级: '禁用等不常用项。',
    },
  },
  'Web 容器': {
    order: ['内容', '外观', '尺寸', '布局', '高级'],
    hints: {
      内容: '卡片标题、右上角内容。',
      外观: '背景、边框、圆角、阴影。',
      尺寸: '内边距、宽高、上下边距。',
      布局: '显示方式、主轴方向、对齐、列数、间距。',
      高级: '子组件列表。',
    },
  },
};

/** 兜底策略（类别没登记时用）：全局顺序 */
export const FALLBACK_STRATEGY: CategoryStrategy = { order: GROUP_ORDER };

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

/**
 * 默认展开的分组 = **排序后的第一个分组**（用户 2026-09-23）。
 * 只传 order 而不是 category：调用方已经拿到了排好序的分组列表。
 */
export function defaultOpenGroup(order: string[]): string {
  return order[0] ?? '';
}

/** 分组说明：优先用类别专属文案，其次全局通用文案 */
export function hintFor(category: string, group: string, globalHints: Record<string, string>): string | undefined {
  return strategyFor(category).hints?.[group] ?? globalHints[group];
}
