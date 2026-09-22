/**
 * 职责：左侧组件面板。按当前模式过滤（supportedModes），分组折叠展示，支持搜索、
 *       双击追加、拖拽到画布插入。面板代码不感知任何具体组件类型（§四 注册表机制）。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { getCategoriesByMode } from '../../registry';
import type { ComponentDefinition } from '../../registry/types';
import { getLiveTypes, loadRuntimeComponents } from '../../registry/live';
import { selectMode, useEditorStore } from '../../store/editorStore';

export const DRAG_MIME = 'application/x-editor-component';

function defaultSizeText(def: ComponentDefinition): string {
  if (def.defaultFrame) {
    const { w, h } = def.defaultFrame;
    return `默认尺寸：${w ?? 240} × ${h ?? 40}px`;
  }
  return '默认尺寸：自适应（文档流）';
}

function ComponentItem({ def }: { def: ComponentDefinition }) {
  const addComponent = useEditorStore((s) => s.addComponent);
  const Icon = def.icon;
  return (
    <button
      type="button"
      draggable
      title={`${def.label}｜${def.description ?? ''}\n${defaultSizeText(def)}\n拖到画布插入 · 双击追加`}
      onDoubleClick={() => addComponent(def.type)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, def.type);
        e.dataTransfer.setData('text/plain', def.type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="flex h-8 w-full cursor-grab items-center gap-2 rounded px-2 text-left text-[13px] text-gray-700 hover:bg-primary/5 hover:text-primary active:cursor-grabbing"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded border border-line bg-white text-gray-500">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{def.label}</span>
    </button>
  );
}

function Category({
  name,
  items,
  open,
  onToggle,
}: {
  name: string;
  items: ComponentDefinition[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 rounded bg-gray-100 px-2 py-1 text-left text-xs font-semibold text-gray-600 hover:bg-gray-200/70"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="flex-1">{name}</span>
        <span className="text-2xs font-normal text-gray-400">{items.length}</span>
      </button>
      {open && (
        <div className="mt-0.5 pl-0.5">
          {items.map((def) => (
            <ComponentItem key={def.type} def={def} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ComponentPanel() {
  const mode = useEditorStore(selectMode);
  const registryVersion = useEditorStore((s) => s.ui.registryVersion);
  const bumpRegistry = useEditorStore((s) => s.bumpRegistry);
  const [query, setQuery] = useState('');
  // 默认只展开「通用」，其余分类折叠（点分类标题展开）
  const [closed, setClosed] = useState<Record<string, boolean>>({ 文档专用: true, 'PPT 专用': true, 'Web 专用 / 基础控件': true, 'Web 专用 / 布局容器': true, 'Web 专用 / 展示组件': true });
  const [reloading, setReloading] = useState(false);

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="panel-title">组件</span>
        <span className="ml-auto text-2xs text-gray-400">
          {mode === 'document' ? '文档模式' : 'Web 模式'}
        </span>
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
            />
          ))
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-2xs text-gray-400">
        <span className="truncate">共 {total} 个 · 拖拽或双击插入</span>
        <button
          type="button"
          title="重新加载 public/组件/ 下的外部组件（改完文件点这里即可，无需重新构建）"
          disabled={reloading}
          onClick={() => {
            setReloading(true);
            void loadRuntimeComponents(true)
              .then((r) => {
                bumpRegistry();
                const n = getLiveTypes().length;
                if (r.failed.length) window.alert(`外部组件：成功 ${r.ok} 个，失败 ${r.failed.length} 个（${r.failed.join('、')}）\n详情见 帮助 → 诊断信息。`);
                else window.alert(`外部组件已重载：${n} 个（${r.source}）`);
              })
              .finally(() => setReloading(false));
          }}
          className="ml-auto flex-none whitespace-nowrap rounded border border-line px-2 py-1 hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {reloading ? '重载中…' : `重载外部组件 (${getLiveTypes().length})`}
        </button>
      </div>
    </div>
  );
}
