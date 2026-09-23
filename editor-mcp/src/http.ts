/**
 * Streamable HTTP transport（规格 §4.3 / §12 阶段七）。
 *
 *   editor-mcp --http --port 37651        → POST/GET/DELETE http://127.0.0.1:37651/mcp
 *
 * 实现要点：
 *   · **有状态会话**：用 `StreamableHTTPServerTransport({ sessionIdGenerator })`，每个新会话
 *     （initialize 时不带 `mcp-session-id`）各建一个 McpServer 实例，
 *     `onsessioninitialized` 记进 Map；后续请求按 `mcp-session-id` 头路由到对应会话。
 *     这样**多个客户端互不干扰**（规格验收 15：3 个客户端可同时服务）。
 *   · 只暴露一个端点 `/mcp`，其余路径 404，避免顺便变成静态服务器。
 *   · 只监听 127.0.0.1（默认），不接受外部连接。
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './config.js';
import { log } from './log.js';
import { buildServer } from './server.js';

const ENDPOINT = '/mcp';

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAt: number;
  dispose: () => void;
}

export interface HttpServerHandle {
  port: number;
  close: () => Promise<void>;
  sessions: () => number;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const send = (res: http.ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
};

export async function startHttpServer(port: number, host = '127.0.0.1'): Promise<HttpServerHandle> {
  const sessions = new Map<string, Session>();

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
      if (url.pathname !== ENDPOINT) {
        send(res, 404, { error: { code: 'NOT_FOUND', message: `只暴露 ${ENDPOINT}` } });
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const existing = sessionId ? sessions.get(sessionId) : undefined;

      try {
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (!existing) {
            // 新会话：必须是 initialize，否则拒绝（否则会悄悄建出一堆无名会话）
            if (sessionId || !isInitializeRequest(body)) {
              send(res, 400, {
                jsonrpc: '2.0',
                error: { code: -32000, message: '服务器当前无此会话；新会话请先发 initialize（不带 mcp-session-id）' },
                id: null,
              });
              return;
            }
            const built = buildServer();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid) => {
                sessions.set(sid, { server: built.server, transport, createdAt: Date.now(), dispose: built.dispose });
                log.info(`HTTP 会话建立：${sid}（当前 ${sessions.size} 个）`);
              },
            });
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) {
                sessions.get(sid)?.dispose();
                sessions.delete(sid);
                log.info(`HTTP 会话关闭：${sid}（剩余 ${sessions.size} 个）`);
              }
            };
            await built.server.connect(transport);
            await transport.handleRequest(req, res, body);
            return;
          }
          await existing.transport.handleRequest(req, res, body);
          return;
        }

        if (req.method === 'GET' || req.method === 'DELETE') {
          if (!existing) {
            send(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: '无此会话（缺 mcp-session-id）' }, id: null });
            return;
          }
          await existing.transport.handleRequest(req, res);
          return;
        }

        send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: `不支持 ${req.method}` } });
      } catch (e) {
        log.error(`HTTP 请求处理失败：${String((e as Error)?.message ?? e)}`);
        if (!res.headersSent) send(res, 500, { error: { code: 'IO_ERROR', message: String((e as Error)?.message ?? e) } });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  log.info(`Streamable HTTP 已监听 http://${host}:${port}${ENDPOINT}（多客户端各建会话；写开关 ALLOW_WRITE=${config.allowWrite}）`);

  return {
    port,
    sessions: () => sessions.size,
    close: async () => {
      for (const [, s] of sessions) {
        s.dispose();
        try {
          await s.transport.close();
        } catch {
          /* 忽略 */
        }
      }
      sessions.clear();
      // ★必须先断开**所有存活连接**：`server.close()` 只会停止接受新连接，
      //   要等已有连接（HTTP keep-alive、SSE 长连接）结束才回调 —— 客户端不主动关就永远退不出去。
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        setTimeout(resolve, 500).unref(); // 兜底：半秒后无论如何都返回
      });
    },
  };
}
