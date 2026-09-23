/**
 * 外部组件契约的**纯文本**版本（Prompt 与 `plugin.types` 共用）。
 * 与 `web-editor/src/registry/types.ts` 的 ComponentDefinition / PropSchemaItem / RenderContext 一一对应；
 * 另外标注了两处"规格与实现不一致"的坑（reactJsxRuntime、children 第三参）。
 */
export const CONTRACT_TEXT = `外部插件（public/组件/*.js）只能这么写：
(function () {
  const React = window.EditorKit.React;          // 编辑器只暴露 React（没有 reactJsxRuntime！）
  window.EditorKit.register({
    type: 'liveXxx',                              // 必须以 live 开头，否则编辑器拒绝注册
    label: '显示名',
    category: '通用',                              // Word 常用/Excel 表格/PPT 专用/通用/布局分页/Web 控件/Web 容器
    supportedModes: ['document', 'web'],
    icon: ({ className }) => React.createElement('span', { className }, '◆'),  // 不能 import lucide-react
    description: '一句话说明',
    isContainer: false,                           // true 时 render 第三参是 children，必须放进自己的 DOM
    defaultProps: { text: '默认文字' },
    propSchema: [
      { key: 'text', label: '文字', control: 'textarea', group: '内容', defaultValue: '默认文字' },
    ],
    render(props, ctx, children) {                // ctx: { mode, page?, canvas?, isEditing, isSelected, mmToPx, ptToPx }
      return React.createElement('div', null, String(props.text || ''), children ?? null);
    },
  });
})();
可用：React.createElement、K.defaultsOf(schema)、K.boxStyle/typographyStyle/alignOf/spacingCss/edgeCss、
      K.fontProps/boxProps（与内置组件同一套属性片段）、K.asString/asNumber/asBool/asEnum、K.lines/rows、
      K.mmToPx/ptToPx、K.icon('名字')（白名单图标）。
不可用：require / process / fs / fetch / import / JSX / TypeScript / React hooks 里的状态（render 要是纯函数）。`;

/**
 * 文档规范（2026-09-23 新增）—— 建文档 / 搬 HTML 时的**判定规则**。
 *
 * 起因：照着一份现成 HTML 建 AGV 方案时，目录被做成了 `list`（源 HTML 里目录是 `<ol>`），
 * 图片留成了占位符（怕 base64 占上下文）。前者是**声明缺失**（没人说目录要用 toc），
 * 后者有正当理由（所以补了 `asset.embed*` 让服务端嵌图）。这两条都写进这里，
 * 作为 `editor://spec/doc-rules` 资源，并在相关 Prompt 里引用。
 */
export const DOC_RULES = `## 一、选组件（别用相近的东西顶替）

| 内容 | 用哪个组件 | 说明 |
|---|---|---|
| 目录 / 目 录 / Contents | **\`toc\`（目录）** | 条目写 \`entries\`，每行 \`标题|页码\`；**不要**用 \`list\`/\`bullets\` 冒充目录 |
| 图片（1 张） | \`image\` | 面板里图片只有**一个入口**：一行一张图（默认 1 行）。写 \`images\` 一行，或写老字段 \`src\`；宽度 \`width\`（文档模式 mm） |
| 图片（2~5 张并排） | **\`image\`（同一个组件）** | \`images\`：每行 \`地址 或 地址 | 图题\`（一行 = 一张 = 面板里一行）；\`columns\`=列数（1~5）；**不要**再新建 \`imagePair\`（它只为老文档保留） |
| 有序/无序列表 | \`list\`（\`ordered: true\` 为编号）/ \`bullets\` | 列表 ≠ 目录 |
| 表格 | \`table\` / \`threeLineTable\` / \`paramTable\` / \`detailTable\` / \`checkTable\` | 单元格内容用 A1 记法逐格改；没有整块「数据」属性行 |
| 标题层级 | \`heading\` + \`level\`(1~6) | 章标题用 level=1，节标题 level=2 |
| 引用 / 代码 / 分隔线 / 分页 | \`quote\` / \`code\` / \`divider\` / \`pageBreak\` | 分页是组件，也可用 \`page.addBreak\` |
| 页眉页脚页码 | 不是组件，是**页面属性** | \`page.setStyle { showFooter: true }\`，文字里用 \`{page}\`/\`{total}\` |

## 二、图片怎么"真的进来"（别写占位符）

- 源里是**内嵌 data URL**（\`data:image/...;base64,...\`）→ 直接用；若在一份 HTML 里，
  用 **\`asset.embedFromHtml { htmlPath, index, nodeId }\`**（不给 index/nodeId 先列清单）把第 N 张嵌进节点；
- 源是**本地图片文件** → **\`asset.embed { nodeId, path }\`**（默认写 \`src\`，面板里就显示成第 1 行）；
- 源是**外链 URL** → 直接把完整 URL 写进 \`src\`（多张时写 \`images\` 里的一行）；
- 想在同一个节点里放多张，用 \`property.set\` 写 \`images\`（每行一张，最多 5 行），
  别连着调两次 \`asset.embed\`（第二次会覆盖第一张）；
- 这三个入口都是**服务端**把 base64 写进节点，回包只给"字节数/格式"，
  **base64 不会进入模型上下文** —— 所以没有"为了省 token 而留占位符"的必要。
- 目标尺寸大、又想省空间时，可以先用 \`asset.embed\` 嵌图，再用 \`property.set\` 调 \`width\`。

## 三、搬一份现成 HTML（\`html_to_document\` Prompt 的规则）

1. \`doc.create\` 建文档（模式按源：有 \`@page …mm\` → 文档模式；固定 px 画布 → Web 模式）；
2. 按源顺序逐块 \`node.add\`：\`h1~h6\`→heading(level 对应)、\`p\`→paragraph、\`ol/ul\`→列表、
   **目录块→toc**、\`table\`→table、\`blockquote\`→quote、\`pre\`→code、\`hr\`→divider、\`img\`→image；
3. 表格用 \`table.setData\` 一次写二维数组（\`|\` 转义成 \`\\|\`、格内换行 \`\\n\`）；
4. 图片按上面「二」嵌入，图题写进那一行的 \`地址 | 图题\`（源里的 \`figcaption\`/alt 就是图题；单张写 \`caption\` 也行）；
5. 页脚页码走页面属性；收尾 \`doc.summary\` + \`export.json\`；
6. 编辑器在线时，先 \`doc.attach\` 让后续调用落到**编辑器正在编辑的那份文档**（否则走无头另存一份）。`;

