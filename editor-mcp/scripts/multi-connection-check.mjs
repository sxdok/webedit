/**
 * 多连接验证（只读脚本；只启动两个 MCP 子进程，不改任何配置）：
 *
 *   node scripts/multi-connection-check.mjs
 *
 * 验的是用户 2026-09-28 的要求「运行同时连接多个」在三层上是否成立：
 *   ① 中转 hub 层：多个 MCP 客户端 + 多个编辑器同时连在同一个 hub 上，请求/回包按 id 各自路由；
 *   ② MCP 进程层：**两个 editor-mcp 进程共用一个 hub** —— 第一个持有端口，第二个作为客户端接入，
 *      **两边都要能拿到 Live**（`hubOwner` 字段区分谁是地主）；
 *   ③ HTTP 会话层：同一个 MCP 上多个并发会话各自都能列出全部工具。
 *
 * 用独立端口（37750/37751/37752），绝不碰正在用的 37650/37651。
 *
 * 探针脚本里踩过的坑（避免以后又写错断言）：
 *   · **晚连**的 MCP 客户端不会收到 `bridge.editor` 事件 —— 它是从 hello 的**回执**里读到
 *     `editors` / `editorVersion` 的；事件只发给"编辑器接入/断开那一刻已经连着的"客户端。
 *     两种都要验，但要用对断言（本次第一版就写错了，看到 FAIL 才发现是脚本而不是产品的问题）。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(HERE, '..', 'dist', 'editor-mcp.bundle.mjs');

const HUB_PORT = 37750;
const A_PORT = 37751;
const B_PORT = 37752;
const HUB_URL = `ws://127.0.0.1:${HUB_PORT}/bridge`;

const results = [];
const ok = (name, pass, evidence = '') => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? `\n        → ${evidence}` : ''}`);
};

const parseRpc = (text) => {
  const payloads = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('data:')) payloads.push(t.slice(5).trim());
    else if (t.startsWith('{')) payloads.push(t);
  }
  for (let i = payloads.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(payloads[i]);
    } catch {
      /* 下一条 */
    }
  }
  return null;
};
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

/** 一个极简 MCP over HTTP 会话 */
function mcpHttp(port) {
  const url = `http://127.0.0.1:${port}/mcp`;
  let sid = null;
  const post = async (body) => {
    const res = await fetch(url, { method: 'POST', headers: { ...HEADERS, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
    if (res.headers.get('mcp-session-id')) sid = res.headers.get('mcp-session-id');
    return parseRpc(await res.text());
  };
  return {
    url,
    init: async () => {
      const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'multi-check', version: '0.0.1' } } });
      await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      return r;
    },
    tools: async () => (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }))?.result?.tools ?? [],
    read: async (uri) => {
      const r = await post({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri } });
      const text = r?.result?.contents?.[0]?.text;
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    },
  };
}

function startMcp(port, tag, lines) {
  const child = spawn(process.execPath, [BUNDLE, '--http', '--port', String(port)], {
    env: {
      ...process.env,
      EDITOR_MCP_BRIDGE_URL: HUB_URL,
      EDITOR_MCP_WORKSPACE: resolve(HERE, '..', 'workspace'),
      EDITOR_MCP_PLUGIN_DIR: resolve(HERE, '..', '..', 'web-editor', 'public', '组件'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => {
    for (const l of String(d).split('\n')) if (l.trim()) lines.push(`[${tag}] ${l.trim()}`);
  });
  return child;
}

const waitOpen = (ws) =>
  new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', rej);
  });

/** 假编辑器：连 hub、回包（制造"编辑器在线"） */
async function fakeEditor(version, counter) {
  const ws = new WebSocket(HUB_URL);
  await waitOpen(ws);
  ws.addEventListener('message', (ev) => {
    let msg = null;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (typeof msg.id === 'string' && msg.id.startsWith('hub-')) {
      counter.count += 1;
      counter.methods.push(msg.method);
      ws.send(JSON.stringify({ id: msg.id, ok: true, result: { echoed: msg.method } }));
    }
  });
  ws.send(JSON.stringify({ id: 'editor-hello', method: 'bridge.hello', params: { role: 'editor', version } }));
  await sleep(300);
  return ws;
}

/** 假 MCP 客户端：连 hub、记 hello 回执与事件、可发请求 */
async function fakeClient(tag) {
  const ws = new WebSocket(HUB_URL);
  await waitOpen(ws);
  const inbox = [];
  const events = [];
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.event) events.push(msg);
      else inbox.push(msg);
    } catch {
      /* 忽略 */
    }
  });
  ws.send(JSON.stringify({ id: `${tag}-hello`, method: 'bridge.hello', params: { role: 'mcp', version: '0.0.1' } }));
  for (let i = 0; i < 20 && !inbox.some((m) => m.id === `${tag}-hello`); i += 1) await sleep(100);
  const hello = inbox.find((m) => m.id === `${tag}-hello`) ?? null;
  const call = async (method, id) => {
    ws.send(JSON.stringify({ id, method, params: {} }));
    for (let i = 0; i < 40; i += 1) {
      const hit = inbox.find((m) => m.id === id);
      if (hit) return hit;
      await sleep(100);
    }
    return null;
  };
  return { ws, call, events, hello };
}

