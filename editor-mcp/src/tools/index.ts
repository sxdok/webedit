/**
 * Tool 汇总注册（规格 §5 / §8）。
 *
 * 每个 Tool 都用 `server.registerTool(name, { title, description, inputSchema }, cb)` 注册：
 *   · inputSchema 用 **zod 原始 shape**（SDK 1.x 的 ZodRawShapeCompat）；
 *   · description 中文、一句话说明 + 关键约束；
 *   · 返回值统一 `{ ok, data?, error?, degraded?, changed? }`，同时给一份 JSON 文本，
 *     方便不支持 structuredContent 的客户端也能读到内容。
 *
 * 阶段一注册 3 个：doc.create / component.list / plugin.list。
 * 后续阶段的域（mode / page / canvas / node / property / table / history / selection / export）
 * 在各自文件里实现后，往下面的 `registerAllTools` 里加一行即可。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { log } from '../log.js';
import { ErrorCodes, fail, type ToolResult } from '../errors.js';
import { docCreate, docCreateSchema } from './document.js';
import { componentList, componentListSchema } from './component.js';
import { pluginList, pluginListSchema } from './plugin.js';

/** 把统一返回体转成 MCP 的 content（文本 JSON + isError 标记） */
export function toContent(res: ToolResult<unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }],
    isError: !res.ok,
  };
}

/** 未实现域的统一占位（阶段三~五逐个替换） */
function notImplemented(tool: string): ToolResult<never> {
  return fail(
    ErrorCodes.NOT_IMPLEMENTED,
    `${tool} 尚未在本版本实现`,
    '阶段一只有 doc.create / component.list / plugin.list；其余域按规格阶段三~五补齐。',
  );
}

export function registerAllTools(server: McpServer): string[] {
  const registered: string[] = [];

  server.registerTool(
    'doc.create',
    {
      title: '新建文档',
      description:
        '在当前工作区新建一份文档（与编辑器「导出 JSON」同格式，编辑器可直接打开）。返回新文档的 docId 与磁盘路径。' +
        '未连接编辑器时走无头模式，返回值带 degraded: true。',
      inputSchema: docCreateSchema,
    },
    async (args) => toContent(await docCreate(args)),
  );
  registered.push('doc.create');

  server.registerTool(
    'component.list',
    {
      title: '列出组件',
      description:
        '列出可用组件（内置注册表 + 外部插件）。内置清单的真源是编辑器（开桥接后由它提供）；' +
        '未开桥接且工作区没有 component-catalog.json 时只返回外部组件，并在 note 里说明，不编造内置清单。',
      inputSchema: componentListSchema,
    },
    async (args) => toContent(await componentList(args)),
  );
  registered.push('component.list');

  server.registerTool(
    'plugin.list',
    {
      title: '列出外部插件',
      description:
        '扫描插件目录（默认 web-editor/public/组件），逐个给出：是否在热加载清单里、是否调用 EditorKit.register、' +
        'type 是否 live 前缀、备份个数与 status（ok / invalid）及 problems 列表。',
      inputSchema: pluginListSchema,
    },
    async (args) => toContent(await pluginList(args)),
  );
  registered.push('plugin.list');

  log.info(`已注册 ${registered.length} 个 Tool：${registered.join(', ')}`);
  log.debug(`未实现域占位可用：${notImplemented('mode.get').error?.code}`);
  return registered;
}
