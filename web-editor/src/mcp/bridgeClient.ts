/**
 * 职责：**MCP 桥接客户端**（规格 §11 编辑器侧）。
 *
 * 编辑器页面**不能监听端口**（浏览器限制），所以 37650 上是 editor-mcp 起的**中转 hub**，
 * 本模块作为 WebSocket **客户端**接进去：
 *
 *     editor-mcp（LiveBridge） ←ws→  hub(37650/bridge)  ←ws→  本模块（编辑器页面）
 *
 * · 由菜单「帮助 → MCP 桥接」开关；默认**不开**（规格 §4.1 要求可选启动）。
 * · 连上后发 `bridge.hello { role:'editor', version }`；断线按指数退避重连。
 * · 收到 `{ id, method, params }` → 路由到 **store 已有 action**（不重写业务逻辑，规格 §14），
 *   回 `{ id, ok, result }` 或 `{ id, ok:false, error:{ code, message } }`。
 * · store 变化时主动推 `document.changed` / `selection.changed`（供 MCP 侧订阅）。
 */
import { useSyncExternalStore } from 'react';
import { useEditorStore } from '../store/editorStore';
import { getLiveTypes } from '../registry/live';
import { routeLive } from './liveMethods';
import { log } from '../utils/logger';
import { desktopApi } from '../utils/desktopChrome';
import { EDITOR_FEATURES, EDITOR_PROTOCOL } from './protocol';
import { MCP_PROTOCOL_VERSION, VERSION } from '../version';

const BRIDGE_URL_DEFAULT = 'ws://127.0.0.1:37650/bridge';
let url = BRIDGE_URL_DEFAULT;

export type BridgeState = 'off' | 'connecting' | 'connected';
let state: BridgeState = 'off';
let ws: WebSocket | null = null;
let backoff = 1000;
let shouldRun = false;
let reconnects = 0;
let lastError: string | null = null;
/**
 * 发给 hub 的 `bridge.hello` 里的编辑器版本（**对外版本**）。
 * ★§5.1 起 **Live 的就绪判据不再是"版本全等"**：改看 `protocol`（上面的 `EDITOR_PROTOCOL`）与
 *   `features`（`EDITOR_FEATURES`）—— 版本不同只记一句 info，协议/能力不满足才逐方法退无头。
 *   版本号仍然要求跨包一致（发行物/诊断/更新都用它），`apps/desktop` 的 verify 里有断言盯着。
 */
let editorVersion = VERSION;
const listeners = new Set<(s: BridgeState) => void>();

/**
 * 入站 token（P0 决策 #1）：hub 现在要求 `bridge.hello` 带 token，否则拒绝握手。
 * 取值优先级（与桥接地址同思路）：
 *   ① URL 参数 `?bridgeToken=…`（自检脚本 / 开发者本机连自制 MCP 时用）；
 *   ② 桌面版：`window.desktop.getStatus() → mcp.token`（应用启动时生成并注入自己拉起的 MCP）。
 * 浏览器里两者都没有 → 不发 token（此时对方 MCP 必须关掉 token 校验，否则会被拒，
 * 这正是"默认拒绝"该有的表现，不是 bug）。
 */
let cachedToken: string | null | undefined;
/** 桌面侧"允许 MCP 写操作"（决策 #2）：null = 不知道（浏览器/还没读到）→ 三态文案用 */
let desktopWrite: boolean | null = null;

/** 读一次桌面状态，刷新 token 与写开关；菜单据此显示"已连接 · 写已禁用" */
async function refreshDesktopState(): Promise<void> {
  const d = desktopApi();
  if (!d) return;
  try {
    const s = await d.getStatus();
    desktopWrite = s.mcpWriteEnabled === true;
    if (s?.mcp?.token) cachedToken = s.mcp.token;
    notify();
  } catch {
    /* 拿不到就保持不知道 */
  }
}

/** 供首选项在切换写开关后主动刷新三态文案（不重连也能立刻更新） */
export async function refreshDesktopWriteState(): Promise<void> {
  await refreshDesktopState();
}

