/**
 * 职责：右侧属性面板（Qt Designer 风格 · Schema 驱动）。结构（规格 §2）：
 *
 *   顶部固定区：组件图标 + 组件名 + 类型徽标 + 组件 ID（可复制）+ 「过滤属性…」
 *   ▼ 通用属性抽屉：位置与尺寸（Web）/ 上下左右边距（mm）/ 显示 / 锁定
 *   ▼ 专有属性抽屉：组件自己的 schema 分组（顺序与默认展开由 groupStrategy 按**类别**决定）
 *   ▼ 状态抽屉（只读）：类型 / ID / 父容器 / 同级序号 / 选中的单元格 / 数据来源
 *
 * 未选中组件 → 文档模式显示页面属性、Web 模式显示画布属性；多选 → MultiSelectPanel。
 * **面板代码不感知任何具体组件字段**：不出现 `if (type === 'table')`，
 * 表格的特殊性来自注册表数据（category: 'Excel 表格' + group: '表格'/'单元格'）与 groupStrategy。
 */
import { memo, useMemo, useState } from 'react';
import { Copy, Layers, Search } from 'lucide-react';
import { getComponent } from '../../registry';
import type { ComponentNode, PropSchemaItem, RenderContext } from '../../registry/types';
import { selectMode, selectPrimarySelected, useEditorStore } from '../../store/editorStore';
import { findParentId, getForest } from '../../store/treeUtils';
import { getLiveTypes } from '../../registry/live';
import { PropertyControl } from '../property-controls';
import { PagePropertyPanel } from './PagePropertyPanel';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';
import { MultiSelectPanel } from './MultiSelectPanel';
import { PropertyGroup } from './PropertyGroup';
import { PropertyDrawer } from './PropertyDrawer';
import { PropertyRow } from './PropertyRow';
import {
  GROUP_HINTS,
  GROUP_ORDER,
  UNIVERSAL_KEYS,
  hintFor,
  orderGroups,
} from './groupStrategy';

export { GROUP_HINTS, GROUP_ORDER };

function groupOf(item: PropSchemaItem): string {
  return item.group || '内容';
}

/** 面板级 memo（规格阶段五）：App 因鼠标坐标等无关状态重渲染时，属性子树不跟着重渲染 */
export const NodePropertiesMemo = memo(NodeProperties);

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
        {selectedCount > 1 ? (
          <MultiSelectPanel />
        ) : node ? (
          <NodePropertiesMemo node={node} mode={mode} />
        ) : mode === 'document' ? (
          <PagePropertyPanel />
        ) : (
          <CanvasPropertyPanel />
        )}
      </div>
    </div>
  );
}

/** 通用属性抽屉里的"显示 / 锁定"两项（不是 schema 属性：显示是文档数据、锁定是编辑器态） */
const VISIBLE_ITEM: PropSchemaItem = {
  key: 'visible',
  label: '是否可见（编辑器态；隐藏后画布不渲染）',
  control: 'switch',
  group: '通用属性',
  defaultValue: true,
};
const LOCKED_ITEM: PropSchemaItem = {
  key: 'locked',
  label: '是否锁定（编辑器态，不导出；锁定时画布不可拖拽）',
  control: 'switch',
  group: '通用属性',
  defaultValue: false,
};

/** 面板级 memo + 渲染计数（计数只为自检："画布鼠标移动导致 App 重渲染时，属性子树不该跟着重渲染"） */
let nodePropsRenders = 0;

