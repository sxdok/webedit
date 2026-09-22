/**
 * 职责：右侧属性面板。完全由注册表 Schema 驱动：
 *   顶部显示模式标签 + 选中组件类型名 + 组件 ID（可复制）；
 *   属性按 group 分节折叠；未选中时按模式显示页面属性 / 画布属性。
 * 面板代码不感知任何具体组件字段（§四）。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Layers, Search } from 'lucide-react';
import { getComponent } from '../../registry';
import type { ComponentNode, PropSchemaItem, RenderContext } from '../../registry/types';
import { selectMode, selectPrimarySelected, useEditorStore } from '../../store/editorStore';
import { PropertyControl } from '../property-controls';
import { PagePropertyPanel } from './PagePropertyPanel';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';

const GROUP_ORDER = ['内容', '排版', '外观', '尺寸', '布局', '高级'];

function groupOf(item: PropSchemaItem): string {
  return item.group || '内容';
}

export function PropertyPanel() {
  const mode = useEditorStore(selectMode);
  const node = useEditorStore(selectPrimarySelected);
  const selectedCount = useEditorStore((s) => s.doc.selectedIds.length);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="panel-title">属性</span>
        <span
          className={`ml-1 rounded px-1.5 py-0.5 text-2xs ${
            mode === 'document' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {mode === 'document' ? '文档模式' : 'Web 模式'}
        </span>
        {selectedCount > 1 && <span className="text-2xs text-gray-400">多选 {selectedCount}</span>}
      </div>

      <div className="thin-scroll flex-1 overflow-auto">
        {node ? <NodeProperties node={node} mode={mode} /> : mode === 'document' ? <PagePropertyPanel /> : <CanvasPropertyPanel />}
      </div>
    </div>
  );
}

function NodeProperties({ node, mode }: { node: ComponentNode; mode: 'document' | 'web' }) {
  const def = getComponent(node.type);
  const updateProps = useEditorStore((s) => s.updateProps);
  const updateFrame = useEditorStore((s) => s.updateFrame);
  const page = useEditorStore((s) => s.doc.document.page);
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const ctx: RenderContext = useMemo(
    () => ({
      mode,
      page,
      canvas,
      isEditing: true,
      isSelected: true,
      mmToPx: (mm) => mm * 3.779527559,
      ptToPx: (pt) => (pt * 96) / 72,
    }),
    [mode, page, canvas],
  );

  const sections = useMemo(() => {
    if (!def) return [];
    const q = query.trim().toLowerCase();
    const items = def.propSchema.filter((it) => {
      if (it.visibleWhen && !it.visibleWhen(node.props, ctx)) return false;
      if (!q) return true;
      return it.label.toLowerCase().includes(q) || it.key.toLowerCase().includes(q);
    });
    const buckets = new Map<string, PropSchemaItem[]>();
    items.forEach((it) => {
      const g = groupOf(it);
      buckets.set(g, [...(buckets.get(g) ?? []), it]);
    });
    return [...buckets.entries()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a[0]);
      const ib = GROUP_ORDER.indexOf(b[0]);
      return (ia < 0 ? GROUP_ORDER.length : ia) - (ib < 0 ? GROUP_ORDER.length : ib);
    });
  }, [def, node.props, query, ctx]);

  if (!def) {
    return (
      <div className="px-3 py-3 text-2xs text-gray-500">
        组件类型「{node.type}」未在注册表中（可能来自旧版本导出文件）。
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5">
        <def.icon className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-semibold text-gray-800">{def.label}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-2xs text-gray-500">
          {node.type}
        </span>
      </div>

      <div className="mb-2 flex items-center gap-1">
        <span className="font-mono text-2xs text-gray-400">{node.id}</span>
        <button
          type="button"
          title="复制组件 ID"
          onClick={() => {
            void navigator.clipboard?.writeText(node.id);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-primary"
        >
          <Copy className="h-3 w-3" />
        </button>
        {copied && <span className="text-2xs text-emerald-600">已复制</span>}
      </div>

      {mode === 'web' && node.frame && (
        <div className="mb-2 rounded border border-line px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1 text-2xs text-gray-500">
            <Layers className="h-3 w-3" /> 位置与尺寸（px）
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <span className="w-3 text-2xs uppercase text-gray-400">{k}</span>
                <input
                  type="number"
                  className="h-7 w-full rounded border border-line bg-white px-1 text-center text-xs"
                  value={node.frame?.[k] ?? 0}
                  onChange={(e) => updateFrame(node.id, { [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mb-2 flex h-7 items-center gap-1.5 rounded border border-line bg-white px-2">
        <Search className="h-3.5 w-3.5 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="过滤属性…"
          className="w-full border-0 text-[13px] outline-none placeholder:text-gray-300"
        />
      </div>

      {sections.length === 0 && (
        <p className="text-2xs text-gray-400">该组件没有匹配的属性（可在组件定义里补 propSchema）。</p>
      )}

      {sections.map(([group, items]) => {
        const open = !closed[group];
        return (
          <div key={group} className="mb-2">
            <button
              type="button"
              onClick={() => setClosed((s) => ({ ...s, [group]: !s[group] }))}
              className="flex w-full items-center gap-1 rounded bg-gray-100 px-2 py-1 text-left text-xs font-semibold text-gray-600 hover:bg-gray-200/70"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="flex-1">{group}</span>
              <span className="text-2xs font-normal text-gray-400">{items.length}</span>
            </button>
            {open && (
              <div className="mt-1.5">
                {items.map((item) => (
                  <PropertyControl
                    key={item.key}
                    item={item}
                    value={node.props[item.key]}
                    nodeId={node.id}
                    onChange={(v) => updateProps(node.id, { [item.key]: v })}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
