/**
 * 桌面版（Electron）外壳适配：**只有跑在桌面版里才生效**，浏览器里所有函数都是空操作。
 *
 * 为什么要这一层：
 *   桌面版用无边框窗口（`titleBarStyle:'hidden'` + Windows 的 `titleBarOverlay`）——原生标题栏与菜单栏都不画了，
 *   系统的**最小化/最大化/关闭**按钮由 Electron 以「覆盖层」画在网页右上角，颜色必须由我们告诉它。
 *   于是网页要负责三件事：
 *     ① 把顶部菜单栏那一行声明成**窗口拖拽区**（`-webkit-app-region: drag`），并给里面的按钮/输入框设 `no-drag`
 *        （否则点不动菜单）；
 *     ② 给覆盖层按钮**留出右上角的位置**（约 138px），免得标题文字被压在按钮下面；
 *     ③ **主题一变就同步按钮颜色**：直接读菜单栏的实际计算样式，不写死色值 ——
 *        换主题（light / monokai）时按钮跟着变，不用在这份代码里维护第二套调色板。
 *
 * 主进程接口见 `apps/desktop/preload.cjs` 暴露的 `window.desktop`。
 */

export interface DesktopUpdateResult {
  status: 'disabled' | 'up-to-date' | 'update-available' | 'error' | 'not-checked';
  currentVersion: string;
  channel?: string;
  manifestUrl?: string;
  latestVersion?: string;
  publishedAt?: string | null;
  notes?: string;
  mandatory?: boolean;
  downloadUrl?: string | null;
  error?: string;
  note?: string;
}

/** 「最近打开」的一条记录（M-11）：桌面版存路径（可重开），浏览器版只存名字 */
export interface RecentDoc {
  /** 桌面版：绝对路径；浏览器版：`name`（本地文件重不开，仅作提示） */
  path: string;
  /** 文件显示名 */
  title: string;
  /** 记录时间戳 */
  at: number;
  /** 桌面版为 'file'，浏览器版为 'name'（后者点不开，菜单里会说明） */
  kind?: 'file' | 'name';
}

export interface DesktopMcpStatus {
  state: 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed';
  pid: number | null;
  external: boolean;
  restarts: number;
  lastError: string | null;
  serverInfo: { name?: string; version?: string } | null;
  url: string;
  bridgeUrl: string;
  /**
   * P0 决策 #1：桌面版自动发放的入站 token。页面在 `bridge.hello` 里带上它，
   * hub 才会认这个"编辑器"；不带会被 1008 关闭。非桌面环境（浏览器）为 undefined。
   */
  token?: string;
}

export interface DesktopStatus {
  desktop: true;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  mode: 'dev' | 'packaged';
  dev: boolean;
  server: { url: string; port: number; distDir: string } | null;
  mcp: DesktopMcpStatus | null;
  mcpUrl: string | null;
  update: DesktopUpdateResult | null;
  config: {
    title: string;
    mcp: { enabled: boolean; httpPort: number; bridgePort: number; allowWrite: boolean };
    update: { enabled: boolean; manifest: string; channel: string };
    meta: { source: string; keySource: string | null; configPath: string | null; keyFingerprint: string | null; problems: string[]; warnings: string[] };
  } | null;
  logDir: string | null;
  dataRoot: string | null;
  componentsDir: string | null;
  startupError: string | null;
  title: string;
  /**
   * 生效的"允许 MCP 写操作"（P0 决策 #2）：加密配置给默认值（分发版 false），
   * 用户在首选项里的改动落在 userData/prefs.json。桥接菜单据此显示"已连接 · 写已禁用"。
   */
  mcpWriteEnabled?: boolean;
  /** M-7：窗口是否处于全屏（F11 切换的结果，供自检观测） */
  fullscreen?: boolean;
}

