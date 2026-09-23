/**
 * 极简 MCP 客户端（只够测试用）：spawn 服务器 → JSON-RPC 握手 → 调 Tool。
 * 阶段九的端到端脚本会扩展它。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pkgRoot = path.resolve(here, '..');

/**
 * 临时空工作区（按需隔离用）。
 * ★只有**确实需要"空工作区"语义**的用例才该用它（例如"没有组件目录时应如实说缺什么"）——
 *   别在 startClient 里默认隔离：几个 smoke 脚本本来就把产物写到 `<pkgRoot>/workspace` 下并回读，
 *   一刀切隔离会把它们全弄坏（真踩过）。
 */
export function tempWorkspace(tag = 'ws') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `editor-mcp-${tag}-`));
}

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
  const notes = [];
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
      // 服务端主动推送（通知没有 id）
      if (msg.method && msg.id == null) {
        notes.push(msg);
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
    /** 原始 JSON-RPC 调用（resources/* 与 prompts/* 用） */
    raw: req,
    /** 服务端推来的通知（notifications/resources/updated 等） */
    notifications: () => notes.slice(),
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
