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
import { EDITOR_PROTOCOL, evaluateHandshake } from './protocolGate.js';

export interface BridgeStatus {
  url: string;
  /** 是否开着连接（= **中转可达**） */
  connected: boolean;
  /** hello 完成**且编辑器已接入**（§5.1 起判据是"协议/能力"，不再要求产品版本全等） */
  ready: boolean;
  /**
   * 中转可达、但**编辑器没接入**（hello 已经问明白了）。
   * ★与 `connected` 分开报：`connected=true, ready=false` 说明"中转在、编辑器没开"，
   *   而不是"连不上中转"—— 排障时这两种情况的处理完全不同。
   */
  hubNoEditor: boolean;
  /** 本侧是否开着自动重连（`start()` 过；阶段八起 MCP 启动即连） */
  running: boolean;
  version: string | null;
  reconnects: number;
  lastError: string | null;
  /* ── §5.3：诊断要能看清"协议是否一致、编辑器报了哪些能力" ── */
  /** 就绪时我们使用的桥接协议版本（未就绪为 null） */
  protocol?: number | null;
  /** 编辑器协议与我们对不上（含"未上报"）→ 缺能力的方法会走无头 */
  protocolMismatch?: boolean;
  /** 编辑器自报的能力集（未就绪为 null） */
  features?: Record<string, boolean> | null;
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
  /** 中转可达但编辑器未接入（hello 已经问明白了）→ 直接走无头，不再等握手超时 */
  private hubNoEditor = false;
  /** §5.1：编辑器的桥接协议与我们的对不上（含"没报"）→ 缺能力的方法一律走无头 */
  private protocolMismatch = false;
  /** §5.1：编辑器自报的能力集（fallback 用来逐方法判是否能用 Live） */
  private editorFeatures: Record<string, boolean> | null = null;
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
      hubNoEditor: this.hubNoEditor,
      running: this.run,
      version: this.readyVersion,
      reconnects: this.reconnects,
      lastError: this.lastError,
      /* §5.3：诊断资源要能看清"协议是否一致、编辑器报了哪些能力" */
      protocol: this.readyVersion ? EDITOR_PROTOCOL : null,
      protocolMismatch: this.protocolMismatch,
      features: this.editorFeatures,
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
    // 中转在线但编辑器没接入 → 立刻返回 false（不要每次调用都白等一个 timeout）
    if (this.hubNoEditor) return false;
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
    this.hubNoEditor = false;
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
      const res = await this.send<{
        version?: string;
        name?: string;
        editors?: number;
        editorVersion?: string | null;
        editorProtocol?: number | null;
        editorFeatures?: Record<string, boolean> | null;
      }>(
        'bridge.hello',
        {
          client: config.name,
          version: config.version,
          protocol: config.protocolVersion,
          // P0：hub 侧 token 校验（决策 #1）。桌面版会在启动本进程时注入同一个 token。
          token: config.token ?? undefined,
        },
        1500,
      );
      // ★hello 只证明"中转可达"，**不等于编辑器在线**：
      //   中转在中、编辑器没开时，请求会被中转回 BRIDGE_OFFLINE —— 那种情况下必须走无头降级，
      //   所以这里以 `editors`（编辑器接入数）为准，而不是拿中转自己的版本号当就绪。
      const editors = Number(res?.editors ?? 1); // 老实现/模拟器不带 editors → 视为已就绪
      if (editors < 1) {
        this.readyVersion = null;
        this.hubNoEditor = true;
        this.lastError = '桥接中转已连上，但编辑器未接入（在编辑器菜单「工具 → MCP 桥接」）';
        log.info(this.lastError);
        // 立刻给出"不可用"的结论：否则每次工具调用都要白等一个 timeout
        this.helloWaiters.forEach((w) => w(false));
        this.helloWaiters = [];
        return; // 不关连接：等中转推 bridge.editor 说编辑器来了
      }
      this.applyHandshake({
        version: res?.editorVersion ?? res?.version ?? 'unknown',
        protocol: res?.editorProtocol ?? undefined,
        features: res?.editorFeatures ?? undefined,
      });
      this.helloWaiters.forEach((w) => w(true));
      this.helloWaiters = [];
    } catch (e) {
      this.lastError = `hello 失败：${String((e as Error)?.message ?? e)}`;
      log.debug(this.lastError);
    }
  }

  /**
   * §5.1：用**协议 + 能力**决定能不能用 Live（**不再要求产品版本全等**）。
   * 版本不同只记 info；协议不同仍尝试 Live，但标 `protocolMismatch` → 调用前按能力逐方法判
   * （见 `fallback.ts` 与 `protocolGate.missingFeature`）。
   */
  private applyHandshake(h: { version?: string; protocol?: number; features?: Record<string, boolean> }): void {
    const decision = evaluateHandshake(
      { protocol: h.protocol, version: h.version, features: h.features },
      config.version,
      EDITOR_PROTOCOL,
    );
    this.protocolMismatch = decision.protocolMismatch;
    this.editorFeatures = h.features ?? null;
    if (!decision.live) {
      this.readyVersion = null;
      this.lastError = decision.note;
      log.warn(decision.note);
      return;
    }
    this.readyVersion = h.version ?? 'unknown';
    this.lastError = null;
    if (decision.protocolMismatch) log.warn(`Live Bridge 就绪（协议不一致）：${decision.note}`);
    else log.info(`Live Bridge 就绪：${h.version ?? 'unknown'}（${decision.note}）`);
  }

  /** 当前编辑器自报的能力集（fallback 用它判"这个方法该不该走 Live"） */
  features(): Record<string, boolean> | null {
    return this.editorFeatures;
  }

  /** 协议是否与我们对不上（含"编辑器没报协议"）→ 缺能力的方法一律走无头 */
  handshakeMismatch(): boolean {
    return this.protocolMismatch;
  }

  /** 中转推来的"编辑器接入/掉线"（bridge.editor）→ 实时切换 Live / 无头 */
  private onEditorPresence(payload: unknown): void {
    const p = (payload ?? {}) as { editors?: number; version?: string | null; protocol?: number | null; features?: Record<string, boolean> | null };
    const n = Number(p.editors ?? 0);
    if (n < 1) {
      if (this.readyVersion) log.info('编辑器已断开桥接 → 后续调用走无头（degraded=true）');
      this.readyVersion = null;
      this.hubNoEditor = true;
      this.protocolMismatch = false;
      this.editorFeatures = null;
      this.lastError = '编辑器未接入桥接（中转在线）';
      return;
    }
    // §5.1：接入/掉线同样走协议+能力判据（不再要求版本全等）
    this.hubNoEditor = false;
    this.applyHandshake({
      version: p.version ?? 'unknown',
      protocol: p.protocol ?? undefined,
      features: p.features ?? undefined,
    });
    // 编辑器接入后，之前等待握手的调用方可以继续（就绪状态由 applyHandshake 决定）
    if (this.readyVersion) {
      this.helloWaiters.forEach((w) => w(true));
      this.helloWaiters = [];
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
      if (event === 'bridge.editor') this.onEditorPresence(msg.payload);
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
