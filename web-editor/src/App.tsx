/**
 * 职责：应用外壳——经典四区布局（菜单栏 / 工具栏 / 左组件面板 + 中画布 + 右属性面板 / 状态栏），
 *       高度撑满视口，滚动只发生在面板与画布容器内部。
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Canvas } from './components/canvas/Canvas';
import { MenuBar } from './components/layout/MenuBar';
import { StatusBar } from './components/layout/StatusBar';
import { ToolBar } from './components/layout/ToolBar';
import { useShortcuts } from './components/layout/useShortcuts';
import { ComponentPanel } from './components/panels/ComponentPanel';
import { ComponentTree } from './components/panels/ComponentTree';
import { DiagnosticsPanel } from './components/panels/DiagnosticsPanel';
import { PropertyPanel } from './components/panels/PropertyPanel';
import { useEditorStore } from './store/editorStore';

function CollapseBar({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={side === 'left' ? '折叠/展开组件面板' : '折叠/展开属性面板'}
      className="no-print flex w-3 shrink-0 items-center justify-center border-line bg-white text-gray-400 hover:bg-gray-100 hover:text-primary"
      style={{ borderLeftWidth: side === 'right' ? 1 : 0, borderRightWidth: side === 'left' ? 1 : 0 }}
    >
      {side === 'left' ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
    </button>
  );
}

export default function App() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const ui = useEditorStore((s) => s.ui);
  const toggleUI = useEditorStore((s) => s.toggleUI);
  useShortcuts();

  // 主题：写到 <html data-theme>（index.css 里按该属性切换 Monokai 深色）
  const theme = ui.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 打印页面尺寸：按当前文档（文档模式=纸张物理尺寸；Web 模式=设备画布尺寸）动态写 @page，
  // 并 margin:0 —— 页边距由纸张自身的内边距负责，这样打印从物理页原点开始。
  const pageSize = useEditorStore((s) =>
    s.doc.mode === 'document'
      ? `${s.doc.document.page.width}mm ${s.doc.document.page.height}mm`
      : `${s.doc.web.canvas.width}px ${s.doc.web.canvas.height}px`,
  );
  useEffect(() => {
    let el = document.getElementById('page-style') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'page-style';
      document.head.appendChild(el);
    }
    // ★@page 里不能用 var()（Chrome 不解析），必须把具体值拼进来。
    //   margin:0 —— 页边距由纸张自身内边距负责（与已验证产线 江苏誉创_金卫智慧舱_AGV方案_V5.0.html 一致）
    el.textContent = `@page{size:${pageSize};margin:0}`;
  }, [pageSize]);

  return (
    <div className="app-root flex h-screen flex-col overflow-hidden bg-panel font-ui">
      <MenuBar />
      <ToolBar />

      <div className="print-block flex min-h-0 flex-1">
        {!ui.leftCollapsed ? (
          <>
            <aside className="no-print flex w-[240px] shrink-0 flex-col border-r border-line bg-white">
              <ComponentPanel />
            </aside>
            <CollapseBar side="left" onClick={() => toggleUI('leftCollapsed')} />
          </>
        ) : (
          <CollapseBar side="right" onClick={() => toggleUI('leftCollapsed')} />
        )}

        <main className="print-block flex min-w-0 flex-1 flex-col">
          <Canvas onPointer={setPointer} />
        </main>

        {ui.showTree && (
          <aside className="no-print w-[220px] shrink-0 border-l border-line bg-white">
            <ComponentTree />
          </aside>
        )}

        {!ui.rightCollapsed ? (
          <>
            <CollapseBar side="left" onClick={() => toggleUI('rightCollapsed')} />
            <aside className="no-print flex w-[300px] shrink-0 flex-col border-l border-line bg-white">
              <PropertyPanel />
            </aside>
          </>
        ) : (
          <CollapseBar side="right" onClick={() => toggleUI('rightCollapsed')} />
        )}
      </div>

      <StatusBar pointer={pointer} />

      {/* 诊断面板（帮助 → 诊断信息 / ?diag=1） */}
      <DiagnosticsPanel open={ui.showDiagnostics} onClose={() => toggleUI('showDiagnostics')} />
    </div>
  );
}
