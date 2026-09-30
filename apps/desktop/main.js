/**
 * 可视化编辑器 · 桌面分发版 —— Electron 主进程
 *
 * 启动顺序（每一步都写日志，出问题能顺着日志查）：
 *   ① 解析路径布局（dev / 安装包两套）
 *   ② 载入**加密配置**（`config/app-config.enc` + 随包密钥，见 src/secureConfig.js）
 *   ③ 起内置静态服务器（`server/webServer.js`，`启动编辑器.py` 的 Node 等价物）
 *   ④ 开窗口，加载 http://127.0.0.1:<port>/
 *   ⑤ 拉起 editor-mcp（HTTP 模式），外部 AI 客户端连 http://127.0.0.1:<port>/mcp
 *   ⑥ 注册菜单与 IPC：检查更新 / 打开下载页 / 复制 MCP 地址 / 重启 MCP / 打开日志目录
 *
 * 退出时按相反顺序收干净：MCP 子进程 → 静态服务器 → 窗口。
 *
 * 安全基线：contextIsolation=true、nodeIntegration=false、sandbox=true，
 * 渲染进程只能通过 preload 暴露的 `window.desktop` 那点能力跟主进程对话；
 * 站内导航被限制在本机地址，外链一律交给系统浏览器（`shell.openExternal`，且只放行 http/https）。
 */
import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';import { randomBytes } from 'node:crypto';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLayout } from './src/paths.js';
import { createLogger } from './src/logger.js';
import { resolveComponentsDir } from './src/components.js';
import { loadAppConfig, maskUrl, redactConfig } from './src/secureConfig.js';
import { createMcpSupervisor, probeMcp, setClientVersion } from './src/mcpSupervisor.js';
import { createUpdater } from './src/updater.js';
import { startWebServer } from './server/webServer.js';
import { LEGACY_USER_DATA_NAME, migrateUserData } from './src/userDataMigration.js';

/**
 * ★P3.5 / ARCHITECTURE §6.10：应用标识改成 `webedit`（**界面显示名不变**，仍是「可视化编辑器」）。
 * 必须在**任何** userData 访问之前 setName —— 包括下面的 `requestSingleInstanceLock()`
 * （它的锁文件就写在 userData 里）。这样 dev 与打包态的 userData 都是 `%APPDATA%\webedit`，
 * 不依赖 electron-builder 把 productName 注入运行时。
 */
app.setName('webedit');

const argv = process.argv.slice(1);
const isDev = argv.includes('--dev') || !app.isPackaged;
const wantCheck = argv.includes('--check') || process.env.EDITOR_DESKTOP_CHECK === '1';
/** 装完自检：真启动（含真开窗加载页面与真连 MCP），把结论写进报告文件后退出 */
const wantSelfTest = argv.includes('--selftest');

/**
 * ★P3.5 数据迁移：`%APPDATA%\可视化编辑器` → `%APPDATA%\webedit`（决策 #14：**移动** + 清单复核 + 回退 + 幂等）。
 * 放在这里（早于 `requestSingleInstanceLock`、早于任何窗口/会话创建）是必须的：
 * Chromium 一旦建了窗口就会往 userData 写文件，那时再改名会被占用而失败。
 * `migrateUserData` 自己绝不抛异常 —— 迁移出问题不该让应用起不来。
 */
const migration = migrateUserData({
  oldDir: join(app.getPath('appData'), LEGACY_USER_DATA_NAME),
  newDir: app.getPath('userData'),
  log: (msg, level) => (level === 'error' ? console.error(`[迁移] ${msg}`) : console.log(`[迁移] ${msg}`)),
});
if (migration.status !== 'noop' && migration.status !== 'skipped') {
  console.log(`[迁移] 结果=${migration.status}：${migration.detail}`);
}
/** 迁移结论留给页面提示条（在 boot 后派发；日志里也有一份） */
const migrationNotice =
  migration.status === 'moved' || migration.status === 'copy-moved'
    ? { kind: 'ok', title: '已迁移运行数据目录', detail: `运行数据已迁到 %APPDATA%\\webedit（${migration.files} 个文件，迁移前已复核哈希）。旧目录 %APPDATA%\\${LEGACY_USER_DATA_NAME} 不再使用。` }
    : migration.status === 'rolled-back'
      ? { kind: 'warn', title: '运行数据迁移已回退', detail: `${migration.detail}（改动已撤销，仍在原目录，数据未丢）` }
      : migration.status === 'conflict'
        ? { kind: 'warn', title: '运行数据目录需要人工确认', detail: migration.detail }
        : null;

/** 单实例：第二次点图标就把已有窗口抬起来（否则会出现两个 MCP 抢端口） */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

/** 无边框窗口顶部「标题栏覆盖层」的高度 = 网页菜单栏那一行的高度（36px）；两边必须一致，否则按钮会错位 */
const TITLEBAR_HEIGHT = 36;

/** @type {any} 全局运行时状态（窗口/服务/监管器/更新器） */
const runtime = {
  layout: null,
  log: null,
  cfg: null,
  configResult: null,
  web: null,
  win: null,
  mcp: null,
  updater: null,
  quitting: false,
  startupError: null,
  exitCode: 0,
  /**
   * 系统窗口按钮（最小化/最大化/关闭）的配色。首帧只能是浅色默认值 —— 主题存在网页的 localStorage 里，
   * 主进程读不到；网页一加载就会按真实主题同步一次（`desktop:set-titlebar`），所以这里只影响极短的一瞬。
   */
  titleBar: { color: '#ffffff', symbolColor: '#374151' },
  /** 页面加载完成（did-finish-load）的等待句柄，自检用 */
  pageReady: null,
};
const statusListeners = new Set();

