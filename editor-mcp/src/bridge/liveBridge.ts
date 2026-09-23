/**
 * Live Bridge 客户端（规格 §4.1）：连编辑器侧的 WebSocket 服务，把 MCP 调用转成
 * `{ id, method, params }` 请求，并接收 `document.changed` / `selection.changed` 推送。
 *
 * 设计要点：
 *   · **零依赖**：用 Node ≥22 内置的 `globalThis.WebSocket`（规格里列的 `ws` 只留给测试用 mock 服务端）；
 *   · **惰性连接**：只有真的要调 Tool 时才连，编辑器没开桥接就"最多等 `timeoutMs`"，绝不把工具挂死；
 *   · **版本协商**：连上先发 `bridge.hello`，版本不一致就断开并拒绝用 Live（规格 §4.1 要求）；
 *   · **指数退避重连**：1s → 2s → 4s … 上限 30s，断开自动重连（编辑器后开也能接上）；
 *   · 连接失败**不报错**：交给 fallback 静默降级到无头（规格 §4.1）。
 */
import { config } from '../config.js';
import { log } from '../log.js';

export interface BridgeStatus {
  url: string;
  /** 是否开着连接 */
  connected: boolean;
  /** hello 完成且版本一致 */
  ready: boolean;
  version: string | null;
  reconnects: number;
  lastError: string | null;
}

interface WsLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  addEventListener(type: string, cb: (ev: { data?: unknown }) => void): void;
}

const WS_CTOR = (globalThis as unknown as { WebSocket?: new (url: string) => WsLike }).WebSocket;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LiveBridge {
  private ws: WsLike | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private backoff = 1000;
  private reconnects = 0;
  private lastError: string | null = null;
  private readyVersion: string | null = null;
  private run = false;
  private connecting = false;
  private helloWaiters: ((ok: boolean) => void)[] = [];
  private events = new Map<string, ((payload: unknown) => void)[]>();
  private lastEvent: Record<string, unknown> = {};

  constructor(private readonly url: string = config.bridgeUrl) {}

  status(): BridgeStatus {
    return {
      url: this.url,
      connected: !!this.ws && this.ws.readyState === 1,
      ready: this.isReady(),
      version: this.readyVersion,
      reconnects: this.reconnects,
      lastError: this.lastError,
    };
  }

  isReady(): boolean {
    return !!this.ws && this.ws.readyState === 1 && !!this.readyVersion;
  }

  /** 订阅编辑器推送的事件（阶段六的 Resource subscription 会用它） */
  on(event: string, cb: (payload: unknown) => void): void {
    const list = this.events.get(event) ?? [];
    list.push(cb);
    this.events.set(event, list);
  }

  /** 最近一次事件的负载（`editor://bridge/status` 与订阅通知会用） */
  lastOf(event: string): unknown {
    return this.lastEvent[event];
  }

  /**
   * 惰性确保可用：已就绪直接 true；否则后台开始重连，最多等 `timeoutMs` 后返回 false。
   * 工具调用不该因为编辑器没开而卡住 —— 这是 fallback 能"静默降级"的前提。
   */
  async ensureReady(timeoutMs = 800): Promise<boolean> {
    if (this.isReady()) return true;
    if (!WS_CTOR) {
      this.lastError = '当前 Node 没有内置 WebSocket（需要 ≥22）';
      return false;
    }
    this.start();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.helloWaiters = this.helloWaiters.filter((w) => w !== done);
        resolve(false);
      }, timeoutMs);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      this.helloWaiters.push(done);
    });
  }

  start(): void {
    if (this.run) return;
    this.run = true;
    this.open();
  }

  stop(): void {
    this.run = false;
    try {
      this.ws?.close();
    } catch {
      /* 忽略 */
    }
    this.ws = null;
    this.readyVersion = null;
    this.rejectAll('桥接已关闭');
  }

  /** 发一条请求并等响应（超时 reject，不阻塞其它请求）。要求连接已就绪 */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
    if (!this.isReady()) throw new Error('Live Bridge 未就绪');
    return this.send<T>(method, params, timeoutMs);
  }

  /**
   * 真正发请求：**不做就绪检查**。
   * ★`bridge.hello` 必须走这里 —— 它自己就是"变成就绪"的那一步，
   *   若走 `call()` 会被"未就绪"挡回来（先有鸡还是先有蛋，握手永远发不出去）。
   */
  private send<T>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('Live Bridge 未连接'));
    const id = `req-${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`桥接调用超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try {
        ws.send(JSON.stringify({ id, method, params }));
        log.debug(`bridge → ${method} ${log.brief(params)}`);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  /* ── 内部 ── */

  private open(): void {
    if (this.connecting) return;
    this.connecting = true;
    try {
      const ws = new WS_CTOR!(this.url);
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.connecting = false;
        this.backoff = 1000;
        void this.hello();
      });
      ws.addEventListener('message', (ev) => this.onMessage(ev?.data));
      ws.addEventListener('error', () => {
        this.lastError = `连接失败：${this.url}`;
      });
      ws.addEventListener('close', () => {
        this.connecting = false;
        this.ws = null;
        this.readyVersion = null;
        this.rejectAll('桥接断开');
        this.scheduleReconnect();
      });
    } catch (e) {
      this.connecting = false;
      this.lastError = String((e as Error)?.message ?? e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.run) return;
    const wait = this.backoff;
    this.backoff = Math.min(wait * 2, 30_000);
    this.reconnects += 1;
    log.debug(`桥接断开，${Math.round(wait / 1000)}s 后重连（第 ${this.reconnects} 次）`);
    const t = setTimeout(() => this.open(), wait);
    if (typeof t.unref === 'function') t.unref(); // 不拖住进程退出
  }

  private async hello(): Promise<void> {
    try {
      const res = await this.send<{ version?: string; name?: string }>(
        'bridge.hello',
        { client: config.name, version: config.version, protocol: config.protocolVersion },
        1500,
      );
      const version = res?.version ?? 'unknown';
      if (version !== 'unknown' && version !== config.version) {
        this.lastError = `版本不匹配（编辑器 ${version} / MCP ${config.version}），拒绝使用 Live Bridge`;
        log.warn(this.lastError);
        this.readyVersion = null;
        this.ws?.close();
        return;
      }
      this.readyVersion = version;
      this.lastError = null;
      log.info(`Live Bridge 就绪：${res?.name ?? 'editor'} v${version}`);
      this.helloWaiters.forEach((w) => w(true));
      this.helloWaiters = [];
    } catch (e) {
      this.lastError = `hello 失败：${String((e as Error)?.message ?? e)}`;
      log.debug(this.lastError);
    }
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    // 响应
    const id = msg.id as string | undefined;
    if (id && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (msg.ok) {
        p.resolve(msg.result);
      } else {
        const err = msg.error as { code?: string; message?: string } | undefined;
        p.reject(new Error(`${err?.code ?? 'BRIDGE_ERROR'}: ${err?.message ?? '未知错误'}`));
      }
      return;
    }
    // 推送
    const event = msg.event as string | undefined;
    if (event) {
      this.lastEvent[event] = msg.payload;
      log.debug(`bridge ← ${event}`);
      (this.events.get(event) ?? []).forEach((cb) => cb(msg.payload));
    }
  }

  private rejectAll(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    this.helloWaiters.forEach((w) => w(false));
    this.helloWaiters = [];
  }
}

/** 进程内单例（工具共用一条连接） */
export const liveBridge = new LiveBridge();
