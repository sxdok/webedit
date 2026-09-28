/**
 * 职责：应用入口。注册组件、安装日志/诊断、挂载 React 根（含错误边界）。
 * URL 参数：
 *   ?log=debug|info|warn|error  日志输出级别（默认 dev=debug / prod=warn；缓冲始终全量记录）
 *   ?diag=1                     启动后打开诊断面板（日志/状态/环境）
 *   ?check=1                    运行自检并把结果写到标题、console 与右下角浮层
 *   ?demo=1                     灌入示例文档（两种模式各一页、含全部组件）    ?mode=web|document  启动后切到指定模式
 *   ?new=1                      启动后打开「新建文档」对话框（先选模式/示例 → 再填参数）
 *   ?prefs=1                    启动后打开「首选项」（编辑器设置集中在这里）
 *   ?select=table              启动后选中第一个该类型的节点（也可给序号），用于核对属性面板排版
 *   ?cell=1,0[;1,1]            再选中该表格的这些单元格（核对单元格格式；行列从 0 起）
 *   ?theme=monokai|light  ?scroll=N  ?printdebug=1
 *   ?load=<url|相对路径>        载入一份已有 HTML（本工程导出的 HTML 可原样读回；见 utils/htmlImport.ts）
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './registry/components'; // ★注册全部组件（必须早于 App 渲染）
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { runSelfCheck } from './store/selfCheck';
import { useEditorStore } from './store/editorStore';
import { getForest } from './store/treeUtils';
import { installGlobalDiagnostics, log, type LogLevel } from './utils/logger';
import { installDesktopChrome } from './utils/desktopChrome';
import { loadRuntimeComponents } from './registry/live';

const params = new URLSearchParams(location.search);

// 桌面版（Electron）外壳适配：无边框窗口的拖拽区、系统窗口按钮配色、`<html data-desktop>` 标记。
// 浏览器里是空操作（`window.desktop` 不存在），所以网页版行为不受影响。
installDesktopChrome();

// 日志：先恢复上次会话尾部（崩溃后仍能看到现场），再装全局错误捕获
const restored = log.restorePersisted();
installGlobalDiagnostics();
const levelParam = params.get('log');
if (levelParam === 'debug' || levelParam === 'info' || levelParam === 'warn' || levelParam === 'error') {
  log.setLevel(levelParam as LogLevel);
}
// 落盘探测：启动器托管时日志/诊断写到「运行目录/logs/」，否则退回 localStorage（如实记一条）
void log.initRemote().then((ok) => {
  const info = log.remoteInfo();
  log.info('boot', ok ? '日志落盘已启用（写入运行目录）' : '日志落盘未启用，退回浏览器本地存储', {
    目录: info.dir || '(无 /__log 接口)',
    文件: info.file || '-',
  });
});
log.info('boot', '编辑器启动', {
  恢复历史日志: restored,
  日志级别: log.getLevel(),
  地址: location.href,
  设备像素比: window.devicePixelRatio,
  视口: `${window.innerWidth}×${window.innerHeight}`,
});

const el = document.getElementById('root');
if (!el) {
  log.error('boot', '#root 不存在，无法挂载');
  throw new Error('#root 不存在');
}

createRoot(el).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// 外部组件目录（public/组件/）：热加载，改完点「重载外部组件」即可，无需重新构建
// ★示例文档要"包含全部组件"，所以 ?demo=1 会等这个 promise（外部组件也算在内）
const liveReady = loadRuntimeComponents().then((r) => {
  log.info('boot', '外部组件目录就绪', { source: r.source, total: r.total, ok: r.ok, failed: r.failed });
  if (r.total || r.failed.length) useEditorStore.getState().bumpRegistry();
});

// ?theme=monokai|light → 指定主题（也会记住在本地）
const themeParam = params.get('theme');
if (themeParam === 'monokai' || themeParam === 'light') {
  useEditorStore.getState().setTheme(themeParam);
}

// ?scroll=N → 启动后把画布容器滚动 N px（调试吸顶/滚动类问题）
const scrollTo = Number(params.get('scroll') || 0);
if (scrollTo > 0) {
  setTimeout(() => {
    const el = document.getElementById('canvas-viewport');
    if (el) el.scrollTop = scrollTo;
  }, 260);
}

// ?diag=1 → 打开诊断面板
if (params.get('diag')) {
  setTimeout(() => useEditorStore.getState().toggleUI('showDiagnostics'), 100);
}

// ?new=1 → 启动后直接打开「新建文档」对话框（先选模式/示例 → 再填参数）
if (params.get('new')) {
  setTimeout(() => useEditorStore.getState().setNewDocOpen(true), 200);
}

// ?prefs=1 → 启动后打开「首选项」（截图/核对设置项用）
if (params.get('prefs')) {
  setTimeout(() => useEditorStore.getState().toggleUI('prefsOpen'), 240);
}

// ?check=1 → 自检
if (params.get('check')) {
  queueMicrotask(() => runSelfCheck());
}

// ?spec=1 → 生成「组件与属性说明清单」并写到运行目录 docs/（无接口时下载）
if (params.get('spec')) {
  setTimeout(() => {
    void import('./utils/specSheet').then(async (m) => {
      const text = m.buildComponentSpecSheet();
      const { saveToRunDir, downloadText } = await import('./utils/download');
      const r = await saveToRunDir('docs/组件与属性说明清单.md', text);
      if (r?.ok) log.info('spec', '组件与属性说明清单已写入运行目录', { file: r.file, bytes: r.bytes });
      else {
        downloadText('组件与属性说明清单.md', text, 'text/markdown');
        log.warn('spec', '没有 /__save 接口，清单改为下载');
      }
    });
  }, 800); // 等外部组件加载完，清单里才会带上它们
}

// ?load=<url|相对路径> → 载入已有 HTML（导入成组件；本工程导出的 HTML 能原样读回）
if (params.get('load')) {
  const src = String(params.get('load'));
  setTimeout(() => {
    void import('./utils/htmlImport')
      .then(async (m) => {
        const res = await fetch(src, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const { doc, result } = m.importHtmlToDocument(html, {
          title: src.split('/').pop()?.replace(/\.html?$/i, ''),
          // 相对路径的图片按**这份 HTML 的地址**解析（?load= 走 http 时图片能直接显示）
          baseUrl: new URL(src, location.href).href,
        });
        useEditorStore.getState().loadDocument(doc);
        log.info('load', 'HTML 已载入编辑器', {
          来源: src,
          模式: result.mode,
          顶层节点: result.stats.top,
          节点总数: result.stats.total,
          精确识别: result.stats.typed,
          按标签识别: result.stats.guessed,
          跳过: result.stats.skipped,
          提示: result.warnings.slice(0, 5),
        });
        document.title = `${doc.title} · 可视化编辑器`;
        queueMicrotask(() => void maybeAutoExportPdf());
      })
      .catch((e: unknown) => log.error('load', `?load=${src} 载入失败`, { error: String(e) }));
  }, 300);
}

/**
 * `?exportPdf=<路径>` → 启动后（`?load=` 完成之后）**自动导出一份 PDF** 到指定路径，
 * 并把结论写进 `document.title`（`pdf-export: ok <bytes> <path>` / `pdf-export: fail <原因>`）。
 *
 * 为什么要这个钩子：E2 的验收标准是"**空白页 = 0**、实际页数 == 期望页数"，而那必须对**固定样张**
 * 反复跑（见 `apps/desktop/scripts/pdf-export-check.mjs`）。没有命令行出口时，"PDF 到底对不对"
 * 就只能靠人眼看 —— 与 `?check=1` / `?spec=1` 同一套约定，让断言成为交付物。
 */
