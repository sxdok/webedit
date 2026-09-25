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
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveLayout } from './src/paths.js';
import { createLogger } from './src/logger.js';
import { resolveComponentsDir } from './src/components.js';
import { loadAppConfig, maskUrl, redactConfig } from './src/secureConfig.js';
import { createMcpSupervisor, probeMcp } from './src/mcpSupervisor.js';
import { createUpdater } from './src/updater.js';
import { startWebServer } from './server/webServer.js';

const argv = process.argv.slice(1);
const isDev = argv.includes('--dev') || !app.isPackaged;
const wantCheck = argv.includes('--check') || process.env.EDITOR_DESKTOP_CHECK === '1';
/** 装完自检：真启动（含真开窗加载页面与真连 MCP），把结论写进报告文件后退出 */
const wantSelfTest = argv.includes('--selftest');

/** 单实例：第二次点图标就把已有窗口抬起来（否则会出现两个 MCP 抢端口） */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

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

function buildStatus() {
  const cfg = runtime.cfg;
  const mcp = runtime.mcp?.status() ?? null;
  return {
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
  if (isDev) log.warn('当前是开发模式（未打包）：加载的是仓库里的 web-editor/dist 与 editor-mcp/dist');

  // ② 加密配置
  runtime.configResult = await loadAppConfig({ layout: runtime.layout, logger: log });
  runtime.cfg = runtime.configResult.config;
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
      allowWrite: runtime.cfg.mcp.allowWrite,
      readyTimeoutMs: runtime.cfg.mcp.readyTimeoutMs,
      autoRestart: runtime.cfg.mcp.autoRestart,
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
    buildMenu();
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
  runtime.win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f3f4f6',
    title: runtime.cfg?.app?.title ?? '可视化编辑器',
    autoHideMenuBar: false,
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
        `(() => ({
           title: document.title,
           rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
           panelLeft: document.querySelectorAll('[data-panel="left"]').length,
           panelRight: document.querySelectorAll('[data-panel="right"]').length,
           leftButtons: document.querySelectorAll('[data-panel="left"] button').length,
           canvas: document.querySelectorAll('[data-canvas-body]').length,
           paper: document.querySelectorAll('[data-paper]').length,
           toolbar: document.querySelectorAll('[data-toolbar]').length,
           textLen: (document.body.innerText || '').length
         }))()`,
      );
      // ⚠ 一开始我断言的是 `[data-palette]`，结果 0 —— 查源码发现那是**取色板色块**的标记
      //   （ColorControl.tsx），只有选中带颜色属性的组件时才出现；组件箱的稳定标记是 shell 上的
      //   `data-panel="left"`（App.tsx）。所以这里改查它，并顺带数一下里面的组件按钮。
      add('页面渲染出编辑器界面（组件箱 / 画布 / 纸张 / 工具栏）', dom.panelLeft > 0 && dom.panelRight > 0 && dom.canvas > 0 && dom.paper > 0 && dom.toolbar > 0 && dom.leftButtons > 10, `#root 子节点=${dom.rootChildren} 左面板=${dom.panelLeft}（组件按钮 ${dom.leftButtons} 个）右面板=${dom.panelRight} 画布=${dom.canvas} 纸张=${dom.paper} 工具栏=${dom.toolbar} 正文长度=${dom.textLen} 标题=「${dom.title}」`);
      report.page = dom;
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
      const init = await mcpRequest(st.url, {
        timeoutMs: 10000,
        body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'desktop-selftest', version: app.getVersion() } } },
      });
      const sid = init.sessionId;
      await mcpRequest(st.url, { timeoutMs: 8000, sessionId: sid, body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
      const tools = await mcpRequest(st.url, { timeoutMs: 20000, sessionId: sid, body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
      const names = (parseRpcBody(tools.body)?.result?.tools ?? []).map((t) => t.name).filter(Boolean);
      add('外部 AI 客户端能列出工具（tools/list）', names.length > 100, `工具数=${names.length}（例：${names.slice(0, 3).join(', ')}）会话=${String(sid).slice(0, 8)}…`);
      if (sid) await mcpRequest(st.url, { method: 'DELETE', sessionId: sid, timeoutMs: 3000 });
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

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开数据目录', click: () => openPath(runtime.layout?.dataRoot) },
        { label: '打开日志目录', click: () => openPath(runtime.layout?.logDir) },
        { type: 'separator' },
        { label: '重新加载页面', accelerator: 'CmdOrCtrl+R', click: () => runtime.win?.webContents.reload() },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '工具',
      submenu: [
        { label: '检查更新…', click: () => void menuCheckUpdate() },
        { label: '打开更新下载页', click: () => void menuOpenDownload() },
        { type: 'separator' },
        { label: '复制 MCP 地址', click: () => copyMcpUrl() },
        { label: '查看 MCP 状态', click: () => void showMcpStatus() },
        { label: '重启 MCP 服务', click: () => void restartMcp() },
        { type: 'separator' },
        { label: '查看当前配置（脱敏）', click: () => void showConfig() },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: `关于 可视化编辑器 ${app.getVersion()}`, click: () => showAbout() },
        { label: '打开日志目录', click: () => openPath(runtime.layout?.logDir) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function menuCheckUpdate() {
  const win = runtime.win;
  if (!runtime.updater) return;
  const r = await runtime.updater.check();
  publishStatus();
  const msg = {
    'update-available': `发现新版本 ${r.latestVersion}`,
    'up-to-date': `已是最新版本（${r.currentVersion}）`,
    disabled: '更新检查已在配置里关闭（update.enabled=false）',
    error: '检查更新失败',
  }[r.status];
  const detail = [
    `当前版本：${r.currentVersion}`,
    `更新通道：${r.channel}`,
    `清单地址：${maskUrl(r.manifestUrl)}`,
    r.latestVersion ? `最新版本：${r.latestVersion}` : null,
    r.publishedAt ? `发布时间：${r.publishedAt}` : null,
    r.notes ? `\n更新说明：\n${r.notes}` : null,
    r.downloadUrl ? `\n下载地址：\n${r.downloadUrl}` : null,
    r.error ? `\n错误：${r.error}` : null,
    r.note ? `\n说明：${r.note}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const buttons = r.status === 'update-available' ? ['打开下载页', '关闭'] : ['知道了'];
  const res = await dialog.showMessageBox(win ?? undefined, {
    type: r.status === 'error' ? 'error' : 'info',
    title: '检查更新',
    message: msg,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  if (r.status === 'update-available' && res.response === 0) await menuOpenDownload();
}

async function menuOpenDownload() {
  const r = await runtime.updater?.openDownload();
  if (!r?.ok) {
    await dialog.showMessageBox(runtime.win ?? undefined, {
      type: 'info',
      title: '打开下载页',
      message: '现在没有可用的下载地址',
      detail: `${r?.error ?? ''}\n\n请先点「检查更新…」（更新地址来自加密配置，改地址不用重新打包）。`,
    });
  }
}

function copyMcpUrl() {
  const url = runtime.mcp?.status().url ?? `http://${runtime.cfg?.mcp?.host ?? '127.0.0.1'}:${runtime.cfg?.mcp?.httpPort ?? 37651}/mcp`;
  clipboard.writeText(url);
  runtime.log?.info(`已复制 MCP 地址：${url}`);
  if (runtime.win) void dialog.showMessageBox(runtime.win, { type: 'info', title: '已复制', message: url, detail: '把它填进支持 Streamable HTTP 的 MCP 客户端即可。' });
}

async function showMcpStatus() {
  const st = runtime.mcp?.status();
  if (!runtime.mcp) {
    await dialog.showMessageBox(runtime.win ?? undefined, { type: 'info', title: 'MCP 状态', message: '本次未启动 MCP（配置 mcp.enabled=false）' });
    return;
  }
  // 现场再探一次：状态里的 ready 可能是几分钟前的
  const probe = await probeMcp(st.url, { timeoutMs: 2500 });
  const bridgeTaken = runtime.log ? runtime.log.tail(400).some((l) => l.includes('桥接中转未能启动')) : false;
  const detail = [
    `运行状态：${st.state}${st.external ? '（接管了外部已在跑的进程）' : ''}`,
    `进程号：${st.pid ?? '(不是本应用拉起的)'}`,
    `地址：${st.url}`,
    `桥接中转：${st.bridgeUrl}${bridgeTaken ? `　⚠ 该端口已被别的进程占用：本 MCP 的工具都能用，但编辑器页面的 Live 通道会连到那个实例上` : ''}`,
    `自动重启次数：${st.restarts}`,
    `握手探测：${probe.ok ? `通过（${probe.serverInfo?.name ?? '?'} ${probe.serverInfo?.version ?? ''}，协议 ${probe.protocolVersion ?? '?'}）` : `未通过（${probe.error ?? '无响应'}）`}`,
    st.lastError ? `最近错误：${st.lastError}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const res = await dialog.showMessageBox(runtime.win ?? undefined, {
    type: probe.ok ? 'info' : 'warning',
    title: 'MCP 状态',
    message: probe.ok ? 'MCP 服务可用' : 'MCP 服务当前不可用',
    detail,
    buttons: ['复制地址', '关闭'],
    defaultId: 0,
    cancelId: 1,
  });
  if (res.response === 0) copyMcpUrl();
}

async function restartMcp() {
  if (!runtime.mcp) return;
  runtime.log?.info('用户从菜单重启 MCP 服务');
  const st = await runtime.mcp.restart();
  publishStatus();
  await dialog.showMessageBox(runtime.win ?? undefined, {
    type: st.state === 'ready' ? 'info' : 'error',
    title: '重启 MCP 服务',
    message: st.state === 'ready' ? '已重启并就绪' : `重启后仍不可用（${st.state}）`,
    detail: `${st.url}\n${st.lastError ?? ''}`,
  });
}

async function showConfig() {
  const view = runtime.configResult ? redactConfig(runtime.configResult) : null;
  if (!view) return;
  await dialog.showMessageBox(runtime.win ?? undefined, {
    type: 'info',
    title: '当前配置（脱敏）',
    message: `来源：${view.meta.source}　密钥：${view.meta.keySource ?? '(无)'}`,
    detail:
      `配置文件：${view.meta.configPath ?? '(无)'}\n` +
      `更新地址：${view.updateBaseUrlMasked}（清单 ${view.update.manifest}，通道 ${view.update.channel}）\n` +
      `静态服务器：${view.server.host}:${view.server.port === 0 ? '自动' : view.server.port}\n` +
      `MCP：${view.mcp.enabled ? `http://${view.mcp.host}:${view.mcp.httpPort}/mcp` : '已关闭'}（桥接 ${view.mcp.bridgePort}）\n` +
      `密钥指纹：${view.meta.keyFingerprint ?? '(无)'}\n` +
      (view.meta.problems.length ? `\n问题：\n${view.meta.problems.join('\n')}` : ''),
  });
}

function showAbout() {
  const s = buildStatus();
  void dialog.showMessageBox(runtime.win ?? undefined, {
    type: 'info',
    title: '关于',
    message: `可视化编辑器 ${s.version}`,
    detail: [
      `Electron ${s.electron} / Chromium ${s.chrome} / Node ${s.node}`,
      `运行模式：${s.mode}${s.dev ? '（开发）' : ''}`,
      `页面地址：${s.server?.url ?? '(未启动)'}`,
      `MCP 地址：${s.mcpUrl ?? '(未启动)'}`,
      `日志目录：${s.logDir}`,
    ].join('\n'),
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
  ipcMain.handle('desktop:open-external', (_e, url) => openExternal(String(url)));
  ipcMain.handle('desktop:open-log-dir', () => openPath(runtime.layout?.logDir));
  ipcMain.handle('desktop:open-data-dir', () => openPath(runtime.layout?.dataRoot));
  ipcMain.handle('desktop:mcp-url', () => runtime.mcp?.status().url ?? null);
  ipcMain.handle('desktop:copy-mcp-url', () => {
    const url = runtime.mcp?.status().url ?? null;
    if (url) clipboard.writeText(url);
    return url;
  });
  ipcMain.handle('desktop:restart-mcp', () => runtime.mcp?.restart() ?? null);
  ipcMain.handle('desktop:mcp-probe', () => (runtime.mcp ? runtime.mcp.probe({ timeoutMs: 2500 }) : null));
  ipcMain.handle('desktop:config', () => (runtime.configResult ? redactConfig(runtime.configResult) : null));
  ipcMain.handle('desktop:open-config-file', () => openPath(runtime.layout?.configDir));
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
