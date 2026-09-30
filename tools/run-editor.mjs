/**
 * 职责：**一条命令把"真窗口 + MCP"跑起来**（用户 2026-09-30 的场景："之前跑真窗口是用 MCP"）。
 *
 * 为什么需要它：MCP 的 HTTP 端点（`http://127.0.0.1:37651/mcp`）**不是独立服务**，
 * 是**桌面版自己拉起来的**（`apps/desktop/src/mcpSupervisor.js`）；hub WS 在 37650。
 * 所以"agent 连不上编辑器"最常见的原因不是配置错，而是**桌面版没在跑**。
 *
 * ★同时解决一个很坑的环境问题：**从 DSH 的 shell 里启动 Electron 会被当成 Node 跑**。
 *   DSH 自己是 Electron，会给子进程带上 `ELECTRON_RUN_AS_NODE=1`；此时
 *   `webedit.exe` 变成"Node 解释器"——`--selftest` 报 `bad option` 退出码 **9**、
 *   直接启动则**秒退且不写任何日志**（看起来像"应用坏了"）。本脚本启动前**删掉这个变量**。
 *
 * 用法：
 *   node tools/run-editor.mjs            # 启动打包版（release/win-unpacked/webedit.exe），跑完留着窗口
 *   node tools/run-editor.mjs --dev      # 启动开发态（apps/desktop 的 electron .，用当前 dist）
 *   node tools/run-editor.mjs --check    # 已经在跑时只做接线检查（幂等）
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const wantDev = args.includes('--dev');
const PORTS = [37650, 37651];

/** 子进程环境：**必须删掉** ELECTRON_RUN_AS_NODE（见文件头说明），否则 Electron 会被当 Node 跑 */
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const listening = async (port) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(900) });
    return r.status > 0;
  } catch {
    return false;
  }
};
/** TCP 层面的探活：HTTP 探 37650 不一定回 200，所以用 net 连一下更可靠 */
const tcpOpen = async (port) =>
  await new Promise((res) => {
    import('node:net').then(({ connect }) => {
      const s = connect({ host: '127.0.0.1', port }, () => {
        s.destroy();
        res(true);
      });
      s.on('error', () => res(false));
      s.setTimeout(900, () => {
        s.destroy();
        res(false);
      });
    });
  });

const already = (await Promise.all(PORTS.map(tcpOpen))).every(Boolean);

if (!already) {
  const packaged = join(ROOT, 'release', 'win-unpacked', 'webedit.exe');
  if (!wantDev && !existsSync(packaged)) {
    console.error(`✗ 找不到打包版：${packaged}\n  先打包（npm run dist），或用 --dev 跑开发态。`);
    process.exit(2);
  }
  console.log(wantDev ? '▸ 启动开发态桌面版（apps/desktop）…' : `▸ 启动打包版桌面版：${packaged}`);
  const child = wantDev
    ? spawn(process.execPath, [join(ROOT, 'node_modules', '.bin', 'electron.cmd'), '.'], {
        cwd: join(ROOT, 'apps', 'desktop'),
        env: childEnv,
        stdio: 'ignore',
        shell: true,
        detached: true, // ★脱离本进程：脚本退出/被杀时窗口不被连带带走（DSH 的作业对象会杀整棵子进程树）
      })
    : spawn(packaged, [], { cwd: dirname(packaged), env: childEnv, stdio: 'ignore', detached: true });

  let up = false;
  for (let i = 0; i < 40 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    up = (await Promise.all(PORTS.map(tcpOpen))).every(Boolean);
  }
  if (!up) {
    console.error('✗ 40 秒内两个端口没起来 —— 看桌面版日志：%APPDATA%\\webedit\\logs\\desktop-*.log');
    console.error('  （若日志里连"启动"都没有：确认 child env 里没有 ELECTRON_RUN_AS_NODE；本脚本已自动删掉）');
    process.exit(1);
  }
  console.log('✓ 真窗口已起：hub WS 37650 ✅  MCP HTTP 37651 ✅');
  /* ★必须 unref：否则 Node 的事件循环会被这个长期运行的子进程吊住 ——
     脚本"跑完不退"（实测卡了 10 分钟），调用方会以为它挂了。unref 之后脚本退出、窗口继续留着。 */
  child.unref();
} else {
  console.log('✓ 桌面版已经在跑（37650/37651 都在听），跳过启动');
}

/* 接线检查（含"不带 token 401 / 带 token 200"的实探）：这是 agent 能不能用 MCP 的判据 */
const check = spawnSync(process.execPath, [join(ROOT, 'tools', 'dsh-mcp-config-check.mjs')], { cwd: ROOT, encoding: 'utf8', env: childEnv });
const lines = String(check.stdout ?? '').split(/\r?\n/).filter((l) => /PASS|FAIL|SKIP|→/.test(l));
console.log('\n——— DSH ↔ 编辑器 MCP 接线检查 ———');
for (const l of lines) console.log('  ' + l.trim());
const failed = lines.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${failed === 0 ? '✓' : '✗'} 接线检查：${failed === 0 ? '全部通过 —— agent 的 mcp-editor 工具现在可用（via=live）' : `${failed} 项失败，按上面提示改`}`);
console.log('  真窗口与 MCP 都留着（手动关窗口即退出；不需要命令行收尾）。');
