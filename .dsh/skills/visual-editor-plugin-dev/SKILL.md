---
name: visual-editor-plugin-dev
description: 给本工作区的可视化编辑器（web-editor）新增/修改**组件与插件**时的规范与验收清单。适用场景：用户说"加一个组件 / 加个插件 / 改组件 / 组件不显示 / 注册不上 / 属性面板里没有这一项 / 热重载 / 外部组件 / 重载外部组件 / 组件要能拖进容器 / 表格类组件要能按单元格编辑 / 组件 schema / propSchema / EditorKit / live 前缀 / dryRun 校验"，或要把某个 A4 编辑器组件、某段 HTML 表格、某个业务卡片搬进编辑器。含：三种组件形态该放哪里、外部插件的硬性要求、EditorKit 完整 API、propSchema 控件与分组规范、七个分类、容器与表格的硬性约定、真实踩过的坑（jsx 签名 / live 前缀 / 裸节点空表 / 容器裁剪 / 二次缩放 / data-cell 标记…）、以及三步验证流程（重载外部组件 → DOM/面板核对 → ?check=1 自检；MCP 侧 plugin.validate + plugin.dryRun）。**不适用于**：与编辑器组件体系无关的纯 JS/React/TS 编码、可打印文档排版交付（用 a4-printable-html-doc）、DSH 自身的 Cordis 动态插件（用 cordis-plugin-development）。
---

# 可视化编辑器 · 组件 / 插件开发规范

一句话：**编辑器框架不认识任何具体组件** —— 组件只提供 `type / label / category / supportedModes / icon / defaultProps / propSchema / render`，
左侧面板、属性面板、画布、分页、导出、MCP 全部由注册表自动驱动。所以"加组件"几乎永远只改组件文件，**不改框架**。

## 0. 先定位：三种形态放哪里

| 形态 | 文件位置 | 生效方式 | 什么时候用 |
|---|---|---|---|
| **外部插件**（推荐先试） | `web-editor/public/组件/<名字>.js` | **运行时热加载**：编辑器里点「重载外部组件」（或组件面板底部按钮），**不需要构建** | 快速迭代、让用户自己改、示例/业务组件；无 TS/JSX/import |
| **内置组件** | `web-editor/src/registry/components/**/<名字>.tsx` | `npm run build` 后生效 | 正式组件、需要 TS 类型、要复用 `shared.ts`/`tableKit` 等内部工具 |
| **框架** | `src/components/**`、`src/store/**`、`src/registry/live.ts` | `npm run build` | 只有确实要改编辑器行为时才动（属性面板/画布/注册表机制） |

内置组件**自动发现**：`src/registry/components` 下任何 `.tsx` 都会被 `import.meta.glob` 收集并注册（`registerComponent`），
新增/删除组件**不需要**改任何框架清单；分组顺序由 `registry/types.ts` 的 `CATEGORY_ORDER` 决定。

> 外部插件与内置组件的**契约是同一个** `ComponentDefinition`；差别只在：外部插件是纯 JS、运行时注册、`type` 必须以 `live` 开头。

## 1. 外部插件的硬性要求（缺一条就会"看不见"或"注册被拒"）

1. **纯 JavaScript**：不能有 `import` / `require` / `process` / `fs` / `fetch`，不能写 TS 类型或 JSX（浏览器直接执行这段源码）。
2. **必须调用 `window.EditorKit.register(def)`**；允许别名（`const K = window.EditorKit; K.register({...})`）。
   没有任何注册调用 = 编辑器永远看不到这个组件（`plugin.validate` 会报 `PLUGIN_CONTRACT_ERROR`）。
3. **`type` 必须以 `live` 开头**（如 `liveNotice`）。否则 `register` **拒绝注册**并打日志（防止外部文件顶掉内置组件）。
4. 必需字段：`type`、`label`、`category`、`supportedModes`、`render`（函数）；`defaultProps`、`propSchema` 强烈建议给全。
5. **`category` 必须是七个约定分类之一**（拼错会静默多出一个分组）：
   `通用` / `布局分页` / `Word 常用` / `Excel 表格` / `PPT 专用` / `Web 控件` / `Web 容器`
   （面板显示短名：布局 / Word / Excel / PPT，契约里仍写全名。）
