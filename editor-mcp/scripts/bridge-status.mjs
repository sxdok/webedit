/**
 * 桥接/Live 通道体检（只读）：一次看清"页面 ↔ hub ↔ MCP"三段到底通没通。
 *
 * 为什么需要它：`editor://bridge/status` 报的是 **MCP 侧**（liveBridge → hub）的健康度，
 * 而"编辑器页面有没有接上 hub"只有 hub 自己知道（向 hub 发 `bridge.hello` 回执里有 `editors`）。
 * 两个都看，才能判定 Live 能不能用；只看一个会得出相反结论。
 *
 * 用法：
 *   node scripts/bridge-status.mjs                 # 默认 MCP 37651 / hub 37650
 *   node scripts/bridge-status.mjs 37652 37653     # 自定义端口
 *
 * 需要 Node ≥22（内置 WebSocket，用来问 hub）。
 */
const MCP_PORT = Number(process.argv[2] ?? 37651);
const HUB_PORT = Number(process.argv[3] ?? 37650);
const MCP = `http://127.0.0.1:${MCP_PORT}/mcp`;
const HUB = `ws://127.0.0.1:${HUB_PORT}/bridge`;

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

const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const post = async (body, sid) => {
  const res = await fetch(MCP, { method: 'POST', headers: { ...headers, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
  return { sid: res.headers.get('mcp-session-id') ?? sid, status: res.status, body: parseRpc(await res.text()) };
};

/** ① MCP 侧：读 editor://bridge/status 资源 */
async function mcpSide() {
  const init = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bridge-status', version: '0.0.1' } },
  });
  const sid = init.sid;
  if (!sid) return { reachable: false, note: `MCP 没响应（HTTP ${init.status}）——应用/服务器没起来？` };
  await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sid);
  const read = await post({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'editor://bridge/status' } }, sid);
  const text = read.body?.result?.contents?.[0]?.text;
  let status = null;
  try {
    status = JSON.parse(text);
  } catch {
    /* 原样展示 */
  }
  return { reachable: true, serverInfo: init.body?.result?.serverInfo, status, raw: text };
}

/** ② hub 侧：问一句 hello，拿 editors / clients 计数 */
function hubSide() {
  if (typeof WebSocket === 'undefined') return Promise.resolve({ note: `当前 Node ${process.versions.node} 没有内置 WebSocket，跳过（需要 ≥22）` });
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      resolve(v);
    };
    const ws = new WebSocket(HUB);
    const timer = setTimeout(() => finish({ note: '超时：hub 没有回 hello 回执' }), 5000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 'bridge-status-1', method: 'bridge.hello', params: { role: 'verifier', version: '0.0.1' } })));
    ws.addEventListener('message', (ev) => {
      clearTimeout(timer);
      try {
        finish({ hello: JSON.parse(String(ev.data))?.result ?? null });
      } catch {
        finish({ note: `回执不是 JSON：${String(ev.data).slice(0, 120)}` });
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      finish({ note: `连不上 hub：${HUB}` });
    });
  });
}

const mcp = await mcpSide();
console.log('── MCP 侧（liveBridge → hub）──');
if (!mcp.reachable) {
  console.log(mcp.note);
} else {
  console.log(`serverInfo=${JSON.stringify(mcp.serverInfo)}`);
  console.log(JSON.stringify(mcp.status ?? mcp.raw, null, 2));
}

const hub = await hubSide();
console.log('\n── hub 侧（编辑器页面 → hub）──');
console.log(hub.hello ? JSON.stringify(hub.hello) : (hub.note ?? '(无结果)'));

const s = mcp.status ?? {};
const editors = hub.hello?.editors;
console.log('\n── 结论 ──');
console.log(`MCP→hub：connected=${s.connected} ready=${s.ready}（${s.lastError ?? '无错误'}）`);
console.log(`页面→hub：editors=${editors ?? '(读不到)'}`);
/**
 * ★判据必须带 `ready`：
 *   `connected` 只说明"本侧连上了中转"，编辑器没接入、或**版本不匹配被拒绝**时它同样是 true
 *   （实测：页面 0.1.0 / MCP 0.2.0 → connected=true 但 lastError=版本不匹配、ready=false）。
 *   只看 connected + editors 会把"被拒绝的 Live"报成可用 —— 本脚本第一版就是这么错的。
 */
const live = s.connected === true && s.ready === true && s.mode === 'live' && typeof editors === 'number' && editors >= 1;
console.log(live ? '★ Live 通道可用（三段都通）' : '★ Live 通道不可用（看上两行缺哪一段）');
process.exitCode = live ? 0 : 1;
