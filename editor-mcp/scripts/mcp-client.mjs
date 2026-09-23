/**
 * 极简 MCP 客户端（只够测试用）：spawn 服务器 → JSON-RPC 握手 → 调 Tool。
 * 阶段九的端到端脚本会扩展它。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pkgRoot = path.resolve(here, '..');

export async function startClient({ env = {}, args = ['--stdio'] } = {}) {
  const child = spawn(process.execPath, [path.join(pkgRoot, 'dist', 'index.js'), ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: pkgRoot,
    env: { ...process.env, ...env },
  });
  let buf = '';
  let seq = 0;
  const pending = new Map();
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(d.toString('utf8')));
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
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });

  const req = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => reject(new Error(`超时：${method}`)), 15000).unref();
    });

  const init = await req('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'editor-mcp-test', version: '0.1.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const tools = async () => (await req('tools/list', {})).result?.tools ?? [];
  const call = async (name, args = {}) => {
    const r = await req('tools/call', { name, arguments: args });
    const text = r.result?.content?.[0]?.text ?? '';
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { isError: !!r.result?.isError, body };
  };

  return {
    serverInfo: init.result?.serverInfo,
    tools,
    call,
    stderr: () => stderr.join(''),
    close: () => child.kill(),
  };
}

/** 断言小工具 */
export function makeChecker() {
  const failures = [];
  const check = (label, ok, detail) => {
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  → ${detail}` : ''}\n`);
    if (!ok) failures.push(label);
  };
  return { check, failures };
}
