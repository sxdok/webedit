/**
 * 职责：左侧组件面板。按当前模式过滤（supportedModes），分组折叠展示，支持搜索、
 *       双击追加、拖拽到画布插入。面板代码不感知任何具体组件类型（§四 注册表机制）。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Search } from 'lucide-react';
import { getCategoriesByMode } from '../../registry';
import { categoryLabel, type ComponentDefinition, type RenderContext } from '../../registry/types';
import { getLiveTypes } from '../../registry/live';
import { selectMode, useEditorStore } from '../../store/editorStore';
import { mmToPx, ptToPx } from '../../utils/units';
import { Tooltip } from '../ui/Tooltip';
import { ComponentThumb } from './ComponentThumb';

export const DRAG_MIME = 'application/x-editor-component';

function defaultSizeText(def: ComponentDefinition): string {
  if (def.defaultFrame) {
    const { w, h } = def.defaultFrame;
    return `默认尺寸：${w ?? 240} × ${h ?? 40}px`;
  }
  return '默认尺寸：自适应（文档流）';
}

function ComponentItem({ def, ctx, preview }: { def: ComponentDefinition; ctx: RenderContext; preview: boolean }) {
  const addComponent = useEditorStore((s) => s.addComponent);
  const Icon = def.icon;
  return (
    <Tooltip
      content={{
        name: def.label,
        keyText: def.type,
        detail: [
          def.description ?? '',
          `${defaultSizeText(def)} · 拖到画布插入 / 双击追加`,
        ].filter(Boolean),
      }}
      side="right"
      /* ★包装元素必须是**块级网格项**。Tooltip 默认的 `inline-flex` 是行内级盒子，
         会把同一分类下的组件项排成一行横向流动（面板看起来是"挤在一起的两列"且宽度参差）；
         这里显式声明成网格项，两列才会等宽对齐、名称才会按列宽省略。 */
      wrapClassName="min-w-0"
    >
    <button
      type="button"
      draggable
      data-comp-item="1"
      data-comp-preview={preview ? '1' : '0'}
      onDoubleClick={() => addComponent(def.type)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, def.type);
        e.dataTransfer.setData('text/plain', def.type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className={`w-full min-w-0 cursor-grab rounded text-left text-[13px] text-gray-700 hover:bg-primary/5 hover:text-primary active:cursor-grabbing ${
        preview ? 'px-1 py-1' : 'flex h-8 items-center gap-1.5 px-1'
      }`}
    >
      <span className={preview ? 'flex items-center gap-1.5' : 'contents'}>
        <span
          data-comp-icon="1"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-white text-gray-500"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span data-comp-name="1" className="min-w-0 flex-1 truncate">
          {def.label}
        </span>
      </span>
      {/* 真渲染缩略图（B9）：取景框整体 pointer-events:none，点击/拖拽仍旧落在卡片上 */}
      {preview && (
        <span className="mt-1 block">
          <ComponentThumb def={def} ctx={ctx} />
        </span>
      )}
    </button>
    </Tooltip>
  );
}

