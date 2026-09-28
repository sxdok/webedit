/**
 * P0 安全闸门端到端验证（起/停自己的 MCP 子进程，不碰正在运行的应用）：
 *
 *   node scripts/auth-check.mjs
 *
 * 覆盖四类真实攻击面（决策 #1/#3）：
 *   T1 本地网页 CSRF  → 跨源 Origin 打 HTTP 必须 403；本机 Origin 放行（但仍要 token）
 *   T2 冒充编辑器     → 任意网页 new WebSocket 连 hub 必须被 1008 关闭；hello 不带 token 被拒
 *   T3 DNS rebinding  → Host 是域名必须 403
 *   鉴权           → 缺 token / token 错 → 401；token 对 → 200（能真正 initialize）
 *
 * 用 `dist/index.js`（tsc 产物，含最新代码），不用 bundle —— 打包版走的是 bundle，
 * 由 `npm run bundle` 重新生成后再验。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '..', 'dist', 'index.js');
const PORT = 37781;
const HUB_PORT = 37782;
const URL_ = `http://127.0.0.1:${PORT}/mcp`;
const HUB_URL = `ws://127.0.0.1:${HUB_PORT}/bridge`;
const TOKEN = `t-${randomBytes(18).toString('hex')}`;

const results = [];
const ok = (name, pass, evidence = '') => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? `\n        → ${evidence}` : ''}`);
};

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'auth-check', version: '0' } },
};

/** 发一条 initialize，可自定义 Origin / Host / Authorization 头 */
const post = async (headers = {}) => {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(INIT),
  });
  const text = await res.text();
  let parsed = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    const payload = t.startsWith('data:') ? t.slice(5).trim() : t;
    if (payload.startsWith('{')) {
      try {
        parsed = JSON.parse(payload);
      } catch {
        /* 继续找 */
      }
    }
  }
  return { status: res.status, text, parsed, sid: res.headers.get('mcp-session-id') };
};

/**
 * 原生 http 请求：**只有它能真的改 `Host` 头** ——
 * undici（fetch）把 Host 列为禁止头名，设了也会被静默忽略，测不出 DNS rebinding 那条。
 */
const postRaw = (headers) =>
  new Promise((resolvePromise) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          text += d;
        });
        res.on('end', () => resolvePromise({ status: res.statusCode, text }));
      },
    );
    req.on('error', (e) => resolvePromise({ status: 0, text: String(e) }));
    req.end(JSON.stringify(INIT));
  });

const logs = [];
const child = spawn(process.execPath, [ENTRY, '--http', '--port', String(PORT)], {
  env: {
    ...process.env,
    // 只起 HTTP + 自带 hub，指到本脚本自己的端口，避免碰到用户正在运行的应用（37650/37651）
    EDITOR_MCP_BRIDGE_URL: HUB_URL,
    EDITOR_MCP_BRIDGE_HUB: '1',
    EDITOR_MCP_TOKEN: TOKEN,
    EDITOR_MCP_REQUIRE_TOKEN: '1',
    EDITOR_MCP_WORKSPACE: resolve(HERE, '..', 'workspace'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    for (const l of String(d).split('\n')) if (l.trim()) logs.push(l.trim());
  });
}

const kill = () => {
  try {
    child.kill();
  } catch {
    /* 已退出 */
  }
};

/** 等 HTTP 就绪（带正确 token 能 initialize 即视为就绪）；返回会话 id 供后续 tools/call 复用 */
const waitReady = async () => {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await post({ Authorization: `Bearer ${TOKEN}` });
      if (r.status === 200 && r.sid) return r.sid;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  return false;
};

/** 发一次 hello，返回 { closed, code, reply } */
const wsHello = (params, origin) =>
  new Promise((resolvePromise) => {
    const opts = origin ? { headers: { origin } } : {};
    const ws = new WebSocket(HUB_URL, opts);
    const state = { closed: false, code: null, reply: null };
    const done = () => {
      try {
        ws.terminate();
      } catch {
        /* 忽略 */
      }
      resolvePromise(state);
    };
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'bridge.hello', params })));
    ws.on('message', (raw) => {
      try {
        state.reply = JSON.parse(raw.toString('utf8'));
      } catch {
        /* 忽略非 JSON */
      }
      setTimeout(done, 120);
    });
    ws.on('close', (code) => {
      state.closed = true;
      state.code = code;
      done();
    });
    ws.on('error', () => {
      state.closed = true;
      done();
    });
    setTimeout(done, 1500);
  });