6. **`icon`**：字符串（走内置图标白名单，如 `'Table'`、`'Type'`、`'Info'`）或 `(props) => React 元素`（内联 SVG / `React.createElement('span', …)`）。
   **不能 import lucide-react**。
7. 文件放在 `web-editor/public/组件/` 下，并把文件名加进同目录 `_manifest.json` 的 `files`（编辑器启动时按清单加载；
   构建时 `public/组件/` 会复制到 `dist/组件/`，开发态与静态托管都能热加载）。
8. 命名建议：文件名用中文语义名（如 `提示条.js`），`type` 用 `live` + 英文驼峰（如 `liveNotice`），`label` 是面板显示名。

## 2. EditorKit：外部插件唯一可用的运行时 API

```js
const { React } = window.EditorKit;   // 只有 React（没有 jsx 自动运行时）
```

| API | 说明 |
|---|---|
| `React` | React 本体。**渲染一律用 `React.createElement(...)`** |
| `reactJsxRuntime.jsx / jsxs / Fragment` | 兼容别名，但**是经典签名**（= `createElement(type, props, ...children)`），不是自动运行时的 `jsx(type, config, key)` |
| `register(def)` | 注册组件（同名会先卸载再注册 → 支持热重载覆盖） |
| `fontProps(size?)` / `boxProps()` | 返回**通用属性片段数组**，直接 `...spread` 进 `propSchema`（与内置组件同一套词汇） |
| `defaultsOf(schema)` | 由 schema 的 `defaultValue` 推导 `defaultProps` |
| `defaultFrameOf(w, h, x=40, y=40)` | 生成 Web 模式默认位置尺寸 `{x,y,w,h}` |
| `boxStyle(props)` / `typographyStyle(...)` / `alignOf(...)` / `spacingCss(...)` / `edgeCss(...)` | 属性 → CSS 片段 |
| `lines(v)` / `rows(v)` | 文本 → 行数组 / 二维数组（`\|` 分列） |
| `asString / asNumber / asBool / asEnum(v, allowed, fallback)` | 取值守卫（**渲染里一律用它取值**，别直接读 `props.x`） |
| `mmToPx / ptToPx` | 单位换算（文档模式排版用） |
| `icon(name?)` | 按白名单名字取图标 |
| **表格内核**：`renderTable(props, ctx)`、`tableSchema(二维数组, variant, {colWidths,rowHeight})`、`parseTableData`、`serializeTableData`、`escapeCell`、`parseCellStyles`、`parseColWidths` | 表格类插件用它渲染/取 schema，**自动获得与内置表格一致的单元格逻辑**（见 §6） |

`render(props, ctx, children?)` 的 `ctx`（RenderContext）：`mode`、`page`（文档模式纸张配置）、`canvas`（Web 画布配置）、
`isEditing`、`isSelected`、`mmToPx`、`ptToPx`、`tableRowRange`（表格跨页续排时由分页器给出）。
**渲染要输出真实最终外观**（真实的 `h2/table/button/input` 元素），编辑器不给组件加任何专属样式。

## 3. propSchema 规范（属性面板由它生成）

```js
{ key, label, control, group, defaultValue, options?, min?, max?, step?, unit?, placeholder?, visibleWhen? }
```

* **`label` 写法**：`主名（说明）`。面板只显示**主名**，括号里的说明进**悬停气泡**（气泡里还会带 key、默认值、取值范围、可选项）。
  说明要写"人话 + 单位 + 取值范围"，别把说明塞进主名（会让属性名列变长、面板变挤）。
* **`control` 必须已实现**（否则面板显示"控件未实现"，自检也会报）：
  `text` `textarea` `richtext` `number` `slider` `color` `select` `switch` `align` `font` `spacing` `edge` `image` `unit` `frame` `children` `cells` `tableSize` `tableHtml`
  其中 `textarea`/`richtext`/`spacing`/`edge`/`frame`/`children`/`cells`/`tableSize`/`tableHtml` 是**整行式**（标签在上、控件独占一行）。
