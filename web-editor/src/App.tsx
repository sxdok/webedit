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
import { MarkdownDialog } from './components/panels/MarkdownDialog';
import { NewDocDialog } from './components/layout/NewDocDialog';
import { NoticeBar } from './components/layout/NoticeBar';
import { DropToImport } from './components/layout/DropToImport';
import { PreferencesDialog } from './components/panels/PreferencesDialog';
import { PropertyPanel } from './components/panels/PropertyPanel';
import { TooltipLayer } from './components/ui/Tooltip';
import { useEditorStore } from './store/editorStore';

function CollapseBar({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tip-text={side === 'left' ? '折叠/展开组件面板' : '折叠/展开属性面板'}
      className="no-print flex w-3 shrink-0 items-center justify-center border-line bg-white text-gray-400 hover:bg-gray-100 hover:text-primary"
      style={{ borderLeftWidth: side === 'right' ? 1 : 0, borderRightWidth: side === 'left' ? 1 : 0 }}
    >
      {side === 'left' ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
    </button>
  );
}

/**
 * 面板宽度拖拽手柄（用户 2026-09-23：左右面板要能拖拽调宽）。
 * · 用 Pointer Events + setPointerCapture：拖到面板外也不会丢事件；
 * · 双保险：pointerup/cancel 都收尾，并清掉 body 上的 cursor 覆盖；
 * · 只改宽度（180–560），不改文档、不入历史。
 */
function PanelResizer({ side, width, onResize }: { side: 'left' | 'right'; width: number; onResize: (w: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '拖动调整组件面板宽度' : '拖动调整属性面板宽度'}
      data-panel-resizer={side}
      data-tip-text="拖动调整宽度（双击恢复默认）"
      className="no-print group relative z-10 w-1 shrink-0 cursor-col-resize bg-transparent"
      onDoubleClick={() => onResize(side === 'left' ? 240 : 300)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const startX = e.clientX;
        const startW = width;
        // ★setPointerCapture 在"非真实指针"（自检里 dispatchEvent 的合成事件）上会抛
        //   InvalidPointerId；这里兜住，拖拽逻辑本身不依赖捕获成功。
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* 忽略：合成事件没有活动指针 */
        }
        const prevCursor = document.body.style.cursor;
        const prevSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          onResize(startW + (side === 'left' ? dx : -dx));
        };
        const done = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', done);
          el.removeEventListener('pointercancel', done);
          document.body.style.cursor = prevCursor;
          document.body.style.userSelect = prevSelect;
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', done);
        el.addEventListener('pointercancel', done);
      }}
    >
      {/* 视觉上是一条 1px 分隔线，hover/拖动时高亮 */}
      <span className="absolute inset-y-0 left-0 w-px bg-line group-hover:bg-primary/60" />
    </div>
  );
}

export default function App() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const ui = useEditorStore((s) => s.ui);
  const toggleUI = useEditorStore((s) => s.toggleUI);
  const setPanelWidth = useEditorStore((s) => s.setPanelWidth);
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
            <aside
              className="no-print flex shrink-0 flex-col border-r border-line bg-white"
              style={{ width: ui.leftWidth ?? 240 }}
              data-panel="left"
            >
              <ComponentPanel />
            </aside>
            <PanelResizer side="left" width={ui.leftWidth ?? 240} onResize={(w) => setPanelWidth('left', w)} />
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
            <PanelResizer side="right" width={ui.rightWidth ?? 300} onResize={(w) => setPanelWidth('right', w)} />
            <aside
              className="no-print flex shrink-0 flex-col border-l border-line bg-white"
              style={{ width: ui.rightWidth ?? 300 }}
              data-panel="right"
            >
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

      {/* Markdown 源码视图（视图 → Markdown 源码）：只读，实时由组件树生成 */}
      <MarkdownDialog open={ui.showMarkdown} onClose={() => toggleUI('showMarkdown')} />

      {/* 首选项（视图 → 首选项…）：编辑器各项设置集中在这里 */}
      <PreferencesDialog />

      {/* 新建文档（文件 → 新建 / Ctrl+N）：先选模式 → 再按模式填参数 */}
      <NewDocDialog />

      {/* ★全局提示条（落盘被跳过 / 导入结果）与「拖文件进窗口即导入」 */}
      <NoticeBar />
      <DropToImport />

      {/* ★自研气泡的**事件委托层**（D16）：任何元素写 `data-tip-text="…"` 即可有统一气泡，
          不必包一层 span（避免改变 DOM 结构与布局）。挂一次，全局生效。 */}
      <TooltipLayer />
    </div>
  );
}
