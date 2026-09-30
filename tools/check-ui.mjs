/**
 * 职责：**一条命令跑"看得见"的界面验证**（用户 2026-09-30 要求：测试不要走无头模式）。
 *
 * 它做四件事：
 *   1. 起本地静态启动器（`web-editor/启动编辑器.py -q -p <端口>`，只服务页面，不开窗口）；
 *   2. 等端口真的能访问；
 *   3. 用 `tools/cdp/eval.mjs --headful` 打开一个**真实可见的浏览器窗口**跑探针
 *      （默认 `?check=1` + `tools/cdp/probes/selfcheck.js` = 全量页面自检，人眼能看着它跑完）；
 *   4. 收尾：关掉启动器（浏览器窗口默认也会关；`--keep-open` 则两者都留着给你手动点）。
 *
 * 用法：
 *   node tools/check-ui.mjs                        # 可见窗口跑全量自检（约 3 分钟）
 *   node tools/check-ui.mjs --probe tools/cdp/probes/prefs-layout.js --query ""   # 换个探针 / 不开自检
 *   node tools/check-ui.mjs --keep-open            # 跑完把窗口留着
 *   node tools/check-ui.mjs --port 5188
 *
 * 判读结果：自检的结论在**页面标题**与右下角报告面板里（`check: N/N 全部通过` 才是全量，见 经验清单 G5）。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argAfter = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const port = Number(argAfter('--port') ?? 5179);
const probe = argAfter('--probe') ?? 'tools/cdp/probes/selfcheck.js';
const query = args.includes('--query') ? (argAfter('--query') ?? '') : 'check=1';
const keepOpen = args.includes('--keep-open');
const python = process.env.PYTHON ?? 'D:\\Python313\\python.exe';
const launcher = join(ROOT, 'web-editor', '启动编辑器.py');

if (!existsSync(launcher)) {
  console.error(`✗ 找不到启动器：${launcher}`);
  process.exit(2);
}
if (!existsSync(join(ROOT, probe))) {
  console.error(`✗ 找不到探针：${join(ROOT, probe)}`);
  process.exit(2);
}

const url = `http://127.0.0.1:${port}/${query ? `?${query}` : ''}`;
console.log(`▸ 起启动器（端口 ${port}）…`);
const server = spawn(python, ['-u', launcher, '-q', '-p', String(port)], { cwd: ROOT, stdio: 'ignore' });

/** 等页面真的能访问（最多 30 秒） */
let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    up = r.ok;
  } catch {
    /* 还没起来 */
  }
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) {
  console.error('✗ 启动器 30 秒内没能提供页面；先手动跑一次启动器看看报错。');
  server.kill();
  process.exit(1);
}
console.log(`▸ 页面就绪：${url}`);
console.log('▸ 打开**可见**浏览器窗口跑探针（人眼可看，关掉窗口即结束）…\n');

const code = await new Promise((res) => {
  const child = spawn(
    process.execPath,
    [join(ROOT, 'tools', 'cdp', 'eval.mjs'), url, join(ROOT, probe), '--headful', ...(keepOpen ? ['--keep-open'] : [])],
    { cwd: ROOT, stdio: 'inherit' },
  );
  child.on('exit', (c) => res(c ?? 0));
});

if (!keepOpen) {
  server.kill();
  console.log('\n▸ 已收尾（启动器与浏览器窗口都关掉了）。');
} else {
  console.log(`\n▸ --keep-open：窗口与启动器都留着 —— 页面 ${url}，看完自己关。`);
}
process.exit(code);
