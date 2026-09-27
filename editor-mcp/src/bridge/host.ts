/**
 * 桥接中转（Bridge Hub）：监听 `ws://127.0.0.1:37650`，把两侧接起来。
 *
 * ★为什么需要"中转"而不是"编辑器自己开服务"：
 *   规格 §11 写的是"编辑器侧新增一个 WebSocket 服务" —— 但**浏览器页面不能监听端口**，
 *   它只能当 WebSocket 客户端。所以 37650 上的服务放在 Node 侧（本文件），
 *   两侧都作为客户端连进来：
 *
 *     editor-mcp（LiveBridge 客户端） ←ws→  Hub  ←ws→  编辑器页面（bridgeClient）
 *
 *   · 编辑器连上后先发 `{ method: 'bridge.hello', params: { role: 'editor', version } }`；
 *   · MCP 侧发来的请求 `{ id, method, params }` 原样转发给编辑器，回包按 id 送回请求方；
 *   · 编辑器主动推的 `{ event, payload }` 广播给所有 MCP 侧连接（订阅用）；
 *   · 编辑器不在线时，请求立刻回错（`BRIDGE_OFFLINE`），不会把调用方挂住。
 *
 * 只监听 127.0.0.1：桥接是"本机调试通道"，不对外。
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from '../config.js';
import { log } from '../log.js';

interface Peer {
  ws: WebSocket;
  role: 'editor' | 'mcp' | 'unknown';
  version?: string;
  connectedAt: number;
}

export interface BridgeHubHandle {
  url: string;
  port: number;
  /** 当前已连的编辑器数（正常 0 或 1） */
  editors: () => number;
  /** MCP 侧连接数（LiveBridge + 其它客户端） */
  clients: () => number;
  close: () => Promise<void>;
}

const HUB_PATH = '/bridge';

/**
 * 探测"这个地址上是不是已经有中转在跑"。
 * ★为什么要先探再绑（用户 2026-09-28 要求「运行同时连接多个」）：
 *   多个 editor-mcp 实例（桌面版自己拉的那个 + DSH/agent 拉的那个 + 手动起的）应当**共用一个中转**：
 *   第一个绑端口当地主，其余的作为客户端接进去 —— 实测两边都能拿到 Live。
 *   老写法是无条件 `startBridgeHub()`，第二个实例必然 EADDRINUSE，于是日志里出现
 *   "桥接中转未能启动（端口可能被占）"，看着像故障（我一度也据此判断"只有一个能 Live"）。
 *   先探一次就能把这种情况如实说成"接入既有中转"（info），而不是报错。
 */
