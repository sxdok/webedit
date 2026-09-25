/**
 * 路径布局：**一套代码同时跑在「仓库里（dev）」和「装完的安装包（packaged）」**。
 *
 * 为什么单独一个文件：这两套布局差别很大（安装包里 `web-editor/dist` 在 `resources/` 下、
 * 用户文档与日志必须落在 `userData`，因为安装目录通常是只读的），把判断集中在一处，
 * 免得散落在 main / server / supervisor 里各写一遍 if (app.isPackaged)。
 *
 * 另外：本模块**不 import electron**，只接收已经问好的路径 —— 这样 `scripts/verify-desktop.mjs`
 * 能在纯 Node 下把布局与后续模块一起验掉。
 *
 * dev 布局（仓库根 = E:\可视化编辑器）：
 *   apps/desktop/{main.js, config/…}
 *   web-editor/{dist/, public/组件/, logs/, docs/}
 *   editor-mcp/{dist/index.js, node_modules/, workspace/}
 *   tools/secure-config/secure-config.mjs
 *
 * packaged 布局（electron-builder，asar 关不住子进程，所以业务资源都走 extraResources）：
 *   resources/web-editor/{dist/, public/组件/}
 *   resources/editor-mcp/{dist/, node_modules/}
 *   resources/tools/secure-config/secure-config.mjs
 *   resources/config/{app-config.enc, buildKey.js}      ← **明文文件**，换更新地址时直接替换
 *   <app.asar>/apps/desktop/{main.js, preload.cjs, src/}
 *   用户数据（日志/文档/组件覆盖）→ %APPDATA%/可视化编辑器/…
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本文件所在目录（src/）；用 fileURLToPath 而不是 import.meta.dirname，兼容 Electron 自带的旧 Node */
export const SRC_DIR = dirname(fileURLToPath(import.meta.url));
/** apps/desktop/ */
export const APP_DIR = resolve(SRC_DIR, '..');

const pickDir = (...cands) => cands.find((p) => p && existsSync(p)) ?? null;

/**
 * @param {object} o
 * @param {boolean} o.isPackaged       Electron 的 app.isPackaged
 * @param {string}  o.resourcesPath    packaged：process.resourcesPath；dev：无所谓
 * @param {string}  o.userDataPath     app.getPath('userData')：日志、文档、组件覆盖都落这里
 * @param {string}  [o.nodeBin]        跑子进程用的可执行文件（默认 process.execPath + ELECTRON_RUN_AS_NODE）
 * @param {string}  [o.configDir]      显式指定的配置目录（--config-dir / 环境变量）
 * @param {NodeJS.ProcessEnv} [o.env]
 */
