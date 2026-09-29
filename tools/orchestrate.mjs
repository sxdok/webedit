/**
 * 仓库编排（P2① / §5.7）：把"一条命令跑完构建与闸门"从 README 里的命令清单变成可执行脚本。
 *
 *   node tools/orchestrate.mjs setup     # 三个包各自装依赖
 *   node tools/orchestrate.mjs build     # 契约 → MCP 编译 → 编辑器构建 → MCP 单文件打包
 *   node tools/orchestrate.mjs verify    # 默认闸门（快）：契约一致 + 两端编译 + 单测 + 桌面 verify
 *   node tools/orchestrate.mjs verify --full   # 再加：auth/会话/多实例/各 smoke/页面自检/PDF/Word
 *   node tools/orchestrate.mjs dist      # 打包桌面发行物（electron-builder）
 *
 * ★为什么用脚本而不是把一堆 `&&` 写进 package.json：
 *   · 每步要**打印一行结论**（谁过了、谁没过、失败时给可行动提示），npm 的 `&&` 链做不到；
 *   · 步骤之间有共享上下文（workspace 根、npm 可执行文件、Windows 下的 `.cmd` 后缀）；
 *   · 将来 P3 目录重排会改路径，只改这一个文件即可。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const full = process.argv.includes('--full');

/**
 * ★P3-M4：「运行数据」统一落仓库根 `var/` —— 别再把 npm / Electron / electron-builder 的缓存与各包日志
 * 塞进源码目录（实测那三份缓存加起来 **1.1GB**，混在源码树里既难看清也容易误提交）。
 *
 * 这里对**本编排启动的所有子进程**统一设三个环境变量；npm 认 `npm_config_cache`，
 * Electron 与 electron-builder 分别认 `ELECTRON_CACHE` / `ELECTRON_BUILDER_CACHE`。
 * 在包目录里自己 `npm install` 不受影响 —— 想统一就统一走根上的 `npm run …`。
 */
const VAR_DIR = path.join(repo, 'var');
const VAR_ENV = {
  npm_config_cache: path.join(VAR_DIR, 'caches', 'npm'),
  ELECTRON_CACHE: path.join(VAR_DIR, 'caches', 'electron'),
  ELECTRON_BUILDER_CACHE: path.join(VAR_DIR, 'caches', 'electron-builder'),
};
for (const p of [...Object.values(VAR_ENV), path.join(VAR_DIR, 'logs')]) mkdirSync(p, { recursive: true });

/** 跑一条命令；失败即抛（返回码非 0 → 终止编排，保留原始退出码） */
function run(label, cmd, args, cwd = repo) {
  process.stdout.write(`\n━━ ${label}\n   $ ${cmd} ${args.join(' ')}${cwd === repo ? '' : `   （在 ${path.relative(repo, cwd)}）`}\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...VAR_ENV } });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} 失败（退出码 ${r.status ?? '未知'}）`);
    process.exit(r.status ?? 1);
  }
  console.log(`✓ ${label}`);
}

const node = (label, script, cwd = repo, extra = []) => run(label, process.execPath, [script, ...extra], cwd);
const npmRun = (label, script, cwd) => run(label, NPM, ['run', script], cwd);

const steps = {
  setup() {
    for (const dir of ['editor-mcp', 'web-editor', 'apps/desktop']) {
      run(`安装依赖：${dir}`, NPM, ['install'], path.join(repo, dir));
    }
    console.log('\n★提示：桌面版与编辑器都装好后，`npm run build` 与 `npm run verify` 才算可复现。');
  },
  build() {
    node('生成契约（版本/协议/方法清单/表格内核同源）', 'tools/sync-contracts.mjs');
    npmRun('编译 editor-mcp（tsc -b）', 'build', path.join(repo, 'editor-mcp'));
    npmRun('构建 web-editor（vite）', 'build', path.join(repo, 'web-editor'));
    npmRun('打包 MCP 单文件（bundle:mcp）', 'bundle:mcp', path.join(repo, 'apps', 'desktop'));
  },
  verify() {
    node('契约与磁盘一致（--check）', 'tools/sync-contracts.mjs', repo, ['--check']);
    npmRun('editor-mcp 类型检查（tsc -b）', 'typecheck', path.join(repo, 'editor-mcp'));
    npmRun('editor-mcp 单元测试（vitest）', 'test', path.join(repo, 'editor-mcp'));
    npmRun('构建 web-editor（vite：tsc + 打包）', 'build', path.join(repo, 'web-editor'));
    /* ★把 MCP 单文件打包也放进**默认**闸门：它是发行物的前置步骤，而且很容易被"顺手改一行"弄坏
       （本轮就发生过：改了 bundle-mcp 的 esbuild 解析、用了个没导入的 `path`，
       默认闸门没跑它 → 漏过。放进默认档后这类破坏当场就红）。 */
    npmRun('打包 MCP 单文件（bundle:mcp）', 'bundle:mcp', path.join(repo, 'apps', 'desktop'));
    npmRun('静态服务器契约（端点集 JS↔Python + 形状/安全负例）', 'check:server', path.join(repo, 'apps', 'desktop'));
    /* P3.5：userData 改名迁移的自检（清单/复核/回退/幂等/跨卷，全在临时目录里做，不碰真实用户数据） */
    npmRun('userData 迁移自检', 'check:userdata', path.join(repo, 'apps', 'desktop'));
    npmRun('桌面版静态闸门（verify）', 'verify', path.join(repo, 'apps', 'desktop'));
    if (full) {
      for (const s of ['auth-check.mjs', 'session-revive-check.mjs', 'multi-connection-check.mjs', 'bridge-smoke.mjs', 'tools-smoke.mjs', 'table-smoke.mjs', 'http-smoke.mjs', 'plugin-smoke.mjs', 'rpc-smoke.mjs']) {
        node(`MCP 检查：${s}`, path.join('editor-mcp', 'scripts', s), path.join(repo, 'editor-mcp'));
      }
      npmRun('页面自检（CDP 无头，约 3 分钟）', 'check:page', path.join(repo, 'apps', 'desktop'));
      npmRun('PDF 空白页样张矩阵', 'check:pdf', path.join(repo, 'apps', 'desktop'));
      node('Word 语义端到端（真 Word 转 PDF）', 'apps/desktop/scripts/docx-word-check.mjs');
    } else {
      console.log('\n★默认闸门是"快"档：跳过了 MCP 各 smoke、页面自检、PDF/Word 端到端。');
      console.log('  跑全量：npm run verify:full');
    }
  },
  dist() {
    if (!existsSync(path.join(repo, 'dist', 'web', 'index.html'))) {
      console.error('✗ 还没构建 web-editor（dist/web/index.html 不存在）—— 先跑 `npm run build`');
      process.exit(1);
    }
    npmRun('打包桌面发行物（electron-builder）', 'dist', path.join(repo, 'apps', 'desktop'));
  },
};

const action = process.argv[2];
if (!action || !steps[action]) {
  console.error(`用法：node tools/orchestrate.mjs <setup|build|verify|dist> [--full]\n收到：${action ?? '(空)'}`);
  process.exit(2);
}
steps[action]();
console.log(`\n★ ${action} 完成${full ? '（--full）' : ''}`);
