/**
 * MCP Server 实例与能力注册（规格 §三 src/server.ts）。
 *
 * 能力：Tools（103 个）+ Resources（阶段六）+ Prompts（11 个，阶段六）。
 * 启动时把版本、协议版本、能力清单打到 stderr，便于客户端排查（规格 §14）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './config.js';
import { log } from './log.js';
import { registerAllTools } from './tools/index.js';
import { notifyResources, registerAllResources, watchPluginDir } from './resources/index.js';
import { registerAllPrompts } from './prompts/index.js';

export interface BuiltServer {
  server: McpServer;
  tools: string[];
  resources: string[];
  prompts: string[];
  /** 停掉插件目录监听（进程退出时收尾）；**必须 await**，否则监听句柄会把进程吊住 */
  dispose: () => Promise<void>;
}

export function buildServer(): BuiltServer {
  const server = new McpServer(
    { name: config.name, version: config.version },
    {
      capabilities: {
        tools: {},
        // subscribe：客户端可订阅 document/current、selection/current、plugin/list（规格 §六）
        resources: { subscribe: true, listChanged: true },
        prompts: {},
      },
    },
  );

  const tools = registerAllTools(server);
  const resources = registerAllResources(server);
  const prompts = registerAllPrompts(server);

  // 插件目录监听（chokidar 装了才启用）→ 变化时推 resources/updated
  // ★watchPluginDir 是异步的（动态 import chokidar），dispose 必须等它落地再关，
  //   否则「dispose 先跑、watcher 后建」→ 监听句柄没人关，进程（如 --list）退不出去。
  const watchReady: Promise<(() => void) | null> = watchPluginDir(server).catch((e: unknown) => {
    log.warn(`插件目录监听未启用：${String((e as Error)?.message ?? e)}`);
    return null;
  });

  log.info(`能力清单：tools=${tools.length} resources=${resources.length} prompts=${prompts.length}（协议版本 ${config.protocolVersion}）`);
  log.info(`工作区：${config.workspace}`);
  log.info(`插件目录：${config.pluginDir}`);
  log.info(`写开关 ALLOW_WRITE=${config.allowWrite}（false 时写操作返回 WRITE_DISABLED）`);
  log.info(`Live Bridge：${config.bridgeUrl}（未连上时所有操作走无头并标 degraded=true）`);

  return {
    server,
    tools,
    resources,
    prompts,
    dispose: async () => {
      const stop = await watchReady;
      stop?.();
    },
  };
}

export { notifyResources };
