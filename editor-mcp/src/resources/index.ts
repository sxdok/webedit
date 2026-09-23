/**
 * Resources（规格 §六）：用 `editor://` 自定义 scheme 暴露"可读的现场"。
 *
 * 分两类：
 *   · 静态资源：`registerResource(name, uri, metadata, cb)`
 *   · 带变量的资源：`registerResourceTemplate(name, new ResourceTemplate(uri, {list}), metadata, cb)`
 *
 * 订阅（§六 Subscriptions）：声明 `capabilities.resources.subscribe`，自己实现
 * `resources/subscribe` / `resources/unsubscribe`（SDK 的 McpServer 没带这两个 handler），
 * 并在**写操作之后**与**插件目录变化时**推送 `notifications/resources/updated`。
 * 订阅的 3 个 URI 按规格：document/current、selection/current、plugin/list。
 *
 * 内容来源与 Tool 一致：优先 Live Bridge（编辑器实例），否则无头读盘并在返回值里标注 via/degraded。
 */
import fs from 'node:fs';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config.js';
import { EditorMcpError } from '../errors.js';
import { log } from '../log.js';
import { bridgeSummary } from '../bridge/fallback.js';
import { readDocument } from '../bridge/headless.js';
import { flatten, getCurrentDoc } from '../engine/session.js';
import { componentGet, componentSchema, exportSpec, historyStack, selectionGet } from '../tools/registry.js';
import { componentList } from '../tools/component.js';
import { manifestPath, pluginGet, pluginList, pluginTypes } from '../tools/plugin.js';

/** 订阅集合（URI → 是否已订阅）；推送时遍历它 */
const subscribed = new Set<string>();

/** 规格要求的三个可订阅 URI */
export const SUBSCRIBABLE = ['editor://document/current', 'editor://selection/current', 'editor://plugin/list'] as const;

type ReadResult = { contents: { uri: string; mimeType: string; text: string }[] };

const json = (uri: string, data: unknown): ReadResult => ({
  contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
});
const md = (uri: string, text: string): ReadResult => ({ contents: [{ uri, mimeType: 'text/markdown', text }] });
const js = (uri: string, text: string): ReadResult => ({ contents: [{ uri, mimeType: 'text/javascript', text }] });

/** 把 ToolResult 变成"资源内容"：失败时把 error 也如实写进正文（资源没有 isError 语义） */
const fromTool = (uri: string, r: { ok: boolean; data?: unknown; error?: unknown; degraded?: boolean }): ReadResult =>
  json(uri, r.ok ? { ...(r.data as object), degraded: r.degraded } : { error: r.error, degraded: true });

/**
 * 读资源时的兜底：**任何异常都变成正文里的 error**，而不是 JSON-RPC 协议错误。
 * 理由：客户端拿到的是一份"可读的现场"，读不到就说清为什么（文档不存在 / 目录缺失…），
 * 比一个裸的 -32603 更有用；也避免一个坏资源把整次会话搞崩。
 */
async function safe(uri: string, fn: () => Promise<ReadResult>): Promise<ReadResult> {
  try {
    return await fn();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // 错误码优先取 EditorMcpError.code（它**不在** message 里）；退而求其次认 `CODE: message` 形式
    const code = e instanceof EditorMcpError ? e.code : /^[A-Z][A-Z_]{2,}:/.test(msg) ? msg.split(':')[0] : 'IO_ERROR';
    log.debug(`资源读取失败 ${uri}：${msg}`);
    return json(uri, { error: { code, message: msg }, degraded: true });
  }
}

