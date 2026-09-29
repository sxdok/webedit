/**
 * DSH 的 mcp-editor 客户端配置检查（P3.5 之后新增；本脚本只读配置，不改任何东西）。
 *
 *   node tools/dsh-mcp-config-check.mjs            # 用 %USERPROFILE%\.dsh
 *   DSH_HOME=D:\... node tools/dsh-mcp-config-check.mjs
 *
 * 为什么值得一个脚本：这份配置是"agent ↔ 编辑器"的**唯一接线**，而它踩过两个坑（2026-09-28 修）：
 *   ① `toolCallTimeoutMs: 20` —— 面板写入的是 20 **毫秒**，每次 tools/call 必然超时；
 *   ② 没有 `reconnect`（官方默认 maxAttempts=10）—— 编辑器没开时重试用完就**永久不再连**，
 *      之后编辑器起来了也连不上。
 * 再加上 P0 起**token 强制**：配置里的 `Authorization` 必须等于桌面版写的 `userData/bridge-token`，
 * 而 userData 在 P3.5 改名后是 `%APPDATA%\webedit`。任何一处漂移，现象都是"agent 连不上编辑器"，
 * 但原因完全不同 —— 所以把四条一起断言，并且**服务器在线时顺手探一次**（401/200）。
 *
 * 只读：不写配置文件。发现漂移时打印出"改哪里、改成什么"。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PATCH = join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml');
const APPDATA = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
const TOKEN_CANDIDATES = ['webedit', '可视化编辑器', 'visual-editor-desktop'].map((n) => join(APPDATA, n, 'bridge-token'));
const MCP_URL = 'http://127.0.0.1:37651/mcp';

const results = [];
const ok = (name, pass, evidence = '') => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? `\n        → ${evidence}` : ''}`);
};

if (!existsSync(PATCH)) {
  console.error(`✗ 找不到 DSH patch：${PATCH}\n  （用 DSH_HOME=<你的 .dsh 目录> 指定）`);
  process.exit(2);
}
const text = readFileSync(PATCH, 'utf8');

/** 抠出 mcp-editor 那一段（从 `- id: mcp-mcp-editor` 到下一个同级 `- ` 或文件尾） */
const start = text.indexOf('- id: mcp-mcp-editor');
const block = start >= 0 ? text.slice(start, (() => {
  const rest = text.slice(start + 20);
  const next = rest.search(/\n\s*- id: /);
  return next >= 0 ? start + 20 + next : text.length;
})()) : '';
ok('patch 里有 mcp-mcp-editor 这一项', block.length > 0, `patch=${PATCH}`);

const grab = (re) => (re.exec(block)?.[1] ?? '').trim();
const url = grab(/^\s*url:\s*(\S+)/m);
const auth = grab(/Authorization:\s*['"]?([^'"\n]+)['"]?/);
const timeout = Number(grab(/toolCallTimeoutMs:\s*(\d+)/));
const maxAttempts = Number(grab(/maxAttempts:\s*(\d+)/));
const maxDelay = Number(grab(/maxDelayMs:\s*(\d+)/));
const transport = grab(/transport:\s*(\S+)/);

ok('传输与地址指向本机编辑器 MCP', transport === 'streamable-http' && url === MCP_URL, `transport=${transport} url=${url}`);

const tokenFile = TOKEN_CANDIDATES.find((p) => existsSync(p)) ?? null;
const token = tokenFile ? readFileSync(tokenFile, 'utf8').trim() : '';
const cfgToken = auth.replace(/^Bearer\s+/i, '');
ok(
  '配置里的 token 与桌面版写的 bridge-token 一致（P0 起强制；userData 在 P3.5 后是 %APPDATA%\\webedit）',
  Boolean(token) && cfgToken === token,
  tokenFile ? `token 文件=${tokenFile}（${token.slice(0, 10)}…）；配置=${cfgToken.slice(0, 10)}…${cfgToken === token ? ' 一致' : ' ❌ 不一致 → 请把配置里的 Authorization 改成 Bearer <文件内容>'}` : `找不到 token 文件（找过 ${TOKEN_CANDIDATES.join(' / ')}）—— 先启动一次桌面版`,
);

/* ① 旧坑：面板写过 20（毫秒）。这里要求"够用"：15s 起 */
ok('toolCallTimeoutMs 不是那个"20 毫秒"的坑，且够用（≥5000ms）', timeout >= 5000, `toolCallTimeoutMs=${timeout || '缺失'}`);
/* ② 旧坑：没有 reconnect → 编辑器没开就永久不再连 */
ok(
  'reconnect 配成"一直重试"（maxAttempts 很大）',
  maxAttempts >= 100000 && maxDelay <= 30000,
  `maxAttempts=${maxAttempts || '缺失'} maxDelayMs=${maxDelay || '缺失'}`,
);

/* 服务器在线时顺手探一次：不带 token 必须 401，带 token 必须 200 */
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-config-check', version: '1' } } });
const H = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const post = async (headers) => {
  const r = await fetch(MCP_URL, { method: 'POST', headers: { ...H, ...headers }, body });
  return r.status;
};
try {
  const noTok = await post({});
  ok('实探：不带 token 被拒（401）', noTok === 401, `HTTP ${noTok}`);
  const withTok = await post({ Authorization: `Bearer ${cfgToken}` });
  ok('实探：配置里的 token 能建立会话（200）', withTok === 200, `HTTP ${withTok}`);
} catch (e) {
  console.log(`SKIP  实探（MCP 不在线，属正常：${e.cause?.code ?? e.message}）—— 启动桌面版后重跑本脚本`);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
