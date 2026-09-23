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

const BRIDGE_URL_DEFAULT = 'ws://127.0.0.1:37650/bridge';
let url = BRIDGE_URL_DEFAULT;

export type BridgeState = 'off' | 'connecting' | 'connected';
let state: BridgeState = 'off';
let ws: WebSocket | null = null;
let backoff = 1000;
let shouldRun = false;
let reconnects = 0;
let lastError: string | null = null;
let editorVersion = '0.1.0';
const listeners = new Set<(s: BridgeState) => void>();

export function bridgeStatus(): { state: BridgeState; url: string; reconnects: number; lastError: string | null; liveComponents: number } {
  return { state, url, reconnects, lastError, liveComponents: getLiveTypes().length };
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
const getBridgeState = (): BridgeState => state;

/** 订阅桥接状态：状态一变（connecting/connected/off）就触发重渲染 */
export function useBridgeState(): BridgeState {
  return useSyncExternalStore(subscribeBridge, getBridgeState, getBridgeState);
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
    return {
      on: true,
      state: s.state,
      label: `已连接（${s.liveComponents} 个外部组件）`,
      detail: s.reconnects > 0 ? `已重连 ${s.reconnects} 次 · ${s.url}` : s.url,
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
  useBridgeState();
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

function setState(next: BridgeState): void {
  if (state === next) return;
  state = next;
  listeners.forEach((cb) => cb(next));
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
    send({ id: 'hello-1', method: 'bridge.hello', params: { role: 'editor', version: editorVersion, protocol: '2025-06-18' } });
    setState('connected');
    subscribeStore(true);
    log.info('bridge', `已连接 MCP 桥接：${url}`);
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
 * **首选项里的"启动时自动连接"**（`ui.autoBridge`，用户 2026-09-24 要求做成开关）。
 * 与 `?bridge=1` 的分工：这个开关是用户可见、随 ui 持久化的设置；URL 参数仍然强制开（无人值守验证用）。
 * 只负责"开"，不负责"关" —— 用户手动断开后不该被下一次启动逻辑立刻又连上（他关的是本次会话）。
 */
export function autoStartBridgeFromPrefs(): void {
  try {
    if (useEditorStore.getState().ui.autoBridge === true && !shouldRun) setBridgeEnabled(true);
  } catch {
    /* 忽略 */
  }
}