async function resolveBridgeToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  let token: string | null = null;
  try {
    const q = new URLSearchParams(location.search);
    const fromUrl = q.get('bridgeToken');
    if (fromUrl) token = fromUrl;
  } catch {
    /* 非浏览器环境 */
  }
  if (!token) {
    const d = desktopApi();
    if (d) {
      try {
        const s = await d.getStatus();
        if (s?.mcp?.token) token = s.mcp.token;
        desktopWrite = s.mcpWriteEnabled === true;
      } catch {
        /* 拿不到就不带 token */
      }
    }
  }
  cachedToken = token;
  return token;
}

export function bridgeStatus(): { state: BridgeState; url: string; reconnects: number; lastError: string | null; liveComponents: number; writeEnabled: boolean | null } {
  return { state, url, reconnects, lastError, liveComponents: getLiveTypes().length, writeEnabled: desktopWrite };
}

export function onBridgeState(cb: (s: BridgeState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/* ══════════════ 给 React 看的桥接状态（用户 2026-09-24 报的"菜单里还是未开启"）══════════════
   两个真问题：
     ① `state === 'off'` 同时表示"没开启"和"开了但没连上" → 菜单只能写"未开启"，说了假话；
     ② 菜单文案是**渲染那一刻**的快照，而桥接状态是模块级变量 —— 没有任何订阅，
        点完开关（弹窗说已开启）之后 React 不会重渲染，菜单就一直是旧的。
   下面给出：`useBridgeSummary()`（订阅 + 说真话的一句话）与 `waitBridgeSettled()`（别抢着弹"成功"）。 */

const subscribeBridge = (cb: () => void): (() => void) => onBridgeState(cb);

/**
 * 订阅用的**快照**：必须把"影响文案的每一项"都编进去。
 * ★真踩过（2026-09-28，自检抓到的真 bug，修了两次才对）：
 *   菜单文案 = `bridgeSummary()`，它同时依赖 `shouldRun`（决定"未开启"那一支）与 `reconnects`（"第 N 次重试"）。
 *   而这里是 `useSyncExternalStore` 的快照比较 —— 只比 `state` 的话：
 *     ① 关掉桥接时 `state` 往往**已经是 `'off'`**（之前连失败过），快照没变 → React **bail out**，菜单停在
 *        「✓MCP 桥接：连接中…（还没连上）」，明明关了还说开着；
 *     ② 重连次数增加时 `state` 也是 `'off' → 'connecting' → 'off'` 的快照，可能整段被跳过一次，文案不刷新。
 *   所以先把 `notify()` 补齐（让订阅者被叫到），再让快照带上 `shouldRun | state | reconnects`
 *   （让 React 认得出"真的变了"）。两件事缺一不可 —— 只做前者，React 仍然不重渲染。
 */
function bridgeSnapshot(): string {
  return `${shouldRun ? 'on' : 'off'}|${state}|${reconnects}|${desktopWrite === null ? '?' : desktopWrite ? 'w' : 'ro'}`;
}

export interface BridgeSummary {
  /** 开关是否被打开（`shouldRun`）—— 与"是否连上"是两件事 */
  on: boolean;
  state: BridgeState;
  /** 一句话状态（菜单直接用） */
  label: string;
  /** 补充信息（URL / 上次错误 / 重连次数） */
  detail: string;
}

/** 桥接状态的一句话摘要：**把"已开启但没连上"与"没开启"分开说** */
export function bridgeSummary(): BridgeSummary {
  const s = bridgeStatus();
  if (!shouldRun) return { on: false, state: s.state, label: '未开启', detail: s.lastError ? `上次：${s.lastError}` : '' };
  if (s.state === 'connected') {
    // ★三态之一：连上了、但 MCP 的写开关是关的 —— 必须如实说，否则用户会以为"能在 Live 里写"
    const readonly = s.writeEnabled === false;
    return {
      on: true,
      state: s.state,
      label: readonly ? `已连接 · 写已禁用（只读，${s.liveComponents} 个外部组件）` : `已连接（${s.liveComponents} 个外部组件）`,
      detail: readonly
        ? `${s.reconnects > 0 ? `已重连 ${s.reconnects} 次 · ` : ''}${s.url} · 写工具会被拒（首选项 → 允许 MCP 写操作）`
        : s.reconnects > 0
          ? `已重连 ${s.reconnects} 次 · ${s.url}`
          : s.url,
    };
  }
  if (s.state === 'connecting') return { on: true, state: s.state, label: '连接中…', detail: s.url };
  return {
    on: true,
    state: s.state,
    // 开了、但此刻不在连接中（连接失败后正在等下一次重试）
    label: s.reconnects > 1 ? `连接中…（第 ${s.reconnects} 次重试）` : '连接中…（还没连上）',
    detail: s.lastError ?? s.url,
  };
}

/** 订阅版摘要（菜单/状态栏用）：状态一变自动跟着变 */
export function useBridgeSummary(): BridgeSummary {
  // ★订阅的是"复合快照"而不是单个 state —— 理由见上面 bridgeSnapshot() 的注释
  useSyncExternalStore(subscribeBridge, bridgeSnapshot, bridgeSnapshot);
  return bridgeSummary();
}

/**
 * 等桥接状态**落定**再回报：连上 → 'connected'；超时/仍没连上 → 当前状态。
 * 用途：点开关后不要立刻弹"已开启"（那只是在说"我开始连了"），要等真连上或确认失败。
 */
export function waitBridgeSettled(timeoutMs = 2500): Promise<BridgeState> {
  return new Promise((resolve) => {
    if (!shouldRun || state === 'connected') {
      resolve(state);
      return;
    }
    let settled = false;
    const finish = (s: BridgeState): void => {
      if (settled) return;
      settled = true;
      off();
      window.clearTimeout(timer);
      resolve(s);
    };
    const off = onBridgeState((s) => {
      if (s === 'connected') finish(s);
    });
    const timer = window.setTimeout(() => finish(state), timeoutMs);
  });
}

/**
 * 通知订阅者。
 * ★为什么单独抽出来：`bridgeSummary()` 依赖的不只是 `state`，还有 `shouldRun`（"没开启" vs "开了但没连上"）。
 *   真踩过（2026-09-28，改自动连接时被自检抓到）：连接失败后 `state` 已经是 `'off'`，此时用户关掉桥接，
 *   `setState('off')` 因"值没变"直接 return → **一个通知都没发** → 菜单保持上一次渲染的
 *   「✓MCP 桥接：连接中…（还没连上）」——明明已经关了，菜单还说开着。所以凡是 `shouldRun` 变化的地方，
 *   都必须无条件 `notify()`，不能只靠 `setState`。
 */
function notify(): void {
  for (const cb of listeners) {
    try {
      cb(state);
    } catch {
      /* 单个订阅者出错不影响别人 */
    }
  }
}

function setState(next: BridgeState): void {
  if (state === next) return;
  state = next;
  notify();
}

/** 统一返回体（与 MCP 侧 Tool 的 data 对齐） */
type RpcReply = { id: string | null; ok: boolean; result?: unknown; error?: { code: string; message: string } };
const err = (id: string | null, code: string, message: string): RpcReply => ({ id, ok: false, error: { code, message } });
const okReply = (id: string | null, result: unknown): RpcReply => ({ id, ok: true, result });

/* ══════════════ 方法路由：MCP method → store action（实现见 liveMethods.ts） ══════════════ */

/** 方法路由：全部落在 liveMethods（返回体与无头通道同形） */
const route = (method: string, params: Record<string, unknown>): Promise<unknown> => routeLive(method, params);

/* ══════════════ 连接管理 ══════════════ */

function send(msg: unknown): void {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/** store 变化 → 推事件（订阅用） */
function pushEvents(): void {
  send({ event: 'document.changed', payload: { docId: useEditorStore.getState().doc.id } });
}
function pushSelection(): void {
  send({ event: 'selection.changed', payload: { ids: useEditorStore.getState().doc.selectedIds } });
}

let unsubDoc: (() => void) | null = null;
let unsubSel: (() => void) | null = null;

function subscribeStore(on: boolean): void {
  if (on) {
    unsubDoc = useEditorStore.subscribe((s, prev) => {
      if (s.doc !== prev.doc) pushEvents();
    });
    unsubSel = useEditorStore.subscribe((s, prev) => {
      if (s.doc.selectedIds !== prev.doc.selectedIds) pushSelection();
    });
  } else {
    unsubDoc?.();
    unsubSel?.();
    unsubDoc = null;
    unsubSel = null;
  }
}

function connect(): void {
  if (!shouldRun) return;
  setState('connecting');
  try {
    ws = new WebSocket(url);
  } catch (e) {
    lastError = String((e as Error)?.message ?? e);
    scheduleReconnect();
    return;
  }
  ws.addEventListener('open', () => {
    backoff = 1000;
    // 先解析 token 再发 hello（hub 侧 token 不对会直接 1008 关闭连接）。
    void (async () => {
      const token = await resolveBridgeToken();
      send({
        id: 'hello-1',
        method: 'bridge.hello',
        params: {
          role: 'editor',
          version: editorVersion,
          /* §5.1：`protocol` 是**桥接协议版本（数字）**，`features` 是能力集 ——
             MCP 侧据此判 Live 可用性（协议相同即可 Live，不再要求产品版本全等）。
             原来这里把 MCP 传输协议的日期串当 `protocol` 送，语义是错的（hub 当时也没用）。 */
          protocol: EDITOR_PROTOCOL,
          features: EDITOR_FEATURES,
          /** MCP 传输协议版本（给诊断看；与桥接协议是两回事） */
          mcpProtocol: MCP_PROTOCOL_VERSION,
          ...(token ? { token } : {}),
        },
      });
      setState('connected');
      subscribeStore(true);
      log.info('bridge', `已连接 MCP 桥接：${url}${token ? '（带 token）' : '（未带 token）'}`);
    })();
  });
  ws.addEventListener('message', (ev) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String((ev as MessageEvent).data)) as Record<string, unknown>;
    } catch {
      return;
    }
    // hub 对 hello 的回执：忽略（已经置 connected）
    if (msg.method === 'bridge.hello') return;
    const id = (msg.id as string | null) ?? null;
    if (typeof msg.method !== 'string') return;
    void route(msg.method, (msg.params as Record<string, unknown>) ?? {})
      .then((result) => send(okReply(id, result)))
      .catch((e: unknown) => {
        const m = String((e as Error)?.message ?? e);
        const code = /^[A-Z][A-Z_]{2,}:/.test(m) ? m.split(':')[0] : 'IO_ERROR';
        send(err(id, code, m.replace(/^[A-Z_]+:\s*/, '')));
      });
  });
  ws.addEventListener('error', () => {
    lastError = `连接失败：${url}`;
  });
  ws.addEventListener('close', () => {
    ws = null;
    subscribeStore(false);
    setState('off');
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (!shouldRun) return;
  const wait = backoff;
  backoff = Math.min(backoff * 2, 30_000);
  reconnects += 1;
  window.setTimeout(() => connect(), wait);
}

/** 菜单开关：开 → 连接 hub；关 → 断开 */
export function setBridgeEnabled(on: boolean, nextUrl?: string): void {
  if (nextUrl) url = nextUrl;
  if (on === shouldRun) return;
  shouldRun = on;
  if (on) {
    backoff = 1000;
    connect();
  } else {
    subscribeStore(false);
    try {
      ws?.close();
    } catch {
      /* 忽略 */
    }
    ws = null;
    setState('off');
    // ★`state` 可能本来就是 off（连接失败后）→ setState 不会通知，但菜单文案要跟着 shouldRun 变
    notify();
    log.info('bridge', '已关闭 MCP 桥接');
  }
}

export function isBridgeEnabled(): boolean {
  return shouldRun;
}

/** URL 参数 `?bridge=1` 用：启动时自动开启（便于无人值守验证） */
export function autoStartBridgeFromUrl(): void {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('bridge')) setBridgeEnabled(true, q.get('bridgeUrl') ?? undefined);
  } catch {
    /* 忽略 */
  }
}