* **`group`** 用这套词汇：`内容` `排版` `外观` `尺寸` `布局` `高级` `表格` `单元格`。
  分组顺序与默认展开由 `components/panels/groupStrategy.ts` 决定（`GROUP_ORDER`：单元格 → 表格 → 内容 → 排版 → 外观 → 尺寸 → 布局 → 高级）；
  **专有属性抽屉里只默认展开第一个分组**，其余折叠。所以把最常改的放第一个分组。
* `visibleWhen(props, ctx)` 可按其它属性隐藏该项（如仅 `display==='flex'` 时显示主轴方向）。
* 「上边距 / 下边距」由注册表统一补（`normalizeSchema`），**组件自己不要再写 `margin`**。
* 数值/单位：`number` 用 `min/max/step`；带单位用 `unit`（`mm`/`px`/`pt`/`%`）；颜色用 `color`；枚举用 `select` + `options`。

## 4. 分类与排序（用户指定，别改）

`CATEGORY_ORDER = 通用 → 布局分页 → Word 常用 → Excel 表格 → PPT 专用 → Web 控件 → Web 容器`
（面板显示：通用 / 布局 / Word / Excel / PPT；Web 两类只在 Web 模式出现）。
选分类的判断：既有 Word 文档场景又有 Web 场景的通用件放 `通用`；只在文档流里排版用的放 `布局分页`；Web 专用控件/容器放后两类。

## 5. 容器组件（能嵌套子组件）

```js
isContainer: true,
render: (props, ctx, children) => React.createElement('div', { style: {...} }, children),
```

* 子节点由画布递归渲染后作为**第三个参数**传入，**必须真的放进自己的 DOM 位置**（否则子组件"消失"）。
* 「分栏 / 容器 / 卡片」这类容器如果**忽略 children**，子组件会整个不见 —— 自检里有专门断言。
* **Web 模式的容器要裁剪越界内容**：内容层用一层 `position:absolute; inset:0; overflow:hidden`
  （与容器边框盒重合 → 不改子组件坐标），这样"子组件拖出容器的部分看不见"。
* Web 模式子组件坐标是**相对父容器**的：换父级（拖进容器）时必须换算坐标并**夹在容器内**
  （框架已做：`reparentComponent(id, parentId, frame)` + 拖动时夹取）。
* 容器不要给自己加 `data-node-id`（那是画布包装节点的标记，会干扰命中测试与组件树）。

## 6. 表格类组件（务必用表格内核）

```js
const K = window.EditorKit;
const DATA = [['参数','方案 A','方案 B'], ['载重','1000kg','1500kg']];
K.register({
  type: 'liveCompareTable', label: '参数对比表', category: 'Excel 表格', supportedModes: ['document','web'],
  icon: 'Table',
  defaultProps: Object.assign(K.defaultsOf(K.tableSchema(DATA, 'normal')), {
    data: K.serializeTableData(DATA),   // ★内容存文本形态（「数据」属性行已删除，必须显式给）
  }),
  propSchema: K.tableSchema(DATA, 'normal', { colWidths: '30,35,35' }),
  render: (props, ctx) => K.renderTable(props, ctx),
});
```

硬性约定（与内置「表格」完全一致，写错会"看着像坏了"）：

* **没有「数据」属性行**（已按用户要求删除）。内容**以单元格为主**：画布上点选/拖选单元格 →
  「单元格格式」组里的「内容」框逐格改；行/列不足用「行 / 列数量」组增删；整块换内容用「HTML 源码」导入。
* **`props.data` 仍是存储形态**：文本 `a | b\nc | d`，转义 `\|` = 格内竖线、`\n` = 格内换行、`\\` = 反斜杠。
  schema 里没有 `data`，所以**默认内容必须自己写进 `defaultProps.data`**，否则渲染出来是一张**空表**（很容易被当成"组件坏了"）。
