/**
 * preload（CommonJS，**故意用 .cjs**）：渲染进程与主进程之间唯一的桥。
 *
 * 为什么是 .cjs：主进程与 src/* 都走 ESM（package.json `type: module`），而 preload 在
 * `sandbox: true` 下必须是 CommonJS —— 用 `.cjs` 后缀让它不受 `type` 影响，最稳。
 *
 * 暴露的能力刻意很小：只够"看状态 / 检查更新 / 开外链 / 开日志目录 / 重启 MCP / 发日志"。
 * **没有** fs、没有 ipcRenderer 原样透出、没有任意 channel 的 send —— 渲染进程拿不到 Node 能力。
 */
const { contextBridge, ipcRenderer } = require('electron');

const stateListeners = new Set();
ipcRenderer.on('desktop:status-changed', (_e, status) => {
  for (const fn of stateListeners) {
    try {
      fn(status);
    } catch {
      /* 页面自己的回调出错不能影响桥 */
    }
  }
});

const api = {
  /** 让前端能一眼判断"在桌面分发版里跑"（浏览器里是 undefined） */
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** 整体状态：服务地址、MCP 状态、更新器状态、脱敏后的配置 */
  getStatus: () => ipcRenderer.invoke('desktop:status'),
  /** 订阅状态变化（MCP 起停、更新检查结果都会推） */
  onStatus: (fn) => {
    if (typeof fn !== 'function') return () => {};
    stateListeners.add(fn);
    return () => stateListeners.delete(fn);
  },
  /** 检查更新（结果结构见主进程 src/updater.js 的 check()） */
  checkUpdate: () => ipcRenderer.invoke('desktop:check-update'),
  /** 打开更新下载页（只有查到了新版本才有地址） */
  openDownload: () => ipcRenderer.invoke('desktop:open-download'),
  /** 用系统浏览器打开 http/https 链接（其它协议会被主进程拒绝） */
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', String(url)),
  openLogDir: () => ipcRenderer.invoke('desktop:open-log-dir'),
  openDataDir: () => ipcRenderer.invoke('desktop:open-data-dir'),
  openConfigDir: () => ipcRenderer.invoke('desktop:open-config-file'),
  mcpUrl: () => ipcRenderer.invoke('desktop:mcp-url'),
  copyMcpUrl: () => ipcRenderer.invoke('desktop:copy-mcp-url'),
  restartMcp: () => ipcRenderer.invoke('desktop:restart-mcp'),
  probeMcp: () => ipcRenderer.invoke('desktop:mcp-probe'),
  getConfig: () => ipcRenderer.invoke('desktop:config'),
  /**
   * 同步系统窗口按钮（最小化/最大化/关闭）的颜色 —— 无边框窗口的「标题栏覆盖层」用。
   * 网页按当前主题读菜单栏的实际底色后调用它；主进程只接受 `#rrggbb`。
   */
  setTitleBar: (o) => {
    void ipcRenderer.invoke('desktop:set-titlebar', { color: String(o?.color ?? ''), symbolColor: String(o?.symbolColor ?? '') });
  },
  /** 前端把日志交给主进程一起落盘（浏览器里没有这个能力，前端应自己判空） */
  log: (level, message) => ipcRenderer.send('desktop:log', String(level), String(message)),
};

try {
  contextBridge.exposeInMainWorld('desktop', api);
} catch (e) {
  // 暴露失败（极少见：沙箱配置被改）时不要静默 —— 页面会看不到 window.desktop
  console.error('[preload] 暴露 window.desktop 失败：', e);
}