const logs = [];
const socks = [];
let a = null;
let b = null;
try {
  console.log(`用 bundle：${BUNDLE}\n`);

  // ① A 先起（应持有中转），② B 后起（应"接入既有中转"而不是报错）
  a = startMcp(A_PORT, 'A', logs);
  const A = mcpHttp(A_PORT);
  let aInit = null;
  for (let i = 0; i < 40 && !aInit; i += 1) {
    try {
      aInit = await A.init();
    } catch {
      await sleep(300);
    }
  }
  const version = aInit?.result?.serverInfo?.version ?? '0.2.0';
  ok('MCP A 启动并就绪（它持有中转）', Boolean(aInit?.result?.serverInfo), `serverInfo=${JSON.stringify(aInit?.result?.serverInfo)}`);

  b = startMcp(B_PORT, 'B', logs);
  const B = mcpHttp(B_PORT);
  let bInit = null;
  for (let i = 0; i < 40 && !bInit; i += 1) {
    try {
      bInit = await B.init();
    } catch {
      await sleep(300);
    }
  }
  ok('MCP B 在 hub 端口被 A 占着时仍然就绪（多实例共存）', Boolean(bInit?.result?.serverInfo), `serverInfo=${JSON.stringify(bInit?.result?.serverInfo)}`);

  // ③ 先连两个 MCP 客户端（为了验"事件广播"），此时还没有编辑器
  const c1 = await fakeClient('c1');
  const c2 = await fakeClient('c2');
  socks.push(c1.ws, c2.ws);
  ok('hub：客户端 hello 回执如实报告"当前没有编辑器"', c1.hello?.result?.editors === 0, `c1 hello.result=${JSON.stringify(c1.hello?.result)}`);

  // ④ 编辑器接入 → 已连的两个客户端都应收到 bridge.editor 事件
  const counter = { count: 0, methods: [] };
  const editorWs = await fakeEditor(version, counter);
  socks.push(editorWs);
  await sleep(700);
  const evAttach = (c) => c.events.map((e) => e.payload).find((p) => p?.editors === 1) ?? null;
  ok('hub：编辑器接入事件广播给**所有已连**的 MCP 客户端', Boolean(evAttach(c1)) && Boolean(evAttach(c2)), `c1 事件=${JSON.stringify(evAttach(c1))}；c2 事件=${JSON.stringify(evAttach(c2))}`);

  // ⑤ 两个 MCP 进程都应当拿到 Live（共用同一个中转）
  const aStatus = await A.read('editor://bridge/status');
  const bStatus = await B.read('editor://bridge/status');
  ok('MCP A 拿到 Live 且标记自己"持有中转"', aStatus?.connected === true && aStatus?.ready === true && aStatus?.mode === 'live' && aStatus?.hubOwner === true, `A：connected=${aStatus?.connected} ready=${aStatus?.ready} mode=${aStatus?.mode} hubOwner=${aStatus?.hubOwner}`);
  ok('MCP B **同样**拿到 Live，且如实标记"中转由别的实例持有"', bStatus?.connected === true && bStatus?.ready === true && bStatus?.mode === 'live' && bStatus?.hubOwner === false, `B：connected=${bStatus?.connected} ready=${bStatus?.ready} mode=${bStatus?.mode} hubOwner=${bStatus?.hubOwner}`);

  // ⑥ hub 层路由：两个客户端并发请求 → 同一个编辑器，各自拿回自己的回包
  const [r1, r2] = await Promise.all([c1.call('document.get', 'c1-req'), c2.call('selection.get', 'c2-req')]);
  ok('hub：两个客户端并发请求各自拿到自己的回包（按 id 路由）', r1?.result?.echoed === 'document.get' && r2?.result?.echoed === 'selection.get', `c1 → ${JSON.stringify(r1?.result)}；c2 → ${JSON.stringify(r2?.result)}；编辑器收到 ${counter.count} 个请求：${counter.methods.join(', ')}`);

  // ⑦ 晚连的客户端靠 hello 回执拿状态（事件它收不到，这是设计如此）
  const c3 = await fakeClient('c3');
  socks.push(c3.ws);
  ok('hub：**晚连**的客户端从 hello 回执就知道编辑器已在线（含版本）', c3.hello?.result?.editors === 1 && c3.hello?.result?.editorVersion === version, `c3 hello.result=${JSON.stringify(c3.hello?.result)}`);

  // ⑧ 同一个 MCP 上两个并发会话
  const S1 = mcpHttp(A_PORT);
  const S2 = mcpHttp(A_PORT);
  await S1.init();
  await S2.init();
  const [t1, t2] = await Promise.all([S1.tools(), S2.tools()]);
  ok('同一个 MCP 上两个并发会话各自列出全部工具', t1.length > 100 && t2.length > 100, `会话1=${t1.length} 个工具；会话2=${t2.length} 个工具`);

  // ⑨ 日志口径：B 不该出现"未能启动"这种像故障的说法
  const bLogs = logs.filter((l) => l.startsWith('[B]'));
  const bSaysAttached = bLogs.some((l) => /检测到既有桥接中转|中转由其它实例持有/.test(l));
  const bSaysBroken = bLogs.some((l) => /桥接中转未能启动/.test(l));
  ok('日志把"接入既有中转"说成正常状态（不是"未能启动"）', bSaysAttached && !bSaysBroken, `B 的桥接日志：${bLogs.filter((l) => /中转|桥接/.test(l)).map((l) => l.replace(/^\[B\]\s*/, '').slice(0, 90)).join(' ｜ ') || '(无)'}`);

  console.log('\n── 关键日志 ──');
  for (const l of logs.filter((x) => /中转/.test(x)).slice(0, 6)) console.log(`  ${l}`);
} finally {
  for (const s of socks) {
    try {
      s.close();
    } catch {
      /* 忽略 */
    }
  }
  for (const c of [a, b]) {
    try {
      c?.kill();
    } catch {
      /* 忽略 */
    }
  }
  await sleep(500);
}

const bad = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - bad.length}/${results.length} 通过${bad.length ? ' —— 有失败' : ' 全部通过'}`);
process.exitCode = bad.length ? 1 : 0;