export function registerAllResources(server: McpServer): string[] {
  const uris: string[] = [];

  /* ── 文档 ── */
  const docIdOf = (v?: string): string | null => v ?? getCurrentDoc();
  const readDocJson = async (uri: string, id?: string): Promise<ReadResult> => {
    const docId = docIdOf(id);
    if (!docId) return json(uri, { error: { code: 'DOC_NOT_FOUND', message: '当前没有打开的文档' } });
    const doc = await readDocument(docId);
    return json(uri, doc);
  };

  server.registerResource(
    '当前文档',
    'editor://document/current',
    { title: '当前文档', description: '当前打开的文档完整 JSON（与编辑器导出同格式）', mimeType: 'application/json' },
    async (uri) => safe(uri.href, () => readDocJson(uri.href)),
  );
  uris.push('editor://document/current');

  server.registerResource(
    '文档内容',
    new ResourceTemplate('editor://document/{docId}', {
      list: async () => {
        const fsMod = await import('node:fs/promises');
        const dir = config.workspace;
        const files = fs.existsSync(dir) ? (await fsMod.readdir(dir)).filter((f) => f.endsWith('.editor.json')) : [];
        return { resources: files.map((f) => ({ uri: `editor://document/${f.replace(/\.editor\.json$/, '')}`, name: f })) };
      },
    }),
    { title: '指定文档', description: '按 docId 读文档完整 JSON', mimeType: 'application/json' },
    async (uri, vars) => safe(uri.href, () => readDocJson(uri.href, String(vars.docId))),
  );
  uris.push('editor://document/{docId}');

  server.registerResource(
    '文档树',
    new ResourceTemplate('editor://document/{docId}/tree', { list: undefined }),
    { title: '文档节点树', description: '精简节点树（id/type/children），不含属性', mimeType: 'application/json' },
    async (uri, vars) =>
      safe(uri.href, async () => {
        const doc = await readDocument(String(vars.docId));
        return json(uri.href, { docId: vars.docId, tree: flatten(doc).map((n) => ({ id: n.id, type: n.type, parentId: n.parentId, depth: n.depth })) });
      }),
  );
  uris.push('editor://document/{docId}/tree');

  server.registerResource(
    '文档摘要',
    new ResourceTemplate('editor://document/{docId}/summary', { list: undefined }),
    { title: '文档摘要', description: '节点数 / 字数 / 估算页数 / 字节数', mimeType: 'application/json' },
    async (uri, vars) =>
      safe(uri.href, async () => {
      const doc = await readDocument(String(vars.docId));
      const nodes = flatten(doc).length;
      const count = (list: { props?: Record<string, unknown>; children?: unknown[] }[]): number =>
        list.reduce((n, c) => {
          let x = 0;
          for (const [k, v] of Object.entries(c.props ?? {})) if (typeof v === 'string' && /text|html|items|data|caption|title|label/.test(k)) x += v.replace(/<[^>]+>/g, '').length;
          return n + x + count(((c.children ?? []) as typeof list));
        }, 0);
      const words = count(doc.document?.components ?? []) + count((doc.web?.root?.children ?? []) as never);
      return json(uri.href, { docId: vars.docId, title: doc.title, mode: doc.mode, nodes, words, pages: Math.max(1, Math.ceil(words / 900)) });
      }),
  );
  uris.push('editor://document/{docId}/summary');

  /* ── 页面 / 画布 ── */
  server.registerResource(
    '页面配置',
    'editor://page/config',
    { title: '页面配置', description: '纸张/方向/页边距/默认字体/页眉页脚', mimeType: 'application/json' },
    async (uri) =>
      safe(uri.href, async () => {
        const id = docIdOf();
        if (!id) return json(uri.href, { error: { code: 'DOC_NOT_FOUND', message: '当前没有打开的文档' } });
        return json(uri.href, (await readDocument(id)).document.page);
      }),
  );
  uris.push('editor://page/config');

  server.registerResource(
    '画布配置',
    'editor://canvas/config',
    { title: '画布配置', description: 'Web 模式设备/宽高/底色/网格/安全区', mimeType: 'application/json' },
    async (uri) =>
      safe(uri.href, async () => {
        const id = docIdOf();
        if (!id) return json(uri.href, { error: { code: 'DOC_NOT_FOUND', message: '当前没有打开的文档' } });
        return json(uri.href, (await readDocument(id)).web.canvas);
      }),
  );
  uris.push('editor://canvas/config');

  /* ── 组件注册表 ── */
  server.registerResource(
    '组件目录',
    'editor://component/catalog',
    { title: '组件目录', description: '全部组件元数据（不含 render）；缺目录时如实说明', mimeType: 'application/json' },
    async (uri) => fromTool(uri.href, await componentList({})),
  );
  uris.push('editor://component/catalog');

  server.registerResource(
    '组件定义',
    new ResourceTemplate('editor://component/{type}', { list: undefined }),
    { title: '组件定义', description: '单个组件的元数据 + 默认属性 + schema 项数', mimeType: 'application/json' },
    async (uri, vars) => fromTool(uri.href, await componentGet({ type: String(vars.type) })),
  );
  uris.push('editor://component/{type}');

  server.registerResource(
    '组件属性 schema',
    new ResourceTemplate('editor://component/{type}/schema', { list: undefined }),
    { title: '组件属性 schema', description: '单个组件的完整属性 schema', mimeType: 'application/json' },
    async (uri, vars) => fromTool(uri.href, await componentSchema({ type: String(vars.type) })),
  );
  uris.push('editor://component/{type}/schema');

  /* ── 规格 / 契约（Markdown）── */
  server.registerResource(
    '组件与属性说明清单',
    'editor://spec/components',
    { title: '组件与属性说明清单', description: '编辑器「帮助 → 导出说明清单」的全文；无编辑器时用组件目录生成精简版', mimeType: 'text/markdown' },
    async (uri) => {
      const r = await exportSpec({});
      if (r.ok) {
        const d = r.data as { markdown?: string; path?: string; source?: string };
        if (d.markdown) return md(uri.href, d.markdown);
        if (d.path && fs.existsSync(d.path)) return md(uri.href, await (await import('node:fs/promises')).readFile(d.path, 'utf8'));
      }
      return md(uri.href, `# 组件与属性说明清单\n\n暂时拿不到：${JSON.stringify(r.error ?? {})}`);
    },
  );
  uris.push('editor://spec/components');

  server.registerResource(
    '外部组件契约',
    'editor://spec/contract',
    { title: '外部组件契约', description: 'ComponentDefinition / PropSchemaItem / RenderContext 的 TypeScript 声明', mimeType: 'text/markdown' },
    async (uri) => {
      const r = await pluginTypes();
      const d = (r.data ?? {}) as { contract?: string; notes?: string[] };
      return md(uri.href, `# 外部组件契约\n\n\`\`\`ts\n${d.contract ?? ''}\n\`\`\`\n\n## 注意事项\n${(d.notes ?? []).map((n) => `- ${n}`).join('\n')}\n`);
    },
  );
  uris.push('editor://spec/contract');

  /* ── 插件 ── */
  server.registerResource(
    '插件清单',
    'editor://plugin/list',
    { title: '插件清单', description: '外部插件列表（含 ok/invalid 状态与问题）', mimeType: 'application/json' },
    async (uri) => fromTool(uri.href, await pluginList({})),
  );
  uris.push('editor://plugin/list');

  server.registerResource(
    '插件源码',
    new ResourceTemplate('editor://plugin/{name}/source', { list: undefined }),
    { title: '插件源码', description: '单个插件的源码', mimeType: 'text/javascript' },
    async (uri, vars) => {
      const r = await pluginGet({ name: String(vars.name) });
      const d = (r.data ?? {}) as { source?: string };
      return r.ok && d.source ? js(uri.href, d.source) : json(uri.href, r.error ?? { message: '读不到源码' });
    },
  );
  uris.push('editor://plugin/{name}/source');

  server.registerResource(
    '插件元数据',
    new ResourceTemplate('editor://plugin/{name}/meta', { list: undefined }),
    { title: '插件元数据', description: '插件的 type/label/category/modes/校验结果（不含源码）', mimeType: 'application/json' },
    async (uri, vars) => fromTool(uri.href, await pluginGet({ name: String(vars.name), withSource: false })),
  );
  uris.push('editor://plugin/{name}/meta');

  server.registerResource(
    '插件清单文件',
    'editor://plugin/manifest',
    { title: '热加载清单', description: '`_manifest.json` 的内容与是否存在', mimeType: 'application/json' },
    async (uri) => json(uri.href, await manifestSnapshot()),
  );
  uris.push('editor://plugin/manifest');

  for (const kind of ['basic', 'form', 'chart', 'container'] as const) {
    server.registerResource(
      `插件模板 ${kind}`,
      `editor://plugin/template/${kind}`,
      { title: `插件模板 ${kind}`, description: `外部组件骨架（${kind}）`, mimeType: 'text/javascript' },
      async (uri) => {
        const r = await import('../tools/plugin.js').then((m) => m.pluginTemplate({ kind, name: 'myWidget', label: '我的组件', category: '通用' }));
        const d = (r.data ?? {}) as { source?: string };
        return js(uri.href, d.source ?? '// 模板生成失败');
      },
    );
    uris.push(`editor://plugin/template/${kind}`);
  }

  /* ── 现场状态 ── */
  server.registerResource(
    '当前选中',
    'editor://selection/current',
    { title: '当前选中', description: '选中的节点 id（编辑器在线时为它的实时选中）', mimeType: 'application/json' },
    async (uri) => fromTool(uri.href, await selectionGet({})),
  );
  uris.push('editor://selection/current');

  server.registerResource(
    '历史信息',
    'editor://history/stack',
    { title: '历史', description: '快照数量与当前位置（只读）', mimeType: 'application/json' },
    async (uri) =>
      safe(uri.href, async () => {
        const id = docIdOf();
        if (!id) return json(uri.href, { error: { code: 'DOC_NOT_FOUND', message: '当前没有打开的文档' } });
        return fromTool(uri.href, await historyStack({ docId: id }));
      }),
  );
  uris.push('editor://history/stack');

  server.registerResource(
    '桥接状态',
    'editor://bridge/status',
    { title: '桥接状态', description: 'Live Bridge 连接状态与降级说明', mimeType: 'application/json' },
    async (uri) => json(uri.href, bridgeSummary()),
  );
  uris.push('editor://bridge/status');

  /* ── 订阅：SDK 的 McpServer 没带 subscribe handler，这里自己注册 ── */
  server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    subscribed.add(req.params.uri);
    log.info(`客户端订阅资源：${req.params.uri}（当前 ${subscribed.size} 个）`);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    subscribed.delete(req.params.uri);
    return {};
  });

  log.info(`已注册 ${uris.length} 个 Resource（其中可订阅：${SUBSCRIBABLE.join(', ')}）`);
  return uris;
}