/**
 * **启动时自动接入"应用带起来的那个 MCP 服务器"**（用户 2026-09-28 要求；开关在 首选项 → MCP 桥接）。
 *
 * 做法与取舍（都比"直接把 shouldRun 置 true"多一点）：
 *   · **先探测、再连**：端口上没人时不假装"已开启" —— 否则菜单会一直显示"连接中/重连中"，
 *     把"服务器没起"说成"正在连"，正是 2026-09-24 那次报过的假话问题的翻版；
 *   · **有界重试**（默认 0.3s / 2s / 5s / 10s / 20s 共 5 次）：桌面分发版是"先开窗、后拉 MCP 子进程"，
 *     页面往往比 MCP 先就绪；只探测一次会漏掉这个竞态。5 次之后不再打扰，菜单里可手动连；
 *   · **桌面版以应用配置为准**：桥接地址取 `window.desktop → mcp.bridgeUrl`（端口可配置），
 *     而不是写死 37650；浏览器里仍旧用默认地址；
 *   · 开关默认**开**；关掉时连探测都不做（`tried:false`），用户的关闭是本次会话的有效决定。
 */
export interface AutoBridgeResult {
  /** 是否真的去探测了（开关关着 / 已经开着 → false） */
  tried: boolean;
  /** 是否接上了 */
  connected: boolean;
  url: string;
  attempts: number;
  /** 给人看的结论（诊断面板/自检用） */
  reason: string;
}

