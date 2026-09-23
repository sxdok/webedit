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
import { ErrorCodes, fail, isWriteTool, type ToolResult } from '../errors.js';
import {
  docClose,
  docCloseSchema,
  docAttach,
  docAttachSchema,
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
import { notifyResources } from '../resources/index.js';
import { componentList, componentListSchema } from './component.js';
import { assetEmbed, assetEmbedFromHtml, assetEmbedFromHtmlSchema, assetEmbedSchema } from './asset.js';
import {
  pluginCreate,
  pluginCreateSchema,
  pluginDelete,
  pluginDeleteSchema,
  pluginDeps,
  pluginDepsSchema,
  pluginDryRun,
  pluginDryRunSchema,
  pluginExport,
  pluginExportSchema,
  pluginGet,
  pluginGetSchema,
  pluginImport,
  pluginImportSchema,
  pluginList,
  pluginListSchema,
  pluginLogsSchema,
  pluginLogsTool,
  pluginManifestAdd,
  pluginManifestAddSchema,
  pluginManifestGet,
  pluginManifestGetSchema,
  pluginManifestRemove,
  pluginManifestRemoveSchema,
  pluginManifestSet,
  pluginManifestSetSchema,
  pluginPatch,
  pluginPatchSchema,
  pluginReload,
  pluginReloadSchema,
  pluginRename,
  pluginRenameSchema,
  pluginTemplate,
  pluginTemplateSchema,
  pluginTypes,
  pluginTypesSchema,
  pluginUpdate,
  pluginUpdateSchema,
  pluginValidate,
  pluginValidateSchema,
} from './plugin.js';
import {
  componentCategories,
  componentCategoriesSchema,
  componentDefaultsSchema,
  componentDefaultsTool,
  componentGet,
  componentGetSchema,
  componentSchema,
  componentSchemaSchema,
  componentSearch,
  componentSearchSchema,
  componentCatalog,
  componentCatalogSchema,
  exportHtml,
  exportHtmlSchema,
  exportJson,
  exportJsonSchema,
  exportPdf,
  exportPdfSchema,
  exportReact,
  exportReactSchema,
  exportSpec,
  exportSpecSchema,
  historyClear,
  historyClearSchema,
  historyRedo,
  historyRedoSchema,
  historyRestore,
  historyRestoreSchema,
  historySnapshot,
  historySnapshotSchema,
  historyStack,
  historyStackSchema,
  historyUndo,
  historyUndoSchema,
  selectionClear,
  selectionClearSchema,
  selectionFocus,
  selectionFocusSchema,
  selectionGet,
  selectionGetSchema,
  selectionSet,
  selectionSetSchema,
} from './registry.js';
import {
  tableAutoFit,
  tableAutoFitSchema,
  tableClearCellStyle,
  tableClearCellStyleSchema,
  tableDeleteCol,
  tableDeleteColSchema,
  tableDeleteRow,
  tableDeleteRowSchema,
  tableGetCellSelection,
  tableGetCellSelectionSchema,
  tableGetData,
  tableGetDataSchema,
  tableInsertCol,
  tableInsertColSchema,
  tableInsertRow,
  tableInsertRowSchema,
  tableMergeCells,
  tableMergeCellsSchema,
  tableSetCell,
  tableSetCellSchema,
  tableSetCellSelection,
  tableSetCellSelectionSchema,
  tableSetCellStyle,
  tableSetCellStyleSchema,
  tableSetColWidths,
  tableSetColWidthsSchema,
  tableSetData,
  tableSetDataSchema,
  tableSetVariant,
  tableSetVariantSchema,
  tableSplitCells,
  tableSplitCellsSchema,
} from './table.js';

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

/** 写操作之后要推哪些资源更新（规格 §六 的 3 个可订阅 URI） */
function changedResources(tool: string): string[] {
  if (tool.startsWith('plugin.')) return ['editor://plugin/list'];
  const uris = ['editor://document/current'];
  if (tool.startsWith('selection.') || tool.startsWith('table.setCellSelection')) uris.push('editor://selection/current');
  return uris;
}

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
    (async (args: unknown) => {
      const res = await handler(args as z.infer<z.ZodObject<S>>);
      // ★写成功后推送资源更新（客户端订阅了才推）——订阅功能必须接在真实写路径上，否则永远不会触发
      if (res.ok && isWriteTool(name)) void notifyResources(server, changedResources(name));
      return toContent(res);
    }) as never,
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
  reg(
    server,
    'doc.attach',
    '接上编辑器当前文档',
    '把 MCP 会话的"当前文档"切到**编辑器里正在编辑的那一份**（之后省略 docId 的调用就作用在它上面）。只读动作，不改编辑器内容；编辑器未接入时如实报 BRIDGE_OFFLINE。',
    docAttachSchema,
    docAttach,
    t,
  );

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

  /* ── 资产域（2026-09-23 新增，2 个）：把本地图片嵌进节点，base64 不经过模型上下文 ── */
  reg(
    server,
    'asset.embed',
    '嵌入本地图片',
    '把本地图片文件读成 data URL 写进节点属性（默认 src）。★服务端完成 base64，回包只说"多大/什么格式"，**不回传图片内容** —— 所以不必为了省 token 把 src 留成占位符。',
    assetEmbedSchema,
    assetEmbed,
    t,
  );
  reg(
    server,
    'asset.embedFromHtml',
    '嵌入 HTML 里的内嵌图',
    '从本地 HTML 里取出内嵌（data:）图片写进节点；不给 index+nodeId 时只列出清单（序号/mime/字节/alt/图注）供挑选。',
    assetEmbedFromHtmlSchema,
    assetEmbedFromHtml,
    t,
  );

  /* ── 组件注册表域 §5.6 ── */
  reg(server, 'component.list', '列出组件', '列出可用组件（内置 + 外部插件）；未连编辑器且无 catalog 时只返回外部组件并说明原因。', componentListSchema, componentList, t);
  reg(server, 'component.get', '取组件定义', '取某组件的元数据（label/分类/模式/说明）+ 默认属性 + schema 项数。', componentGetSchema, componentGet, t);
  reg(server, 'component.schema', '取属性 schema', '取某组件的完整属性 schema（key/label/控件/分组/默认值/范围）。', componentSchemaSchema, componentSchema, t);
  reg(server, 'component.categories', '列出分类', '按分类列出组件数量，可按模式过滤。', componentCategoriesSchema, componentCategories, t);
  reg(server, 'component.defaults', '取默认属性', '取某组件的默认 props。', componentDefaultsSchema, componentDefaultsTool, t);
  reg(server, 'component.search', '搜索组件', '按 type/label/分类/说明模糊搜索。', componentSearchSchema, componentSearch, t);
  reg(
    server,
    'component.catalog',
    '导出组件目录',
    '把编辑器注册表的完整快照（组件 + 默认属性 + 属性 schema）取回并落成 component-catalog.json；之后编辑器不在线也能用 component.*。',
    componentCatalogSchema,
    componentCatalog,
    t,
  );

  /* ── 表格域 §5.8（15 个）── */
  reg(server, 'table.getData', '读表格数据', '返回二维数组（或 asText 的 "a | b" 文本）+ 行列数 + 表头 + 已格式化格数 + 列宽 + 线条风格。', tableGetDataSchema, tableGetData, t);
  reg(server, 'table.setData', '写表格数据', '整表替换（数组或文本；`\\|` 格内竖线、`\\n` 格内换行），超出新尺寸的格式会被裁剪。', tableSetDataSchema, tableSetData, t);
  reg(server, 'table.setCell', '写单元格', '按行列号写单个格子（行号含表头行）。', tableSetCellSchema, tableSetCell, t);
  reg(server, 'table.insertRow', '插入行', '在 at 处插入若干空行，并同步平移单元格格式。', tableInsertRowSchema, tableInsertRow, t);
  reg(server, 'table.deleteRow', '删除行', '删除 at 起的若干行（至少留一行），同步平移格式。', tableDeleteRowSchema, tableDeleteRow, t);
  reg(server, 'table.insertCol', '插入列', '插入若干空列，并同步平移格式与列宽（合计仍为 100%）。', tableInsertColSchema, tableInsertCol, t);
  reg(server, 'table.deleteCol', '删除列', '删除若干列，同步平移格式与列宽。', tableDeleteColSchema, tableDeleteCol, t);
  reg(server, 'table.mergeCells', '合并单元格', '把 A1 范围合并（写范围键，被覆盖的格子不渲染）。', tableMergeCellsSchema, tableMergeCells, t);
  reg(server, 'table.splitCells', '拆分单元格', '去掉范围内的合并与格式键。', tableSplitCellsSchema, tableSplitCells, t);
  reg(server, 'table.setCellStyle', '设置单元格格式', '按 A1 范围写格式（底色/字色/字号/加粗/对齐/垂直/内边距/边框）。', tableSetCellStyleSchema, tableSetCellStyle, t);
  reg(server, 'table.clearCellStyle', '清除单元格格式', '清掉范围内的格式（合并区一并去掉）。', tableClearCellStyleSchema, tableClearCellStyle, t);
  reg(server, 'table.setVariant', '设置线条风格', 'normal 全框线 / threeLine 三线表 / hLines 横线表。', tableSetVariantSchema, tableSetVariant, t);
  reg(server, 'table.setColWidths', '设置列宽', '逗号分隔，纯数字按 %（"20,50,30"），也可写 "35mm"；空串=自动。', tableSetColWidthsSchema, tableSetColWidths, t);
  reg(server, 'table.autoFit', '列宽自适应', '按内容自适应列宽（无头按内容长度估算；编辑器在线时按真实渲染宽度）。', tableAutoFitSchema, tableAutoFit, t);
  reg(server, 'table.getCellSelection', '读单元格选区', '当前选中的单元格区域。', tableGetCellSelectionSchema, tableGetCellSelection, t);
  reg(server, 'table.setCellSelection', '设置单元格选区', '设置当前单元格选区（A1 范围）。', tableSetCellSelectionSchema, tableSetCellSelection, t);

  /* ── 历史域 §5.9 ── */
  reg(server, 'history.undo', '撤销', '撤销若干步（无头用快照栈；编辑器在线时走它的历史栈）。', historyUndoSchema, historyUndo, t);
  reg(server, 'history.redo', '重做', '重做若干步。', historyRedoSchema, historyRedo, t);
  reg(server, 'history.snapshot', '打快照', '手动压一个快照（可带标签）。', historySnapshotSchema, historySnapshot, t);
  reg(server, 'history.restore', '恢复快照', '回到指定序号的快照。', historyRestoreSchema, historyRestore, t);
  reg(server, 'history.clear', '清空历史', '清空快照栈；必须 confirm: true。', historyClearSchema, historyClear, t);
  reg(server, 'history.stack', '历史信息', '快照数量与当前位置。', historyStackSchema, historyStack, t);

  /* ── 选择域 §5.10 ── */
  reg(server, 'selection.get', '读选中', '当前选中的节点 id。', selectionGetSchema, selectionGet, t);
  reg(server, 'selection.set', '设置选中', '设置选中的节点（无头只记录在服务端）。', selectionSetSchema, selectionSet, t);
  reg(server, 'selection.clear', '清除选中', '清空选中。', selectionClearSchema, selectionClear, t);
  reg(server, 'selection.focus', '滚动到视图', '把某个节点滚动到可视区（需要编辑器在线）。', selectionFocusSchema, selectionFocus, t);

  /* ── 导出域 §5.11 ── */
  reg(server, 'export.json', '导出 JSON', '取/写文档 JSON（与编辑器导出同格式）；给 path 就写到工作区。', exportJsonSchema, exportJson, t);
  reg(server, 'export.html', '导出 HTML', '导出可独立打开的 HTML（需要编辑器在线：渲染与 @page 都由它做）。', exportHtmlSchema, exportHtml, t);
  reg(server, 'export.react', '导出 React', '导出 React + Tailwind 代码（需要编辑器在线）。', exportReactSchema, exportReact, t);
  reg(server, 'export.pdf', '导出 PDF', '调用编辑器打印导出 PDF（需要编辑器在线）。', exportPdfSchema, exportPdf, t);
  reg(server, 'export.spec', '导出说明清单', '导出《组件与属性说明清单》Markdown；编辑器在线时与它的菜单导出一致，否则用组件目录生成精简版并标注差异。', exportSpecSchema, exportSpec, t);

  /* ── 插件域 §5.12（20 个，重点域）── */
  reg(server, 'plugin.list', '列出外部插件', '扫描插件目录：是否在热加载清单里、是否调用 EditorKit.register、type 是否 live 前缀、备份数与问题列表。', pluginListSchema, pluginList, t);
  reg(server, 'plugin.get', '读取插件', '读单个插件（默认连源码一起返回），并顺带做一次静态校验。', pluginGetSchema, pluginGet, t);
  reg(server, 'plugin.create', '新建插件', '生成插件骨架写入插件目录并加入热加载清单；type 自动加 live 前缀，已存在需 overwrite: true（会先备份）。', pluginCreateSchema, pluginCreate, t);
  reg(server, 'plugin.update', '覆盖插件', '用新源码覆盖插件文件，**覆盖前自动备份**（保留最近 N 个，默认 5）。', pluginUpdateSchema, pluginUpdate, t);
  reg(server, 'plugin.patch', '局部替换', '按 find/replace 改一处（find 必须唯一），改完自动备份并重新校验。', pluginPatchSchema, pluginPatch, t);
  reg(server, 'plugin.delete', '删除插件', '删除插件文件并同步清单；必须 confirm: true，默认留一份备份。', pluginDeleteSchema, pluginDelete, t);
  reg(server, 'plugin.rename', '重命名插件', '改文件名并同步清单；必须 confirm: true。', pluginRenameSchema, pluginRename, t);
  reg(server, 'plugin.validate', '静态校验', '语法（V8 解析）+ 契约（register/type/label/category/supportedModes/render）+ live 前缀 + 禁用依赖。', pluginValidateSchema, pluginValidate, t);
  reg(server, 'plugin.dryRun', '沙箱试运行', '⚠ 关键能力：`node:vm` 沙箱里执行插件（mock window.EditorKit、3 秒超时、无 require/process/fs），用给定 props 渲染出**静态 HTML**，不开编辑器就能看效果。', pluginDryRunSchema, pluginDryRun, t);
  reg(server, 'plugin.manifest.get', '读热加载清单', '读 `_manifest.json`（编辑器热加载的退化清单）。', pluginManifestGetSchema, pluginManifestGet, t);
  reg(server, 'plugin.manifest.set', '写热加载清单', '整表覆盖清单，并报告"清单里有但文件不存在"的条目。', pluginManifestSetSchema, pluginManifestSet, t);
  reg(server, 'plugin.manifest.add', '清单加一条', '把某个已存在的插件加入清单。', pluginManifestAddSchema, pluginManifestAdd, t);
  reg(server, 'plugin.manifest.remove', '清单删一条', '从清单里移除某个插件（不删文件）。', pluginManifestRemoveSchema, pluginManifestRemove, t);
  reg(server, 'plugin.template', '取插件模板', '返回 basic / form / chart / container 四种骨架源码。', pluginTemplateSchema, pluginTemplate, t);
  reg(server, 'plugin.types', '取契约声明', '返回 ComponentDefinition / PropSchemaItem / RenderContext 的 TypeScript 声明与外部组件约束，供生成插件时对齐。', pluginTypesSchema, pluginTypes, t);
  reg(server, 'plugin.logs', '插件日志', 'MCP 侧执行插件时的 console 输出（环形缓冲 500 条）。', pluginLogsSchema, pluginLogsTool, t);
  reg(server, 'plugin.deps', '依赖分析', '列出插件用到的 EditorKit 助手/React hooks/禁用依赖，并给出结论。', pluginDepsSchema, pluginDeps, t);
  reg(server, 'plugin.import', '导入插件', '从 URL 或本地文件导入（先校验契约，合格才写入并进清单）。', pluginImportSchema, pluginImport, t);
  reg(server, 'plugin.export', '导出插件', '导出插件源码（返回内容或写到工作区）。', pluginExportSchema, pluginExport, t);
  reg(server, 'plugin.reload', '重载插件', '编辑器在线时触发它的热加载；不在线则说明"需手动点重载"。', pluginReloadSchema, pluginReload, t);

  log.info(`已注册 ${t.length} 个 Tool：${t.join(', ')}`);
  log.debug(`未实现域占位示例：${notImplemented('table.getData', '阶段四').error?.code}`);
  return t;
}