/** 推送资源更新通知（写操作之后 / 插件目录变化时调用） */
export async function notifyResources(server: McpServer, uris: readonly string[] = SUBSCRIBABLE): Promise<void> {
  if (!server.isConnected()) return;
  for (const uri of uris) {
    if (!subscribed.has(uri)) continue;
    try {
      await server.server.sendResourceUpdated({ uri });
      log.debug(`已推送资源更新：${uri}`);
    } catch (e) {
      log.debug(`推送资源更新失败（${uri}）：${String((e as Error)?.message ?? e)}`);
    }
  }
}

/** 插件目录监听（规格 §六：editor://plugin/list 支持订阅）——chokidar 可选，装了就启用 */
export async function watchPluginDir(server: McpServer): Promise<(() => void) | null> {
  try {
    const mod = (await import('chokidar')) as unknown as { watch: (p: string, o?: unknown) => { on: (e: string, cb: () => void) => void; close: () => Promise<void> } };
    const watcher = mod.watch(config.pluginDir, { ignoreInitial: true, depth: 1 });
    const onChange = () => {
      void notifyResources(server, ['editor://plugin/list', 'editor://document/current']);
    };
    watcher.on('add', onChange);
    watcher.on('change', onChange);
    watcher.on('unlink', onChange);
    log.info(`已监听插件目录变化：${config.pluginDir}`);
    return () => void watcher.close();
  } catch {
    log.info('未安装 chokidar → 跳过插件目录监听（其余功能不受影响）');
    return null;
  }
}

/** 插件清单文件的读取（给 editor://plugin/manifest 用；readManifest 是插件模块内部的） */
export async function manifestSnapshot(): Promise<{ file: string; exists: boolean; files: string[]; dir: string }> {
  const file = manifestPath();
  const exists = fs.existsSync(file);
  let files: string[] = [];
  if (exists) {
    try {
      const parsed = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8')) as unknown;
      files = Array.isArray(parsed) ? parsed.map(String) : ((parsed as { files?: string[] })?.files ?? []);
    } catch {
      files = [];
    }
  }
  return { file, exists, files, dir: config.pluginDir };
}
