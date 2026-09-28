/**
 * 「编辑器拉起的 MCP，被 agent 连上后到底能不能干活」的端到端检查（只读；不改任何文档内容）。
 *
 *   node scripts/agent-live-check.mjs [mcpPort=37651] [hubPort=37650]
 *
 * 站在 **agent 视角**走一遍真实链路：
 *   agent ──HTTP──> editor-mcp(编辑器拉起的那个) ──ws──> hub ──ws──> 编辑器页面 ──> 真实文档
 *
 * 判据为什么用 `doc.attach`：它是**Live 专属**工具（`src/tools/document.ts:100` 的 `liveOnly`），
 * 编辑器没接入桥接时**不会**悄悄降级到无头，而是如实报 `BRIDGE_OFFLINE`。所以它成功
 * ＝"agent 真能操作你正打开的那份文档"，而不是"能列出一堆工具但都在改磁盘"。
 *
 * 前置：可视化编辑器正在运行（它才会拉 MCP + 中转，页面才会自动接入桥接）。
 * 退出码 0 = 全通；1 = 有失败。
 *
 * P0 起 MCP 校验 token：本脚本自动取票（`EDITOR_MCP_TOKEN` → 桌面版 userData 的 bridge-token），
 * 并在开头打印来源；取不到 ticket 时会明说"401 = 没带票"而不是含糊地报"连不上"。
 */
import { noTokenHint, resolveBridgeToken } from './lib/bridge-token.mjs';

const MCP_PORT = Number(process.argv[2] ?? 37651);
const HUB_PORT = Number(process.argv[3] ?? 37650);
const MCP = `http://127.0.0.1:${MCP_PORT}/mcp`;

// P0 起 MCP 与 hub 都校验 token；本脚本连的是"应用正在跑的那个"，所以自动取票
const { token: BRIDGE_TOKEN, source: TOKEN_SOURCE } = resolveBridgeToken();

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

const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(BRIDGE_TOKEN ? { Authorization: `Bearer ${BRIDGE_TOKEN}` } : {}) };
let sid = null;
const post = async (body) => {
  const res = await fetch(MCP, { method: 'POST', headers: { ...HEADERS, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
  if (res.headers.get('mcp-session-id')) sid = res.headers.get('mcp-session-id');
  return { status: res.status, body: parseRpc(await res.text()) };
};
/** 取工具返回的 JSON（服务器把结果放在 content[0].text 里） */
const toolJson = (rpc) => {
  const text = rpc?.result?.content?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text ?? JSON.stringify(rpc) };
  }
};

console.log(`agent 视角：${MCP}（hub ${HUB_PORT}）\n`);
try {
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-live-check', version: '0.0.1' } } });
  if (!init.body?.result?.serverInfo) {
    console.log(`连不上 MCP（HTTP ${init.status}）—— 可视化编辑器没在运行？（它就是拉起 MCP 的那一方）`);
    process.exitCode = 1;
    process.exit();
  }
  await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  const info = init.body.result.serverInfo;
  console.log(`serverInfo=${JSON.stringify(info)}\n`);

  const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = list.body?.result?.tools ?? [];
  ok('agent 能列出工具表', tools.length > 100, `${tools.length} 个工具；含 doc.attach=${tools.some((t) => t.name === 'doc.attach')}`);

  const status = await post({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'editor://bridge/status' } });
  let st = null;
  try {
    st = JSON.parse(status.body?.result?.contents?.[0]?.text ?? 'null');
  } catch {
    /* 忽略 */
  }
  ok('MCP 侧看到 Live 就绪（编辑器页面已接入中转）', st?.ready === true && st?.mode === 'live', `connected=${st?.connected} ready=${st?.ready} mode=${st?.mode} hubOwner=${st?.hubOwner} situation=${st?.situation ?? ''}`);

  const attach = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'doc.attach', arguments: {} } });
  const a = toolJson(attach.body);
  /**
   * 断言口径：`ok:true` + 拿到 `docId` + `via:'live'` 就是"Live 成功"。
   * 不要把 `degraded` 写成 `=== false`：MCP 工具结果外层不一定带这个字段（实测 `degraded` 是 undefined，
   * 而 `data.via='live'` 已经把"走的是 Live 通道"说清了）。判据应是"没被降级"，即 `degraded !== true`。
   */
  ok(
    '★★ doc.attach（Live 专属）成功 —— 说明 agent 真能操作"你正打开的那份文档"',
    a?.ok === true && Boolean(a?.data?.docId) && (a?.data?.via === 'live' || a?.via === 'live') && a?.degraded !== true,
    `ok=${a?.ok} docId=${a?.data?.docId ?? '(无)'} title=${a?.data?.title ?? ''} via=${a?.data?.via ?? a?.via ?? ''} degraded=${a?.degraded} error=${a?.error ? JSON.stringify(a.error) : '无'}`,
  );

  const docs = await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'doc.list', arguments: { limit: 5 } } });
  const d = toolJson(docs.body);
  ok('agent 能列文档（Live 通道返回编辑器里的文档）', d?.ok === true, `ok=${d?.ok} 条数=${Array.isArray(d?.data?.docs) ? d.data.docs.length : '?'} via=${d?.data?.via ?? ''} degraded=${d?.degraded}`);

  const hub = await new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') return resolve({ note: `Node ${process.versions.node} 无内置 WebSocket` });
    const ws = new WebSocket(`ws://127.0.0.1:${HUB_PORT}/bridge`);
    const t = setTimeout(() => resolve({ note: 'hub 未回 hello' }), 5000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 'agent-check', method: 'bridge.hello', params: { role: 'verifier', version: '0.0.1', ...(BRIDGE_TOKEN ? { token: BRIDGE_TOKEN } : {}) } })));
    ws.addEventListener('message', (ev) => {
      clearTimeout(t);
      try {
        resolve(JSON.parse(String(ev.data)).result);
      } catch {
        resolve({ note: String(ev.data).slice(0, 100) });
      }
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(t);
      resolve({ note: `连不上 hub ${HUB_PORT}` });
    });
  });
  ok('中转 hub 报告编辑器在线', typeof hub?.editors === 'number' && hub.editors >= 1, JSON.stringify(hub));
} catch (e) {
  console.log(`\n异常：${String(e?.message ?? e)}`);
  process.exitCode = 1;
}

const bad = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - bad.length}/${results.length} 通过${bad.length ? ' —— 有失败' : ' 全部通过'}`);
if (bad.length) process.exitCode = 1;
