/**
 * 职责：应用入口。注册组件、安装日志/诊断、挂载 React 根（含错误边界）。
 * URL 参数：
 *   ?log=debug|info|warn|error  日志输出级别（默认 dev=debug / prod=warn；缓冲始终全量记录）
 *   ?diag=1                     启动后打开诊断面板（日志/状态/环境）
 *   ?check=1                    运行自检并把结果写到标题、console 与右下角浮层
 *   ?demo=1                     灌入示例文档    ?mode=web|document  启动后切到指定模式
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './registry/components'; // ★注册全部组件（必须早于 App 渲染）
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { runSelfCheck } from './store/selfCheck';
import { useEditorStore } from './store/editorStore';
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
void loadRuntimeComponents().then((r) => {
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

// ?check=1 → 自检
if (params.get('check')) {
  queueMicrotask(() => runSelfCheck());
}

// ?demo=1 → 灌入示例文档；随后（无论是否 demo）应用 ?mode=
const applyModeParam = () => {
  const m = params.get('mode');
  if (m === 'web' || m === 'document') useEditorStore.getState().setMode(m);
};
if (params.get('demo')) {
  void import('./store/demo')
    .then((m) => {
      m.seedDemo();
      applyModeParam();
    })
    .catch((e: unknown) => log.error('boot', '示例文档加载失败', { error: String(e) }));
} else {
  setTimeout(applyModeParam, 60);
}