function publishStatus() {
  if (!runtime.win || runtime.win.isDestroyed()) return;
  try {
    runtime.win.webContents.send('desktop:status-changed', buildStatus());
  } catch {
    /* 窗口正在销毁 */
  }
  for (const fn of statusListeners) {
    try {
      fn();
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 读取或生成 `userData/bridge-token`（P0 决策 #1）。
 *
 * 为什么放文件而不是每次随机：agent 侧的配置里要填**同一个值**，重启应用后不能变，
 * 否则用户每次重启都得重新复制配置。文件权限随 userData（本机当前用户可读）。
 *
 * 只给**本应用自己**用：注入自己拉起的 MCP + 经 desktop:status 交给本应用页面；
 * 绝不给其它 AI 客户端自动发放（那等于帮别人拿 token）—— 别的客户端由用户手工复制。
 */
function readOrCreateBridgeToken() {
  try {
    const file = join(app.getPath('userData'), 'bridge-token');
    try {
      const text = readFileSync(file, 'utf8').trim();
      if (text) return text;
    } catch {
      /* 不存在 → 生成 */
    }
    const token = randomBytes(24).toString('base64url');
    writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
    runtime.log?.info(`已生成 MCP 入站 token：${file}（agent 侧配置需要它，可在「工具 → MCP 桥接」一键复制）`);
    return token;
  } catch (e) {
    // 拿不到可写目录时不能因此起不来：退化为本次进程的随机 token（页面仍能用，agent 侧需重启后重新复制）
    runtime.log?.warn(`bridge-token 读写失败，改用本次进程的临时 token：${e instanceof Error ? e.message : String(e)}`);
    return randomBytes(24).toString('base64url');
  }
}

/**
 * 用户首选项（`userData/prefs.json`）—— 目前只有"允许 MCP 写操作"（决策 #2）。
 *
 * 为什么不直接改加密配置：那是**分发物**（只读、随包带），运行期改它没法回滚也不好审计；
 * 首选项是**用户数据**，放 userData 天经地义，且改完由应用重启 MCP 子进程真正生效。
 * 读失败一律按"用配置默认值"处理，绝不因首选项坏了起不来。
 */
function prefsPath() {
  return join(app.getPath('userData'), 'prefs.json');
}

function readPrefs() {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writePrefs(next) {
  const merged = { ...readPrefs(), ...next };
  try {
    writeFileSync(prefsPath(), JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    runtime.log?.warn(`首选项写入失败（${prefsPath()}）：${e instanceof Error ? e.message : String(e)}`);
  }
  runtime.prefs = merged;
  return merged;
}

/** 生效的写开关：首选项优先，其次加密配置；类型不对就回落到"关"（默认拒绝） */
function resolveAllowWrite(prefs, fromConfig) {
  const v = prefs?.mcp?.allowWrite;
  if (typeof v === 'boolean') return v;
  return fromConfig === true;
}

/**
 * 「最近打开」的持久化（M-11）。
 *
 * ★为什么放 `userData/recent-docs.json` 而不是浏览器的 localStorage：这里存的是**本地文件路径**，
 *   浏览器拿不到路径、也读不了别的文件；桌面版才能真正"点一下就重开"。
 *   两者刻意分开（方案 §7.2 M-11 的要求）：浏览器里那份只记名字，且如实说明点不开。
 *
 * 记录时机：打开成功、另存为、导出 JSON 各记一次；同路径去重（新记录顶到最前），最多 8 条。
 */
const RECENT_MAX = 8;

function recentsPath() {
  return join(app.getPath('userData'), 'recent-docs.json');
}

function readRecents() {
  try {
    const raw = JSON.parse(readFileSync(recentsPath(), 'utf8'));
    return Array.isArray(raw)
      ? raw.filter((r) => r && typeof r.path === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(entry) {
  if (!entry?.path) return readRecents();
  const next = [entry, ...readRecents().filter((r) => r.path !== entry.path)].slice(0, RECENT_MAX);
  try {
    writeFileSync(recentsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    runtime.log?.warn(`最近打开写入失败：${e instanceof Error ? e.message : String(e)}`);
  }
  return next;
}

function buildStatus() {
  const cfg = runtime.cfg;
  const mcp = runtime.mcp?.status() ?? null;  return {
    desktop: true,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    mode: runtime.layout?.mode ?? null,
    dev: isDev,
    server: runtime.web ? { url: runtime.web.url, port: runtime.web.port, distDir: runtime.web.distDir } : null,
    mcp,
    mcpUrl: mcp?.url ?? null,
    /** 生效的"允许 MCP 写操作"（决策 #2）：页面用它显示"已连接 · 写已禁用"三态 */
    mcpWriteEnabled: runtime.allowWrite === true,
    /** M-7：窗口是否处于全屏（F11 的行为要能被自检观测到，否则"按了没反应"验不出来） */
    fullscreen: runtime.win && !runtime.win.isDestroyed() ? runtime.win.isFullScreen() : false,
    update: runtime.updater?.status() ?? null,
    config: runtime.configResult ? redactConfig(runtime.configResult) : null,
    logDir: runtime.layout?.logDir ?? null,
    dataRoot: runtime.layout?.dataRoot ?? null,
    componentsDir: runtime.components?.dir ?? null,
    startupError: runtime.startupError,
    title: cfg?.app?.title ?? '可视化编辑器',
  };
}

/* ══════════════════ ① ~ ③ 启动 ══════════════════ */

async function boot() {
  // 探测/握手时自报的版本：用应用真实版本，而不是源码里再抄一份常量（版本号已经散落多处，能少一处是一处）
  setClientVersion(app.getVersion());
  runtime.layout = resolveLayout({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    configDir: argValue('--config-dir'),
  });
  runtime.log = createLogger({ logDir: runtime.layout.logDir, minLevel: 'debug' });
  const log = runtime.log;
  log.info(`=== 可视化编辑器桌面版启动 v${app.getVersion()}（mode=${runtime.layout.mode}，pid=${process.pid}）===`);
  log.info(`布局：webRoot=${runtime.layout.webRoot} mcpEntry=${runtime.layout.mcpEntry} 日志=${runtime.layout.logDir}`);
  if (isDev) log.warn('当前是开发模式（未打包）：加载的是仓库里的 dist/web 与 editor-mcp/dist');

  // ② 加密配置
  runtime.configResult = await loadAppConfig({ layout: runtime.layout, logger: log });
  runtime.cfg = runtime.configResult.config;
  // ②·补充：写开关（决策 #2）—— 加密配置给**默认值（分发版为 false）**，
  // 用户在本应用「首选项」里的改动落在 userData/prefs.json（不改加密配置），重启 MCP 生效。
  runtime.prefs = readPrefs();
  runtime.allowWrite = resolveAllowWrite(runtime.prefs, runtime.cfg.mcp.allowWrite);
  // 日志器必须在配置之前就存在（配置可能读失败也要能记日志），所以这里再按 logging.level 调整落盘级别
  log.setLevel(runtime.cfg.logging.level);
  log.info(`落盘日志级别：${log.level()}（配置 logging.level；环形缓冲不受影响）`);
  if (runtime.configResult.meta.problems.length) {
    // 配置坏掉不阻塞启动，但要让人知道（无窗口阶段先记日志，窗口出来后弹一次）
    log.error(`配置有 ${runtime.configResult.meta.problems.length} 个问题，已按默认值兜底启动`);
  }

  // ③ 静态服务器
  //  组件目录先落地：分发版要把随包组件"种子"拷进 userData（安装目录只读，导入组件包/ MCP 写插件都得有可写目录）
  runtime.components = resolveComponentsDir({
    mode: runtime.layout.mode,
    bundledDir: runtime.layout.bundledComponentsDir,
    userDir: runtime.layout.userComponentsDir,
    logger: log,
  });
  try {
    runtime.web = await startWebServer({
      rootDir: runtime.layout.webRoot,
      port: runtime.cfg.server.port || 0,
      host: runtime.cfg.server.host,
      quiet: true,
      // ★安装目录通常只读：日志/文档/组件写到 userData（见 src/paths.js）
      logDir: runtime.layout.logDir,
      docsDir: runtime.layout.docsDir,
      componentsDir: runtime.components.dir ?? runtime.layout.componentsDir,
    });
    log.info(`静态服务器就绪：${runtime.web.url}（dist=${runtime.web.distDir}）`);
  } catch (e) {
    runtime.startupError = `静态服务器启动失败：${e instanceof Error ? e.message : String(e)}`;
    log.error(runtime.startupError);
  }

  // ⑥ 更新器（只读加密配置里的地址）
  runtime.updater = createUpdater({
    config: runtime.cfg.update,
    currentVersion: app.getVersion(),
    logger: log,
    openExternal: (url) => openExternal(url),
  });

  // ④ 窗口
  createWindow();

  // 配置里要求"用系统浏览器打开一份"时额外开一份（默认 false：用应用自己的窗口）
  if (runtime.cfg.server.openBrowser && runtime.web) {
    void openExternal(runtime.web.url).then((r) => log.info(`按配置 server.openBrowser=true 用系统浏览器打开 ${runtime.web.url}（${r.ok ? '已打开' : `失败：${r.error}`}）`));
  }

  // ⑤ MCP
  if (runtime.cfg.mcp.enabled) {
    runtime.mcp = createMcpSupervisor({
      nodeBin: runtime.layout.nodeBin,
      nodeEnv: runtime.layout.nodeEnv,
      mcpEntry: runtime.layout.mcpEntry,
      mcpRoot: runtime.layout.mcpRoot,
      host: runtime.cfg.mcp.host,
      port: runtime.cfg.mcp.httpPort,
      bridgePort: runtime.cfg.mcp.bridgePort,
      workspace: runtime.layout.mcpWorkspace,
      pluginDir: runtime.components.dir ?? runtime.layout.pluginDir,
      allowWrite: runtime.allowWrite,
      readyTimeoutMs: runtime.cfg.mcp.readyTimeoutMs,
      autoRestart: runtime.cfg.mcp.autoRestart,
      // P0 决策 #1：桌面版**自动发放** token —— 生成/复用 userData/bridge-token，
      // 注入自己拉起的 MCP，并经 desktop:status 交给本应用页面（页面在 bridge.hello 里带上它）。
      // ★只给本应用自己用：其它 AI 客户端不会被自动发 token，只能人工复制带 token 的配置。
      token: readOrCreateBridgeToken(),
      logger: log,
    });
    runtime.mcp.onStatus(publishStatus);
    void runtime.mcp.start().then((st) => {
      log.info(`MCP 状态：${st.state}${st.external ? '（接管已有进程）' : ''} ${st.url}${st.lastError ? ` 错误：${st.lastError}` : ''}`);
      // 桥接中转被别人占着（本机常有：DSH 自己也起了一个 editor-mcp）时，MCP 会照常服务，
      // 但**编辑器页面的 Live 通道会连到那个旧实例**上。这件事必须说清楚，否则"MCP 明明起来了却联动不了"。
      if (log.tail(400).some((l) => l.includes('桥接中转未能启动'))) {
        log.warn(`桥接中转端口 ${runtime.cfg.mcp.bridgePort} 已被别的进程占用：本应用的 MCP 仍可用（文档/组件/导出等工具都在），但编辑器页面的 Live 通道指向的是那个已在运行的实例`);
      }
      publishStatus();
    });
  } else {
    log.warn('配置里 mcp.enabled=false：本次不启动 MCP 服务');
  }

  // ⑦ 装完自检（`--selftest`）：跑完写报告并退出
  if (wantSelfTest) void runSelfTest();
}

if (gotLock) {
  app.on('second-instance', () => {
    if (runtime.win && !runtime.win.isDestroyed()) {
      if (runtime.win.isMinimized()) runtime.win.restore();
      runtime.win.show();
      runtime.win.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    installWindowChrome();
    boot().catch((e) => {
      runtime.startupError = e instanceof Error ? e.message : String(e);
      runtime.log?.error(`启动失败：${runtime.startupError}`);
      dialog.showErrorBox('启动失败', runtime.startupError);
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', (e) => {
    if (runtime.quitting) return;
    runtime.quitting = true;
    e.preventDefault();
    shutdown().finally(() => app.exit(runtime.exitCode ?? 0));
  });
}

async function shutdown() {
  const log = runtime.log;
  log?.info('开始收尾：停止 MCP → 关闭静态服务器');
  try {
    await runtime.mcp?.stop();
  } catch (e) {
    log?.warn(`停止 MCP 出错：${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await runtime.web?.close();
  } catch (e) {
    log?.warn(`关闭静态服务器出错：${e instanceof Error ? e.message : String(e)}`);
  }
  log?.info('收尾完成，退出');
}

/* ══════════════════ ④ 窗口 ══════════════════ */

function createWindow() {
  const url = runtime.web ? runtime.web.url + (wantCheck ? '?check=1' : '') : null;
  /**
   * 窗口外观：**无边框 + 标题栏覆盖**（Windows 上叫 WCO），让边框与网页连成一体：
   *   · `titleBarStyle: 'hidden'` —— 不画原生标题栏（连带原生菜单栏也不画）；
   *   · `titleBarOverlay`        —— 系统的最小化/最大化/关闭按钮以覆盖层画在**网页右上角**，
   *     颜色由网页按当前主题告诉我们（`desktop:set-titlebar`，见 web-editor/src/utils/desktopChrome.ts）；
   *   · 网页侧把菜单栏那一行声明成拖拽区（`-webkit-app-region: drag`）并给按钮留位。
   * 这样只有**一层**菜单：网页自己的「文件/编辑/视图/页面/桌面/帮助」。
   */
  const barColor = runtime.titleBar.color;
  runtime.win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: barColor,
    title: runtime.cfg?.app?.title ?? '可视化编辑器',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: barColor, symbolColor: runtime.titleBar.symbolColor, height: TITLEBAR_HEIGHT },
    webPreferences: {
      // ★必须用 fileURLToPath：直接拿 URL.pathname 在 Windows 上会变成 `/E:/…`（多一个斜杠）
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  runtime.win.once('ready-to-show', () => runtime.win.show());
  runtime.win.on('closed', () => {
    runtime.win = null;
  });
  // 自检要等"页面真的加载完"：这里把 did-finish-load / did-fail-load 都变成可等待的句柄
  runtime.pageReady = new Promise((resolve) => {
    const done = (v) => resolve(v);
    runtime.win.webContents.once('did-finish-load', () => done({ ok: true }));
    runtime.win.webContents.once('did-fail-load', (_e, code, desc) => done({ ok: false, error: `${code} ${desc}` }));
    setTimeout(() => done({ ok: false, error: '等待页面加载超时（30s）' }), 30000).unref?.();
  });

  // 外链一律交给系统浏览器；应用自身只允许待在本机地址
  runtime.win.webContents.setWindowOpenHandler(({ url: target }) => {
    void openExternal(target, { silent: true });
    return { action: 'deny' };
  });
  runtime.win.webContents.on('will-navigate', (event, target) => {
    if (runtime.web && target.startsWith(runtime.web.url)) return;
    event.preventDefault();
    void openExternal(target, { silent: true });
  });
  runtime.win.webContents.on('render-process-gone', (_e, details) => {
    runtime.log?.error(`渲染进程异常退出：${details.reason}（exitCode=${details.exitCode}）`);
  });
  runtime.win.webContents.on('did-fail-load', (_e, code, desc, target) => {
    runtime.log?.error(`页面加载失败：${code} ${desc} ← ${target}`);
  });

  if (!url) {
    runtime.win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<h2 style="font-family:system-ui;padding:24px">启动失败</h2><p style="font-family:system-ui;padding:0 24px">${runtime.startupError ?? '未知错误'}</p><p style="font-family:system-ui;padding:0 24px;color:#666">日志目录：${runtime.layout?.logDir ?? ''}</p>`,
      )}`,
    );
  } else {
    runtime.win.loadURL(url);
  }

  if (isDev && argv.includes('--devtools')) runtime.win.webContents.openDevTools({ mode: 'detach' });

  runtime.win.webContents.on('did-finish-load', () => {
    publishStatus();
    /* ★P3.5：迁移结果在页面里用**提示条**说明（规格要求"日志 + 提示条"）。
       页面侧监听 `editor:notice` 自定义事件（见 web-editor 的 NoticeBar）。 */
    if (migrationNotice) {
      runtime.log?.[migrationNotice.kind === 'ok' ? 'info' : 'warn'](`迁移提示条：${migrationNotice.title} —— ${migrationNotice.detail}`);
      void runtime.win.webContents
        .executeJavaScript(
          `window.dispatchEvent(new CustomEvent('editor:notice',{detail:${JSON.stringify(migrationNotice)}}));true`,
        )
        .catch((e) => runtime.log?.warn(`迁移提示条派发失败：${e.message}`));
    }
    const problems = runtime.configResult?.meta?.problems ?? [];
    if (problems.length) {
      void dialog.showMessageBox(runtime.win, {
        type: 'warning',
        title: '配置有问题（已用默认值兜底）',
        message: `加密配置文件有 ${problems.length} 个问题，应用已按默认值启动。`,
        detail: problems.join('\n'),
        buttons: ['知道了', '打开日志目录'],
        defaultId: 0,
        cancelId: 0,
      }).then((r) => {
        if (r.response === 1) void openPath(runtime.layout.logDir);
      });
    }
  });
}

/* ══════════════════ ⑦ 装完自检（--selftest） ══════════════════ */

/**
 * "装完自检"：与正常启动**走完全一样的过程**（读加密配置 → 起静态服务器 → 开窗加载页面 →
 * 拉起 MCP → 真握手 + tools/list），只是最后把结论写成 JSON 报告再退出。
 *
 * 为什么要有它：分发版是双击启动的、没有终端；用户说"打不开"时，让他在命令行跑
 * `可视化编辑器.exe --selftest` 就能拿到一份可发回来的报告，比截图和猜测有用得多。
 * 退出码：0 = 全通过，1 = 有失败项。
 */
async function runSelfTest() {
  const log = runtime.log;
  const checks = [];
  const add = (name, pass, evidence) => {
    checks.push({ name, pass: Boolean(pass), evidence: evidence === undefined ? null : String(evidence) });
    log[pass ? 'info' : 'error'](`自检：${pass ? 'PASS' : 'FAIL'} ${name}${evidence === undefined ? '' : ` → ${evidence}`}`);
  };
  const report = {
    runAt: new Date().toISOString(),
    app: { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    mode: runtime.layout?.mode ?? null,
    userData: runtime.layout?.dataRoot ?? null,
    config: runtime.configResult
      ? { source: runtime.configResult.meta.source, keySource: runtime.configResult.meta.keySource, problems: runtime.configResult.meta.problems, warnings: runtime.configResult.meta.warnings, updateBaseUrl: maskUrl(runtime.cfg.update.baseUrl) }
      : null,
    checks,
  };

  // ① 加密配置
  add('加密配置读取（能解开、无致命问题）', runtime.configResult?.meta.source === 'encrypted' && (runtime.configResult?.meta.problems.length ?? 1) === 0, `来源=${runtime.configResult?.meta.source} 密钥=${runtime.configResult?.meta.keySource} 问题数=${runtime.configResult?.meta.problems.length ?? '?'}`);

  // ② 静态服务器（真的 HTTP 取一次首页）
  if (runtime.web) {
    try {
      const res = await fetch(runtime.web.url);
      const html = await res.text();
      add('内置静态服务器返回首页', res.status === 200 && /<div id="root"/.test(html), `HTTP ${res.status} ${res.headers.get('content-type')} 长度=${html.length} ${runtime.web.url}`);
    } catch (e) {
      add('内置静态服务器返回首页', false, e instanceof Error ? e.message : String(e));
    }
  } else {
    add('内置静态服务器返回首页', false, runtime.startupError ?? '服务器未启动');
  }

  // ③ 窗口真的把页面渲染出来了（断言几个稳定的 data-* 标记，而不是"窗口开了就算"）
  const page = runtime.pageReady ? await runtime.pageReady : { ok: false, error: '窗口未创建' };
  if (page.ok && runtime.win) {
    try {
      const dom = await runtime.win.webContents.executeJavaScript(
        `(() => {
           const bar = document.querySelector('[data-menubar]');
           const title = bar ? bar.querySelector('span.truncate') : null;
           const btn = document.querySelector('[data-menu]');
           const cs = bar ? getComputedStyle(bar) : null;
           return {
             title: document.title,
             rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
             panelLeft: document.querySelectorAll('[data-panel="left"]').length,
             panelRight: document.querySelectorAll('[data-panel="right"]').length,
             leftButtons: document.querySelectorAll('[data-panel="left"] button').length,
             canvas: document.querySelectorAll('[data-canvas-body]').length,
             paper: document.querySelectorAll('[data-paper]').length,
             toolbar: document.querySelectorAll('[data-toolbar]').length,
             textLen: (document.body.innerText || '').length,
             desktopAttr: document.documentElement.getAttribute('data-desktop'),
             menubarCount: document.querySelectorAll('[data-menubar]').length,
             gapVar: document.documentElement.style.getPropertyValue('--titlebar-gap'),
             menubarPadRight: cs ? cs.paddingRight : null,
             menubarRegion: cs ? cs.getPropertyValue('-webkit-app-region') : null,
             menuBtnRegion: btn ? getComputedStyle(btn).getPropertyValue('-webkit-app-region') : null,
             titleRightGap: title ? Math.round(window.innerWidth - title.getBoundingClientRect().right) : -1,
             menus: [...document.querySelectorAll('[data-menu]')].map((el) => el.getAttribute('data-menu')),
           };
         })()`,
      );
      // ⚠ 一开始我断言的是 `[data-palette]`，结果 0 —— 查源码发现那是**取色板色块**的标记
      //   （ColorControl.tsx），只有选中带颜色属性的组件时才出现；组件箱的稳定标记是 shell 上的
      //   `data-panel="left"`（App.tsx）。所以这里改查它，并顺带数一下里面的组件按钮。
      add('页面渲染出编辑器界面（组件箱 / 画布 / 纸张 / 工具栏）', dom.panelLeft > 0 && dom.panelRight > 0 && dom.canvas > 0 && dom.paper > 0 && dom.toolbar > 0 && dom.leftButtons > 10, `#root 子节点=${dom.rootChildren} 左面板=${dom.panelLeft}（组件按钮 ${dom.leftButtons} 个）右面板=${dom.panelRight} 画布=${dom.canvas} 纸张=${dom.paper} 工具栏=${dom.toolbar} 正文长度=${dom.textLen} 标题=「${dom.title}」`);
      report.page = dom;

      /**
       * 无边框窗口（标题栏覆盖层）的界面契约：**只有一条菜单栏**、菜单栏是拖拽区、菜单按钮不是拖拽区、
       * 右上角给系统的最小化/最大化/关闭按钮留了位。这几条靠网页截图看不准（系统按钮不在截图里），
       * 所以用计算样式断言 —— 任何一条坏掉都会表现为"拖不动窗口"或"标题被按钮压住"。
       */
      const menus = dom.menus ?? [];
      add(
        '界面：只有一条菜单栏，顺序符合惯例（文件/编辑/视图/页面/工具/帮助）',
        dom.menubarCount === 1 && menus.join('/') === '文件/编辑/视图/页面/工具/帮助',
        `菜单栏数=${dom.menubarCount}；下拉=${menus.join(' / ')}`,
      );
      add(
        '无边框窗口：菜单栏是拖拽区、菜单按钮不是（否则点不动菜单）',
        dom.menubarRegion === 'drag' && dom.menuBtnRegion === 'no-drag',
        `菜单栏 -webkit-app-region=${dom.menubarRegion}；菜单按钮=${dom.menuBtnRegion}；data-desktop=${dom.desktopAttr}`,
      );
      add(
        '无边框窗口：右上角给系统窗口按钮留了位（标题文字不会被压住）',
        dom.menubarPadRight === '138px' && dom.titleRightGap > 120 && dom.gapVar === '138px',
        `菜单栏 padding-right=${dom.menubarPadRight}、--titlebar-gap=${dom.gapVar}；标题右侧余量=${dom.titleRightGap}px`,
      );
    } catch (e) {
      add('页面渲染出编辑器界面（组件箱 / 画布 / 纸张 / 工具栏）', false, e instanceof Error ? e.message : String(e));
    }
  } else {
    add('页面渲染出编辑器界面（组件箱 / 画布 / 纸张 / 工具栏）', false, `页面没加载成功：${page.error}`);
  }

  // ④ MCP：等它就绪，然后真握手 + 真列工具
  if (runtime.mcp) {
    const deadline = Date.now() + (runtime.cfg.mcp.readyTimeoutMs + 5000);
    let st = runtime.mcp.status();
    while (st.state !== 'ready' && st.state !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      st = runtime.mcp.status();
    }
    add('MCP 服务就绪', st.state === 'ready', `状态=${st.state} pid=${st.pid ?? '(外部进程)'} 地址=${st.url}${st.lastError ? ` 错误：${st.lastError}` : ''}`);
    if (st.state === 'ready') {
      const { mcpRequest, parseRpcBody } = await import('./src/mcpSupervisor.js');
      // P0：token 强制后，自检也必须带票（它是本应用自己的客户端）。
      // 顺手多验一条：**不带 token 必须被拒（401）** —— 这才是"强制"的证据，而不是只看带票能通。
      const token = st.token;
      const noToken = await mcpRequest(st.url, {
        timeoutMs: 8000,
        body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'desktop-selftest-noauth', version: app.getVersion() } } },
      });
      add('不带 token 的客户端被拒（HTTP 401）', noToken.status === 401, `status=${noToken.status}（P0 决策 #1：缺 token 不服务）`);
      const init = await mcpRequest(st.url, {
        timeoutMs: 10000,
        token,
        body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'desktop-selftest', version: app.getVersion() } } },
      });
      const sid = init.sessionId;
      await mcpRequest(st.url, { timeoutMs: 8000, token, sessionId: sid, body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
      const tools = await mcpRequest(st.url, { timeoutMs: 20000, token, sessionId: sid, body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
      const names = (parseRpcBody(tools.body)?.result?.tools ?? []).map((t) => t.name).filter(Boolean);
      add('外部 AI 客户端（带 token）能列出工具（tools/list）', names.length > 100, `工具数=${names.length}（例：${names.slice(0, 3).join(', ')}）会话=${String(sid).slice(0, 8)}…`);
      if (sid) await mcpRequest(st.url, { method: 'DELETE', sessionId: sid, timeoutMs: 3000, token });
      report.mcp = { url: st.url, tools: names.length, pid: st.pid, external: st.external, bridgeConflict: log.tail(400).some((l) => l.includes('桥接中转未能启动')) };
    } else {
      add('外部 AI 客户端能列出工具（tools/list）', false, 'MCP 没就绪，跳过');
    }
  } else {
    add('MCP 服务就绪', false, '本次未启动 MCP（配置 mcp.enabled=false）');
  }

  // ⑤ 更新接口只验证"地址可解析、开关状态明确"，**不联网**（自检不该依赖外网）
  const u = runtime.updater?.status() ?? null;
  add('更新接口已就绪（不联网检查，只看配置）', runtime.cfg.update.enabled ? /^https?:/i.test(runtime.cfg.update.baseUrl) : true, `开关=${runtime.cfg.update.enabled} 清单地址=${maskUrl(runtime.updater?.manifestUrl() ?? '')} 通道=${runtime.cfg.update.channel}`);

  const failed = checks.filter((c) => !c.pass);
  report.summary = { total: checks.length, passed: checks.length - failed.length, failed: failed.length, result: failed.length ? 'FAIL' : 'PASS' };

  // 可选截图：`--shot <png>`。用于核对界面本身（只有一层菜单、右上角给系统按钮留位、深浅主题配色），
  // 这种"看出来的问题"光靠断言盖不住。
  const shotPath = argValue('--shot');
  if (shotPath && runtime.win && !runtime.win.isDestroyed()) {
    try {
      // 让截图更有信息量：先把「工具」菜单点开（能一次看到菜单项与标题栏覆盖层的关系）
      const openMenu = argValue('--shot-menu');
      if (openMenu && openMenu !== 'no') {
        await runtime.win.webContents.executeJavaScript(
          `(() => { const b = document.querySelector('[data-menu="${openMenu === 'yes' ? '工具' : openMenu}"]'); if (b) b.click(); return !!b; })()`,
        );
        await new Promise((r) => setTimeout(r, 350));
      }
      const img = await runtime.win.webContents.capturePage();
      writeFileSync(shotPath, img.toPNG());
      log.info(`已截图：${shotPath}（${img.getSize().width}×${img.getSize().height}）`);
      report.shot = shotPath;
    } catch (e) {
      log.warn(`截图失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const outPath = argValue('--selftest-out') || (runtime.layout?.dataRoot ? `${runtime.layout.dataRoot}\\selftest-report.json` : null);
  report.reportPath = outPath;
  try {
    if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (e) {
    log.error(`自检报告写不进去：${e instanceof Error ? e.message : String(e)}`);
  }
  const line = `自检结果：${report.summary.passed}/${report.summary.total} 通过${failed.length ? ` —— 失败 ${failed.length} 项：${failed.map((f) => f.name).join('；')}` : ' 全部通过'}`;
  log.info(line);
  // Electron 在 Windows 上是 GUI 子系统程序，stdout 不一定接到父控制台 → 报告落盘才是可靠通道
  process.stdout.write(`${line}\n报告：${outPath}\n`);
  runtime.exitCode = failed.length ? 1 : 0;
  app.quit();
}

/* ══════════════════ 菜单 ══════════════════ */

/**
 * 窗口外观与快捷键。
 *   · **不设原生菜单**（`Menu.setApplicationMenu(null)`）：菜单只有一条 —— 网页自己的那条
 *     （文件/编辑/视图/页面/桌面/帮助）。系统的最小化/最大化/关闭按钮由无边框窗口的**覆盖层**提供
 *     （`titleBarOverlay`），颜色由网页按当前主题通过 `desktop:set-titlebar` 同步。
 *   · 没有原生菜单就没有它带的加速键，所以**只在开发模式**下补"开发者工具 / 重新加载"两枚；
 *     生产环境故意不补 —— 文档编辑器里误按 Ctrl+R 会丢掉未保存的内容。
 */
function installWindowChrome() {
  Menu.setApplicationMenu(null);
  const wc = runtime.win?.webContents;
  if (!wc || !isDev) return;
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key ?? '').toLowerCase();
    const ctrl = input.control || input.meta;
    if (key === 'f12' || (ctrl && input.shift && key === 'i')) {
      wc.toggleDevTools();
      event.preventDefault();
    } else if (ctrl && input.shift && key === 'r') {
      wc.reload();
      event.preventDefault();
    }
  });
}

/* ══════════════════ IPC（preload 用） ══════════════════ */

function registerIpc() {
  ipcMain.handle('desktop:status', () => buildStatus());
  ipcMain.handle('desktop:check-update', async () => {
    const r = await runtime.updater?.checkOnce();
    publishStatus();
    return r ?? null;
  });
  ipcMain.handle('desktop:open-download', () => runtime.updater?.openDownload() ?? { ok: false, error: '更新器未初始化' });
  /* 文件 → 退出（2026-09-30 按"常见软件排版"补的入口；preload 暴露成 desktopApi().quit()）。
     走 app.quit() 而不是 window.close()：App 自己的 before-quit 里要做 MCP 子进程收尾。 */
  ipcMain.handle('desktop:quit', () => {
    setImmediate(() => app.quit());
    return { ok: true };
  });
  ipcMain.handle('desktop:open-external', (_e, url) => openExternal(String(url)));
  ipcMain.handle('desktop:open-log-dir', () => openPath(runtime.layout?.logDir));
  ipcMain.handle('desktop:open-data-dir', () => openPath(runtime.layout?.dataRoot));
  ipcMain.handle('desktop:mcp-url', () => runtime.mcp?.status().url ?? null);
  ipcMain.handle('desktop:copy-mcp-url', () => {
    const url = runtime.mcp?.status().url ?? null;
    if (url) clipboard.writeText(url);
    return url;
  });
  /**
   * 「工具 → MCP 桥接」一键复制**带 token 的客户端配置**（P0 决策 #1/#4）。
   * 只复制文本，由用户自己粘贴到其它 AI 客户端 —— 我们不替别的应用写配置，也不自动给它们发 token。
   */
  ipcMain.handle('desktop:copy-mcp-config', () => {
    const st = runtime.mcp?.status();
    if (!st?.url || !st.token) return null;
    const cfg = {
      mcpServers: {
        'visual-editor': {
          type: 'http',
          url: st.url,
          headers: { Authorization: `Bearer ${st.token}` },
        },
      },
    };
    const text = JSON.stringify(cfg, null, 2);
    clipboard.writeText(text);
    runtime.log?.info('已复制带 token 的 MCP 客户端配置（含 Authorization 头）');
    return text;
  });
  ipcMain.handle('desktop:restart-mcp', () => runtime.mcp?.restart() ?? null);
  /* ── M-11「最近打开」：列表 / 打开旧文件（主进程读文本回传）/ 另存为 / 清除 ──
     桌面版才做得到"点一下就重开"：只有主进程能拿到本地路径、也才能读别的文件。 */
  /**
   * E2：**PDF 真产出**（`webContents.printToPDF`）。
   *
   * ★为什么用**隐藏窗口加载「导出 HTML」**，而不是直接打印主窗口：
   *   主窗口是**分页画布**（固定纸张盒 + 自己带 padding、`@page{margin:0}`），导出 HTML 是**流**
   *   （`@page{size;margin}`）。两者是两套打印模型（ARCHITECTURE §7.5 的 B1/B5）——
   *   直接打印主窗口，PDF 与导出的 HTML/Word 版式会不一致。
   *   让 PDF 由**同一份导出 HTML** 渲染，PDF ≡ HTML 版式就是构造性的，不再靠"两边都改对"。
   *
   * `preferCSSPageSize: true` 让 CSS 的 `@page` 决定纸张与页边距；`printBackground` 保证底色/表头色不丢。
   */
  ipcMain.handle('desktop:export-pdf', async (_e, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    const html = typeof o.html === 'string' ? o.html : '';
    if (!html.trim()) return { ok: false, error: '没有可导出的内容（导出 HTML 为空）' };

    let target = typeof o.path === 'string' && o.path ? o.path : null;
    if (!target) {
      const r = await dialog.showSaveDialog(runtime.win, {
        title: '导出 PDF',
        defaultPath: typeof o.suggestedName === 'string' && o.suggestedName ? o.suggestedName : 'document.pdf',
        filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      target = r.filePath;
    }

    const tmp = join(app.getPath('temp'), `editor-export-${Date.now()}.html`);
    let win = null;
    try {
      writeFileSync(tmp, html, 'utf8');
      win = new BrowserWindow({
        show: false,
        width: 1024,
        height: 768,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
      });
      await win.loadFile(tmp);
      const pdf = await win.webContents.printToPDF({
        preferCSSPageSize: true, // 纸张与页边距由 CSS @page 决定（与导出 HTML 同源）
        printBackground: true, // 背景色/表头底色
        margins: { marginType: 'none' }, // 边距已在 @page 里，别再叠一层
      });
      writeFileSync(target, pdf);
      pushRecent({ path: target, title: basename(target), at: Date.now() });
      runtime.log?.info(`已导出 PDF：${target}（${pdf.length} 字节）`);
      return { ok: true, path: target, bytes: pdf.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      runtime.log?.error(`导出 PDF 失败：${msg}`);
      return { ok: false, error: msg };
    } finally {
      try {
        win?.destroy();
      } catch {
        /* 忽略 */
      }
      try {
        if (existsSync(tmp)) rmSync(tmp, { force: true });
      } catch {
        /* 忽略 */
      }
    }
  });
  /** 二进制落盘（E1 的 .docx 验收用；给了 path 就不再弹对话框，便于脚本化） */
  ipcMain.handle('desktop:save-binary', async (_e, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    const base64 = typeof o.base64 === 'string' ? o.base64 : '';
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return { ok: false, error: '没有要写入的字节' };
    let target = typeof o.path === 'string' && o.path ? o.path : null;
    if (!target) {
      const r = await dialog.showSaveDialog(runtime.win, {
        title: '另存为',
        defaultPath: typeof o.suggestedName === 'string' ? o.suggestedName : 'document.docx',
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      target = r.filePath;
    }
    try {
      writeFileSync(target, buf);
      pushRecent({ path: target, title: basename(target), at: Date.now() });
      runtime.log?.info(`已写入 ${target}（${buf.length} 字节）`);
      return { ok: true, path: target, bytes: buf.length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('desktop:recent-list', () => readRecents());
  /** 写一条最近记录（页面侧一般不用，主要用于自检与将来的"记录非对话框来源的打开"） */
  ipcMain.handle('desktop:recent-push', (_e, entry) => {
    if (!entry || typeof entry.path !== 'string' || !entry.path) return readRecents();
    return pushRecent({ path: entry.path, title: String(entry.title ?? basename(entry.path)), at: Number(entry.at ?? Date.now()) });
  });
  ipcMain.handle('desktop:recent-clear', () => {
    try {
      writeFileSync(recentsPath(), '[]', 'utf8');
      runtime.log?.info('已清除最近打开清单');
    } catch (e) {
      runtime.log?.warn(`清除最近打开失败：${e instanceof Error ? e.message : String(e)}`);
    }
    return [];
  });
  /** 弹文件框并读回文本：桌面版走这条才有**路径**可记（浏览器 input[type=file] 只给文件名） */
  ipcMain.handle('desktop:pick-and-read', async () => {
    const r = await dialog.showOpenDialog(runtime.win, {
      title: '打开工程文件',
      filters: [
        { name: '编辑器工程（.editor.json）', extensions: ['json'] },
        { name: '全部文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    const p = r.filePaths?.[0];
    if (r.canceled || !p) return { ok: false, canceled: true };
    try {
      const text = readFileSync(p, 'utf8');
      pushRecent({ path: p, title: basename(p), at: Date.now() });
      return { ok: true, path: p, name: basename(p), text };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('desktop:open-recent', async (_e, p) => {
    if (typeof p !== 'string' || !p) return { ok: false, error: '路径为空' };
    try {
      const text = readFileSync(p, 'utf8');
      pushRecent({ path: p, title: basename(p), at: Date.now() });
      return { ok: true, path: p, name: basename(p), text };
    } catch (e) {
      // 文件被挪走/删掉是常事：如实报错，并从清单里摘掉
      const still = readRecents().filter((r) => r.path !== p);
      try {
        writeFileSync(recentsPath(), JSON.stringify(still, null, 2), 'utf8');
      } catch {
        /* 忽略 */
      }
      return { ok: false, error: `打不开 ${p}：${e instanceof Error ? e.message : String(e)}` };
    }
  });
  /** 另存为真实文件（桌面版）：写入后记一条"最近打开" */
  ipcMain.handle('desktop:save-text', async (_e, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    const suggested = typeof o.suggestedName === 'string' ? o.suggestedName : 'document.html';
    const text = typeof o.text === 'string' ? o.text : '';
    const r = await dialog.showSaveDialog(runtime.win, {
      title: '另存为',
      defaultPath: suggested,
      filters: [
        { name: suggested.endsWith('.json') ? '编辑器工程（.editor.json）' : 'HTML 文件', extensions: [suggested.endsWith('.json') ? 'json' : 'html'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    const p = r.filePath;
    if (r.canceled || !p) return { ok: false, canceled: true };
    try {
      writeFileSync(p, text, 'utf8');
      pushRecent({ path: p, title: basename(p), at: Date.now() });
      runtime.log?.info(`已另存为：${p}（${text.length} 字符）`);
      return { ok: true, path: p, name: basename(p) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  /**
   * M-7：全屏（F11）。用**窗口全屏**而不是网页 Fullscreen API —— 后者会把无边框窗口的
   * 标题栏覆盖层一起带走（最小化/最大化/关闭按钮消失），用户会以为应用坏了。
   */
  ipcMain.handle('desktop:toggle-fullscreen', () => {
    if (!runtime.win || runtime.win.isDestroyed()) return false;
    const next = !runtime.win.isFullScreen();
    runtime.win.setFullScreen(next);
    runtime.log?.info(`窗口全屏：${next ? '开' : '关'}`);
    return next;
  });
  /**
   * 「首选项 → 允许 MCP 写操作」开关（决策 #2）。
   * 写入 userData/prefs.json 后**重启 MCP 子进程**，让 EDITOR_MCP_ALLOW_WRITE 真正生效 ——
   * 只改界面不重启就是"假开关"，那正是审计里点名的"看着能用、实际没生效"。
   */
  ipcMain.handle('desktop:set-allow-write', async (_e, value) => {
    const next = value === true;
    writePrefs({ mcp: { ...(readPrefs().mcp ?? {}), allowWrite: next } });
    runtime.allowWrite = next;
    runtime.log?.info(`MCP 写开关 → ${next ? '开' : '关'}（已写入 prefs.json），重启 MCP 使其生效`);
    if (runtime.mcp) {
      runtime.mcp.setAllowWrite?.(next);
      try {
        await runtime.mcp.restart();
      } catch (e) {
        runtime.log?.warn(`重启 MCP 失败（写开关仍已保存，下次启动生效）：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    publishStatus();
    return buildStatus();
  });
  ipcMain.handle('desktop:mcp-probe', () => (runtime.mcp ? runtime.mcp.probe({ timeoutMs: 2500 }) : null));
  ipcMain.handle('desktop:config', () => (runtime.configResult ? redactConfig(runtime.configResult) : null));
  ipcMain.handle('desktop:open-config-file', () => openPath(runtime.layout?.configDir));
  /**
   * 无边框窗口的系统按钮配色：网页按当前主题读菜单栏的实际底色后告诉我们。
   * 只认 `#rrggbb`（Windows 的 titleBarOverlay 要求不透明色），脏值一律忽略 —— 免得被页面传坏值。
   */
  ipcMain.handle('desktop:set-titlebar', (_e, arg) => {
    const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v) : null);
    const color = hex(arg?.color);
    const symbolColor = hex(arg?.symbolColor);
    if (!color || !symbolColor) return { ok: false, error: '颜色必须是 #rrggbb' };
    runtime.titleBar = { color, symbolColor };
    if (!runtime.win || runtime.win.isDestroyed()) return { ok: false, error: '窗口不存在' };
    try {
      runtime.win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
      return { ok: true, ...runtime.titleBar };
    } catch (e) {
      // 非 Windows / 旧版本没有这个 API：不算致命，窗口照样能用
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.on('desktop:log', (_e, level, message) => {
    const lv = ['debug', 'info', 'warn', 'error'].includes(String(level)) ? String(level) : 'info';
    runtime.log?.[lv]?.(`[renderer] ${String(message).slice(0, 4000)}`);
  });
}

/* ══════════════════ 小工具 ══════════════════ */

function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** 只放行 http/https 的外链（防止配置文件/页面把用户送去 file:// 或自定义协议） */
async function openExternal(url, { silent = false } = {}) {
  const s = String(url ?? '');
  if (!/^https?:\/\//i.test(s)) {
    if (!silent) runtime.log?.warn(`拒绝打开非 http(s) 链接：${s}`);
    return { ok: false, error: '只允许 http/https 链接' };
  }
  try {
    await shell.openExternal(s);
    return { ok: true, url: s };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function openPath(p) {
  if (!p) return { ok: false, error: '路径为空' };
  const r = await shell.openPath(p);
  if (r) runtime.log?.warn(`打不开 ${p}：${r}`);
  return { ok: !r, path: p, error: r || null };
}
