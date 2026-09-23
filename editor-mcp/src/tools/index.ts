/**
 * Tool 汇总注册（规格 §5 / §8）。
 *
 * 每个 Tool 都用 `server.registerTool(name, { title, description, inputSchema }, cb)` 注册：
 *   · inputSchema 用 **zod 原始 shape**（SDK 1.x 的 ZodRawShapeCompat）；
 *   · description 中文、一句话说明 + 关键约束；
 *   · 返回值统一 `{ ok, data?, error?, degraded?, changed? }`，同时给一份 JSON 文本，
 *     方便不支持 structuredContent 的客户端也能读到内容。
 *
 * 已完成：阶段一（doc.create / component.list / plugin.list）+ 阶段三六域
 * （doc.* / mode.* / page.* / canvas.* / node.* / property.*）。
 * 阶段四（表格 / 历史 / 选择 / 导出）与阶段五（插件域全量）继续往下面加。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { log } from '../log.js';
import { ErrorCodes, fail, type ToolResult } from '../errors.js';
import {
  docClose,
  docCloseSchema,
  docCreate,
  docCreateSchema,
  docDelete,
  docDeleteSchema,
  docDuplicate,
  docDuplicateSchema,
  docGet,
  docGetSchema,
  docList,
  docListSchema,
  docOpen,
  docOpenSchema,
  docRename,
  docRenameSchema,
  docSummarySchema,
  docSummaryTool,
} from './document.js';
import {
  canvasGet,
  canvasGetSchema,
  canvasSetBackground,
  canvasSetBackgroundSchema,
  canvasSetDevice,
  canvasSetDeviceSchema,
  canvasSetGrid,
  canvasSetGridSchema,
  canvasSetSafeArea,
  canvasSetSafeAreaSchema,
  canvasSetSize,
  canvasSetSizeSchema,
  modeGet,
  modeGetSchema,
  modeList,
  modeListSchema,
  modeSet,
  modeSetSchema,
  pageAddBreak,
  pageAddBreakSchema,
  pageGet,
  pageGetSchema,
  pageSetMargin,
  pageSetMarginSchema,
  pageSetOrientation,
  pageSetOrientationSchema,
  pageSetSize,
  pageSetSizeSchema,
  pageSetStyle,
  pageSetStyleSchema,
  propertyBatchSet,
  propertyBatchSetSchema,
  propertyGet,
  propertyGetSchema,
  propertyHint,
  propertyHintSchema,
  propertyReset,
  propertyResetSchema,
  propertySet,
  propertySetSchema,
  propertyValidate,
  propertyValidateSchema,
} from './domains.js';
import {
  nodeAdd,
  nodeAddSchema,
  nodeBatchRemove,
  nodeBatchRemoveSchema,
  nodeBatchUpdate,
  nodeBatchUpdateSchema,
  nodeDuplicate,
  nodeDuplicateSchema,
  nodeFind,
  nodeFindSchema,
  nodeGet,
  nodeGetSchema,
  nodeList,
  nodeListSchema,
  nodeMove,
  nodeMoveSchema,
  nodeRemove,
  nodeRemoveSchema,
  nodeReorder,
  nodeReorderSchema,
  nodeSetFrame,
  nodeSetFrameSchema,
  nodeSetLocked,
  nodeSetLockedSchema,
  nodeSetText,
  nodeSetTextSchema,
  nodeSetVisible,
  nodeSetVisibleSchema,
  nodeTree,
  nodeTreeSchema,
  nodeUpdate,
  nodeUpdateSchema,
} from './node.js';
import { componentList, componentListSchema } from './component.js';
import { pluginList, pluginListSchema } from './plugin.js';

/** 把统一返回体转成 MCP 的 content（文本 JSON + isError 标记） */
export function toContent(res: ToolResult<unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }],
    isError: !res.ok,
  };
}

/** 未实现域的统一占位（阶段四~五逐个替换） */
export function notImplemented(tool: string, phase: string): ToolResult<never> {
  return fail(ErrorCodes.NOT_IMPLEMENTED, `${tool} 尚未在本版本实现`, `按规格排在${phase}。`);
}

/** 一行注册：省掉几十个 Tool 的样板（inputSchema 直接给 zod 原始 shape） */
type ZodShape = Record<string, z.ZodTypeAny>;