export function resolveLayout({ isPackaged, resourcesPath, userDataPath, nodeBin, configDir, env = process.env }) {
  const repoRoot = isPackaged ? null : resolve(APP_DIR, '..', '..');

  // ── 业务资源：dev 读仓库，packaged 读 resources/ ──
  const webRoot = isPackaged
    ? pickDir(join(resourcesPath, 'web-editor'))
    : pickDir(join(repoRoot, 'web-editor'));
  const distDir = webRoot ? join(webRoot, 'dist') : null;
  const bundledComponents = webRoot
    ? pickDir(join(webRoot, 'public', '组件'), join(webRoot, 'dist', '组件'))
    : null;

  const mcpRoot = isPackaged
    ? pickDir(join(resourcesPath, 'editor-mcp'))
    : pickDir(join(repoRoot, 'editor-mcp'));
  const mcpDistEntry = mcpRoot ? join(mcpRoot, 'dist', 'index.js') : null;
  /**
   * 优先用**单文件打包**出来的 MCP（`scripts/bundle-mcp.mjs`）：
   * 仓库里的 `editor-mcp/node_modules` 是符号链接拼的（指向 DSH 的 pnpm store），**装不进安装包**；
   * 单文件 2.4MB、自包含，是分发版唯一可靠形态。没有单文件时才退回 dist 目录（开发者本机）。
   */
  const mcpBundle = isPackaged
    ? pickDir(join(resourcesPath, 'editor-mcp-bundle'))
    : pickDir(join(APP_DIR, 'dist-mcp'));
  const mcpBundleEntry = mcpBundle ? join(mcpBundle, 'editor-mcp.bundle.mjs') : null;
  const mcpEntry = mcpBundleEntry && existsSync(mcpBundleEntry) ? mcpBundleEntry : mcpDistEntry;

  // ── 加密配置与密钥：packaged 优先 resources/config（明文文件、可整包替换，不用重新打包）──
  const explicitConfigDir = configDir || env.EDITOR_DESKTOP_CONFIG_DIR || null;
  const resolvedConfigDir =
    explicitConfigDir ??
    (isPackaged ? pickDir(join(resourcesPath, 'config')) ?? join(resourcesPath, 'config') : join(APP_DIR, 'config'));

  // ── 加密核心（独立的那个文件）：dev 直读 tools/，packaged 读 resources/tools/ ──
  const secureConfigCore = isPackaged
    ? pickDir(join(resourcesPath, 'tools', 'secure-config', 'secure-config.mjs'))
    : pickDir(join(repoRoot, 'tools', 'secure-config', 'secure-config.mjs'));

  // ── 可写数据：**永远不写安装目录**（Program Files 下普通用户没权限）──
  const dataRoot = userDataPath;
  const userComponents = join(dataRoot, '组件');

  return {
    mode: isPackaged ? 'packaged' : 'dev',
    repoRoot,
    appDir: APP_DIR,
    resourcesPath: isPackaged ? resourcesPath : null,
    webRoot,
    distDir,
    /** 外部（热加载）组件目录：用户目录里有就用用户的（装完还能加组件），否则用随包的那份 */
    componentsDir: existsSync(userComponents) ? userComponents : bundledComponents,
    bundledComponentsDir: bundledComponents,
    userComponentsDir: userComponents,
    mcpRoot,
    mcpEntry,
    /** 单文件 MCP（打包用；不存在时为 null，此时 mcpEntry 指向 dist 目录） */
    mcpBundleEntry,
    /** MCP 的无头文档目录：分发版用 userData/workspace，绝不写安装目录 */
    mcpWorkspace: isPackaged ? join(dataRoot, 'workspace') : mcpRoot && join(mcpRoot, 'workspace'),
    pluginDir: bundledComponents,
    logDir: join(dataRoot, 'logs'),
    docsDir: join(dataRoot, 'docs'),
    dataRoot,
    configDir: resolvedConfigDir,
    configEncPath: join(resolvedConfigDir, 'app-config.enc'),
    configPlainPath: join(resolvedConfigDir, 'app-config.json'),
    configKeyPath: join(resolvedConfigDir, 'config.key'),
    /**
     * 构建期兜底密钥。**必须是 `.mjs`**：这个文件是 ESM 语法（`export const`），而它的落点是
     * 安装目录 / 免安装版解包出的临时目录 —— 那里向上找不到任何 `package.json`，
     * Node 会把 `.js` 当 CommonJS 解析，`import()` 直接 SyntaxError。
     * （真踩过：仓库里跑 win-unpacked 时恰好向上能找到 apps/desktop/package.json 而侥幸通过，
     *   一到免安装版的 %TEMP% 解包目录就"找不到密钥"。）老的 buildKey.js 仍兼容读取。
     */
    buildKeyPath: join(resolvedConfigDir, 'buildKey.mjs'),
    /** 老版本（或手写脚本）留下的 buildKey.js；仍兼容读取 */
    buildKeyLegacyPath: join(resolvedConfigDir, 'buildKey.js'),
    secureConfigCore,
    /** 用 Electron 自带的 Node 跑子进程（分发版机器上不一定装了系统 node） */
    nodeBin: nodeBin ?? process.execPath,
    nodeEnv: { ELECTRON_RUN_AS_NODE: '1' },
    /** 编辑器页面用「check=1」启动（自检） */
    checkMode: env.EDITOR_DESKTOP_CHECK === '1',
  };
}
