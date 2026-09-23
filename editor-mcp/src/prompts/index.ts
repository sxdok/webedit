/**
 * Prompts（规格 §七）：11 个预设提示词，客户端选中后拿到**已填好上下文**的 messages。
 *
 * 设计原则：
 *   · 提示词里明确"该调哪些 Tool、按什么顺序"，把 MCP 的能力真正串起来（规格验收 5）；
 *   · 上下文里带上真实约束（live 前缀、createElement、无头会 degraded…），避免 AI 走弯路；
 *   · 参数都有默认值，客户端不传也能跑。
 *   · ★MCP 协议规定 prompt 参数一律是**字符串**（SDK 会在协议层先校验，传数字会被拒），
 *     所以这里全部用 z.string() / z.enum([...])，数值在提示词正文里按字符串插值。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { CONTRACT_TEXT } from './contract.js';

type Msg = { role: 'user' | 'assistant'; content: { type: 'text'; text: string } };
const user = (text: string): Msg => ({ role: 'user', content: { type: 'text', text } });
const assistant = (text: string): Msg => ({ role: 'assistant', content: { type: 'text', text } });

const ENV_NOTE = `环境：MCP 服务器 editor-mcp v0.1.0；工作区 ${config.workspace}；插件目录 ${config.pluginDir}。
工具命名 <域>.<动作>；所有写操作返回 { ok, data, error?, degraded?, changed? }。
编辑器没开 MCP 桥接时，工具会走**无头模式**（直接改磁盘文档）并标 degraded: true —— 这时画布不会实时变，最后要在编辑器里打开该文档。`;

export function registerAllPrompts(server: McpServer): string[] {
  const names: string[] = [];
  const reg = <A extends Record<string, z.ZodTypeAny>>(
    name: string,
    title: string,
    description: string,
    argsSchema: A,
    build: (args: Record<string, unknown>) => Msg[],
  ) => {
    // ★`as never`：与 tools/index.ts 同一个原因（SDK 的 registerPrompt 是重载 + 泛型推断，
    //   从"通用 shape"转发时 TS 收敛不到具体重载；运行时仍由 zod argsSchema 校验）。
    server.registerPrompt(
      name,
      { title, description, argsSchema: argsSchema as never },
      ((args: Record<string, unknown>) => ({ messages: build(args ?? {}) })) as never,
    );
    names.push(name);
  };

  /* 1. 建文档 */
  reg(
    'create_document',
    '创建 Word 文档',
    '一份文档：标题 + 摘要 + 正文 + 表格 + 页码；自动串起 doc.create → node.add → property.set → export.json',
    { title: z.string().default('未命名文档'), outline: z.string().default('一、背景\n二、方案\n三、结论'), pageSize: z.enum(['A4', 'A3', 'A5', 'Letter', 'Legal']).default('A4') },
    (a) => [
      user(`帮我用可视化编辑器建一份文档《${String(a.title)}》（${String(a.pageSize)} 纸张），结构如下：\n${String(a.outline)}`),
      assistant(
        [
          ENV_NOTE,
          '',
          '请按这个顺序做，每步都用真实 Tool 调用（不要只说计划）：',
          `1. doc.create { title: "${String(a.title)}", mode: "document", pageSize: "${String(a.pageSize)}" } → 记住返回的 docId`,
          '2. node.add { type: "heading", props: { text: "<标题>", level: 1 } }（文档标题）',
          '3. node.add { type: "abstract" } + node.setText 写摘要',
          '4. 按大纲逐条：node.add { type: "heading", level: 2 } → node.add { type: "paragraph" } → node.setText 填正文',
          '5. 需要表格时：node.add { type: "table" } → table.setData（二维数组）→ table.setVariant / table.setCellStyle',
          '6. 页脚页码属于页面属性：page.setStyle { showFooter: true }（页脚文字里用 {page} / {total} 变量）',
          '7. 收尾：doc.summary 看节点数与字数；export.json 导出；export.spec 导出属性清单（若在编辑器里导出 HTML/PDF，需先开桥接）',
          '',
          '注意：node.add 的 props 会与组件默认值合并；表格单元格用 A1 记法（B2 / A2:B3）；文档流里插入顺序就是阅读顺序。',
        ].join('\n'),
      ),
    ],
  );

  /* 2. 建 PPT 页 */
  reg(
    'create_slide',
    '创建 PPT 页',
    '一页 PPT（封面/内容页/数据页/结束页），用 PPT 专用组件',
    { kind: z.enum(['cover', 'content', 'data', 'end']).default('content'), title: z.string().default('演示标题'), bullets: z.string().default('要点一\n要点二\n要点三') },
    (a) => [
      user(`做一页 ${String(a.kind)} 类型的 PPT：标题「${String(a.title)}」，要点：${String(a.bullets)}`),
      assistant(
        [
          ENV_NOTE,
          'PPT 组件在类别「PPT 专用」；它们在文档流里按顺序排布（当前编辑器把 PPT 当作类别而不是独立模式）。',
          `1. doc.create { title: "${String(a.title)}", mode: "document" }`,
          kindHint(String(a.kind)),
          '2. 用 node.setText 填内容；要数据图用 chartBar（items: "一月|120\\n二月|180"）；要流程用 process（items: "第1步|说明\\n第2步|说明"）',
          '3. node.setFrame 仅在 Web 模式有意义；文档模式的 PPT 组件靠 node.reorder 调顺序',
          '4. 收尾：doc.summary',
        ].join('\n'),
      ),
    ],
  );

  /* 3. Web 页面 */
  reg(
    'build_web_page',
    '搭建 Web 页面',
    '导航 + 卡片 + 表单 + 页脚（Web 模式绝对定位 + 容器嵌套）',
    { purpose: z.string().default('产品介绍页'), sections: z.string().default('导航\n卡片\n表单\n页脚'), device: z.enum(['Desktop', 'Laptop', 'Tablet', 'Mobile']).default('Desktop') },
    (a) => [
      user(`用 Web 模式搭一个${String(a.purpose)}，区块：${String(a.sections)}，目标设备 ${String(a.device)}`),
      assistant(
        [
          ENV_NOTE,
          `1. doc.create { mode: "web", device: "${String(a.device)}" }`,
          '2. canvas.setDevice / canvas.setGrid { show: true, size: 8 } 先定画布',
          '3. 容器：node.add { type: "container", props: { display: "flex", flexDirection: "column", gap: 12 } } → 记住 id',
          '4. 往容器里加子节点：node.add { type: "card", parentId: "<容器id>" }；卡片里再放 button / input',
          '5. 位置尺寸：node.setFrame { id, x, y, w, h }（Web 模式必须给 frame，否则堆在左上角）',
          '6. 收尾：node.tree 检查嵌套；export.react 出 React+Tailwind 代码（需编辑器在线）',
        ].join('\n'),
      ),
    ],
  );

  /* 4. 加表格 */
  reg(
    'add_table',
    '添加并填充表格',
    '建一张表格并填数据、设线条风格',
    { rows: z.string().default('3'), cols: z.string().default('3'), headerRow: z.enum(['true', 'false']).default('true'), variant: z.enum(['normal', 'threeLine', 'hLines']).default('normal') },
    (a) => [
      user(`加一张 ${String(a.rows)} 行 × ${String(a.cols)} 列的表格${a.headerRow ? '（含表头）' : ''}，线条风格 ${String(a.variant)}`),
      assistant(
        [
          ENV_NOTE,
          `1. node.add { type: "table", props: { headerRow: ${String(a.headerRow)}, variant: "${String(a.variant)}" } } → 记住 id`,
          `2. table.setData { id, data: [[...${String(a.cols)} 列], ...共 ${String(a.rows)} 行] }（数组或 "a | b\\nc | d" 文本）`,
          '3. 格式：table.setCellStyle { id, range: "A1:B1", style: { background: "#e8f1f9", fontWeight: 700 } }',
          '4. 列宽：table.setColWidths { widths: "20,50,30" }（纯数字按 %）；或 table.autoFit',
          '5. 合并：table.mergeCells { range: "A2:B3" }；拆分：table.splitCells',
          '6. 格内换行写 \\n，格内竖线写 \\|（它们会被转义，不会被当成列分隔符）',
        ].join('\n'),
      ),
    ],
  );

  /* 5. 填已有表格 */
  reg(
    'fill_table',
    '按数据填充已有表格',
    '给已有表格灌数据（保持列宽与格式）',
    { tableId: z.string(), data: z.string().default('项目 | 取值 | 说明\n示例 | — | —') },
    (a) => [
      user(`把这份数据填进表格 ${String(a.tableId)}：\n${String(a.data)}`),
      assistant(
        [
          ENV_NOTE,
          `1. table.getData { id: "${String(a.tableId)}" } 先看当前行列数与表头`,
          `2. table.setData { id: "${String(a.tableId)}", data: "..." }（超出新尺寸的格式会被裁剪）`,
          '3. 只想改个别格子就用 table.setCell { row, col, value }（行号含表头行，从 0 起）',
          '4. 填完 table.getData 复核，必要时 table.autoFit 重算列宽',
        ].join('\n'),
      ),
    ],
  );

  /* 6. 统一排版 */
  reg(
    'format_document',
    '统一文档排版',
    '把字体/字号/行距/标题层级统一一遍',
    { fontFamily: z.string().default('宋体'), fontSize: z.string().default('12'), lineHeight: z.string().default('1.5') },
    (a) => [
      user(`把整份文档排版统一成 ${String(a.fontFamily)} / ${String(a.fontSize)}pt / 行距 ${String(a.lineHeight)}`),
      assistant(
        [
          ENV_NOTE,
          '1. page.setStyle { defaultFont: "' + String(a.fontFamily) + '", defaultFontSize: ' + String(a.fontSize) + ', lineHeight: ' + String(a.lineHeight) + ' } —— 这是全局默认值',
          '2. node.find { type: "heading" } 找出所有标题，再用 property.batchSet 统一字号（node.batchUpdate 也能一次改多个）',
          '3. 逐个体检：node.list 看所有节点类型，对 paragraph 用 property.set 调字号/行距（留空则继承页面默认）',
          '4. 表格另算：table.setCellStyle 改字号与对齐；表宽用 table.setColWidths',
          '5. 收尾 doc.summary + export.json',
        ].join('\n'),
      ),
    ],
  );

  /* 7. 生成插件 */
  reg(
    'register_plugin',
    '从描述生成外部组件',
    '写一个外部热加载组件（插件）：生成 → 校验 → 沙箱试运行 → 落盘 → 重载',
    { description: z.string().default('一个显示设备状态的彩色卡片'), name: z.string().default('statusCard'), category: z.string().default('通用') },
    (a) => [
      user(`写一个外部组件：${String(a.description)}（名字 ${String(a.name)}，分类 ${String(a.category)}）`),
      assistant(
        [
          ENV_NOTE,
          '外部组件（插件）约束 —— 这是最容易踩坑的地方：',
          CONTRACT_TEXT,
          '',
          '请按这个流程做，每步都调用真实 Tool：',
          `1. plugin.types 先读契约（对齐字段）`,
          `2. plugin.template { kind: "basic" } 拿骨架作参考（或直接 plugin.create）`,
          `3. plugin.create { name: "${String(a.name)}", label: "…", category: "${String(a.category)}", kind: "basic" }`,
          `4. plugin.update { name: "${String(a.name)}", source: "<你写的完整源码>" }`,
          '5. plugin.validate { name } —— 必须 ok；有 PLUGIN_* 错误就按提示改',
          '6. plugin.dryRun { name, props: {...} } —— 看返回的 html 是否符合预期，不对就改再试（**这一步是闭环关键**）',
          '7. plugin.deps { name } 复核依赖；plugin.reload 让编辑器生效（不在线它会提示手动点「重载外部组件」）',
        ].join('\n'),
      ),
    ],
  );

  /* 8. 调试插件 */
  reg('debug_plugin', '调试插件报错', '根据报错定位插件问题并给出修改', { name: z.string(), error: z.string().default('（把控制台报错贴这里）') }, (a) => [
    user(`插件 ${String(a.name)} 报错：${String(a.error)}`),
    assistant(
      [
        ENV_NOTE,
        `1. plugin.get { name: "${String(a.name)}" } 看源码与静态校验结果`,
        `2. plugin.validate { name: "${String(a.name)}" } 看具体错误码：`,
        '   · PLUGIN_SYNTAX_ERROR → 语法错（看 message 的行列）',
        '   · PLUGIN_CONTRACT_ERROR → 缺 type/label/category/supportedModes/render，或没调用 register',
        '   · PLUGIN_TYPE_PREFIX → type 没以 live 开头',
        '   · PLUGIN_DEPS → 用了 require/process/fs/fetch/import（沙箱与浏览器里都没有）',
        `3. plugin.dryRun { name: "${String(a.name)}" } 复现；看返回的 logs（插件 console 也会被收集）`,
        '4. 改：plugin.patch（锚点唯一）或 plugin.update；改完再 validate + dryRun',
        '5. 仍不确定就用 plugin.logs 看历史输出；必要时 plugin.export 导出源码给我看',
      ].join('\n'),
    ),
  ]);

  /* 9. 迭代插件 */
  reg('iterate_plugin', '迭代优化插件', '按反馈改插件并验证', { name: z.string(), feedback: z.string().default('样式再紧凑一些') }, (a) => [
    user(`插件 ${String(a.name)} 再改一下：${String(a.feedback)}`),
    assistant(
      [
        ENV_NOTE,
        `1. plugin.get { name: "${String(a.name)}" } 读当前源码`,
        '2. 用 plugin.patch 做最小改动（锚点必须唯一；不唯一就 plugin.update 整份覆盖）',
        '3. plugin.validate → plugin.dryRun（对比改动前后的 html）',
        '4. 满意后 plugin.reload；如果改动了默认属性也顺便更新 propSchema 的 defaultValue',
        '5. 想留档可以 plugin.export 到工作区',
      ].join('\n'),
    ),
  ]);

  /* 10. 全部导出 */
  reg('export_all', '导出全部产物', 'JSON + HTML + React + 说明清单各导一份', { docId: z.string().default('（当前文档）'), outDir: z.string().default('（工作区）') }, (a) => [
    user(`把文档 ${String(a.docId)} 导出成 JSON / HTML / React / 说明清单，放到 ${String(a.outDir)}`),
    assistant(
      [
        ENV_NOTE,
        '1. doc.summary 先确认导的是哪份',
        `2. export.json { docId, path: "${String(a.outDir)}/doc.json" }`,
        `3. export.html { docId, path: "${String(a.outDir)}/doc.html" }（需要编辑器在线：渲染与 @page 由它做）`,
        `4. export.react { docId, path: "${String(a.outDir)}/Doc.tsx", componentName: "Doc" }（需要编辑器在线）`,
        `5. export.spec { path: "${String(a.outDir)}/组件与属性说明清单.md" }（编辑器不在线时用组件目录生成精简版，会标 source: catalog）`,
        '6. 逐个核对返回的 bytes/path；BRIDGE_OFFLINE 说明该能力只有编辑器里实现，不要伪造成功',
      ].join('\n'),
    ),
  ]);

  /* 11. 按清单生成组件 */
  reg(
    'spec_to_component',
    '按说明清单生成组件',
    '读《组件与属性说明清单》并按同一套契约写一个新组件',
    { description: z.string().default('一个三列对比的表格组件'), category: z.string().default('Excel 表格'), modes: z.string().default('document') },
    (a) => [
      user(`按项目现有契约新增一个组件：${String(a.description)}（分类 ${String(a.category)}，支持 ${String(a.modes)}）`),
      assistant(
        [
          ENV_NOTE,
          `1. 先读 editor://spec/components（说明清单）与 editor://spec/contract（契约），或调 component.list / component.schema`,
          `2. 新组件有两种做法：`,
          `   · 内置组件：在 web-editor/src/registry/components/ 下按分类加一个 .tsx，导出 ComponentDefinition（type/label/category/supportedModes/icon/defaultProps/propSchema/render），**不用改任何框架文件**（目录自动发现）`,
          `   · 外部组件（不改代码、热加载）：用 plugin.create + plugin.update 写到 public/组件/，type 必须 live 前缀，渲染用 React.createElement`,
          `3. 属性要能被属性面板渲染：control 只能是已实现的那 19 种；分组用 内容/排版/外观/尺寸/布局/高级/表格/单元格`,
          `4. 写完自检：内置→在编辑器里 ?check=1；外部→plugin.validate + plugin.dryRun`,
          `5. 容器组件记得 isContainer: true，并把 render 的第三参 children 放进自己的 DOM（否则子组件不显示）`,
        ].join('\n'),
      ),
    ],
  );

  log.info(`已注册 ${names.length} 个 Prompt：${names.join(', ')}`);
  return names;
}

function kindHint(kind: string): string {
  switch (kind) {
    case 'cover':
      return '   · 封面用 node.add { type: "slideTitle" }（PPT 封面）或 cover（文档封面）';
    case 'data':
      return '   · 数据页用 chartBar / kpiCards（items: "名称|数值" 每行一条）';
    case 'end':
      return '   · 结束页用 node.add { type: "endSlide" }';
    default:
      return '   · 内容页用 node.add { type: "bullets" }（要点列表）或 process / timeline';
  }
}
