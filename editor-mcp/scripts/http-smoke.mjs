/**
 * 阶段七验证：安全模块 + Streamable HTTP transport。
 *
 *   node scripts/http-smoke.mjs
 *
 * 覆盖（规格 §10 / §13 验收 10、11、15）：
 *   · HTTP 模式下 **3 个客户端**各自 initialize 建会话、互不干扰（tools/list + 各自写自己的文档）
 *   · 只有 /mcp 一个端点；无会话的 POST 被拒；错误路径不崩
 *   · 速率限制：EDITOR_MCP_RATE_LIMIT 设小 → 超限返回 RATE_LIMITED
 *   · 写开关：ALLOW_WRITE=false → 写操作 WRITE_DISABLED（读操作正常）——已在 table-smoke 覆盖，这里再验 HTTP 下同样生效
 *   · 审计日志：写操作后 workspace/audit.log 里能看到该次调用
 *
 * ★P0 起 **token 校验是默认开启的**：脚本自己发一个 token 给子进程，并在每个请求头里带上
 *   `Authorization: Bearer <token>`。不带的表现是"initialize 直接 401"→ 整套静默全红（排查过）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeChecker, pkgRoot } from './mcp-client.mjs';

const { check, failures } = makeChecker();
const PORT = 37677;
const TOKEN = `http-smoke-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const BASE = `http://127.0.0.1:${PORT}/mcp`;
const AUDIT = path.join(pkgRoot, 'workspace', 'audit.log');

/** 一个极简 HTTP MCP 客户端：手工握手 + 带 session id */
async function httpClient(name) {
  let sessionId = null;
  const rpc = async (method, params, isNotification = false) => {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        // P0：入站 token 校验（编辑器/agent 都必须带；不带就是 401）
        Authorization: `Bearer ${TOKEN}`,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(isNotification ? {} : { id: Math.floor(Math.random() * 1e6) }), method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const text = await res.text();
    // Streamable HTTP 可能返回 SSE（data: {...}）或纯 JSON
    const jsonLine = text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) : text;
    let body = null;
    try {
      body = jsonLine ? JSON.parse(jsonLine) : null;
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body, sessionId };
  };
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '0.1.0' } });
  await rpc('notifications/initialized', {}, true);
  const call = async (tool, args = {}) => {
    const r = await rpc('tools/call', { name: tool, arguments: args });
    const t = r.body?.result?.content?.[0]?.text ?? '';
    let parsed = null;
    try {
      parsed = t ? JSON.parse(t) : null;
    } catch {
      parsed = { raw: t };
    }
    return { body: parsed, isError: !!r.body?.result?.isError, status: r.status };
  };
  return { name, init, rpc, call, sessionId: () => sessionId };
}

