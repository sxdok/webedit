/**
 * 阶段二验证：双通道自动降级 + **协议/能力协商**（规格 §5.1；原来验的是"版本全等"）。
 *
 *   node scripts/bridge-smoke.mjs
 *
 * 场景：
 *   ① 桥接**没开**时：doc.create 走无头 → degraded=true、via=headless，文件真写出来
 *   ② 起 mock 桥接后：同一个调用走 Live → degraded=false、via=live，且拿到 mock 的 docId
 *   ③ Live 已连上但编辑器回 `METHOD_NOT_FOUND`（老编辑器不认识这个新方法）→ **降级到无头**并标 degraded
 *      （规格 §5.1 明确要求；原来这里是"原样抛出业务错误"，会把"版本错开"误报成"工具坏了"）
 *   ④ 版本不同但**协议相同** → 仍然允许 Live（这正是 §5.1 要替换掉"版本全等"的那条）
 *   ⑤ 协议不同 + 编辑器明确说缺 `exportDocx` → **依赖该能力的方法**走无头，其它方法仍走 Live
 *   ⑥ 事件订阅：doc.create 之后 mock 推的 document.changed 能被收到
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
// ★P0 决策 #2 起写操作默认被拒（`EDITOR_MCP_ALLOW_WRITE=false`）：本脚本要建文档（无头回退路径），
//   不显式申请就会表现为"doc.create 直接失败、via=undefined"（这坑在 5 个 smoke 里都踩过一遍）。
process.env.EDITOR_MCP_ALLOW_WRITE = 'true';

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

/**
 * 等到**真的就绪**再断言（而不是单次 `ensureReady`）。
 * ★单次调用会踩到重连退避：`stop()/start()` 之后第一次连接可能排在退避队列里，
 *   `ensureReady(1500)` 会返回 false —— 但紧接着的调用却成功了（实测：ready=false 却 via=live）。
 */
const waitReady = async (maxMs = 8000) => {
  const t0 = Date.now();
  for (;;) {
    if (await liveBridge.ensureReady(600)) return true;
    if (Date.now() - t0 > maxMs) return false;
  }
};

/**
 * 等 mock **真的开始监听**再继续。
 * ★不要用固定 sleep：同一端口上前一个 mock 刚被 kill、新 mock 还没绑定完时，
 *   `liveBridge` 会拿到"未连接"（实测就是这样红的），而红出来的现象像是"协议协商不对"。
 */
const waitForListen = (proc, ms = 6000) =>
  new Promise((resolve) => {
    let buf = '';
    const done = (v) => {
      clearTimeout(t);
      resolve(v);
    };
    const t = setTimeout(() => done(false), ms);
    proc.stderr.on('data', (d) => {
      buf += String(d);
      if (/监听 ws/.test(buf)) done(true);
    });
  });

try {
  /* ① 桥接没开 */
  const r1 = await withBridge('doc.create', { title: '降级用例' }, async () => ({ docId: 'headless-1', title: '降级用例' }));
  check('桥接未开启 → 走无头并标记 degraded', r1.via === 'headless' && r1.degraded === true, `via=${r1.via} degraded=${r1.degraded}`);

  const summary1 = bridgeSummary();
  check('bridge.status 如实报告"未连接 + 走 headless 的原因"', summary1.ready === false && !!summary1.hint, `mode=${summary1.mode}`);

  /* ② 起 mock 桥接 */
  const mock = startMock();
  await waitForListen(mock);
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
    /* §5.1：编辑器不认识这个方法 → 降级到无头（不再是"当业务错误抛出"） */
    'Live 已连上但编辑器回 METHOD_NOT_FOUND → 降级到无头并标 degraded（协议可能偏旧）',
    bizCode === '' && fellBack === true,
    `err.code=${bizCode || '(未抛错=已降级)'}；是否降级=${fellBack}`,
  );

  mock.kill();
  await wait(400);

  /* ③ 版本不同、协议相同 → 仍允许 Live（替换旧的"版本全等"闸门） */
  const mock2 = startMock(['--bad-version']);
  await waitForListen(mock2);
  liveBridge.stop();
  liveBridge.start();
  const ready2 = await waitReady();
  const r3 = await withBridge('doc.create', { title: '版本不同但协议相同' }, async () => ({ docId: 'headless-2' }));
  check(
    '版本不同但协议 v2 相同 → 仍然走 Live（不再因产品版本不同废掉 Live）',
    ready2 === true && r3.via === 'live' && r3.degraded === false,
    `ready=${ready2} via=${r3.via}；lastError=${liveBridge.status().lastError}`,
  );
  mock2.kill();
  await wait(400);

  /* ④ 协议不同 + 明确缺能力 → 只有依赖该能力的方法降级 */
  const mock3 = startMock(['--bad-protocol', '--no-export-docx']);
  await waitForListen(mock3);
  liveBridge.stop();
  liveBridge.start();
  await waitReady();
  const e1 = await withBridge('export.docx', { docId: 'x' }, async () => ({ bytes: 'headless-docx' }));
  const d1 = await withBridge('doc.create', { title: '协议不同但不依赖该能力' }, async () => ({ docId: 'headless-3' }));
  check(
    '协议不同 + 缺 exportDocx → export.docx 走无头；doc.create 仍走 Live（逐方法降级）',
    e1.via === 'headless' && e1.degraded === true && d1.via === 'live' && d1.degraded === false,
    `export.docx via=${e1.via}；doc.create via=${d1.via}；mismatch=${liveBridge.handshakeMismatch()}`,
  );
  mock3.kill();

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