* 单元格格式存 `props.cellStyles`，键是 **Excel A1 记法**（`B2`，合并区 `B2:C3`）；插入/删除行列要**平移这些键**。
* 列宽 `props.colWidths`：逗号分隔，纯数字按百分比（`20,50,30`），也可写 `35mm`；空了就按内容自适应。
* 线条风格 `props.variant`：`normal` 全框线 / `threeLine` 三线表 / `hLines` 横线表。
* 表头：`headerRow`（首行为表头，默认 true）、`headerCol`（首列为表头，默认 false，开启后第一列渲染成 `th[scope=row]`）。
* 需要跨页续排（文档模式）时，组件定义里加 `splittable: 'rows'`。
* 想只暴露"单元格格式/行列数量"两个控件时，可用 `tableSchema` 生成后自己筛选，但**别自己造 `data-cell` 标记**——
  `renderTable` 已按 `data-cell="行,列"` 输出，单元格选择与格式定位都依赖它。

## 7. 硬性禁令与真实踩过的坑（症状 → 原因 → 正确做法）

| 症状 | 原因 | 正确做法 |
|---|---|---|
| 组件在左侧面板里根本没有 | 没调 `register` / 文件不在 `public/组件/` / 没进 `_manifest.json` | 补注册、确认路径与清单，然后点「重载外部组件」 |
| 注册被拒、日志写 "type 必须以 live 开头" | 想用 `type: 'table'` 覆盖内置组件 | 外部插件 `type` 一律 `live` 前缀 |
| 面板出现一个没见过的分组 | `category` 拼错（如 "Word常用" 少空格） | 用七个约定分类的**精确字符串** |
| 组件内容/子元素丢了、或 `null` 配置报错 | 用了 `jsx(type, config, maybeKey)`（自动运行时签名） | 用 `React.createElement(type, props, ...children)`，或 `EditorKit.reactJsxRuntime.jsx`（经典签名） |
| 用了 `EditorKit.reactJsxRuntime` 报 undefined | 规格文档写的自动运行时与实现不一致 | 实现只给经典签名；`plugin.validate` 会把这种写法当错误提示 |
| 表格渲染成一张空表 | 裸节点（没有 `defaultProps`，或 schema 里没有 `data` 却没给默认值） | `defaultProps.data = serializeTableData(rows)`（旧数据则兼容读 `items`） |
| 拖进容器的子组件看不见了 | 只改了树结构、没把坐标换算成"相对新容器"，加上容器裁剪就出了可视区 | 用 `reparentComponent(id, parentId, frame)` 传相对坐标并夹在容器内 |
| 容器里的子组件边框被切一半 | 容器裁剪 vs 子组件能停在跨界位置 | 拖动/缩放时把子组件**夹在容器边框盒内**（框架已做，组件别自己反转） |
| 缩放后标尺/内容错位 | 在已 `scale(zoom)` 的外层里又乘了一次 zoom | 只在**一处**应用 zoom（标尺刻度用 `zoom` 参数，容器**不要再 scale**） |
| 打印时位置偏移 | 平移/缩放层没在打印时清掉 | 画布层用 `.print-reset` / `data-pan-layer` 标记（打印会 `transform:none`）；组件里的编辑态装饰加 `no-print` |
| 分页测量把组件算错高 | 依赖了只在屏幕态存在的 DOM/交互 | 渲染要幂等、无副作用；编辑态装饰加 `no-print`；不要给节点加 `data-node-id` |
| 组件把整个编辑器拖垮 | render 抛错未兜 | 每个节点都有错误边界（只降级该节点成红框），但**仍要修根因**：`?check=1` 会报渲染错误 |
| 属性面板项不显示 | `control` 没实现 / `visibleWhen` 返回 false / `group` 不在默认展开的第一个分组 | 用已实现控件；需要常年可见就放到第一个分组 |

其它纪律：
* 渲染里**不要缓存/读取编辑器内部对象**，只用传进来的 `props` 与 `ctx`。
* 不要写全局副作用（挂 `window`、定时器、事件监听）——组件会被反复渲染（含离屏测量层）。
* 颜色/字号/间距尽量走 `props`（能被属性面板改），不要写死。
* 交互控件的 `onClick` 里记得 `e.preventDefault()`（编辑器里不触发真实行为，如按钮不提交、链接不跳转）。

## 8. 验证流程（改完必须走一遍）