try {
  const sid = await waitReady();
  const ready = Boolean(sid);
  ok('MCP 就绪（带正确 token 能 initialize）', ready);
  if (!ready) {
    console.log('\n--- 子进程日志（尾部）---');
    for (const l of logs.slice(-20)) console.log('  ' + l);
  }

  // ── HTTP 面 ──
  const noToken = await post();
  ok('HTTP：缺 Authorization → 401', noToken.status === 401, `status=${noToken.status} code=${noToken.parsed?.error?.data?.code ?? '-'}`);

  const badToken = await post({ Authorization: 'Bearer wrong-token' });
  ok('HTTP：token 错 → 401', badToken.status === 401, `status=${badToken.status}`);

  const crossOrigin = await post({ Origin: 'http://evil.example', Authorization: `Bearer ${TOKEN}` });
  ok('HTTP：跨源 Origin → 403 ORIGIN_REJECTED', crossOrigin.status === 403 && crossOrigin.parsed?.error?.data?.code === 'ORIGIN_REJECTED', `status=${crossOrigin.status} code=${crossOrigin.parsed?.error?.data?.code ?? '-'}`);

  const nullOrigin = await post({ Origin: 'null', Authorization: `Bearer ${TOKEN}` });
  ok('HTTP：Origin=null（file:// 页面）→ 403', nullOrigin.status === 403, `status=${nullOrigin.status}`);

  const badHostRaw = await postRaw({ Host: 'evil.example:37781', Authorization: `Bearer ${TOKEN}` });
  const badHost = { status: badHostRaw.status, parsed: JSON.parse(badHostRaw.text || '{}') };
  ok('HTTP：Host 是域名（DNS rebinding）→ 403 HOST_REJECTED', badHost.status === 403 && badHost.parsed?.error?.data?.code === 'HOST_REJECTED', `status=${badHost.status} code=${badHost.parsed?.error?.data?.code ?? '-'}`);

  const localOrigin = await post({ Origin: 'http://127.0.0.1:5179', Authorization: `Bearer ${TOKEN}` });
  ok('HTTP：本机 Origin + 正确 token → 200', localOrigin.status === 200 && Boolean(localOrigin.sid), `status=${localOrigin.status} sid=${localOrigin.sid ? '有' : '无'}`);

  // ── 写开关（决策 #2）：默认关时必须"拒得掉 + 说得清" ──
  // 这是 P0 验收口径里的一条：**写禁用时写工具被拒，且提示可读**（不是静默成功、也不是天书报错）。
  const callWriteTool = async (name, args) => {
    const headers = { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': sid, Origin: 'http://127.0.0.1:5179' };
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }),
    });
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      const payload = t.startsWith('data:') ? t.slice(5).trim() : t;
      if (!payload.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(payload);
        const inner = parsed?.result?.content?.[0]?.text;
        if (inner) return JSON.parse(inner);
        if (parsed?.error) return parsed;
      } catch {
        /* 继续找 */
      }
    }
    return null;
  };
  const writeRes = await callWriteTool('doc.create', {});
  const writeCode = writeRes?.error?.code ?? writeRes?.data?.error?.code ?? null;
  const writeMsg = String(writeRes?.error?.message ?? writeRes?.data?.error?.message ?? '');
  ok(
    '写开关默认关：写工具被拒 WRITE_DISABLED 且提示可读',
    writeCode === 'WRITE_DISABLED' && /写|WRITE|首选项/.test(writeMsg),
    `code=${writeCode} message=${writeMsg.slice(0, 90)}`,
  );

  // ── WS hub 面 ──
  const wsCross = await wsHello({ role: 'editor', version: '0.2.0', token: TOKEN }, 'http://evil.example');
  ok('WS：跨源 Origin 升级 → 1008 关闭', wsCross.closed && wsCross.code === 1008, `closed=${wsCross.closed} code=${wsCross.code}`);

  const wsNoToken = await wsHello({ role: 'editor', version: '0.2.0' });
  ok('WS：hello 不带 token → 拒绝（UNAUTHORIZED）', wsNoToken.reply?.error?.code === 'UNAUTHORIZED', `reply=${JSON.stringify(wsNoToken.reply)}`);

  const wsBadToken = await wsHello({ role: 'editor', version: '0.2.0', token: 'wrong' });
  ok('WS：hello token 错 → 拒绝', wsBadToken.reply?.error?.code === 'UNAUTHORIZED', `reply=${JSON.stringify(wsBadToken.reply)}`);

  const wsOk = await wsHello({ role: 'editor', version: '0.2.0', token: TOKEN });
  ok('WS：hello 带正确 token → ok:true（并回报 editors 数）', wsOk.reply?.ok === true && typeof wsOk.reply?.result?.editors === 'number', `reply=${JSON.stringify(wsOk.reply)}`);

  // 服务端日志里应当留下拒绝记录（可诊断性）
  const warnCount = logs.filter((l) => /拒绝入站请求|拒绝桥接连接|拒绝桥接握手/.test(l)).length;
  ok('服务端日志记录了拒绝（便于排查）', warnCount >= 3, `命中 ${warnCount} 条`);
} finally {
  kill();
  await sleep(300);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过`);
if (passed !== results.length) {
  console.log('\n--- 子进程日志（尾部 25 行）---');
  for (const l of logs.slice(-25)) console.log('  ' + l);
  process.exit(1);
}
