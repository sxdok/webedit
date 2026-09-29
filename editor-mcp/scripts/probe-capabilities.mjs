/**
 * 只读探测：我们的 editor-mcp 在 `initialize` 里**有没有声明 tools 能力**，
 * 以及 tools/list 实际返回多少工具。
 *
 * 为什么单独查这个：官方 `dsh-mcp-client` 的工具发现是
 *   `client.getServerCapabilities()?.tools === undefined ? { tools: [] } : await client.listTools(...)`
 * —— 服务器只要**没声明 tools 能力**，客户端就**静默**注册 0 个工具（不报错），
 * 表现就是"服务器连上了、但探测不到工具"。
 *
 * 用法：node .probe-capabilities.mjs [bundlePath] [port]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ★P3-M2：唯一一份单文件 MCP 在仓库根 dist/mcp（原来这里还写死了绝对路径）
const BUNDLE = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'mcp', 'editor-mcp.bundle.mjs');
const PORT = Number(process.argv[3] ?? 37661);
const URL_ = `http://127.0.0.1:${PORT}/mcp`;
/**
 * ★P0 起 **token 是强制的**：本脚本自己生成一把注入子进程，并在每个请求里带上。
 * 不带的表现是「服务器已开启 token 校验…拒绝服务」→ 探针永远得到 401、却看不出哪里错（它自 P0 起就静默失效了）。
 */
const TOKEN = `caps-probe-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

const child = spawn(process.execPath, [BUNDLE, '--http', '--port', String(PORT)], {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, EDITOR_MCP_BRIDGE_HUB: '0', EDITOR_MCP_TOKEN: TOKEN },
});
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));

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
const H = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}` };
const post = async (body, sid) => {
  const res = await fetch(URL_, { method: 'POST', headers: { ...H, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
  return { sid: res.headers.get('mcp-session-id') ?? sid, status: res.status, body: parseRpc(await res.text()) };
};

try {
  // 等端口起来
  for (let i = 0; i < 30; i += 1) {
    try {
      await fetch(URL_, { method: 'POST', headers: H, body: '{}' });
      break;
    } catch {
      await sleep(300);
    }
  }
  const t0 = Date.now();
  const init = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'caps-probe', version: '0.0.1' } },
  });
  const initMs = Date.now() - t0;
  const sid = init.sid;
  const caps = init.body?.result?.capabilities;
  console.log(`initialize → HTTP ${init.status}，耗时 ${initMs}ms`);
  console.log(`serverInfo = ${JSON.stringify(init.body?.result?.serverInfo)}`);
  console.log(`capabilities = ${JSON.stringify(caps)}`);
  console.log(`★ capabilities.tools 存在？ ${caps && 'tools' in caps ? '是 ✅' : '否 ❌（官方客户端会据此静默注册 0 个工具）'}`);

  if (sid) {
    await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sid);
    const t1 = Date.now();
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sid);
    const tools = list.body?.result?.tools ?? [];
    console.log(`tools/list → ${tools.length} 个工具，耗时 ${Date.now() - t1}ms`);
    console.log(`前 3 个：${tools.slice(0, 3).map((t) => t.name).join(', ')}`);
    await post({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} }, sid);
  }
  if (stderr.trim()) console.log(`\n服务器 stderr（尾部）：\n${stderr.trim().split('\n').slice(-4).join('\n')}`);
} finally {
  child.kill();
  await sleep(400);
}
