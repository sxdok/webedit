/**
 * 职责：**画布上方的分页标签**（像 PS 打开多个文档时的标签栏）。
 *
 * 每个标签 = 一"页" = 一份**独立文档**（有自己的模式与内容）；点标签切页，
 * 页的模式决定画布预览与右侧属性面板（文档模式看纸张/文档属性，Web 模式看画布/绝对定位属性）。
 *
 *   ＋  → 打开「新建文档」对话框（先选模式 → 再填参数）→ 新建一页
 *   ×  → 关闭该页（只剩一页时不给关；关闭当前页会切到相邻页）
 */
import { useMemo } from 'react';
import { FileText, Monitor, Plus, X } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

export function PageTabs() {
  const pages = useEditorStore((s) => s.pages);
  const activeId = useEditorStore((s) => s.activePageId);
  const doc = useEditorStore((s) => s.doc);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const closePage = useEditorStore((s) => s.closePage);
  const setNewDocOpen = useEditorStore((s) => s.setNewDocOpen);

  /** 当前页的标题/模式以**活的 doc** 为准（改名、切模式后标签立刻跟着变） */
  const list = useMemo(
    () => pages.map((p) => (p.id === activeId ? { ...p, title: doc.title, mode: doc.mode } : p)),
    [pages, activeId, doc.title, doc.mode],
  );

  return (
    <div
      data-page-tabs="1"
      className="no-print flex h-8 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-line bg-white px-2"
    >
      {list.map((p) => {
        const active = p.id === activeId;
        const Icon = p.mode === 'web' ? Monitor : FileText;
        return (
          <div
            key={p.id}
            data-page-tab={p.id}
            data-page-mode={p.mode}
            data-page-active={active ? '1' : '0'}
            className={`group flex shrink-0 items-center gap-1 border-b-2 px-2 text-2xs ${
              active ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <button
              type="button"
              data-page-select={p.id}
              title={`${p.title}（${p.mode === 'web' ? 'Web 模式' : '文档模式'}）—— 点击切换这一页`}
              className="flex max-w-[180px] items-center gap-1 truncate py-1"
              onClick={() => setActivePage(p.id)}
            >
              <Icon className={`h-3 w-3 shrink-0 ${p.mode === 'web' ? 'text-emerald-600' : 'text-primary'}`} />
              <span className="truncate">{p.title || '未命名'}</span>
              <span className="shrink-0 rounded bg-gray-100 px-1 text-[9px] leading-4 text-gray-500">
                {p.mode === 'web' ? 'Web' : '文档'}
              </span>
            </button>
            {pages.length > 1 && (
              <button
                type="button"
                data-page-close={p.id}
                title="关闭这一页"
                className="rounded p-0.5 text-gray-300 opacity-0 hover:bg-gray-100 hover:text-red-500 group-hover:opacity-100"
                onClick={() => closePage(p.id)}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        data-page-add="1"
        title="新建一页（先选模式 → 再填参数）"
        className="my-1 ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-dashed border-line text-gray-400 hover:border-primary hover:text-primary"
        onClick={() => setNewDocOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <span className="ml-auto flex shrink-0 items-center py-1 text-[10px] text-gray-400">
        共 {pages.length} 页 · 每页可独立选择模式（文档 / Web）
      </span>
    </div>
  );
}