const child = spawn(process.execPath, [path.join(pkgRoot, 'dist', 'index.js'), '--http', '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: pkgRoot,
  env: { ...process.env, EDITOR_MCP_TOKEN: TOKEN, EDITOR_MCP_PLUGIN_DIR: path.join(pkgRoot, 'workspace', '_plugin-test-http'), EDITOR_MCP_RATE_LIMIT: '40', EDITOR_MCP_ALLOW_WRITE: 'true' },
});
const stderr = [];
child.stderr.on('data', (d) => stderr.push(d.toString('utf8')));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await wait(900);

  /* ── 只暴露 /mcp ── */
  const root = await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null);
  const other = await fetch(`http://127.0.0.1:${PORT}/tools`).catch(() => null);
  check('HTTP 只暴露 /mcp（其余路径 404）', root?.status === 404 && other?.status === 404, `GET / → ${root?.status}，GET /tools → ${other?.status}`);

  /* ── 无会话的 POST 被拒 ── */
  const noSession = await fetch(BASE, {
    method: 'POST',
    // ★带上 token：**未认证（401）优先于协议状态（400）** —— 不带 token 时拿到的是 401，
    //   那样这条"没 initialize 就调工具"的协议约束就验不到了。两条用例各自只验一件事。
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const noSessionBody = await noSession.json().catch(() => ({}));
  check('没有 initialize 就直接 tools/list → 400 且给出原因', noSession.status === 400 && /initialize/.test(JSON.stringify(noSessionBody)), `${noSession.status} ${JSON.stringify(noSessionBody).slice(0, 90)}`);

  /* P0：**不带 token 的请求一律 401** —— 与上一条分开：认证先于协议状态、也先于会话 */
  const noToken = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const noTokenBody = await noToken.json().catch(() => ({}));
  check(
    '不带 token 的请求 → 401（认证先于协议状态与会话）',
    noToken.status === 401 && /Authorization/i.test(JSON.stringify(noTokenBody)),
    `${noToken.status} ${JSON.stringify(noTokenBody).slice(0, 90)}`,
  );

  /* ── 3 个客户端各建会话，互不干扰 ── */
  const clients = [await httpClient('client-A'), await httpClient('client-B'), await httpClient('client-C')];
  const sids = clients.map((c) => c.sessionId());
  check(
    '3 个客户端各自 initialize 拿到独立会话 id',
    sids.every((s) => typeof s === 'string' && s.length > 10) && new Set(sids).size === 3,
    sids.map((s) => `${String(s).slice(0, 8)}…`).join(' / '),
  );

  const lists = await Promise.all(clients.map((c) => c.rpc('tools/list', {})));
  const counts = lists.map((r) => (r.body?.result?.tools ?? []).length);
  check('每个会话都能独立列出全部 Tool', counts.every((n) => n === counts[0] && n > 100), `各自 ${counts.join(' / ')} 个 Tool`);

  // 每个客户端建自己的文档（互不污染）
  const docIds = [`http-a-${Date.now().toString(36)}`, `http-b-${Date.now().toString(36)}`, `http-c-${Date.now().toString(36)}`];
  const creates = await Promise.all(clients.map((c, i) => c.call('doc.create', { title: `HTTP ${i}`, docId: docIds[i], mode: 'document' })));
  check('3 个会话并发写各自的文档都成功', creates.every((r) => r.body?.ok === true), creates.map((r) => r.body?.data?.docId).join(' / '));

  const after = await Promise.all(clients.map((c) => c.call('doc.list', {})));
  const seen = after.map((r) => (r.body?.data?.docs ?? []).map((d) => d.docId));
  check(
    '每个会话都看得到全部 3 份文档（共享工作区、会话互不干扰）',
    seen.every((s) => docIds.every((d) => s.includes(d))),
    seen.map((s) => s.length).join(' / '),
  );

  /* ── 审计日志 ── */
  const auditBefore = fs.existsSync(AUDIT) ? fs.statSync(AUDIT).size : 0;
  await clients[0].call('doc.rename', { docId: docIds[0], title: 'HTTP A 改名' });
  await wait(200);
  const auditText = fs.existsSync(AUDIT) ? fs.readFileSync(AUDIT, 'utf8') : '';
  const auditTail = auditText.split('\n').filter(Boolean).slice(-6).join('\n');
  check(
    '写操作进了审计日志 workspace/audit.log',
    auditText.includes('doc.rename') && auditText.includes(docIds[0]),
    `文件 ${auditBefore} → ${auditText.length} 字节；末行：${auditTail.split('\n').pop()?.slice(0, 70) ?? '(空)'}`,
  );

  /* ── 速率限制 ── */
  let limited = null;
  for (let i = 0; i < 60 && !limited; i += 1) {
    const r = await clients[1].call('doc.list', {});
    if (r.body?.error?.code === 'RATE_LIMITED') limited = { i, msg: r.body.error.message };
  }
  check('超过每分钟上限 → RATE_LIMITED（服务器仍在服务）', !!limited, limited ? `第 ${limited.i + 1} 次调用被拦：${limited.msg}` : '60 次内没触发（上限设太大了？）');
  const stillAlive = await clients[2].rpc('tools/list', {});
  check('被限流后其它会话仍可用（限流不杀服务）', (stillAlive.body?.result?.tools ?? []).length > 100, `${(stillAlive.body?.result?.tools ?? []).length} 个 Tool`);

  /* ── 清理 ── */
  for (const id of docIds) fs.rmSync(path.join(pkgRoot, 'workspace', `${id}.editor.json`), { force: true });
} catch (e) {
  check('阶段七验证流程未抛异常', false, String(e?.stack ?? e));
} finally {
  // ★先 SIGTERM（走优雅收尾），1 秒内没退就强杀：否则子进程存活会让父进程的管道一直开着，
  //   整个脚本"明明跑完了却不退出"（真踩过）
  child.kill();
  await wait(1000);
  if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  fs.rmSync(path.join(pkgRoot, 'workspace', '_plugin-test-http'), { recursive: true, force: true });
  if (failures.length) process.stderr.write(`\n---- 服务器 stderr（尾部）----\n${stderr.join('').slice(-1200)}\n`);
  process.stdout.write(failures.length ? `\n结果：${failures.length} 条失败\n` : '\n结果：全部通过\n');
  process.exit(failures.length ? 1 : 0);
}
