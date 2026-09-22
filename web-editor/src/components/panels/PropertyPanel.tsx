/**
 * 职责：右侧属性面板。完全由注册表 Schema 驱动：
 *   顶部显示模式标签 + 选中组件类型名 + 组件 ID（可复制）；
 *   属性按 group 分节折叠；未选中时按模式显示页面属性 / 画布属性。
 * 面板代码不感知任何具体组件字段（§四）。
 */
import { useMemo, useState } from 'react';
import { Copy, Layers, Search } from 'lucide-react';
import { getComponent } from '../../registry';
import type { ComponentNode, PropSchemaItem, RenderContext } from '../../registry/types';
import { selectMode, selectPrimarySelected, useEditorStore } from '../../store/editorStore';
import { PropertyControl } from '../property-controls';
import { PagePropertyPanel } from './PagePropertyPanel';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';
import { PropertyGroup } from './PropertyGroup';

export const GROUP_ORDER = ['表格', '单元格', '内容', '排版', '外观', '尺寸', '布局', '高级'];

/** 默认只展开这个分组，其余分组默认折叠（与左侧组件面板"只展开一类"一致） */
export const DEFAULT_OPEN_GROUP = '表格';

/**
 * 分组说明（默认隐藏，鼠标悬停分组标题时弹气泡）——重点把"整表属性 vs 单元格属性"讲清楚，
 * 这也是用户明确要求的：右侧属性里必须一眼看出改的是整体还是某个单元格。
 */
export const GROUP_HINTS: Record<string, string> = {
  表格: '整张表格的属性。下面「单元格」组里针对个别格子做的设置会覆盖这里的默认值。',
  单元格: '只作用于画布上选中的单元格（点选/拖选一片）。没被覆盖的项沿用「表格」组的默认值。',
  内容: '组件的内容与文字。',
  排版: '字体、字号、行距、字距、对齐等文字样式。',
  外观: '背景、边框、圆角、阴影等外观。',
  尺寸: '宽高与上下边距。',
  布局: '位置与排布方式。',
  高级: '不常用项。',
};

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

      <div className="thin-scroll flex-1 overflow-auto" data-props-scroll="1">
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
  // 记录"哪些分组被手动展开/折叠"的覆盖值；没记录的按默认
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // ★选中了单元格时，「单元格」组**临时默认展开**：用户点了格子就该看到格式控件。
  //   注意用"派生默认值"而不是写 state——否则展开状态会一直留着（选中取消后也收不回去）。
  const tableCells = useEditorStore((s) => s.ui.tableCells);
  const cellGroupOpen = !!tableCells && tableCells.nodeId === node?.id;

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

  // ★默认展开哪个组：有「表格」组就展开它；否则展开**第一个组**（非表格组件若全折叠，
  //   用户选中后会看到一排折叠标题、看不到任何属性）
  const defaultOpenGroup = sections.some(([g]) => g === DEFAULT_OPEN_GROUP)
    ? DEFAULT_OPEN_GROUP
    : (sections[0]?.[0] ?? '');

  if (!def) {
    return (
      <div className="px-3 py-3 text-2xs text-gray-500">
        组件类型「{node.type}」未在注册表中（可能来自旧版本导出文件）。
      </div>
    );
  }

  return (
    <div className="px-2.5 py-1.5" data-props-panel="1">
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

      <div className="mb-1.5 flex h-6 items-center gap-1.5 rounded border border-line bg-white px-2">
        <Search className="h-3.5 w-3.5 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="过滤属性…"
          className="w-full min-w-0 border-0 text-xs outline-none placeholder:text-gray-300"
        />
      </div>

      {sections.length === 0 && (
        <p className="text-2xs text-gray-400">该组件没有匹配的属性（可在组件定义里补 propSchema）。</p>
      )}

      {sections.map(([group, items]) => {
        const open = toggled[group] ?? (group === defaultOpenGroup || (group === '单元格' && cellGroupOpen));
        return (
          <PropertyGroup
            key={group}
            name={group}
            count={items.length}
            open={open}
            hint={GROUP_HINTS[group]}
            onToggle={() => setToggled((s) => ({ ...s, [group]: !open }))}
          >
            {items.map((item) => (
              <PropertyControl
                key={item.key}
                item={item}
                value={node.props[item.key]}
                nodeId={node.id}
                onChange={(v) => updateProps(node.id, { [item.key]: v })}
              />
            ))}
          </PropertyGroup>
        );
      })}
    </div>
  );
}
