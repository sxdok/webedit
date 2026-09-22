/**
 * 职责：从**注册表实时生成**「组件功能属性 + 属性编辑器状态」说明清单（Markdown）。
 *
 * 为什么生成而不是手写：手写的清单一定会跟代码漂移（这一路上踩过 README 写"15 种控件"实际 14、
 * 写"导出 React 尚未实现"其实早就实现了）。这里直接读注册表与面板常量，
 * **新增/删除组件后重新生成即可**，内容与运行中的编辑器永远一致。
 *
 * 清单回答两个问题（用户明确要求）：
 *   ① 这个组件**有哪些功能属性**（属性名 / key / 控件 / 默认值 / 说明 / 取值）；
 *   ② **选中这个组件后属性编辑器是什么状态**（哪些分组、各有几项、默认展开谁、哪些是两行式、
 *      有哪些特殊块，例如 Web 模式的位置与尺寸、容器的子组件列表）。
 *
 * 落盘：启动器 `POST /__save` → 运行目录 `docs/组件与属性说明清单.md`（帮助菜单 / `?spec=1`）。
 */
import { CATEGORY_ORDER, type ComponentDefinition, type PropSchemaItem } from '../registry/types';
import { getAllComponents } from '../registry';
import { IMPLEMENTED_CONTROLS, isWideControl, splitLabel } from '../components/property-controls';
import { DEFAULT_OPEN_GROUP, GROUP_HINTS, GROUP_ORDER } from '../components/panels/PropertyPanel';

/** 注册表统一补的通用属性（不是组件自己的属性） */
const UNIVERSAL_KEYS = new Set(['marginTop', 'marginBottom']);

/** 控件 → 用途（与 property-controls 的分派一致） */
const CONTROL_NOTES: Record<string, string> = {
  text: '单行文本输入',
  textarea: '多行文本（每行一条，用 | 分列）',
  richtext: '富文本（contenteditable + 工具条，值存 HTML）',
  number: '数字输入',
  slider: '滑块 + 当前值',
  color: '取色器 + 十六进制输入',
  select: '下拉选择',
  switch: '开关（布尔）',
  align: '左/中/右/两端对齐（图标按钮）',
  font: '字体下拉（宋体/黑体/楷体/仿宋/微软雅黑/Times/Arial）',
  spacing: '单一间距值 + 单位（四边联动）',
  edge: '四边独立数值（上/右/下/左）',
  image: '图片地址 + 选择本地文件（转 data:URL）',
  unit: '数值 + 单位徽标（mm/px/pt）',
  frame: '位置与尺寸（x/y/w/h）',
  children: '容器子项列表（排序 / 删除 / 进入选中）',
  cells: '**表格单元格**：点选格子后逐格改格式（即改即生效）',
  tableSize: '**表格**：行/列数量 + 插入/删除行列 + 列宽自适应',
};

/** Markdown 表格单元格转义：内容里的 `|` 会把表格撑破（"数据"属性的默认值里就有），必须转义 */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function fmtDefault(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') {
    const s = v.replace(/\n/g, ' ⏎ ');
    return s === '' ? '（空）' : `\`${s.length > 36 ? `${s.slice(0, 36)}…` : s}\``;
  }
  if (typeof v === 'object') {
    try {
      const j = JSON.stringify(v);
      return `\`${j.length > 36 ? `${j.slice(0, 36)}…` : j}\``;
    } catch {
      return '（对象）';
    }
  }
  return `\`${String(v)}\``;
}

/** 属性的"说明 + 取值"：优先用 schema 标签里括号内的说明，再补单位/范围/选项 */
function describe(item: PropSchemaItem): string {
  const { hint } = splitLabel(item.label);
  const bits: string[] = [];
  if (hint) bits.push(hint);
  if (item.unit) bits.push(`单位 ${item.unit}`);
  if (item.min !== undefined || item.max !== undefined) bits.push(`范围 ${item.min ?? ''}~${item.max ?? ''}`);
  if (item.options?.length) bits.push(`可选：${item.options.map((o) => String(o.label)).join(' / ')}`);
  if (item.visibleWhen) bits.push('按条件显示');
  if (UNIVERSAL_KEYS.has(item.key)) bits.push('通用属性（注册表统一补）');
  return bits.join('；') || '—';
}

/** 一个组件的属性表（按分组拆成多张）；defaultOpen = 该组件默认展开的组（与面板同一规则） */
function componentTables(def: ComponentDefinition, defaultOpen: string): string[] {
  const groups = new Map<string, PropSchemaItem[]>();
  for (const it of def.propSchema) groups.set(it.group, [...(groups.get(it.group) ?? []), it]);
  const order = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const out: string[] = [];
  for (const g of order) {
    const items = groups.get(g) ?? [];
    const openHint =
      g === defaultOpen
        ? '默认展开'
        : g === '单元格'
          ? '默认折叠，选中单元格时自动展开'
          : '默认折叠';
    out.push(`**「${g}」组**（${items.length} 项 · ${openHint}）`);
    out.push('');
    if (GROUP_HINTS[g]) out.push(`> 分组气泡说明：${GROUP_HINTS[g]}`);
    if (GROUP_HINTS[g]) out.push('');
    out.push('| 属性（面板显示名） | key | 控件 | 排版 | 默认值 | 说明 / 取值 |');
    out.push('|---|---|---|---|---|---|');
    for (const it of items) {
      out.push(
        `| ${cell(splitLabel(it.label).short)} | \`${cell(it.key)}\` | \`${cell(it.control)}\` | ${
          isWideControl(it.control) ? '整行式' : '单行式'
        } | ${cell(fmtDefault(it.defaultValue))} | ${cell(describe(it))} |`,
      );
    }
    out.push('');
  }
  return out;
}