async function maybeAutoExportPdf(): Promise<void> {
  const target = params.get('exportPdf');
  if (!target) return;
  try {
    const { exportPdf } = await import('./utils/export/pdf');
    const r = await exportPdf({ path: target });
    document.title = r.ok ? `pdf-export: ok ${r.bytes ?? 0} ${r.path ?? ''}` : `pdf-export: fail ${r.error ?? '未知'}`;
  } catch (e) {
    document.title = `pdf-export: fail ${e instanceof Error ? e.message : String(e)}`;
  }
}
if (params.get('exportPdf') && !params.get('load')) queueMicrotask(() => void maybeAutoExportPdf());

// ?demo=1 → 灌入示例文档（两种模式各一页、含全部组件）；随后（无论是否 demo）应用 ?mode=
// ?select=<type|index> → 启动后选中一个节点（截图/核对属性面板排版用，例如 ?select=table）
const applySelectParam = () => {
  const want = params.get('select');
  if (!want) return;
  const s = useEditorStore.getState();
  const forest = getForest(s.doc);
  // 两种模式都能选：文档模式看 document.components，Web 模式看 web.root.children
  const hit = forest.find((n) => n.type === want) ?? forest[Number(want)];
  if (hit) s.selectComponent([hit.id]);
};
const applyModeParam = () => {
  const m = params.get('mode');
  if (m === 'web' || m === 'document') useEditorStore.getState().setMode(m);
};
/** ?cell=1,0[;1,1] → 选中当前表格节点的这些单元格（截图/核对单元格格式用） */
const applyCellParam = () => {
  const want = params.get('cell');
  if (!want) return;
  const s = useEditorStore.getState();
  const id = s.doc.selectedIds[0];
  if (!id) return;
  s.selectTableCells(
    id,
    want
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean),
  );
};
/**
 * 启动时的桥接策略：
 *   · `?bridge=1[&bridgeUrl=ws://…]` → **强制开**（无人值守验证用，覆盖首选项）；
 *   · 否则走**首选项 → MCP 桥接 → 启动时自动连接**（`ui.autoBridge`，默认开）：
 *     先探测本机 MCP 服务器（桌面版还会从应用配置里取真实桥接端口），检测到才接入，
 *     并在 0.3/2/5/10/20s 内有界重试 —— 桌面版是"先开窗、后拉 MCP 子进程"，页面常比 MCP 先就绪。
 */
const applyBridgeParam = () => {
  void import('./mcp/bridgeClient').then((m) => {
    if (params.get('bridge')) m.autoStartBridgeFromUrl();
    else void m.autoStartBridgeFromPrefs();
  });
};

if (params.get('demo')) {
  void Promise.all([import('./store/demo'), liveReady])
    .then(([m]) => {
      // 示例 = 两页（文档模式页 + Web 模式页）；都从注册表实时取，含外部热加载组件
      m.seedDemo();
      // ?mode=web|document → 直接切到对应那**页**（示例页各自就是那个模式）
      const want = params.get('mode');
      if (want === 'web' || want === 'document') {
        const S = useEditorStore.getState();
        const page = S.pages.find((p) => p.mode === want);
        if (page) S.setActivePage(page.id);
      }
      setTimeout(() => {
        applySelectParam();
        setTimeout(applyCellParam, 80);
      }, 160);
    })
    .catch((e: unknown) => log.error('boot', '示例文档加载失败', { error: String(e) }));
} else {
  setTimeout(applyModeParam, 60);
}
// 桥接开关独立于 demo/mode：等页面挂载后再连，避免和首屏抢带宽
setTimeout(applyBridgeParam, 400);
