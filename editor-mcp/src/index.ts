#!/usr/bin/env node
/**
 * editor-mcp 入口（规格 §三 src/index.ts + §十二 阶段一）。
 *
 *   editor-mcp --stdio                 本地 MCP 客户端默认（阶段一实现）
 *   editor-mcp --http --port 37651     Streamable HTTP（阶段七实现，现在明确报错而不是假装可用）
 *   editor-mcp --help / --version
 *
 * 注意：**stdout 是 MCP 的 JSON-RPC 通道**，所有日志都走 stderr（见 log.ts）。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { log, setDebug } from './log.js';
import { buildServer } from './server.js';

function printHelp(): void {
  process.stderr.write(
    [
      `${config.name} v${config.version} —— 可视化编辑器 MCP 服务器`,
      '',
      '用法：',
      '  editor-mcp --stdio                用 stdio 启动（本地 MCP 客户端）',
      '  editor-mcp --http --port 37651    用 Streamable HTTP 启动（阶段七）',
      '  editor-mcp --list                 只打印能力清单后退出（不启动传输）',
      '',
      '环境变量：',
      '  EDITOR_MCP_BRIDGE_URL    Live Bridge 地址（默认 ws://127.0.0.1:37650）',
      '  EDITOR_MCP_WORKSPACE     无头文档目录（默认 <包>/workspace）',
      '  EDITOR_MCP_PLUGIN_DIR    外部插件目录（默认 <仓库>/web-editor/public/组件）',
      '  EDITOR_MCP_ALLOW_WRITE   false 时拒绝所有写操作（默认 true）',
    ].join('\n') + '\n',
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${config.version}\n`);
    return;
  }
  setDebug(argv.includes('--debug'));

  const wantHttp = argv.includes('--http');
  const wantList = argv.includes('--list');
  const stdio = argv.includes('--stdio') || (!wantHttp && !wantList);

  log.info(
    `${config.name} v${config.version} 启动（协议版本 ${config.protocolVersion}，transport=${wantHttp ? 'http' : stdio ? 'stdio' : 'none'}）`,
  );
  const { server, tools, resources, prompts, dispose } = buildServer();

  if (wantList) {
    process.stdout.write(
      `${JSON.stringify({ name: config.name, version: config.version, protocolVersion: config.protocolVersion, tools, resources, prompts }, null, 2)}\n`,
    );
    dispose();
    return;
  }

  if (wantHttp) {
    const portArg = argv.indexOf('--port');
    const port = portArg >= 0 ? Number(argv[portArg + 1] ?? 37651) : 37651;
    const { startHttpServer } = await import('./http.js');
    const handle = await startHttpServer(port);
    log.info('已进入 HTTP 模式，Ctrl+C 退出');
    const stop = () => {
      // ★收尾必须有硬上限：HTTP 可能还有 keep-alive / SSE 连接挂着，
      //   等它们自然结束会把进程吊死（真踩过：测试脚本的管道因此一直不关）
      const hardExit = setTimeout(() => process.exit(0), 800);
      hardExit.unref();
      void handle.close().then(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('已连接 stdio，等待 MCP 客户端请求（Ctrl+C 退出）');
}

main().catch((e: unknown) => {
  log.error(`启动失败：${String((e as Error)?.message ?? e)}`);
  process.exitCode = 1;
});