/** 探测某个地址上有没有桥接中转（能建立 WebSocket 就算有；探完立刻断开，不发 hello） */
export function probeBridge(targetUrl: string, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        socket?.close();
      } catch {
        /* 已经关了 */
      }
      resolve(ok);
    };
    try {
      socket = new WebSocket(targetUrl);
    } catch {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    socket.addEventListener('open', () => {
      window.clearTimeout(timer);
      finish(true);
    });
    socket.addEventListener('error', () => {
      window.clearTimeout(timer);
      finish(false);
    });
  });
}

/** 桥接地址：显式给的 > 桌面版应用配置里的 > 默认值 */
async function resolveBridgeUrl(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const d = desktopApi();
  if (d) {
    try {
      const s = await d.getStatus();
      if (s?.mcp?.bridgeUrl) return s.mcp.bridgeUrl;
    } catch {
      /* 拿不到就用默认地址 */
    }
  }
  return url;
}

/**
 * 自动接入。返回结论而不是抛错 —— 调用方（main.tsx / 自检）都不该因为它失败而中断启动。
 * @param opts.url     指定桥接地址（自检用；缺省按上面的优先级解析）
 * @param opts.delays  每次探测前的等待（毫秒；自检可传小值让它快）
 */
export async function autoStartBridgeFromPrefs(opts: { url?: string; delays?: number[] } = {}): Promise<AutoBridgeResult> {
  const delays = opts.delays ?? [300, 2000, 5000, 10000, 20000];
  let enabled = false;
  try {
    enabled = useEditorStore.getState().ui.autoBridge === true;
  } catch {
    enabled = false;
  }
  if (!enabled) {
    return { tried: false, connected: false, url, attempts: 0, reason: '首选项里「启动时自动连接」是关的' };
  }
  if (shouldRun) {
    return { tried: false, connected: true, url, attempts: 0, reason: '已经开着（手动连过或 ?bridge=1 强制开）' };
  }

  const target = await resolveBridgeUrl(opts.url);
  for (let i = 0; i < delays.length; i += 1) {
    if (delays[i] > 0) await new Promise((r) => window.setTimeout(r, delays[i]));
    if (shouldRun) return { tried: true, connected: true, url: target, attempts: i + 1, reason: '期间已被手动打开' };
    if (await probeBridge(target)) {
      setBridgeEnabled(true, target);
      log.info('bridge', `检测到本机 MCP 服务器，已自动接入：${target}（第 ${i + 1} 次探测）`);
      return { tried: true, connected: true, url: target, attempts: i + 1, reason: '探测到桥接中转并已接入' };
    }
  }
  log.info('bridge', `没有检测到本机 MCP 服务器（探测 ${delays.length} 次：${target}）—— 可用「工具 → MCP 桥接」手动连`);
  return { tried: true, connected: false, url: target, attempts: delays.length, reason: '没探测到桥接中转（MCP 服务器没在运行？）' };
}

