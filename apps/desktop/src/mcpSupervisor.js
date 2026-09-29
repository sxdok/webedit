/**
 * editor-mcp 子进程监管：**软件启动时把 MCP 服务器带起来**，供外部 AI 客户端连接；
 * 应用退出时收干净，不让它变成孤儿进程。
 *
 * 形态选择：`editor-mcp --http --port <n>`（Streamable HTTP，端点 `/mcp`），因为
 *   · 外部 AI 客户端（Claude Desktop、Cherry Studio、自研 agent…）只要填一个 URL 就能连；
 *   · stdio 模式仍然保留：想用 stdio 的客户端直接 `node editor-mcp/dist/index.js --stdio`。
 *
 * 几个真踩过的坑，都在代码里落实了：
 *   ① **端口被上一次的残留进程占着**：不硬抢，先做一次真正的 `initialize` 握手探测；
 *      能通就"接管"（external=true）并如实报告，避免出现第二个 MCP 把桥接端口抢掉。
 *   ② **子进程 stdout 是 JSON-RPC 通道**（stdio 模式下），HTTP 模式下它只往 stderr 打日志 —— 
 *      两路都收进日志文件，出问题时不用猜。
 *   ③ **崩溃循环**：连续崩溃 N 次后停止重启并标记 failed，而不是无限重启刷日志。
 *   ④ 用的是 Electron 自带的 Node（`ELECTRON_RUN_AS_NODE=1`），**分发版机器上不需要装 node**。
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import { MCP_PROTOCOL_VERSION, VERSION } from './version.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * 探测/握手时自报的客户端身份。
 * 版本**来自生成物**（`./version.js`，P3-M9 起；唯一源是根 `package.json`），
 * `main.js` 启动时还会用 `app.getVersion()` 覆盖一次（打包态以 exe 为准）。
 */
/** 客户端自报名（P3.5 起用 ASCII 标识 `webedit`；界面显示名仍是「可视化编辑器」） */
const MCP_CLIENT_NAME = 'webedit';
let clientVersion = VERSION;
const mcpClientInfo = () => ({ name: MCP_CLIENT_NAME, version: clientVersion });
/** 覆盖自报版本（main.js 启动时调用；测试脚本也可用） */
export function setClientVersion(v) {
  if (v) clientVersion = String(v);
}
/** 我们说的那版 MCP 规范（同样来自生成物，不在各处手写） */
const PROTOCOL_VERSION = MCP_PROTOCOL_VERSION;

/**
 * 入站 token（P0 决策 #1）。
 *   · 桌面版：读/建 `userData/bridge-token` 后传进来（持久，agent 侧配置要用它）；
 *   · 没传（verify / 单测等非 Electron 场景）：为本次进程生成一个随机 token，保证
 *     「子进程环境」与「探测请求」用同一把，行为与生产一致。
 */
export function newBridgeToken() {
  return randomBytes(24).toString('base64url');
}

/** 一次 JSON-RPC over Streamable HTTP 请求；返回 { ok, status, sessionId, body } */
export async function mcpRequest(url, { body, sessionId, method = 'POST', timeoutMs = 4000, accept = 'application/json, text/event-stream', token } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        // P0：token 强制后，本应用自己的探测/会话也必须带上（缺了会 401）
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, sessionId: res.headers.get('mcp-session-id') ?? null, body: text };
  } catch (e) {
    return { ok: false, status: 0, sessionId: null, body: '', error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析 MCP 的 HTTP 响应体：**可能是纯 JSON，也可能是 SSE**（`event: message` + `data: {...}`）。
 * 真踩过：只认"以 `{` 开头的行"会漏掉 `data: {...}`，于是 initialize 明明成功、`serverInfo` 却是 null，
 * tools/list 数出来 0 个工具 —— 看起来像"工具没注册"，其实是解析写错了。
 */
export function parseRpcBody(text) {
  const payloads = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('data:')) payloads.push(t.slice(5).trim());
    else if (t.startsWith('{')) payloads.push(t);
  }
  for (let i = payloads.length - 1; i >= 0; i -= 1) {
    try {
      const j = JSON.parse(payloads[i]);
      if (j && typeof j === 'object') return j;
    } catch {
      /* 试下一条 */
    }
  }
  try {
    return JSON.parse(String(text ?? '').trim());
  } catch {
    return null;
  }
}

/** 真握手：能拿到 result 才算"这个端口上跑着 MCP"；顺手把探测用的会话关掉 */
export async function probeMcp(url, { timeoutMs = 4000, token } = {}) {
  const init = await mcpRequest(url, {
    timeoutMs,
    token,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: mcpClientInfo() } },
  });
  const parsed = parseRpcBody(init.body);
  if (!init.ok || !parsed?.result) {
    return { ok: false, status: init.status, error: init.error ?? (init.body ? init.body.slice(0, 200) : 'HTTP 已通但 initialize 没返回 result') };
  }
  const info = parsed.result;
  if (init.sessionId) await mcpRequest(url, { method: 'DELETE', sessionId: init.sessionId, timeoutMs: 2000, token });
  return { ok: true, sessionId: init.sessionId, serverInfo: info?.serverInfo ?? null, protocolVersion: info?.protocolVersion ?? null };
}