function Category({
  name,
  items,
  open,
  onToggle,
  ctx,
  preview,
}: {
  name: string;
  items: ComponentDefinition[];
  open: boolean;
  onToggle: () => void;
  ctx: RenderContext;
  preview: boolean;
}) {
  return (
    <div className="mb-1">
      <button
        type="button"
        data-category-name={name}
        /* 面板显示短名（Word/Excel/PPT/布局）；契约里仍是全名，所以 title 里给出全名 */
        title={`${categoryLabel(name)}（${name}）`}
        onClick={onToggle}
        className="flex w-full items-center gap-1 rounded bg-gray-100 px-2 py-1 text-left text-xs font-semibold text-gray-600 hover:bg-gray-200/70"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="flex-1">{categoryLabel(name)}</span>
        <span className="text-2xs font-normal text-gray-400">{items.length}</span>
      </button>
      {open && (
        <div
          data-comp-grid="1"
          data-comp-grid-cols={preview ? '1' : '2'}
          className={`mt-1 grid gap-x-2 gap-y-0.5 pl-0.5 ${preview ? 'grid-cols-1 gap-y-1' : 'grid-cols-2'}`}
        >
          {items.map((def) => (
            <ComponentItem key={def.type} def={def} ctx={ctx} preview={preview} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ComponentPanel() {
  const mode = useEditorStore(selectMode);
  const registryVersion = useEditorStore((s) => s.ui.registryVersion);
  const preview = useEditorStore((s) => s.ui.compPreview ?? true);
  const setCompPreview = useEditorStore((s) => s.setCompPreview);
  const page = useEditorStore((s) => s.doc.document.page);
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  const [query, setQuery] = useState('');
  // 默认只展开「Word 常用」（最常用的一类），其余分类折叠（点分类标题展开）
  const [closed, setClosed] = useState<Record<string, boolean>>({
    'Excel 表格': true,
    通用: true,
    布局分页: true,
    'PPT 专用': true,
    'Web 控件': true,
    'Web 容器': true,
  });

  const categories = useMemo(() => {
    const all = getCategoriesByMode(mode);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (d) =>
            d.label.toLowerCase().includes(q) ||
            d.type.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.items.length > 0);
    // registryVersion：运行时热加载组件后需要重新计算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query, registryVersion]);

  const total = categories.reduce((n, c) => n + c.items.length, 0);

  /** 缩略图的渲染上下文：只读、非编辑态，纸张/画布取当前文档的（同一套比例） */
  const thumbCtx: RenderContext = useMemo(
    () => ({ mode, page, canvas, isEditing: false, isSelected: false, mmToPx, ptToPx }),
    [mode, page, canvas],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="panel-title">组件</span>
        <button
          type="button"
          data-comp-preview-toggle="1"
          data-comp-preview-state={preview ? '1' : '0'}
          title={preview ? '隐藏缩略图（回到紧凑两列）' : '显示真渲染缩略图'}
          onClick={() => setCompPreview(!preview)}
          className="ml-auto rounded border border-line p-1 text-gray-400 hover:border-primary hover:text-primary"
        >
          {preview ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        <span className="text-2xs text-gray-400">{mode === 'document' ? '文档模式' : 'Web 模式'}</span>
      </div>

      <div className="border-b border-line px-2 py-2">
        <div className="flex h-7 items-center gap-1.5 rounded border border-line bg-white px-2">
          <Search className="h-3.5 w-3.5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索组件…"
            className="w-full border-0 text-[13px] outline-none placeholder:text-gray-300"
          />
        </div>
      </div>

      <div className="thin-scroll flex-1 overflow-auto px-2 py-2">
        {total === 0 ? (
          <p className="px-1 py-3 text-2xs leading-5 text-gray-400">
            当前模式下没有可用的组件。
            <br />
            （按实现计划，组件在阶段四注册：只需在 registry/components/ 下新增文件并注册，本面板会自动出现。）
          </p>
        ) : (
          categories.map((c) => (
            <Category
              key={c.name}
              name={c.name}
              items={c.items}
              open={!closed[c.name]}
              onToggle={() => setClosed((s) => ({ ...s, [c.name]: !s[c.name] }))}
              ctx={thumbCtx}
              preview={preview}
            />
          ))
        )}
      </div>

      {/* ★底部的「重载外部组件」按钮已按用户要求收进「首选项 → 组件箱」（2026-09-24），
          这里只留计数与操作提示。 */}
      <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-2xs text-gray-400">
        <span className="truncate">共 {total} 个 · 拖拽或双击插入</span>
        <span data-comp-live-count={getLiveTypes().length} className="ml-auto flex-none whitespace-nowrap">
          外部组件 {getLiveTypes().length} 个
        </span>
      </div>
    </div>
  );
}
