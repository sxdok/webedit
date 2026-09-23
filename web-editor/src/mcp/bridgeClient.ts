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