/**
 * @param {object} o
 * @param {string} o.nodeBin       跑子进程的可执行文件（分发版用 Electron 自带的 Node）
 * @param {Record<string,string>} [o.nodeEnv]
 * @param {string} o.mcpEntry      editor-mcp/dist/index.js
 * @param {string} [o.mcpRoot]     子进程 cwd（相对路径解析用）
 * @param {string} o.host
 * @param {number} o.port
 * @param {number} o.bridgePort
 * @param {string} o.workspace     无头文档目录
 * @param {string} [o.pluginDir]
 * @param {boolean} [o.allowWrite]
 * @param {number} [o.readyTimeoutMs]
 * @param {boolean} [o.autoRestart]
 */
export function createMcpSupervisor({
  nodeBin,
  nodeEnv = {},
  mcpEntry,
  mcpRoot,
  host = '127.0.0.1',
  port,
  bridgePort,
  workspace,
  pluginDir,
  allowWrite = true,
  readyTimeoutMs = 20000,
  autoRestart = true,
  maxRestarts = 5,
  token,
  logger,
}) {
  const url = `http://${host}:${port}/mcp`;
  /** 本实例实际使用的 token：调用方没给就随机生成（子进程环境与探测用同一把） */
  const bridgeToken = token && String(token).trim() ? String(token).trim() : newBridgeToken();
  /** 生效的写开关（可被 setAllowWrite 改；重启子进程时生效） */
  let allowWriteValue = allowWrite === true;
  const state = {
    state: 'stopped', // stopped | starting | ready | restarting | failed
    pid: null,
    external: false,
    restarts: 0,
    lastError: null,
    serverInfo: null,
    startedAt: null,
    exits: [],
    url,
    probe: null,
  };
  let child = null;
  let stopping = false;
  let restartTimer = null;
  let startPromise = null;
  const listeners = new Set();

  const emit = () => {
    const snap = status();
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {
        /* 监听者自己的问题不影响监管 */
      }
    }
    return snap;
  };
  const set = (patch) => {
    Object.assign(state, patch);
    return emit();
  };
  const status = () => ({
    state: state.state,
    pid: state.pid,
    external: state.external,
    restarts: state.restarts,
    lastError: state.lastError,
    serverInfo: state.serverInfo,
    startedAt: state.startedAt,
    url,
    bridgeUrl: `ws://${host}:${bridgePort}/bridge`,
    /** 页面用它在 bridge.hello 里带 token；main.js 也用它生成「一键复制客户端配置」 */
    token: bridgeToken,
    probe: state.probe,
  });

  function onLine(stream, text) {
    for (const ln of String(text).split(/\r?\n/)) {
      if (!ln.trim()) continue;
      logger?.[stream === 'stderr' ? 'debug' : 'info']?.(`[mcp:${stream}] ${ln.trim()}`);
    }
  }

  function spawnChild() {
    const env = {
      ...process.env,
      ...nodeEnv,
      EDITOR_MCP_BRIDGE_URL: `ws://${host}:${bridgePort}/bridge`,
      EDITOR_MCP_WORKSPACE: workspace,
      EDITOR_MCP_ALLOW_WRITE: allowWriteValue ? 'true' : 'false',
      // P0：入站鉴权 token（决策 #1）。缺 token 时 MCP 会拒绝所有入站请求；agent 侧需补 headers.Authorization
      EDITOR_MCP_TOKEN: bridgeToken,
      EDITOR_MCP_REQUIRE_TOKEN: 'true',
      ...(pluginDir ? { EDITOR_MCP_PLUGIN_DIR: pluginDir } : {}),
    };
    logger?.info(`拉起 editor-mcp：${nodeBin} ${mcpEntry} --http --port ${port}（workspace=${workspace}）`);
    child = spawn(nodeBin, [mcpEntry, '--http', '--port', String(port)], {
      cwd: mcpRoot ?? undefined,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => onLine('stdout', d));
    child.stderr.on('data', (d) => onLine('stderr', d));
    child.on('error', (e) => {
      state.lastError = `子进程启动失败：${e.message}`;
      logger?.error(state.lastError);
    });
    child.on('exit', (code, signal) => {
      const wasChild = child;
      child = null;
      const rec = { at: new Date().toISOString(), code, signal };
      state.exits.push(rec);
      if (state.exits.length > 10) state.exits.shift();
      logger?.warn(`editor-mcp 退出：code=${code} signal=${signal}${stopping ? '（应用正在退出，属正常）' : ''}`);
      state.pid = null;
      if (stopping || wasChild === null) return;
      state.lastError = `editor-mcp 意外退出（code=${code}${signal ? `, signal=${signal}` : ''}）`;
      if (autoRestart && state.restarts < maxRestarts) {
        state.restarts += 1;
        const delay = Math.min(8000, 500 * 2 ** (state.restarts - 1));
        set({ state: 'restarting' });
        logger?.warn(`${delay}ms 后第 ${state.restarts}/${maxRestarts} 次重启 editor-mcp`);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          void start({ adopt: false });
        }, delay);
      } else {
        set({ state: 'failed' });
        logger?.error(`editor-mcp 连续失败 ${state.restarts} 次，已停止自动重启（可在菜单里手动重启 MCP 服务）`);
      }
    });
    state.pid = child.pid ?? null;
  }

  /** 等它真的能握手；期间每 400ms 探一次 */
  async function waitReady() {
    const deadline = Date.now() + readyTimeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await probeMcp(url, { timeoutMs: 2500, token: bridgeToken });
      state.probe = last;
      if (last.ok) return last;
      if (!child && state.state !== 'restarting') return last; // 进程已经死了，不用再等
      await sleep(400);
    }
    return last;
  }

  /**
   * 启动。`adopt`（默认 true）为真时，先探测端口上是否已有可用的 MCP：
   * 有就接管，不重复拉起 —— 应用重启后旧进程还没退干净时特别重要。
   */
  async function start({ adopt = true } = {}) {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      stopping = false;
      if (state.state === 'ready' && (child || state.external)) return status();
      set({ state: 'starting', lastError: null });
      try {
        mkdirSync(workspace, { recursive: true });
      } catch (e) {
        logger?.warn(`无头文档目录建不出来（${workspace}）：${e instanceof Error ? e.message : String(e)}`);
      }

      if (adopt) {
        const found = await probeMcp(url, { timeoutMs: 1500, token: bridgeToken });
        if (found.ok) {
          /**
           * ★只有在**版本一致**时才接管。
           * 真踩过的风险（审计 2026-09-28）：原来只要端口上能握手就接管 —— 同一台机器上另一个
           * 版本（旧安装版、或 DSH 自己拉起的实例）占着 37651 时，本应用会静默把 agent 接到
           * **那个实例**上：它读写的 workspace、它注册的工具表都不是本应用的，界面还显示"就绪"。
           * 版本不一致就明确失败并说清怎么处理，而不是"看起来能用、实际连错了人"。
           */
          const foundVersion = found.serverInfo?.version ?? null;
          if (foundVersion !== null && foundVersion !== clientVersion) {
            const msg = `端口 ${port} 上已有一个 editor-mcp v${foundVersion}（本应用 v${clientVersion}），**拒绝接管**：接管会让 agent 连到那个实例的工具表与工作区。请关掉那个实例，或在加密配置里改 mcp.httpPort（同时改 agent 侧的 URL）。`;
            state.exits = [];
            set({ state: 'failed', external: false, serverInfo: found.serverInfo, lastError: msg, probe: found });
            logger?.error(msg);
            return status();
          }
          state.exits = [];
          set({ state: 'ready', external: true, serverInfo: found.serverInfo, startedAt: new Date().toISOString(), restarts: 0, probe: found });
          logger?.info(`端口 ${port} 上已有可用且版本一致的 editor-mcp（v${foundVersion ?? '?'}，外部进程），直接接管：${url}`);
          return status();
        }
      }

      spawnChild();
      const ok = await waitReady();
      if (ok?.ok) {
        set({ state: 'ready', external: false, serverInfo: ok.serverInfo, startedAt: new Date().toISOString(), restarts: 0 });
        logger?.info(`editor-mcp 已就绪：${url}（pid=${state.pid}）`);
      } else {
        set({ state: 'failed', lastError: `等 ${readyTimeoutMs}ms 仍未就绪：${ok?.error ?? '无响应'}` });
        logger?.error(state.lastError);
      }
      return status();
    })();
    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop({ keepExternal = true } = {}) {
    stopping = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    const c = child;
    if (!c) {
      set({ state: 'stopped', pid: null, ...(keepExternal ? {} : { external: false }) });
      return;
    }
    logger?.info(`停止 editor-mcp（pid=${c.pid}）`);
    await new Promise((resolve) => {
      const done = () => resolve();
      const timer = setTimeout(() => {
        try {
          c.kill('SIGKILL');
          logger?.warn('editor-mcp 未在 3s 内退出，已强杀');
        } catch {
          /* 已经退出了 */
        }
        done();
      }, 3000);
      c.once('exit', () => {
        clearTimeout(timer);
        done();
      });
      try {
        c.kill('SIGTERM');
      } catch {
        clearTimeout(timer);
        done();
      }
    });
    state.exits = [];
    set({ state: 'stopped', pid: null, restarts: 0 });
  }

  return {
    url,
    start,
    stop,
    status,
    probe: (opts) => probeMcp(url, { token: bridgeToken, ...opts }),
    onStatus: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** 手动重启（菜单用）：无论当前是 external 还是 child，都先停再起 */
    async restart() {
      await stop();
      state.restarts = 0;
      return start({ adopt: false });
    },
    /**
     * 改"允许写"开关（决策 #2）：只改内存里的值，**下次启动/重启子进程时生效**。
     * 调用方（首选项开关）负责紧接着 `restart()`，否则界面上会显示新状态而 MCP 还是旧行为。
     */
    setAllowWrite(value) {
      allowWriteValue = value === true;
    },
    /** 当前生效的写开关（供状态显示与断言） */
    allowWrite: () => allowWriteValue,
  };
}
