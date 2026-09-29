/**
 * 无头跑页面自检（`?check=1`）并把结论从命令行读出来。
 *
 *   node apps/desktop/scripts/check-page.mjs            # 起桌面版（--check）+ CDP 读 document.title
 *   node apps/desktop/scripts/check-page.mjs --keep     # 跑完不退出（人工看浮层/截图时用）
 *
 * 为什么需要它：页面自检（`web-editor/src/store/selfCheck.ts`，几百条断言）只把结论写进
 * `document.title` 与右下角浮层 —— 没有 CLI 出口时，"跑没跑过、过了多少"只能靠人开窗口肉眼看，
 * 于是很容易变成"我记得它过"。这里用 **CDP**（`--remote-debugging-port`）把标题读回来，
 * 让 `?check=1` 成为可脚本化、可留证据的闸门（P2 的"一条命令跑完所有闸门"会用上它）。
 *
 * 退出码：0 = 全绿；1 = 有失败或超时。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// 用 Node 内置 WebSocket（≥22）：apps/desktop 里没有 ws 依赖，别为此加一个（CDP 只需发一条 evaluate）

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, '..');
const PORT = Number(process.env.CHECK_CDP_PORT ?? 9223);
/**
 * 总超时。★别调小：自检的交互段有几百条断言，每条都带 `await wait(...)` 与真实指针事件，
 * 整体约 2–4 分钟。默认 3 分钟时**偶尔会踩线**，表现是"标题停在 17/17 + 超时"，
 * 看起来像自检卡住 —— 实际只是我给的预算不够（排查过一次）。给到 8 分钟。
 */
const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS ?? 480000);
const KEEP = process.argv.includes('--keep');

/** electron 可执行文件：优先 node_modules 里的，找不到就退回 PATH 上的 electron */
function electronBin() {
  const local = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
  return existsSync(local) ? local : 'electron';
}

/**
 * ★独立的 userData 目录：桌面版有**单实例锁**（`app.requestSingleInstanceLock()`）。
 * 用户可能正开着编辑器（例如 win-unpacked 那份），若共用 userData，我们起的这个实例会被锁挤掉、
 * 立刻 `app.quit()`（表现为"启动了又马上退出"）。换个目录 = 另起一个互不干扰的实例。
 */
const userDataDir = join(tmpdir(), `dsh-checkpage-${process.pid}`);
mkdirSync(userDataDir, { recursive: true });

const child = spawn(electronBin(), ['.', '--check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`], {
  cwd: APP_DIR,
  // ★必须清掉：被继承时 Electron 会当 Node 跑，`--check` 直接报 bad option
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let appLog = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => {
  appLog += String(d);
});
child.on('exit', (code) => {
  if (!finished) console.error(`桌面版提前退出：code=${code}`);
});

const finish = (code) => {
  if (!KEEP) {
    try {
      child.kill();
    } catch {
      /* 已退出 */
    }
  }
  process.exit(code);
};
let finished = false;

/** 等 CDP 起来并找到页面目标 */
async function findTarget() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string');
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(400);
  }
  return null;
}

/** 通过 CDP 读一次 document.title（用内置 WebSocket：addEventListener 风格） */
function readTitle(wsUrl) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      resolvePromise(v);
    };
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      resolvePromise('');
      return;
    }
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            // 一次读两样：标题 + "真正跑完"的标记（自检会先发布一次阶段性结论，见 selfCheck.finish(final)）
            expression: `JSON.stringify({ title: document.title, done: document.documentElement.dataset.selfcheckDone ?? '' })`,
            returnByValue: true,
          },
        }),
      );
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === 1) {
          try {
            done(JSON.parse(msg.result?.result?.value ?? '{}'));
          } catch {
            done({ title: String(msg.result?.result?.value ?? ''), done: '' });
          }
        }
      } catch {
        /* 忽略 */
      }
    });
    ws.addEventListener('error', () => done({ title: '', done: '' }));
    setTimeout(() => done({ title: '', done: '' }), 4000);
  });
}

/** 读报告浮层里的 FAIL 行（`data-check-report` 由 selfCheck.renderReport 写） */
function readFails(wsUrl) {
  return new Promise((resolvePromise) => {
    const expression = `JSON.stringify((window.__dshCheckResults || []).filter((r) => !r.pass).map((r) => r.name))`;
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      resolvePromise(v);
    };
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      resolvePromise([]);
      return;
    }
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === 2) {
          try {
            done(JSON.parse(msg.result?.result?.value ?? '[]'));
          } catch {
            done([]);
          }
        }
      } catch {
        /* 忽略 */
      }
    });
    ws.addEventListener('error', () => done([]));
    setTimeout(() => done([]), 4000);
  });
}

