/**
 * 职责：应用入口。注册组件、安装日志/诊断、挂载 React 根（含错误边界）。
 * URL 参数：
 *   ?log=debug|info|warn|error  日志输出级别（默认 dev=debug / prod=warn；缓冲始终全量记录）
 *   ?diag=1                     启动后打开诊断面板（日志/状态/环境）
 *   ?check=1                    运行自检并把结果写到标题、console 与右下角浮层
 *   ?demo=1                     灌入示例文档（两种模式各一页、含全部组件）    ?mode=web|document  启动后切到指定模式
 *   ?new=1                      启动后打开「新建文档」对话框（先选模式/示例 → 再填参数）
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
import { loadRuntimeComponents } from './registry/live';

const params = new URLSearchParams(location.search);

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
        const { doc, result } = m.importHtmlToDocument(html, { title: src.split('/').pop()?.replace(/\.html?$/i, '') });
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
      })
      .catch((e: unknown) => log.error('load', `?load=${src} 载入失败`, { error: String(e) }));
  }, 300);
}

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
/** ?bridge=1[&bridgeUrl=ws://...] → 启动后自动开启 MCP 桥接（无人值守验证用；平时走菜单「帮助 → MCP 桥接」） */
const applyBridgeParam = () => {
  if (!params.get('bridge')) return;
  void import('./mcp/bridgeClient').then((m) => m.autoStartBridgeFromUrl());
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