/** 该组件默认展开的组：有「表格」组就展开它，否则展开第一个组（与 PropertyPanel 同一规则） */
function defaultOpenOf(order: string[]): string {
  return order.includes(DEFAULT_OPEN_GROUP) ? DEFAULT_OPEN_GROUP : (order[0] ?? '');
}

/** 选中该组件后，属性编辑器呈现的状态 */
function editorState(def: ComponentDefinition): string[] {
  const groups = new Map<string, number>();
  for (const it of def.propSchema) groups.set(it.group, (groups.get(it.group) ?? 0) + 1);
  const order = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const openName = defaultOpenOf(order);
  const lines: string[] = [];
  lines.push(
    `- **面板分组（${order.length} 个，按此顺序）**：` +
      order
        .map((g) => {
          const n = groups.get(g) ?? 0;
          if (g === openName) return `**${g} ${n}（默认展开）**`;
          if (g === '单元格') return `${g} ${n}（选中单元格时自动展开）`;
          return `${g} ${n}（折叠）`;
        })
        .join(' ｜ '),
  );
  const wide = def.propSchema.filter((it) => isWideControl(it.control));
  const inline = def.propSchema.filter((it) => !isWideControl(it.control));
  lines.push(
    `- **排版**：单行式 ${inline.length} 项（左列属性名 + 右列控件）｜整行式 ${wide.length} 项` +
      (wide.length ? `（${[...new Set(wide.map((w) => w.control))].join('、')}，标签在上、控件独占整行）` : ''),
  );
  lines.push(`- **顶部固定区**：组件名 + \`${def.type}\` 徽标、组件 ID（可一键复制）、「过滤属性…」输入框`);
  if (def.supportedModes.includes('web')) {
    lines.push('- **Web 模式额外**：选中时面板顶部多一块「位置与尺寸（px）」。x / y / w / h 四个数值输入');
  }
  if (def.isContainer) {
    lines.push('- **容器专属**：含 `children` 控件 —— 子组件列表（上移/下移/删除/点进选中）');
  }
  const controls = [...new Set(def.propSchema.map((it) => it.control))];
  lines.push(`- **用到的控件**：${controls.map((c) => `\`${c}\``).join('、')}`);
  return lines;
}

export function buildComponentSpecSheet(): string {
  const all = getAllComponents().filter((d) => !d.type.startsWith('__'));
  const known = CATEGORY_ORDER as readonly string[];
  const byCat = new Map<string, ComponentDefinition[]>();
  for (const d of all) byCat.set(d.category, [...(byCat.get(d.category) ?? []), d]);
  const cats = [...byCat.keys()].sort((a, b) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const L: string[] = [];
  L.push('# Web 可视化编辑器 · 组件功能属性 与 属性编辑器状态 说明清单');
  L.push('');
  L.push('> 本文件由编辑器**从组件注册表实时生成**（帮助 → 导出组件与属性说明清单，或访问 `?spec=1`），');
  L.push(`> 不会与代码脱节：新增/删除组件后重新生成即可。生成时间：${new Date().toLocaleString()}`);
  L.push('');
  L.push('每个组件一段，回答两件事：**① 它有哪些功能属性**；**② 选中它之后属性编辑器是什么状态**。');
  L.push('');
  L.push('## 一、总览');
  L.push('');
  L.push(`- 组件总数：**${all.length}**`);
  L.push(`- 分类分布：${cats.map((c) => `${c} ${(byCat.get(c) ?? []).length}`).join(' / ')}`);
  L.push(`- 已实现的属性控件：**${IMPLEMENTED_CONTROLS.size}** 种`);
  L.push('');
  L.push('### 组件化约定（改组件不用动框架）');
  L.push('');
  L.push('| 约定 | 说明 |');
  L.push('|---|---|');
  L.push('| 一个组件一个文件 | `src/registry/components/{common,document,ppt,web}/*.tsx`，导出 `xxxComponent: ComponentDefinition` |');
  L.push('| 注册靠目录自动发现 | `index.ts` 用 `import.meta.glob` 扫描；**加/删组件不改框架文件**（文件名以 `_` 开头则忽略） |');
  L.push('| 组件定义字段 | `type / label / category / supportedModes / icon / description / isContainer / defaultProps / defaultFrame / propSchema / render` |');
  L.push('| 渲染契约 | `render(props, ctx)` 返回真实最终外观（真实 `<h1>`/`<table>`/`<button>`…），编辑器只在外层套选中/悬停外壳 |');
  L.push('| 模式过滤 | `supportedModes`，面板与画布按当前模式过滤 |');
  L.push('| 通用属性 | 注册表统一给**所有组件**补 `上边距(mm)`/`下边距(mm)`（属性表里标注"通用属性"） |');
  L.push('| 容器 | `isContainer: true` 可嵌套子组件（children 注入容器元素内部） |');
  L.push('| 外部组件（热加载） | `public/组件/*.js` 调 `window.EditorKit.register(...)`，改完点「重载外部组件」，不用构建 |');
  L.push('| 单个组件出错不拖垮整体 | 每个节点外套节点级错误边界，render 抛错只把该节点降级成红框提示 |');
  L.push('');
  L.push('## 二、属性编辑器总说明');
  L.push('');
  L.push('| 项 | 规则 |');
  L.push('|---|---|');
  L.push('| 排布 | 两列紧凑列表：左列固定宽属性名、右列控件，一行一个属性 |');
  L.push('| 属性名 | 只显示主名（`数据（每行一条，用 | 分列）` → 显示 `数据`）；带虚线下划线表示"可悬停看说明" |');
  L.push('| 说明 | **默认全部隐藏**，鼠标悬停属性名弹气泡（自研 Tooltip，非原生 title） |');
  L.push('| 整行式控件 | `textarea / richtext / spacing / edge / frame / children / cells / tableSize` —— 标签在上、控件独占整行 |');
  L.push(`| 分组顺序 | ${GROUP_ORDER.join(' → ')} |`);
  L.push(`| 默认展开 | 「${DEFAULT_OPEN_GROUP}」组；「单元格」组在有单元格被选中时自动展开 |`);
  L.push('| 分组说明 | 分组标题悬停弹气泡，写明该组是"整表"还是"选中的单元格" |');
  L.push('| 未选中组件 | 文档模式显示「页面属性」，Web 模式显示「画布属性」 |');
  L.push('| 编辑器态 vs 文档数据 | 选中了哪些单元格、悬停/选中态属**编辑器态**（不导出、不打印）；组件属性（含 `cellStyles`）属**文档数据** |');
  L.push('');
  L.push('### 控件类型清单（schema 里可用）');
  L.push('');
  L.push('| 控件 | 用途 | 整行式 |');
  L.push('|---|---|---|');
  for (const c of IMPLEMENTED_CONTROLS) {
    L.push(`| \`${c}\` | ${cell(CONTROL_NOTES[c] ?? '—')} | ${isWideControl(c) ? '是' : '否'} |`);
  }
  L.push('');
  for (const cat of cats) {
    const items = (byCat.get(cat) ?? []).slice().sort((a, b) => a.label.localeCompare(b.label, 'zh'));
    L.push(`## ${cat}（${items.length} 个组件）`);
    L.push('');
    for (const def of items) {
      const flags = [def.supportedModes.includes('document') ? '文档' : '', def.supportedModes.includes('web') ? 'Web' : '']
        .filter(Boolean)
        .join('+');
      L.push(`### ${def.label}　\`${def.type}\``);
      L.push('');
      L.push(`- 分类：${def.category}　可用模式：**${flags}**${def.isContainer ? '　**容器**（可嵌套子组件）' : ''}`);
      if (def.description) L.push(`- 一句话说明：${def.description}`);
      L.push(`- 功能属性共 **${def.propSchema.length}** 项`);
      L.push('');
      L.push('**选中它之后，属性编辑器的状态**');
      L.push('');
      L.push(...editorState(def));
      L.push('');
      L.push('**它的功能属性**');
      L.push('');
      const order = [...new Set(def.propSchema.map((it) => it.group))].sort((a, b) => {
        const ia = GROUP_ORDER.indexOf(a);
        const ib = GROUP_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      L.push(...componentTables(def, defaultOpenOf(order)));
    }
  }
  L.push('## 三、维护指引');
  L.push('');
  L.push('| 想做什么 | 怎么做 |');
  L.push('|---|---|');
  L.push('| 加一个内置组件 | 在对应分类目录新建 `.tsx`，导出 `ComponentDefinition`；**不用改框架文件** |');
  L.push('| 加一个外部组件（不构建） | `public/组件/` 放 `.js`，调 `window.EditorKit.register(...)`，点「重载外部组件」 |');
  L.push('| 加一种属性控件 | `property-controls/index.tsx` 加 `case` 并加进 `IMPLEMENTED_CONTROLS`，schema 即可用 |');
  L.push('| 改分组 / 默认展开 / 分组说明 | `PropertyPanel.tsx` 的 `GROUP_ORDER` / `DEFAULT_OPEN_GROUP` / `GROUP_HINTS` |');
  L.push('| 重新生成本清单 | 菜单「帮助 → 导出组件与属性说明清单」，或访问 `?spec=1`（写到运行目录 `docs/`） |');
  L.push('');
  L.push('> 自检（`?check=1`）核对：分类只用约定分类且每类都有组件、每个组件都有自己的配置属性、');
  L.push('> 每个组件 schema 里的控件都已实现、注册表由目录自动发现、属性面板无溢出与属性名折行。');
  L.push('');
  return L.join('\n');
}