export function probeHub(rawUrl = config.bridgeUrl, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    /** 只用 DOM 风格的两个事件 + close：内置 WebSocket 与 `ws` 都满足（`ws` 也实现了 addEventListener） */
    interface ProbeSocket {
      close(): void;
      addEventListener(type: string, cb: () => void): void;
    }
    let ws: ProbeSocket | null = null;
    const finish = (okValue: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        ws?.close();
      } catch {
        /* 忽略 */
      }
      resolve(okValue);
    };
    // 只做"建得起来吗"的探测：不发 hello，连上就关（中转会把它当作 role=unknown，断开即回收）
    const Ctor = (globalThis as unknown as { WebSocket?: new (u: string) => ProbeSocket }).WebSocket;
    if (!Ctor) {
      resolve(false);
      return;
    }
    try {
      ws = new Ctor(rawUrl);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      finish(true);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

/** 本进程是不是"中转的持有者"（第一个实例 true，后续接入既有中转的实例 false） */
let ownsHub = false;
export const hubOwnedByMe = (): boolean => ownsHub;

export async function startBridgeHub(port?: number): Promise<BridgeHubHandle> {
  const url = new URL(config.bridgeUrl);
  const listenPort = port ?? Number(url.port || 37650);
  const host = url.hostname || '127.0.0.1';

  const peers = new Set<Peer>();
  const wss = new WebSocketServer({ host, port: listenPort, path: HUB_PATH });

  const send = (peer: Peer, msg: unknown): void => {
    if (peer.ws.readyState !== 1) return;
    try {
      peer.ws.send(JSON.stringify(msg));
    } catch (e) {
      log.debug(`桥接发送失败：${String((e as Error)?.message ?? e)}`);
    }
  };
  const editorPeer = (): Peer | undefined => [...peers].find((p) => p.role === 'editor' && p.ws.readyState === 1);
  const editors = () => [...peers].filter((p) => p.role === 'editor' && p.ws.readyState === 1).length;
  const clients = () => [...peers].filter((p) => p.role === 'mcp' && p.ws.readyState === 1).length;
  /** 已接入编辑器的版本（没有编辑器时 null）—— MCP 侧据此做**真正的**版本协商 */
  const editorVersion = (): string | null => editorPeer()?.version ?? null;

  /**
   * 编辑器"在不在线"发生变化时，主动告诉所有 MCP 侧连接。
   * ★没有这条推送就有个大坑：MCP 侧 hello 成功只说明"中转可达"，
   *   如果据此就认为 Live 可用，编辑器没开时每次调用都会拿到 BRIDGE_OFFLINE 而**不再降级**。
   *   所以就绪状态必须由"编辑器接入/断开"来驱动。
   */
  const announce = (): void => {
    const payload = { editors: editors(), clients: clients(), version: editorVersion() };
    for (const p of peers) if (p.role === 'mcp') send(p, { event: 'bridge.editor', payload });
    log.debug(`桥接编辑器状态：editors=${payload.editors} version=${payload.version ?? '无'}`);
  };

  /** 请求 → 编辑器：把 id 换成 hub 侧的唯一 id，避免两侧 id 撞车 */
  let seq = 0;
  const inFlight = new Map<string, { from: Peer; clientId: string }>();

  wss.on('connection', (ws, req) => {
    const peer: Peer = { ws, role: 'unknown', connectedAt: Date.now() };
    peers.add(peer);
    log.info(`桥接接入：${req.socket.remoteAddress}（当前 ${peers.size} 个连接）`);

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      } catch {
        return;
      }

      // ① 握手 / 身份
      if (msg.method === 'bridge.hello') {
        const params = (msg.params ?? {}) as { role?: string; version?: string };
        const wasEditor = peer.role === 'editor';
        peer.role = params.role === 'editor' ? 'editor' : 'mcp';
        peer.version = params.version;
        log.info(`桥接身份：${peer.role}（版本 ${peer.version ?? '未知'}）；编辑器 ${editors()} / 客户端 ${clients()}`);
        // 回它自己的 hello：
        //   · `version` 是**中转自身**的版本 → 只表示"中转可达"，≠ 编辑器在线；
        //   · `editors` / `editorVersion` 才是"编辑器在不在线、什么版本"，MCP 侧据此判定是否可用 Live。
        send(peer, {
          id: msg.id ?? null,
          ok: true,
          result: {
            name: 'editor-mcp-hub',
            version: config.version,
            role: peer.role,
            editors: editors(),
            clients: clients(),
            /** 已接入编辑器的版本；没有编辑器时 null */
            editorVersion: editorVersion(),
            protocol: config.protocolVersion,
          },
        });
        // 编辑器接入/掉线 → 通知所有 MCP 侧连接，让它们实时切换 Live / 无头
        if (peer.role === 'editor' || wasEditor) announce();
        return;
      }

      // ② 编辑器回包 → 送回原来的请求方
      if (typeof msg.id === 'string' && msg.id.startsWith('hub-')) {
        const pending = inFlight.get(msg.id);
        if (pending) {
          inFlight.delete(msg.id);
          send(pending.from, { id: pending.clientId, ok: msg.ok !== false, result: msg.result, error: msg.error });
        }
        return;
      }

      // ③ 编辑器主动推送 → 广播给所有 MCP 侧连接
      if (typeof msg.event === 'string') {
        for (const p of peers) if (p.role === 'mcp') send(p, msg);
        log.debug(`桥接广播事件：${msg.event}`);
        return;
      }

      // ④ MCP 侧请求 → 转发给编辑器
      if (typeof msg.method === 'string') {
        const target = editorPeer();
        const clientId = String(msg.id ?? '');
        if (!target) {
          // 编辑器没连上：立刻回错（不要把调用方挂住）
          send(peer, {
            id: msg.id ?? null,
            ok: false,
            error: { code: 'BRIDGE_OFFLINE', message: '编辑器未连接桥接（请确认编辑器已打开、并在菜单里开启了 MCP 桥接）' },
          });
          return;
        }
        const hubId = `hub-${++seq}`;
        inFlight.set(hubId, { from: peer, clientId });
        send(target, { id: hubId, method: msg.method, params: msg.params });
        // 超时兜底：15 秒没回就报错并清理（编辑器卡住时不能把 MCP 侧拖死）
        setTimeout(() => {
          if (!inFlight.has(hubId)) return;
          inFlight.delete(hubId);
          send(peer, { id: clientId, ok: false, error: { code: 'IO_ERROR', message: `编辑器 ${String(msg.method)} 超时未响应` } });
        }, 15_000).unref();
        return;
      }
    });

    ws.on('close', () => {
      peers.delete(peer);
      log.info(`桥接断开：${peer.role}（剩余编辑器 ${editors()} / 客户端 ${clients()}）`);
      if (peer.role === 'editor') announce();
    });
    ws.on('error', (e) => log.debug(`桥接连接出错：${String(e?.message ?? e)}`));
  });

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  log.info(`桥接中转已监听 ws://${host}:${listenPort}${HUB_PATH}（等待编辑器页面接入）`);
  ownsHub = true;

  return {
    url: `ws://${host}:${listenPort}${HUB_PATH}`,
    port: listenPort,
    editors,
    clients,
    close: async () => {
      ownsHub = false;
      for (const p of peers) {
        try {
          p.ws.close();
        } catch {
          /* 忽略 */
        }
      }
      peers.clear();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
        setTimeout(resolve, 300).unref();
      });
    },
  };
}
