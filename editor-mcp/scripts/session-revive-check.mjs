/**
 * 会话复活回归（只读；只起/停 MCP 子进程）：
 *
 *   node scripts/session-revive-check.mjs
 *
 * 复现的真事故（2026-09-28）：编辑器每次启动都会拉起**新的** editor-mcp 进程，而 agent 侧
 * （DSH 的 dsh-mcp-client）只在**传输层关闭**时才重连、不会因为一次请求失败就重新 initialize。
 * 于是它一直拿着**上一个进程**的 `mcp-session-id` 发请求：
 *   · 老实现 → HTTP 400 + `{"code":-32000,"message":"服务器当前无此会话…"}`，
 *     客户端把它当"工具报错"，于是 agent **永久卡死**（实测报
 *     `Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32000,…}}`）；
 *   · 新实现 → 服务端按同一个 id **复活会话**（内部合成一次 initialize）后照常服务。
 *
 * 断言口径：用旧 id 发 tools/list 必须拿到 200 + 全部工具，且服务端日志明确说"已在服务端按同一 id 复活"。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(HERE, '..', 'dist', 'editor-mcp.bundle.mjs');
const PORT = 37753;
const URL_ = `http://127.0.0.1:${PORT}/mcp`;
/** P0 起 token 强制：本脚本自带 MCP 子进程，自己生成一把并全程带上 */
const TOKEN = `tok-${randomBytes(12).toString('hex')}`;

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
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}` };
const post = async (body, sid) => {
  const res = await fetch(URL_, { method: 'POST', headers: { ...HEADERS, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, sid: res.headers.get('mcp-session-id'), body: parseRpc(await res.text()) };
};

const logs = [];
const startMcp = () => {
  const child = spawn(process.execPath, [BUNDLE, '--http', '--port', String(PORT)], {
    env: { ...process.env, EDITOR_MCP_BRIDGE_HUB: '0', EDITOR_MCP_WORKSPACE: resolve(HERE, '..', 'workspace'), EDITOR_MCP_TOKEN: TOKEN, EDITOR_MCP_REQUIRE_TOKEN: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => {
    for (const l of String(d).split('\n')) if (l.trim()) logs.push(l.trim());
  });
  return child;
};
const waitReady = async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'warmup', version: '0' } } });
      if (r.status === 200 && r.sid) return r.sid;
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  return null;
};

let first = null;
let second = null;
try {
  // ① 第一个进程：正常握手，拿到会话 id
  first = startMcp();
  const sid = await waitReady();
  ok('第一个 MCP 进程正常握手并给出会话 id', Boolean(sid), `sid=${sid}`);
  const before = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, sid);
  const beforeCount = before.body?.result?.tools?.length ?? 0;
  ok('第一个进程里带会话 id 调用正常', before.status === 200 && beforeCount > 100, `HTTP ${before.status}，工具 ${beforeCount} 个`);

  // ② 杀掉它（模拟"编辑器关掉/重开"→ MCP 换代）
  first.kill();
  first = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      await fetch(URL_, { method: 'POST', headers: HEADERS, body: '{}' });
      await sleep(200);
    } catch {
      break;
    }
  }

  // ③ 起第二个进程（新会话表是空的），客户端继续用**旧 id** 发请求
  second = startMcp();
  await waitReady();
  const stale = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sid);
  const staleCount = stale.body?.result?.tools?.length ?? 0;
  ok(
    '★用**上一个进程的会话 id** 继续调用：服务端复活会话并正常返回（agent 不会卡死）',
    stale.status === 200 && staleCount > 100,
    `HTTP ${stale.status}，工具 ${staleCount} 个；错误=${stale.body?.error ? JSON.stringify(stale.body.error) : '无'}`,
  );
  ok('复活后会话 id 与客户端手里的一致（客户端无需改动）', stale.sid === undefined || stale.sid === sid, `响应头 mcp-session-id=${stale.sid ?? '(未返回)'}`);

  // ④ 真实工具调用也能过（不是只有 tools/list）
  const call = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doc.list', arguments: { limit: 1 } } }, sid);
  const text = call.body?.result?.content?.[0]?.text ?? '';
  ok('旧 id 上真实工具调用成功', call.status === 200 && /"ok"\s*:\s*true/.test(text), `HTTP ${call.status}；回包片段=${text.slice(0, 120) || JSON.stringify(call.body?.error)}`);

  // ⑤ 新客户端照旧（不能为了自愈把正常路径弄坏）
  const fresh = await post({ jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fresh', version: '1' } } });
  ok('全新客户端仍走正常握手（新会话 id 与旧的无关）', fresh.status === 200 && Boolean(fresh.sid) && fresh.sid !== sid, `HTTP ${fresh.status} sid=${fresh.sid}`);

  ok(
    '日志把"旧会话自愈"说清楚了（不是静默装作没发生）',
    logs.some((l) => /上一代进程的会话 id/.test(l)),
    logs.filter((l) => /会话/.test(l)).slice(0, 3).map((l) => l.slice(0, 110)).join(' ｜ ') || '(无)',
  );
} finally {
  for (const c of [first, second]) {
    try {
      c?.kill();
    } catch {
      /* 忽略 */
    }
  }
  await sleep(400);
}

const bad = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - bad.length}/${results.length} 通过${bad.length ? ' —— 有失败' : ' 全部通过'}`);
process.exitCode = bad.length ? 1 : 0;