export interface DesktopApi {
  isDesktop: true;
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  getStatus: () => Promise<DesktopStatus>;
  onStatus: (fn: (s: DesktopStatus) => void) => () => void;
  checkUpdate: () => Promise<DesktopUpdateResult | null>;
  openDownload: () => Promise<{ ok: boolean; url?: string; error?: string }>;
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  openLogDir: () => Promise<{ ok: boolean; path?: string; error?: string | null }>;
  openDataDir: () => Promise<{ ok: boolean; path?: string; error?: string | null }>;
  openConfigDir: () => Promise<{ ok: boolean; path?: string; error?: string | null }>;
  mcpUrl: () => Promise<string | null>;
  copyMcpUrl: () => Promise<string | null>;
  /** P0 决策 #1/#4：复制**含 Authorization 头**的 MCP 客户端配置（别的 AI 客户端要它才连得上） */
  copyMcpConfig: () => Promise<string | null>;
  restartMcp: () => Promise<DesktopMcpStatus | null>;
  /* ── M-11 最近打开（只有桌面版能记住"路径"并重开本地文件） ── */
  recentList: () => Promise<RecentDoc[]>;
  /** 写一条最近记录（自检 / 非对话框来源的打开用） */
  recentPush: (entry: { path: string; title?: string; at?: number }) => Promise<RecentDoc[]>;
  recentClear: () => Promise<RecentDoc[]>;
  /** 弹文件框并读回文本（返回 path，便于记录最近打开） */
  pickAndRead: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; name?: string; text?: string; error?: string }>;
  openRecent: (path: string) => Promise<{ ok: boolean; path?: string; name?: string; text?: string; error?: string }>;
  /** 另存为真实文件（桌面版比"下载"更符合桌面习惯，也能记住路径） */
  saveText: (opts: { suggestedName: string; text: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; name?: string; error?: string }>;
  /** E1：二进制落盘（.docx；给 path 就不弹对话框，便于脚本化验收） */
  saveBinary: (opts: { base64: string; path?: string; suggestedName?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; bytes?: number; error?: string }>;
  /** E2：导出 PDF（主进程用隐藏窗口加载导出 HTML → `printToPDF`，版式与导出 HTML 同源） */
  exportPdf: (opts: { html: string; suggestedName?: string; path?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; bytes?: number; error?: string }>;
  /** M-7：全屏（F11）——桌面版走窗口全屏，返回切换后的状态 */
  toggleFullscreen: () => Promise<boolean>;
  /** P0 决策 #2：切换"允许 MCP 写操作"（写入 prefs.json 并重启 MCP，返回新状态） */
  setAllowWrite: (value: boolean) => Promise<DesktopStatus>;
  probeMcp: () => Promise<{ ok: boolean; serverInfo?: { name?: string; version?: string } | null; protocolVersion?: string | null; error?: string } | null>;
  getConfig: () => Promise<DesktopStatus['config']>;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
  /** 同步系统窗口按钮的颜色（无边框窗口的覆盖层） */
  setTitleBar: (o: { color: string; symbolColor: string }) => void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export function desktopApi(): DesktopApi | undefined {
  return typeof window === 'undefined' ? undefined : window.desktop;
}

export const isDesktop = (): boolean => desktopApi()?.isDesktop === true;

/** 覆盖层按钮占的宽度（Windows 上三颗按钮 ≈ 138px @100% 缩放）；给菜单栏右侧留位 */
export const TITLEBAR_BUTTONS_WIDTH = 138;

/** `rgb(r, g, b)` / `rgba(...)` → `#rrggbb`；解析不了返回 null */
function toHex(color: string): string | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color || '');
  if (!m) return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

/** 相对亮度（决定按钮用深色还是浅色符号） */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 安装桌面外壳适配。返回卸载函数（组件卸载时调用，避免重复监听）。
 * 断言友好：会在 `<html>` 上打 `data-desktop="1"`，自检/截图脚本据此判断"这是桌面版"。
 */
export function installDesktopChrome(): () => void {
  const api = desktopApi();
  if (!api) return () => {};

  const html = document.documentElement;
  html.setAttribute('data-desktop', '1');
  // 给 CSS 用：覆盖层按钮占的宽度（`html[data-desktop] .app-titlebar-gap { padding-right: var(--titlebar-gap) }`）
  html.style.setProperty('--titlebar-gap', `${TITLEBAR_BUTTONS_WIDTH}px`);

  let last = '';
  const sync = (): void => {
    const bar = document.querySelector<HTMLElement>('[data-menubar]');
    if (!bar) return;
    const cs = getComputedStyle(bar);
    const color = toHex(cs.backgroundColor) ?? (html.dataset.theme === 'monokai' ? '#272822' : '#ffffff');
    const symbolColor = luminance(color) < 0.5 ? '#f8f8f2' : '#374151';
    const key = `${color}|${symbolColor}|${bar.offsetHeight}`;
    if (key === last) return;
    last = key;
    try {
      api.setTitleBar({ color, symbolColor });
    } catch {
      /* 非 Windows 或旧版本没有这个能力：忽略（窗口仍可用） */
    }
  };

  // 主题切换（`<html data-theme>`）、窗口缩放（改变量）、首帧渲染都要同步一次
  const mo = new MutationObserver(sync);
  mo.observe(html, { attributes: true, attributeFilter: ['data-theme', 'data-desktop', 'style', 'class'] });
  const onResize = () => sync();
  window.addEventListener('resize', onResize);
  sync();
  requestAnimationFrame(sync);
  const timers = [120, 400, 900].map((ms) => window.setTimeout(sync, ms));

  return () => {
    mo.disconnect();
    window.removeEventListener('resize', onResize);
    timers.forEach((t) => window.clearTimeout(t));
  };
}

/** 把桌面版的动作结果整理成"给人看的段落"（菜单里弹提示框用） */
export function formatUpdateResult(r: DesktopUpdateResult | null): string {
  if (!r) return '没有拿到检查结果（桌面接口不可用）。';
  const lines = [`当前版本：${r.currentVersion}`, `通道：${r.channel ?? '-'}`, `清单：${r.manifestUrl ?? '-'}`];
  if (r.status === 'update-available') {
    lines.unshift(`发现新版本：${r.latestVersion}`);
    if (r.publishedAt) lines.push(`发布时间：${r.publishedAt}`);
    if (r.mandatory) lines.push('（该版本被标记为必须更新）');
    if (r.downloadUrl) lines.push('', '下载地址：', r.downloadUrl);
    if (r.notes) lines.push('', '更新说明：', r.notes);
  } else if (r.status === 'up-to-date') {
    lines.unshift(`已是最新版本（${r.latestVersion ?? r.currentVersion}）`);
    if (r.note) lines.push('', r.note);
  } else if (r.status === 'disabled') {
    lines.unshift('更新检查已在配置里关闭（update.enabled=false）');
  } else if (r.status === 'error') {
    lines.unshift('检查更新失败');
    if (r.error) lines.push('', `原因：${r.error}`);
  }
  return lines.join('\n');
}