function NodeProperties({ node, mode }: { node: ComponentNode; mode: 'document' | 'web' }) {
  nodePropsRenders += 1;
  const def = getComponent(node.type);
  const updateProps = useEditorStore((s) => s.updateProps);
  const updateFrame = useEditorStore((s) => s.updateFrame);
  const setNodeHidden = useEditorStore((s) => s.setNodeHidden);
  const toggleLocked = useEditorStore((s) => s.toggleLocked);
  const lockedIds = useEditorStore((s) => s.ui.lockedIds) ?? [];
  const page = useEditorStore((s) => s.doc.document.page);
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  const doc = useEditorStore((s) => s.doc);
  const tableCells = useEditorStore((s) => s.ui.tableCells);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  /* ★折叠状态放进 store.ui（随持久化保存 → 刷新后保持），规格阶段五「折叠状态持久化」。
     键加 `node:` 前缀，避免与页面属性面板的同名分组（如「尺寸」）互串。 */
  const closed = useEditorStore((s) => s.ui.propClosed) ?? { groups: {}, drawers: {} };
  const setPropClosed = useEditorStore((s) => s.setPropClosed);
  const toggled = useMemo(
    () => Object.fromEntries(Object.entries(closed.groups).map(([k, v]) => [k, !v])),
    [closed.groups],
  );
  const setToggled = (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => {
    const next = fn(toggled);
    const groups: Record<string, boolean> = {};
    for (const [k, open] of Object.entries(next)) if (open !== toggled[k]) groups[k] = !open; // 只报变化的键
    setPropClosed({ groups });
  };
  const drawer = useMemo(
    () => ({
      通用属性: closed.drawers['node:通用属性'] !== true,
      专有属性: closed.drawers['node:专有属性'] !== true,
      状态: closed.drawers['node:状态'] !== true,
    }),
    [closed.drawers],
  );
  const setDrawer = (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => {
    const next = fn(drawer);
    const entries: Record<string, boolean> = {};
    (['通用属性', '专有属性', '状态'] as const).forEach((k) => {
      if (next[k] !== drawer[k]) entries[`node:${k}`] = next[k] === false; // 只报变化的键
    });
    setPropClosed({ drawers: entries });
  };
  // 选中了单元格时，「单元格」组**临时默认展开**（派生值，不写 state，取消选中后自动收起）
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

  /** 专有属性 = schema 里除去"通用属性（上下边距）"的部分 */
  const own = useMemo(() => (def ? def.propSchema.filter((it) => !UNIVERSAL_KEYS.has(it.key)) : []), [def]);
  const universal = useMemo(() => (def ? def.propSchema.filter((it) => UNIVERSAL_KEYS.has(it.key)) : []), [def]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return own.filter((it) => {
      if (it.visibleWhen && !it.visibleWhen(node.props, ctx)) return false;
      if (!q) return true;
      return it.label.toLowerCase().includes(q) || it.key.toLowerCase().includes(q);
    });
  }, [own, node.props, query, ctx]);

  /** 分组 + 按类别策略排序（规格 §6） */
  const sections = useMemo(() => {
    const buckets = new Map<string, PropSchemaItem[]>();
    visibleItems.forEach((it) => {
      const g = groupOf(it);
      buckets.set(g, [...(buckets.get(g) ?? []), it]);
    });
    const order = orderGroups([...buckets.keys()], def?.category ?? '');
    return order.map((g) => [g, buckets.get(g) ?? []] as [string, PropSchemaItem[]]);
  }, [visibleItems, def?.category]);

  /**
   * 默认展开：**只展开排在第一个的分组**（用户 2026-09-23），其余折叠。
   * 表格类的第一个分组是「单元格」（顺序见 GROUP_ORDER：单元格 → 表格 → …）。
   */
  const firstGroup = sections[0]?.[0] ?? '';

  /** 状态抽屉（只读） */
  const status = useMemo(() => {
    const forest = getForest(doc);
    const parentId = findParentId(forest, node.id);
    const siblings = (() => {
      const find = (list: ComponentNode[]): ComponentNode[] | null => {
        if (list.some((n) => n.id === node.id)) return list;
        for (const n of list) {
          const hit = n.children ? find(n.children) : null;
          if (hit) return hit;
        }
        return null;
      };
      return find(forest) ?? [];
    })();
    const idx = siblings.findIndex((n) => n.id === node.id);
    const live = getLiveTypes().includes(node.type);
    return {
      组件类型: node.type,
      '组件 ID': node.id,
      父容器: parentId ?? '根（root）',
      同级顺序: `${idx + 1} / ${siblings.length}`,
      选中的单元格: cellGroupOpen && tableCells ? tableCells.cells.join(' ') : '—',
      数据来源: live ? '外部热加载（public/组件/*.js）' : '内置组件',
    };
  }, [doc, node.id, node.type, cellGroupOpen, tableCells]);

  if (!def) {
    return (
      <div className="px-3 py-3 text-2xs text-gray-500">
        组件类型「{node.type}」未在注册表中（可能来自旧版本导出文件）。
      </div>
    );
  }

  const filtered = query.trim().length > 0;

  return (
    <div className="px-2.5 py-1.5" data-props-panel="1" data-props-renders={nodePropsRenders}>
      {/* ── 顶部固定区 ── */}
      <div className="mb-1 flex items-center gap-1.5">
        <def.icon className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-semibold text-gray-800">{def.label}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-2xs text-gray-500">{node.type}</span>
      </div>
      <div className="mb-1.5 flex items-center gap-1">
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
      <div className="mb-1.5 flex h-6 items-center gap-1.5 rounded-md border border-line bg-white px-2">
        <Search className="h-3.5 w-3.5 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="过滤属性…"
          className="w-full min-w-0 border-0 text-xs outline-none placeholder:text-gray-300"
        />
      </div>

      {/* ── 通用属性抽屉 ── */}
      <PropertyDrawer
        name="通用属性"
        open={drawer['通用属性'] !== false}
        onToggle={() => setDrawer((s) => ({ ...s, 通用属性: s['通用属性'] === false }))}
        badge={`${universal.length + (mode === 'web' && node.frame ? 4 : 0) + 2} 项`}
        hint="所有组件都有的属性：位置与尺寸（Web 模式）、上下边距、显示与锁定。"
      >
        {mode === 'web' && node.frame && (
          <>
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <PropertyRow
                key={k}
                item={{ key: `frame.${k}`, label: `位置与尺寸 ${k.toUpperCase()}（px）`, control: 'number', group: '位置与尺寸', defaultValue: 0 }}
                value={node.frame?.[k] ?? 0}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <Layers className="h-3 w-3 shrink-0 text-gray-300" />
                  <input
                    type="number"
                    data-frame={k}
                    className="h-7 w-full min-w-0 rounded-md border border-line bg-white px-1 text-right text-xs tabular-nums outline-none focus:border-primary"
                    value={node.frame?.[k] ?? 0}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) updateFrame(node.id, { [k]: v });
                    }}
                  />
                </div>
              </PropertyRow>
            ))}
          </>
        )}
        {universal.map((item) => (
          <PropertyControl
            key={item.key}
            item={item}
            value={node.props[item.key]}
            nodeId={node.id}
            onChange={(v) => updateProps(node.id, { [item.key]: v })}
          />
        ))}
        <PropertyRow item={VISIBLE_ITEM} value={node.hidden !== true}>
          <PropertyControl
            item={VISIBLE_ITEM}
            value={node.hidden !== true}
            onChange={(v) => setNodeHidden(node.id, v !== true)}
          />
        </PropertyRow>
        <PropertyRow item={LOCKED_ITEM} value={lockedIds.includes(node.id)}>
          <PropertyControl item={LOCKED_ITEM} value={lockedIds.includes(node.id)} onChange={() => toggleLocked(node.id)} />
        </PropertyRow>
      </PropertyDrawer>

      {/* ── 专有属性抽屉 ── */}
      <PropertyDrawer
        name="专有属性"
        open={drawer['专有属性'] !== false}
        onToggle={() => setDrawer((s) => ({ ...s, 专有属性: s['专有属性'] !== false ? false : true }))}
        badge={`${visibleItems.length} 项`}
        hint="这个组件自己的属性，按分组归并；分组顺序按组件类别（Word / PPT / Excel 表格 / Web）决定，默认只展开第一个分组。"
      >
        {sections.length === 0 && (
          <p className="px-1 text-2xs text-gray-400">该组件没有匹配的属性（可在组件定义里补 propSchema）。</p>
        )}
        {sections.map(([group, items], idx) => {
          // 规格 §8.1：分组之间画细分隔线（第一个分组不画）
          const open =
            filtered ||
            (group === '单元格' && cellGroupOpen) ||
            (toggled[group] ?? group === firstGroup);
          return (
            <PropertyGroup
              key={group}
              name={group}
              count={items.length}
              open={open}
              divider={idx > 0}
              hint={hintFor(def.category, group, GROUP_HINTS)}
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
      </PropertyDrawer>

      {/* ── 状态抽屉（只读） ── */}
      <PropertyDrawer
        name="状态"
        open={drawer['状态'] !== false}
        onToggle={() => setDrawer((s) => ({ ...s, 状态: s['状态'] === false }))}
        hint="只读信息：组件身份、所处层级、选中的单元格、组件来源。"
      >
        {Object.entries(status).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 py-0.5 text-2xs text-gray-500" data-status-row={k}>
            <span className="w-24 shrink-0 truncate">{k}</span>
            <span className="ml-auto truncate font-mono text-gray-600" title={v}>
              {v}
            </span>
          </div>
        ))}
      </PropertyDrawer>
    </div>
  );
}