function reg<S extends ZodShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult<unknown>>,
  out: string[],
): void {
  // ★两处 `as never`：SDK 的 registerTool 是重载 + 泛型推断，从"通用 shape"转发时 TS 无法收敛到
  //   某个具体重载；**运行时仍由 zod shape 做校验**（inputSchema 原样传入），这里只是让编译通过。
  server.registerTool(
    name,
    { title, description, inputSchema: inputSchema as never },
    (async (args: unknown) => toContent(await handler(args as z.infer<z.ZodObject<S>>))) as never,
  );
  out.push(name);
}

export function registerAllTools(server: McpServer): string[] {
  const t: string[] = [];

  /* ── 文档域 §5.1 ── */
  reg(server, 'doc.create', '新建文档', '在工作区新建一份文档（与编辑器导出 JSON 同格式）。未连编辑器时走无头，返回 degraded: true。', docCreateSchema, docCreate, t);
  reg(server, 'doc.open', '打开文档', '打开工作区里已有的文档（按 docId），并记为"当前文档"，后续 Tool 可省略 docId。', docOpenSchema, docOpen, t);
  reg(server, 'doc.close', '关闭文档', 'Live 时关闭编辑器里的文档；无头时清空"当前文档"标记。', docCloseSchema, docClose, t);
  reg(server, 'doc.list', '列出文档', '列出工作区里的文档（按修改时间倒序），含标题/模式/节点数/字数。', docListSchema, docList, t);
  reg(server, 'doc.get', '获取文档', '取文档骨架（标题/模式/页面/画布/节点计数）；includeNodes=true 才返回完整 JSON。', docGetSchema, docGet, t);
  reg(server, 'doc.rename', '重命名文档', '改文档标题（只动 title，不动文件名）。', docRenameSchema, docRename, t);
  reg(server, 'doc.delete', '删除文档', '删除文档文件；破坏性操作，必须 confirm: true，否则返回 CONFIRM_REQUIRED。', docDeleteSchema, docDelete, t);
  reg(server, 'doc.duplicate', '复制文档', '把文档整份复制成新 docId（缺省加 -copy 后缀）。', docDuplicateSchema, docDuplicate, t);
  reg(server, 'doc.summary', '文档摘要', '节点数、字数、估算页数、字节数。', docSummarySchema, docSummaryTool, t);

  /* ── 模式域 §5.2 ── */
  reg(server, 'mode.list', '列出模式', '编辑器支持的模式与含义。', modeListSchema, modeList, t);
  reg(server, 'mode.get', '当前模式', '取文档的当前模式（document / web / ppt）。', modeGetSchema, modeGet, t);
  reg(server, 'mode.set', '切换模式', '切换模式；两套内容都保留（与编辑器语义一致）。', modeSetSchema, modeSet, t);

  /* ── 页面域 §5.3 ── */
  reg(server, 'page.get', '页面配置', '取文档模式的页面配置（纸张/方向/页边距/字体/页眉页脚）。', pageGetSchema, pageGet, t);
  reg(server, 'page.setSize', '设置纸张', '设置纸张尺寸；横向状态下会按方向换算宽高。', pageSetSizeSchema, pageSetSize, t);
  reg(server, 'page.setOrientation', '设置方向', '纵向/横向；切换时自动交换宽高。', pageSetOrientationSchema, pageSetOrientation, t);
  reg(server, 'page.setMargin', '设置页边距', '设置页边距（mm），只传要改的边。', pageSetMarginSchema, pageSetMargin, t);
  reg(server, 'page.setStyle', '页面样式', '默认字体/字号/行距/底色/页眉页脚开关。', pageSetStyleSchema, pageSetStyle, t);
  reg(server, 'page.addBreak', '插入分页符', '在文档流指定位置插入分页符（缺省追加到末尾）。', pageAddBreakSchema, pageAddBreak, t);

  /* ── 画布域 §5.4 ── */
  reg(server, 'canvas.get', '画布配置', '取 Web 模式的画布配置（设备/宽高/底色/网格/安全区）。', canvasGetSchema, canvasGet, t);
  reg(server, 'canvas.setDevice', '设置设备', '按设备预设设置画布宽高（Desktop/Laptop/Tablet/Mobile/Custom）。', canvasSetDeviceSchema, canvasSetDevice, t);
  reg(server, 'canvas.setSize', '设置画布尺寸', '自定义画布宽高（px），设备标记会变成 Custom。', canvasSetSizeSchema, canvasSetSize, t);
  reg(server, 'canvas.setBackground', '画布底色', '设置画布背景色。', canvasSetBackgroundSchema, canvasSetBackground, t);
  reg(server, 'canvas.setGrid', '网格设置', '是否显示网格、网格尺寸、是否吸附。', canvasSetGridSchema, canvasSetGrid, t);
  reg(server, 'canvas.setSafeArea', '安全区', '是否显示安全区。', canvasSetSafeAreaSchema, canvasSetSafeArea, t);

  /* ── 节点域 §5.5 ── */
  reg(server, 'node.add', '添加组件', '添加一个组件节点并返回 id。可指定 parentId 放进容器、index 指定位置、props 给初始属性。', nodeAddSchema, nodeAdd, t);
  reg(server, 'node.get', '获取节点', '取单个节点的完整属性（默认不含子节点，只给 childCount）。', nodeGetSchema, nodeGet, t);
  reg(server, 'node.update', '更新属性', '按 key 合并写入节点属性（部分更新）。', nodeUpdateSchema, nodeUpdate, t);
  reg(server, 'node.remove', '删除节点', '删除一个节点（连同子节点）。', nodeRemoveSchema, nodeRemove, t);
  reg(server, 'node.move', '移动节点', '移动到新父容器/新位置；会拒绝移动到自身子孙里的非法操作。', nodeMoveSchema, nodeMove, t);
  reg(server, 'node.duplicate', '复制节点', '复制节点（含子节点）到它后面。', nodeDuplicateSchema, nodeDuplicate, t);
  reg(server, 'node.list', '列出节点', '扁平列出节点（id/type/parentId/depth），可按类型或文本过滤；只返回精简字段。', nodeListSchema, nodeList, t);
  reg(server, 'node.tree', '节点树', '取树形结构（id/type/children），depth 控制展开层数。', nodeTreeSchema, nodeTree, t);
  reg(server, 'node.find', '查找节点', '按类型 / 属性文本查找节点。', nodeFindSchema, nodeFind, t);
  reg(server, 'node.setText', '设置文本', '改文本类属性（自动挑 text/html/items/caption），也可用 key 指定。', nodeSetTextSchema, nodeSetText, t);
  reg(server, 'node.setFrame', '设置位置尺寸', 'Web 模式的位置尺寸（x/y/w/h/rotation）。', nodeSetFrameSchema, nodeSetFrame, t);
  reg(server, 'node.setVisible', '显示隐藏', '隐藏后画布不渲染该节点。', nodeSetVisibleSchema, nodeSetVisible, t);
  reg(server, 'node.setLocked', '锁定解锁', '锁定是编辑器态（不写进文档），无头模式下无副作用。', nodeSetLockedSchema, nodeSetLocked, t);
  reg(server, 'node.reorder', '层级调整', '在同一级里前移/后移/置顶/置底。', nodeReorderSchema, nodeReorder, t);
  reg(server, 'node.batchUpdate', '批量改属性', '对多个节点写同一组属性。', nodeBatchUpdateSchema, nodeBatchUpdate, t);
  reg(server, 'node.batchRemove', '批量删除', '批量删除节点；必须 confirm: true。', nodeBatchRemoveSchema, nodeBatchRemove, t);

  /* ── 属性域 §5.7 ── */
  reg(server, 'property.get', '读属性', '读单个属性值。', propertyGetSchema, propertyGet, t);
  reg(server, 'property.set', '写属性', '写单个属性值。', propertySetSchema, propertySet, t);
  reg(server, 'property.reset', '重置属性', '重置为默认值（有组件目录时用默认值，否则删除该属性并说明）。', propertyResetSchema, propertyReset, t);
  reg(server, 'property.validate', '校验属性值', '按组件 schema 校验取值（没有目录时返回 valid=null，不假装通过）。', propertyValidateSchema, propertyValidate, t);
  reg(server, 'property.batchSet', '批量写属性', '一次写多个属性。', propertyBatchSetSchema, propertyBatchSet, t);
  reg(server, 'property.hint', '属性说明', '取属性说明（label/控件类型/分组/提示/默认值）。', propertyHintSchema, propertyHint, t);

  /* ── 组件注册表域 §5.6 / 插件域 §5.12（阶段一已建，阶段四/五扩展） ── */
  reg(server, 'component.list', '列出组件', '列出可用组件（内置 + 外部插件）；未连编辑器且无 catalog 时只返回外部组件并说明原因。', componentListSchema, componentList, t);
  reg(server, 'plugin.list', '列出外部插件', '扫描插件目录：是否在热加载清单里、是否调用 EditorKit.register、type 是否 live 前缀、备份数与问题列表。', pluginListSchema, pluginList, t);

  log.info(`已注册 ${t.length} 个 Tool：${t.join(', ')}`);
  log.debug(`未实现域占位示例：${notImplemented('table.getData', '阶段四').error?.code}`);
  return t;
}
