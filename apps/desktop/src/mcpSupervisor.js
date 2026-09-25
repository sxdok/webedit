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
import { mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MCP_CLIENT_INFO = { name: 'visual-editor-desktop', version: '0.1.0' };
const PROTOCOL_VERSION = '2025-06-18';

/** 一次 JSON-RPC over Streamable HTTP 请求；返回 { ok, status, sessionId, body } */
export async function mcpRequest(url, { body, sessionId, method = 'POST', timeoutMs = 4000, accept = 'application/json, text/event-stream' } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
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
export async function probeMcp(url, { timeoutMs = 4000 } = {}) {
  const init = await mcpRequest(url, {
    timeoutMs,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: MCP_CLIENT_INFO } },
  });
  const parsed = parseRpcBody(init.body);
  if (!init.ok || !parsed?.result) {
    return { ok: false, status: init.status, error: init.error ?? (init.body ? init.body.slice(0, 200) : 'HTTP 已通但 initialize 没返回 result') };
  }
  const info = parsed.result;
  if (init.sessionId) await mcpRequest(url, { method: 'DELETE', sessionId: init.sessionId, timeoutMs: 2000 });
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
  logger,
}) {
  const url = `http://${host}:${port}/mcp`;
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
      EDITOR_MCP_ALLOW_WRITE: allowWrite ? 'true' : 'false',
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
      last = await probeMcp(url, { timeoutMs: 2500 });
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
        const found = await probeMcp(url, { timeoutMs: 1500 });
        if (found.ok) {
          state.exits = [];
          set({ state: 'ready', external: true, serverInfo: found.serverInfo, startedAt: new Date().toISOString(), restarts: 0, probe: found });
          logger?.info(`端口 ${port} 上已有可用的 editor-mcp（外部进程），直接接管：${url}`);
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
    probe: (opts) => probeMcp(url, opts),
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
  };
}
