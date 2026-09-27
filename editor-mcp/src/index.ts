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
  // 桥接中转：让编辑器页面能接进来（浏览器不能监听端口，所以由 Node 侧当中转）
  let hub: { close: () => Promise<void> } | null = null;
  if (config.bridgeHub) {
    try {
      /**
       * ★**先探再绑**（用户 2026-09-28：「运行同时连接多个」）。
       * 多个 editor-mcp 实例应当**共用一个中转**：第一个绑端口当持有者，其余作为客户端接进去 ——
       * 实测两边都能拿到 Live（见 `scripts/multi-connection-check.mjs`：A 占端口、B 只连不占，
       * 两边 `editor://bridge/status` 都是 connected + ready + mode=live）。
       * 老写法是无条件 `startBridgeHub()`，第二个实例必然 EADDRINUSE，日志写成
       * "桥接中转未能启动（端口可能被占）" —— 看着像故障，也让人误判成"只能有一个拿到 Live"。
       */
      const { startBridgeHub, probeHub, hubOwnedByMe } = await import('./bridge/host.js');
      const existing = await probeHub();
      if (existing) {
        log.info(`检测到既有桥接中转（${config.bridgeUrl}）—— 本实例作为客户端接入（多实例共用一个中转，都能拿到 Live）`);
      } else {
        hub = await startBridgeHub();
      }
      /**
       * ★中转起来（或已存在）后**立刻**让 MCP 侧也接进去（而不是等第一次 live 调用才惰性连接）。
       *   为什么必须提前：`editor://bridge/status` 的 `ready` 是从本侧连接状态算出来的 ——
       *   如果这侧还没连，"编辑器已接入"这件事**没有任何人告诉它**，于是 ready 永远 false，
       *   直到某次调用触发惰性连接、顺便 hello 问出 `editors` 才转真。
       *   现象就是"编辑器明明接上了，桥接状态却一直显示未就绪"（阶段八端到端卡在这里：
       *   等 30s 超时后，后面的调用却都是 via=live）。
       */
      const { liveBridge } = await import('./bridge/liveBridge.js');
      liveBridge.start();
      log.info(`MCP 侧已接入桥接中转（${config.bridgeUrl}），等待编辑器页面接入${hubOwnedByMe() ? '（本实例持有中转）' : '（中转由其它实例持有）'}`);
    } catch (e) {
      log.warn(`桥接中转未能启动：${String((e as Error)?.message ?? e)}（端口可能被非中转进程占用；Live 不可用，其余工具不受影响）`);
    }
  }

  const { server, tools, resources, prompts, dispose } = buildServer();

  if (wantList) {
    process.stdout.write(
      `${JSON.stringify({ name: config.name, version: config.version, protocolVersion: config.protocolVersion, tools, resources, prompts }, null, 2)}\n`,
    );
    // ★收尾必须等两个句柄真的关掉（chokidar 监听 + 桥接中转），否则进程会被吊住不退出
    await dispose();
    await hub?.close();
    return;
  }

  if (wantHttp) {
    const portArg = argv.indexOf('--port');
    const port = portArg >= 0 ? Number(argv[portArg + 1] ?? 37651) : 37651;
    const { startHttpServer } = await import('./http.js');
    const handle = await startHttpServer(port);
    log.info('已进入 HTTP 模式，Ctrl+C 退出');
    const stopAll = async () => {
    await hub?.close();
  };
  const stop = () => {
      // ★收尾必须有硬上限：HTTP 可能还有 keep-alive / SSE 连接挂着，
      //   等它们自然结束会把进程吊死（真踩过：测试脚本的管道因此一直不关）
      const hardExit = setTimeout(() => process.exit(0), 800);
      hardExit.unref();
      void handle.close().then(stopAll).then(() => process.exit(0));
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
