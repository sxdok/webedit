/**
 * 阶段二验证：双通道自动降级 + 版本协商（规格 §4.1 / §二）。
 *
 *   node scripts/bridge-smoke.mjs
 *
 * 场景：
 *   ① 桥接**没开**时：doc.create 走无头 → degraded=true、via=headless，文件真写出来
 *   ② 起 mock 桥接后：同一个调用走 Live → degraded=false、via=live，且拿到 mock 的 docId
 *   ③ 版本不匹配时：hello 被拒 → 自动降级，仍然 via=headless（不会"半信半疑地用 Live"）
 *   ④ 事件订阅：doc.create 之后 mock 推的 document.changed 能被收到
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const PORT = 37699; // 用不常见端口，避免和真实编辑器（37650）打架

// ★必须在 import 编译产物**之前**设好：config 是模块加载时读环境变量算出来的
process.env.EDITOR_MCP_BRIDGE_URL = `ws://127.0.0.1:${PORT}`;

const failures = [];
const check = (label, okFlag, detail) => {
  process.stdout.write(`${okFlag ? 'PASS' : 'FAIL'}  ${label}${detail ? `  → ${detail}` : ''}\n`);
  if (!okFlag) failures.push(label);
};

/** 直接 import 编译产物：这样能拿到 via/degraded，不必额外暴露诊断 Tool
 *  （Windows 绝对路径不能直接给 ESM loader，必须转成 file:// URL） */
const mod = (rel) => pathToFileURL(path.join(pkgRoot, 'dist', rel)).href;
const { liveBridge } = await import(mod('bridge/liveBridge.js'));
const { withBridge, bridgeSummary } = await import(mod('bridge/fallback.js'));
const { docCreate } = await import(mod('tools/document.js'));

const startMock = (extra = []) =>
  spawn(process.execPath, [path.join(pkgRoot, 'scripts/mock-bridge.mjs'), '--port', String(PORT), ...extra], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: pkgRoot,
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  /* ① 桥接没开 */
  const r1 = await withBridge('doc.create', { title: '降级用例' }, async () => ({ docId: 'headless-1', title: '降级用例' }));
  check('桥接未开启 → 走无头并标记 degraded', r1.via === 'headless' && r1.degraded === true, `via=${r1.via} degraded=${r1.degraded}`);

  const summary1 = bridgeSummary();
  check('bridge.status 如实报告"未连接 + 走 headless 的原因"', summary1.ready === false && !!summary1.hint, `mode=${summary1.mode}`);

  /* ② 起 mock 桥接 */
  const mock = startMock();
  await wait(700);
  liveBridge.start();
  const ready = await liveBridge.ensureReady(2500);
  check('mock 桥接起来后 hello 通过、Live 可用', ready === true, JSON.stringify(liveBridge.status()));

  const doc = await docCreate({ title: '走 Live 的文档', mode: 'document' });
  check(
    'doc.create 优先走 Live（degraded=false、via=live、docId 来自编辑器）',
    doc.ok === true && doc.data?.via === 'live' && doc.degraded === false && String(doc.data?.docId).startsWith('live-'),
    `via=${doc.data?.via} docId=${doc.data?.docId} degraded=${doc.degraded}`,
  );

  const node = await liveBridge.call('node.add', { type: 'table' });
  check('桥接调用返回编辑器结果（node.add）', !!node && node.total === 1 && node.node?.type === 'table', JSON.stringify(node));

  const changed = liveBridge.lastOf('document.changed');
  check('收到了编辑器推送 document.changed（订阅链路可用）', !!changed && typeof changed === 'object', JSON.stringify(changed));

  /* 业务错误不降级：mock 未实现的方法要原样抛出**错误码**，且不能偷偷写到无头 */
  let bizCode = '';
  let fellBack = false;
  try {
    await withBridge(
      'table.mergeCells',
      { id: 'n1', range: 'A1:B2' },
      async () => {
        fellBack = true;
        return { fallback: true };
      },
    );
  } catch (e) {
    bizCode = String(e?.code ?? '');
  }
  check(
    'Live 已连上时"业务错误"不降级（METHOD_NOT_FOUND 原样抛出、没有偷偷走无头）',
    bizCode === 'METHOD_NOT_FOUND' && fellBack === false,
    `err.code=${bizCode || '(空)'}；是否降级=${fellBack}`,
  );

  mock.kill();
  await wait(400);

  /* ③ 版本不匹配 */
  const mock2 = startMock(['--bad-version']);
  await wait(700);
  liveBridge.stop();
  liveBridge.start();
  const ready2 = await liveBridge.ensureReady(1500);
  const r3 = await withBridge('doc.create', { title: '版本不匹配' }, async () => ({ docId: 'headless-2' }));
  check(
    '版本不匹配 → 拒绝 Live、自动降级到无头',
    ready2 === false && r3.via === 'headless' && r3.degraded === true,
    `ready=${ready2} via=${r3.via}；lastError=${liveBridge.status().lastError}`,
  );
  mock2.kill();

  /* 收尾：无头写出来的临时文档清掉 */
  const ws = path.join(pkgRoot, 'workspace');
  if (fs.existsSync(ws)) {
    for (const f of fs.readdirSync(ws)) if (f.endsWith('.editor.json')) fs.rmSync(path.join(ws, f), { force: true });
  }
} catch (e) {
  check('桥接验证流程未抛异常', false, String(e?.stack ?? e));
} finally {
  liveBridge.stop();
  process.stdout.write(failures.length ? `\n结果：${failures.length} 条失败\n` : '\n结果：全部通过\n');
  // 显式退出：子进程/句柄可能还挂着，靠事件循环自然退出会卡住调用方
  process.exit(failures.length ? 1 : 0);
}
