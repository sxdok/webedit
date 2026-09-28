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
import { guardRequest } from './security/guard.js';

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

const send = (res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
};

export async function startHttpServer(port: number, host = '127.0.0.1'): Promise<HttpServerHandle> {
  const sessions = new Map<string, Session>();
  /** 已复活过的旧会话 id（只记来避免日志刷屏） */
  const revived = new Set<string>();

  /**
   * 在服务端**内部合成一次 initialize**，把一个新会话标成"已初始化"并绑定到指定 id。
   *
   * ★为什么需要它（2026-09-28 实测的真事故）：
   *   编辑器每次启动都会拉起一个新的 editor-mcp 进程，而 agent 侧（DSH 的 `dsh-mcp-client`）
   *   只在**传输层关闭**时才重连、**不**会因为一次请求失败而重新 initialize。于是它会一直拿着
   *   上一个进程的 `mcp-session-id` 发请求。老实现遇到"不认识的会话 id"直接回 400 + JSON-RPC 错误：
   *   客户端看到的是"工具调用报错"，而不是"会话失效需要重建"，于是**永久卡死** ——
   *   实测现象就是 `Error POSTing to endpoint: {"code":-32000,"message":"服务器当前无此会话…"}`。
   *   （MCP 规范对无效会话要求 404，但这一版 SDK 客户端拿到 404 同样只是抛错，不会自动重来。
   *     所以只能由**服务端**把会话接回去 —— 这也是"同时连接多个 / 编辑器重启后 agent 还能用"的关键。）
   *
   * 实现走的是 transport 自己的状态机（合成一个标准 initialize 请求），不依赖 SDK 私有字段之外的东西；
   * SDK 若改了内部结构，这里会抛错并退回"诚实报错"，不会静默装成能用。
   */
  async function reviveSession(staleId: string): Promise<Session> {
    const built = buildServer();
    const transport = new StreamableHTTPServerTransport({
      // 生成器返回**客户端原来那个 id** → 复活后的会话 id 与客户端手里的一致，后续请求自然命中
      sessionIdGenerator: () => staleId,
      onsessioninitialized: (sid) => {
        sessions.set(sid, { server: built.server, transport, createdAt: Date.now(), dispose: built.dispose });
        if (!revived.has(sid)) {
          revived.add(sid);
          log.warn(`收到上一代进程的会话 id：${sid} —— 客户端没有重新 initialize（agent 侧只在传输层关闭时才重连），已在服务端按同一 id 复活会话并继续服务`);
        }
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        void sessions.get(sid)?.dispose();
        sessions.delete(sid);
        log.info(`HTTP 会话关闭：${sid}（剩余 ${sessions.size} 个）`);
      }
    };
    await built.server.connect(transport);

    // 合成 initialize（不产生真实 HTTP 往返；回包我们不看，只需要它把会话标成已初始化）
    const inner = (transport as unknown as { _webStandardTransport?: { handleRequest: (r: Request) => Promise<Response> } })
      ._webStandardTransport;
    if (typeof inner?.handleRequest !== 'function') {
      throw new Error('SDK 内部结构变化：无法合成 initialize 以复活会话');
    }
    const synthetic = await inner.handleRequest(
      new Request(`http://${host}:${port}${ENDPOINT}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '__revive__',
          method: 'initialize',
          params: {
            protocolVersion: config.protocolVersion,
            capabilities: {},
            clientInfo: { name: 'editor-mcp(session-revive)', version: config.version },
          },
        }),
      }),
    );
    await synthetic.body?.cancel().catch(() => undefined);
    if (!synthetic.ok) throw new Error(`合成 initialize 失败：HTTP ${synthetic.status}`);

    const session = sessions.get(staleId);
    if (!session) throw new Error('合成 initialize 后仍没有会话（SDK 行为变化）');
    return session;
  }

  /** 建一个全新的**有状态**会话（正常客户端走这条：多客户端互不干扰） */
  async function createSession(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): Promise<void> {
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
        void sessions.get(sid)?.dispose();
        sessions.delete(sid);
        log.info(`HTTP 会话关闭：${sid}（剩余 ${sessions.size} 个）`);
      }
    };
    await built.server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
      if (url.pathname !== ENDPOINT) {
        send(res, 404, { error: { code: 'NOT_FOUND', message: `只暴露 ${ENDPOINT}` } });
        return;
      }

      // ── P0 安全闸门：Host（防 DNS rebinding）→ Origin（防本机网页 CSRF）→ token（鉴权）──
      // 只绑回环挡不住浏览器：任意网页都能用 text/plain 简单请求打到 127.0.0.1:37651。
      const verdict = guardRequest(
        { host: req.headers.host, origin: req.headers.origin, authorization: req.headers.authorization },
        { allow: config.originAllow, token: config.token, requireToken: config.requireToken },
      );
      if (!verdict.allowed) {
        const status = verdict.code === 'UNAUTHORIZED' ? 401 : 403;
        log.warn(`拒绝入站请求 [${verdict.code}] ${req.socket.remoteAddress ?? '?'} ${req.method} ${url.pathname} — ${verdict.reason}`);
        send(
          res,
          status,
          {
            jsonrpc: '2.0',
            error: {
              code: status === 401 ? -32002 : -32003,
              message: verdict.reason ?? '拒绝访问',
              data: { code: verdict.code, hint: '见「工具 → MCP 桥接」一键复制带 token 的客户端配置' },
            },
            id: null,
          },
          status === 401 ? { 'WWW-Authenticate': 'Bearer realm="editor-mcp"' } : {},
        );
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const existing = sessionId ? sessions.get(sessionId) : undefined;

      try {
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (!existing) {
            // ① 全新客户端：必须是 initialize（否则会悄悄建出一堆无名会话）
            if (!sessionId) {
              if (!isInitializeRequest(body)) {
                send(res, 400, {
                  jsonrpc: '2.0',
                  error: { code: -32000, message: '服务器当前无此会话；新会话请先发 initialize（不带 mcp-session-id）' },
                  id: null,
                });
                return;
              }
              await createSession(req, res, body);
              return;
            }
            // ② 客户端带来了会话 id，但本进程没有这个会话 = **上一代进程的旧会话**（编辑器重启过）。
            if (isInitializeRequest(body)) {
              // 它自己在重新握手 → 走正常新会话（新 id 会在响应头里，客户端会采纳）
              await createSession(req, res, body);
              return;
            }
            // 否则**按同一个 id 复活会话**再服务这一条请求：客户端完全不用改，agent 不会卡死。
            try {
              const revivedSession = await reviveSession(sessionId);
              await revivedSession.transport.handleRequest(req, res, body);
            } catch (e) {
              log.warn(`复活旧会话失败（${sessionId}）：${String((e as Error)?.message ?? e)}`);
              send(res, 400, {
                jsonrpc: '2.0',
                error: { code: -32001, message: `会话已失效且无法复活：${String((e as Error)?.message ?? e)}（请让客户端重新 initialize）` },
                id: null,
              });
            }
            return;
          }
          await existing.transport.handleRequest(req, res, body);
          return;
        }

        if (req.method === 'GET' || req.method === 'DELETE') {
          if (!existing) {
            /**
             * GET（SSE 续流）带旧 id：同样先试着复活，能复活就服务。
             * DELETE（客户端收尾时主动终止会话）：**回 405** 而不是 404 —— SDK 客户端把 405 当
             * "服务器不支持显式终止会话"从而干净收场，回 404 反而会让它在 teardown 时抛错。
             */
            if (req.method === 'GET' && sessionId) {
              try {
                await (await reviveSession(sessionId)).transport.handleRequest(req, res);
                return;
              } catch {
                /* 落到下面的 405/404 */
              }
            }
            send(res, req.method === 'DELETE' ? 405 : 404, {
              jsonrpc: '2.0',
              error: { code: -32001, message: req.method === 'DELETE' ? '无此会话（不支持显式终止）' : '无此会话（缺有效的 mcp-session-id）' },
              id: null,
            });
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
        void s.dispose();
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
