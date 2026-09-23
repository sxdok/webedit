/**
 * MCP Server 实例与能力注册（规格 §三 src/server.ts）。
 *
 * 阶段一只挂 Tool；Resource（阶段六）与 Prompt（阶段六）在这里留好挂载点。
 * 能力清单一并打印到 stderr，便于客户端排查（规格 §14「启动时打印版本与能力清单」）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './config.js';
import { log } from './log.js';
import { registerAllTools } from './tools/index.js';

export interface BuiltServer {
  server: McpServer;
  tools: string[];
}

export function buildServer(): BuiltServer {
  const server = new McpServer(
    { name: config.name, version: config.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  const tools = registerAllTools(server);

  log.info(
    `能力清单：tools=${tools.length}（${tools.join(', ')}）resources=0（阶段六）prompts=0（阶段六）`,
  );
  log.info(`工作区：${config.workspace}`);
  log.info(`插件目录：${config.pluginDir}`);
  log.info(`写开关 ALLOW_WRITE=${config.allowWrite}（false 时所有写操作返回 WRITE_DISABLED）`);
  log.info(`Live Bridge：${config.bridgeUrl}（阶段二接入；当前一律走无头，返回 degraded=true）`);

  return { server, tools };
}
