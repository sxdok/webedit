/**
 * 模拟编辑器侧的 MCP 桥接服务（测试用，规格 §4.1 的编辑器端协议）。
 *
 *   node scripts/mock-bridge.mjs [--port 37650] [--version 0.1.0] [--bad-version]
 *
 * 实现：bridge.hello（版本协商）+ doc.create / node.add / selection.get 三个示例方法，
 * 并在 doc.create 之后主动推一条 `document.changed` 事件（用来验证订阅链路）。
 * 只用于本地验证与阶段九的端到端脚本，不参与产品运行。
 */
import { WebSocketServer } from 'ws';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const port = portArg >= 0 ? Number(argv[portArg + 1]) : 37650;
const versionArg = argv.indexOf('--version');
const version = argv.includes('--bad-version') ? '9.9.9' : versionArg >= 0 ? argv[versionArg + 1] : '0.1.0';

const wss = new WebSocketServer({ host: '127.0.0.1', port });
const state = { nodes: [], selection: [] };

wss.on('connection', (ws) => {
  process.stderr.write(`[mock-bridge] 客户端已连接（端口 ${port}，声明版本 ${version}）\n`);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    const { id, method, params } = msg;
    const reply = (ok, payload) => ws.send(JSON.stringify(ok ? { id, ok: true, result: payload } : { id, ok: false, error: payload }));

    switch (method) {
      case 'bridge.hello':
        // 模拟"中转 + 一个已接入的编辑器"：editors/editorVersion 是就绪判定的依据；
        // §5.1 起还要报 **protocol + features**（MCP 侧据此判 Live 与逐方法降级）
        reply(true, {
          name: 'mock-editor',
          version,
          protocol: '2025-06-18',
          clients: wss.clients.size,
          editors: 1,
          editorVersion: version,
          editorProtocol: argv.includes('--bad-protocol') ? 99 : 2,
          editorFeatures: argv.includes('--no-export-docx')
            ? { exportDocx: false, liveSelection: true, realtime: true }
            : { exportDocx: true, liveSelection: true, realtime: true },
        });
        break;
      case 'doc.create': {
        const docId = `live-${Math.random().toString(36).slice(2, 8)}`;
        reply(true, { docId, mode: params?.mode ?? 'document', title: params?.title ?? '未命名文档' });
        ws.send(JSON.stringify({ event: 'document.changed', payload: { docId } }));
        break;
      }
      case 'node.add': {
        const node = { id: `n${state.nodes.length + 1}`, type: params?.type ?? 'paragraph' };
        state.nodes.push(node);
        reply(true, { node, total: state.nodes.length });
        break;
      }
      case 'selection.get':
        reply(true, { ids: state.selection });
        break;
      default:
        reply(false, { code: 'METHOD_NOT_FOUND', message: `mock 未实现 ${method}` });
    }
  });
});

process.stderr.write(`[mock-bridge] 监听 ws://127.0.0.1:${port}\n`);
/** 收到信号要**立刻退**：wss.close() 会等已有连接关闭，否则测试脚本的管道一直挂着 */
const close = () => {
  for (const c of wss.clients) {
    try {
      c.terminate();
    } catch {
      /* 忽略 */
    }
  }
  try {
    wss.close();
  } catch {
    /* 忽略 */
  }
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
process.on('SIGHUP', close);