1. **热加载**：在编辑器里点「重载外部组件」；失败会弹窗列出文件名，细节看「帮助 → 诊断信息」。
2. **面板与画布核对**：
   * 左侧分类下能看到组件（分类/显示名/图标/名称省略号）；
   * 拖到画布能正常渲染，选中后右侧「专有属性」按预期分组（只展开第一个分组）；
   * 值改动能立刻反映到画布；容器能拖入子组件；表格能点选单元格并在「内容」框改文字。
3. **跑自检**（最权威、可复核）：浏览器打开 `http://127.0.0.1:5179/?check=1`，
   报告落在运行目录 `web-editor/logs/check-YYYY-MM-DD.log`，必须 **全部 PASS**（当前 155 条，其中含
   "外部组件 schema 与内置组件共用同一套控件"、"外部组件 type 必须 live 前缀"、"外部组件重载幂等"、"容器裁剪"、"Web 表格单元格可直接点选"等）。
   新增了能力/修了 bug，**顺手加一条断言**并把"默认展开/分组顺序"这类易回归点钉住。
4. **MCP 侧（可选，需要 editor-mcp 进程）**：
   * `plugin.validate {name, source}`：语法 + 契约静态校验（live 前缀、必填字段、禁用的依赖、`register` 调用）。
     本 Skill 的 `templates/*.js` 都是 **validate 0 问题**，可以直接当"合规样例"用。
   * `plugin.dryRun {name, source}`：在 `node:vm` 沙箱里跑一遍并 `renderToStaticMarkup`，看真实 HTML；
     沙箱只注入 `window.EditorKit`（mock）+ `console` + `React`，**没有** `require/process/fs/fetch`。
     ⚠ **已知缺口（2026-09-23 实测）**：沙箱 mock 的 EditorKit 目前**缺 `fontProps` / `boxProps`**，
     所以用了通用属性片段的插件（`templates/plugin-basic.js` 就是）dryRun 会报
     `K.fontProps is not a function` —— **编辑器里是正常的**；`defaultFrameOf` 的签名此前也被写错过。
     判断口径：**`plugin.validate` 通过 + 编辑器里「重载外部组件」成功 = 插件没问题**；
     dryRun 报某个 API "不是函数" 时，先确认编辑器侧 `registry/live.ts` 的 `EditorKit` 真有这个 API，
     再决定是"补沙箱 mock"还是"改插件"——**不要为了让 dryRun 过而删掉插件里的正常用法**。
   * `plugin.list / plugin.get / plugin.update / plugin.patch / plugin.create / plugin.template / plugin.logs`：列目录、读写、按锚点改、看 dryRun 日志。
5. **构建校验**（改到内置组件或框架时）：`cd web-editor && npx tsc -b && npm run build` 必须 0 错误。

## 9. 提交前清单

- [ ] 文件在正确位置；外部插件已进 `public/组件/_manifest.json`。
- [ ] `type` 有 `live` 前缀（外部插件）；`category` 是七个约定分类之一。
- [ ] `label` 是「主名（说明）」写法；`control` 都在已实现列表里；最常改的项在第一个分组。
- [ ] `defaultProps` 齐全（含表格的 `data`）；`render` 只依赖 `props` / `ctx`。
- [ ] 容器把 `children` 放进 DOM；Web 容器有裁剪层。
- [ ] 表格类组件用 `renderTable/tableSchema`，没有自造 `data` 属性与 `data-cell` 标记。
- [ ] 编辑态装饰带 `no-print`；没有全局副作用；没有 `data-node-id`。
- [ ] 「重载外部组件」成功；`?check=1` 全绿；必要时补了断言。

## 附：模板

* `templates/plugin-basic.js` —— 最小可注册组件（文本类，含通用属性片段）。
* `templates/plugin-container.js` —— Web 容器（`isContainer` + 裁剪层 + 子组件落位）。
* `templates/plugin-table.js` —— 表格类（表格内核 + 单元格逻辑 + 默认内容/高亮列）。

复制到 `web-editor/public/组件/<中文名>.js`，改 `type/label/category` 与内容即可；改完点「重载外部组件」。
