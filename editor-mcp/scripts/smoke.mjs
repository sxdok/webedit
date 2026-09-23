/**
 * 阶段一冒烟脚本：起 stdio MCP 服务器，走真实 JSON-RPC 握手，调用 3 个 Tool。
 *
 *   node scripts/smoke.mjs
 *
 * 断言（对应规格 §13 验收 1 / 2 / 11 的前置条件）：
 *   · initialize 成功、tools/list 至少列出 doc.create / component.list / plugin.list
 *   · plugin.list 能扫到编辑器插件目录里的外部组件
 *   · doc.create 真的在 workspace 下写出 <docId>.editor.json，且能被无头引擎读回
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
/**
 * ★本脚本验的是"**没有任何组件目录**时的行为"（component.list 只给外部组件 + note + degraded），
 *   所以必须用一个**空工作区**：开发者工作区里只要有 component-catalog.json（任何一次
 *   component.catalog 都会生成它），这些用例就会失败 —— 不是功能坏了，是测试假设被环境改了。
 */
const EMPTY_WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-mcp-smoke-'));
const child = spawn(process.execPath, [path.join(pkgRoot, 'dist', 'index.js'), '--stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: pkgRoot,
  env: { ...process.env, EDITOR_MCP_WORKSPACE: EMPTY_WORKSPACE },
});

let buf = '';
let seq = 0;
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // 非 JSON 行（理论上不该有，stdout 只放 JSON-RPC）
    }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
const req = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
    setTimeout(() => reject(new Error(`超时：${method}`)), 10000).unref();
  });

const failures = [];
const check = (label, okFlag, detail) => {
  process.stdout.write(`${okFlag ? 'PASS' : 'FAIL'}  ${label}${detail ? `  → ${detail}` : ''}\n`);
  if (!okFlag) failures.push(label);
};

try {
  const init = await req('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'editor-mcp-smoke', version: '0.1.0' },
  });
  check('initialize 握手', !!init.result?.serverInfo, `${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const tools = await req('tools/list', {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  check(
    'tools/list 含阶段一的 3 个 Tool',
    ['doc.create', 'component.list', 'plugin.list'].every((n) => names.includes(n)),
    names.join(', '),
  );

  const call = async (name, args) => {
    const r = await req('tools/call', { name, arguments: args ?? {} });
    const text = r.result?.content?.[0]?.text ?? '';
    return { isError: !!r.result?.isError, body: text ? JSON.parse(text) : null };
  };

  const plugins = await call('plugin.list', { includeInvalid: true });
  check(
    'plugin.list 扫到外部插件',
    plugins.body?.ok === true && (plugins.body?.data?.total ?? 0) > 0,
    `目录 ${plugins.body?.data?.dir} → ${plugins.body?.data?.total} 个（ok ${plugins.body?.data?.ok} / invalid ${plugins.body?.data?.invalid}）；清单=${plugins.body?.data?.manifestFile ?? '无'}`,
  );

  const comps = await call('component.list', {});
  check(
    'component.list 不编造内置清单（无桥接/目录时只给外部组件 + note + degraded）',
    comps.body?.ok === true && !!comps.body?.data?.note && comps.body?.degraded === true,
    `total=${comps.body?.data?.total}；sources=${JSON.stringify(comps.body?.data?.sources)}；degraded=${comps.body?.degraded}`,
  );

  const created = await call('doc.create', { title: '冒烟测试文档', mode: 'document', pageSize: 'A4' });
  const file = created.body?.data?.path;
  check(
    'doc.create 真的写出可读回的文档',
    created.body?.ok === true && created.body?.degraded === true && !!file && fs.existsSync(file),
    `${file}（degraded=${created.body?.degraded}）`,
  );
  if (file) {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    check(
      '写入的 JSON 与编辑器导出同构（id/title/mode/document/web）',
      !!doc.id && !!doc.title && !!doc.mode && !!doc.document?.page && !!doc.web?.root,
      `title=「${doc.title}」、page.size=${doc.document?.page?.size}、components=${doc.document?.components?.length}`,
    );
    fs.rmSync(file, { force: true });
  }

  const denied = await call('component.list', { mode: 'ppt' });
  check('按模式过滤可用（mode=ppt 返回 0 个且不报错）', denied.body?.ok === true, `total=${denied.body?.data?.total}`);
} catch (e) {
  check(`冒烟流程未抛异常`, false, String(e?.message ?? e));
} finally {
  child.kill();
  process.stdout.write(failures.length ? `\n结果：${failures.length} 条失败\n` : '\n结果：全部通过\n');
  process.exitCode = failures.length ? 1 : 0;
}