/**
 * 旁路监听页面异常（CDP `Runtime.exceptionThrown` + console.error）。
 * 为什么需要：自检是 async 链（`interactionChecks().then(...finish)`），中途抛异常时**标题永远停在
 * 上一个阶段**（表现为"卡住"），只看标题根本不知道错在哪 —— 这正是第一次接 M-11 时踩到的坑。
 */
function watchExceptions(wsUrl) {
  const errors = [];
  const ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: 900, method: 'Runtime.enable' }));
  });
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails ?? {};
        const text = d.exception?.description ?? d.text ?? '(无描述)';
        errors.push(String(text).split('\n').slice(0, 3).join(' | '));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
        if (text.trim()) errors.push(`console.error: ${text.slice(0, 200)}`);
      }
    } catch {
      /* 忽略 */
    }
  });
  return { errors, close: () => { try { ws.close(); } catch { /* 忽略 */ } } };
}

/** 读报告浮层的最后几行（卡住时用来看"跑到哪一条"） */
function readReportTail(wsUrl) {
  return new Promise((resolvePromise) => {
    const expression = `JSON.stringify([...document.querySelectorAll('[data-check-report] div')].slice(-6).map((d)=>d.textContent||''))`;
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      resolvePromise(Array.isArray(v) ? v : []);
    };
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      resolvePromise([]);
      return;
    }
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 901, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === 901) done(JSON.parse(msg.result?.result?.value ?? '[]'));
      } catch {
        /* 忽略 */
      }
    });
    ws.addEventListener('error', () => done([]));
    setTimeout(() => done([]), 3000);
  });
}

const target = await findTarget();
if (!target) {
  console.error(`CDP 没起来（端口 ${PORT}）—— 桌面版日志尾部：\n${appLog.slice(-800)}`);
  finished = true;
  finish(1);
}

console.log(`页面自检中（CDP ${PORT}）… 目标：${target.url}`);
const watcher = watchExceptions(target.webSocketDebuggerUrl);
const deadline = Date.now() + TIMEOUT_MS;
let title = '';
let doneFlag = '';
let stageShown = false;
while (Date.now() < deadline) {
  const snap = await readTitle(target.webSocketDebuggerUrl);
  title = snap.title ?? '';
  doneFlag = snap.done ?? '';
  if (/^check:\s*\d+\/\d+/.test(title)) {
    // 有阶段性结论也打印一次（便于盯着看），但只有 done=1 才是全量
    if (doneFlag === '1') break;
    if (!stageShown) {
      console.log(`  （阶段性：${title} —— 还在跑 DOM/交互段）`);
      stageShown = true;
    }
  }
  await sleep(700);
}

if (doneFlag !== '1' || !/^check:\s*\d+\/\d+/.test(title)) {
  const tail = await readReportTail(target.webSocketDebuggerUrl);
  watcher.close();
  console.error(`等自检结论超时（最后标题：${title || '(空)'}，done=${doneFlag || '-'}）`);
  if (watcher.errors.length) {
    console.error(`页面异常 ${watcher.errors.length} 条：`);
    for (const e of watcher.errors.slice(0, 5)) console.error('  ! ' + e);
  }
  if (tail.length) {
    console.error('报告浮层最后几条：');
    for (const t of tail) console.error('  · ' + t.slice(0, 150));
  }
  console.error(`桌面版日志尾部：\n${appLog.slice(-500)}`);
  finished = true;
  finish(1);
}
watcher.close();

console.log(`自检结论：${title}`);
const m = /^check:\s*(\d+)\/(\d+)/.exec(title);
const good = Number(m[1]);
const total = Number(m[2]);

/** 有失败时把 FAIL 明细读回来（报告浮层里有逐条结果）——只报结果不给证据等于没跑 */
if (good !== total) {
  const fails = await readFails(target.webSocketDebuggerUrl);
  console.error(`\n失败 ${total - good} 条：`);
  // 压成一行：断言名里可能带换行/HTML，直接打印会把后面的条目挤掉（排查时踩过）
  for (const f of fails) console.error('  ✗ ' + String(f).replace(/\s+/g, ' ').slice(0, 300));
}
finished = true;
if (KEEP) {
  console.log('（--keep：桌面版保持打开，Ctrl+C 结束）');
  process.exitCode = good === total ? 0 : 1;
} else {
  finish(good === total ? 0 : 1);
}
