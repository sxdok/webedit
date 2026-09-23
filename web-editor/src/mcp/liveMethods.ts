/**
 * 职责：**Bridge 的方法路由**（规格 §11 编辑器侧）—— 把 MCP 侧发来的 `{method, params}` 落到
 * 编辑器 store 的公开 action 上，并**返回与无头通道同形的结果**。
 *
 * 两条通道（Live / Headless）必须是同一个 Tool 的两种实现：客户端不该因为"编辑器开没开"而拿到
 * 不同的字段或不同的语义。所以这里每个方法都对齐 `editor-mcp/src/engine/session.ts` +
 * `tools/*.ts` 的返回形状（同样的 key、同样的 A1 记法、同样的行列平移规则），表格运算直接复用
 * 编辑器自己的 `tableKit`（`|` 分列、`\|`/`\n` 转义、A1 键、合并范围键），保证两边一致。
 *
 * 约定：
 *   · 抛 `new Error('CODE: message')` → MCP 侧解析出错误码（NODE_NOT_FOUND / CONFIRM_REQUIRED …）；
 *   · 抛 `LIVE_FALLBACK: ...` → 表示"编辑器有意不做这件事"，MCP 侧会**静默改用无头通道**并标 degraded；
 *   · **绝不用旧的 state 快照读结果**：store 的 action 是同步提交的，改完必须重新 getState() 再读，
 *     否则返回的永远是改动前的值（这个坑真踩过：setDevice 后返回的还是旧画布）。
 */
import { useEditorStore } from '../store/editorStore';
import { findNode, flatten, getForest } from '../store/treeUtils';
import { getComponent, getAllComponents, getCategoriesByMode } from '../registry';
import type { ComponentDefinition, ComponentNode, EditorDocument } from '../registry/types';
import { getLiveTypes } from '../registry/live';
import {
  a1Key,
  cellStyleKeyAt,
  parseA1,
  parseCellStyles,
  parseColWidths,
  parseTableData,
  serializeTableData,
  shiftCellKeys,
  type A1Range,
  type CellStyle,
} from '../registry/components/common/tableKit';
import { buildExportHtml } from '../utils/export/docExport';
import { buildReactComponent } from '../utils/export/reactExport';
import { buildComponentSpecSheet } from '../utils/specSheet';

type Params = Record<string, unknown>;
type Store = ReturnType<typeof useEditorStore.getState>;

const now = (): Store => useEditorStore.getState();
const num = (p: Params, k: string): number | undefined => (typeof p[k] === 'number' ? (p[k] as number) : undefined);

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function requireNode(id: string): ComponentNode {
  const node = findNode(getForest(now().doc), id);
  if (!node) fail('NODE_NOT_FOUND', `找不到节点 ${id}`);
  return node;
}

function requireDef(type: string): ComponentDefinition {
  const def = getComponent(type);
  if (!def) fail('COMPONENT_NOT_FOUND', `组件注册表里没有 ${type}`);
  return def;
}

/** A1 范围（也兼容旧写法 "1,1"）→ 0 基矩形 */
function rangeOf(key: string): A1Range {
  const p = parseA1(key);
  if (!p) fail('TABLE_RANGE_INVALID', `解析不了范围「${key}」，应形如 B2 或 B2:C3`);
  return p;
}

/** 范围内的所有 A1 键 */
function keysInRange(r: A1Range): string[] {
  const out: string[] = [];
  for (let row = r.r0; row <= r.r1; row += 1) for (let col = r.c0; col <= r.c1; col += 1) out.push(a1Key(row, col, row, col));
  return out;
}

/* ══════════════ 表格：与无头 tableKit 同一套语义 ══════════════ */

const isTableType = (type: string): boolean => type === 'table' || /Table$/.test(type);

function tableProps(id: string): { rows: string[][]; styles: Record<string, CellStyle>; before: ComponentNode } {
  const node = requireNode(id);
  if (!isTableType(node.type)) fail('INVALID_PROP_VALUE', `节点 ${id} 是 ${node.type}，不是表格类组件`);
  return { rows: parseTableData(node.props.data), styles: parseCellStyles(node.props.cellStyles), before: node };
}

/** 二维数组补齐成矩形 */
function padRect(rows: string[][], cols: number): string[][] {
  const width = Math.max(cols, rows.reduce((n, r) => Math.max(n, r.length), 0));
  return rows.map((r) => {
    const copy = [...r];
    while (copy.length < width) copy.push('');
    return copy;
  });
}

/* ══════════════ 主路由 ══════════════ */

export async function routeLive(method: string, params: Params): Promise<unknown> {
  const p = params ?? {};

  /**
   * ★文档域守卫（阶段八修正）：编辑器里只有**当前打开的这一份**文档。
   *   如果 MCP 请求的 `docId` 不是它，绝不能拿"当前文档"顶上 —— 那会把**另一个文档的内容**
   *   当成结果返回（静默给错数据，比报错糟得多）。这种情况一律交回无头通道：
   *   磁盘上的其它文档由无头读，找不到就如实报 `DOC_NOT_FOUND`。
   */
  const wantDoc = typeof p.docId === 'string' && p.docId !== '' ? p.docId : null;
  if (wantDoc && wantDoc !== now().doc.id) {
    throw new Error(
      `LIVE_FALLBACK: 文档 ${wantDoc} 不在编辑器里（当前打开的是 ${now().doc.id}），该请求交给无头通道`,
    );
  }

  // 判断一个节点是否隐藏（文档树里的 hidden 标记）
  const hiddenOf = (n: ComponentNode): boolean => n.hidden === true;

  switch (method) {
    /* ── 文档 ── */
    /**
     * doc.attach：把 MCP 会话的"当前文档"对到**编辑器里正在编辑的这一份**上。
     * 只读（不回写任何内容），是"用 MCP 改用户正在编辑的文档"的入口 ——
     * 没有它，MCP 会话的当前文档（常常是无头建的）和编辑器打开的文档永远对不上，
     * 所有 docId 相关的调用都会（正确地）降级到无头。
     */
    case 'doc.attach': {
      const d = now().doc;
      return {
        docId: d.id,
        title: d.title,
        mode: d.mode,
        counts: {
          documentNodes: flatten(d.document.components).length,
          webNodes: flatten(d.web.root.children ?? []).length,
        },
      };
    }
    case 'doc.get': {
      const d = now().doc;
      if (p.includeNodes === true) return { docId: d.id, document: d };
      return {
        docId: d.id,
        title: d.title,
        mode: d.mode,
        page: d.document.page,
        canvas: d.web.canvas,
        counts: { documentNodes: d.document.components.length, webTop: d.web.root.children?.length ?? 0 },
      };
    }
    case 'doc.summary': {
      const d = now().doc;
      const documentNodes = flatten(d.document.components).length;
      const thisMode = flatten(getForest(d)).length;
      const webNodes = flatten(d.web.root.children ?? []).length;
      const words = countWords(d);
      return {
        docId: d.id,
        title: d.title,
        mode: d.mode,
        nodes: thisMode,
        documentNodes,
        webNodes,
        pages: d.mode === 'web' ? 1 : Math.max(1, Math.ceil(words / 900)),
        words,
        bytes: null,
        mtime: null,
        via: 'live',
      };
    }
    case 'doc.rename': {
      now().setTitle(String(p.title ?? ''));
      const d = now().doc;
      return { docId: d.id, title: d.title };
    }
    case 'doc.list': {
      const d = now().doc;
      return {
        docs: [{ docId: d.id, title: d.title, mode: d.mode, current: true }],
        current: d.id,
        note: '编辑器里同时只有"当前这一份"文档；要批量管理磁盘文档请用无头通道（关闭 MCP 桥接）',
      };
    }
    // 建立/打开/关闭/删除/复制文档都属于"文件与窗口"层面：编辑器有意不做（避免毁掉未保存内容）
    case 'doc.create':
    case 'doc.open':
    case 'doc.close':
    case 'doc.delete':
    case 'doc.duplicate':
      throw new Error(`LIVE_FALLBACK: ${method} 由无头通道执行（编辑器里的文档由 UI 管理，桥接不会替你重置/删除它）`);

    /* ── 模式 / 页面 / 画布 ── */
    case 'mode.get':
      return { mode: now().doc.mode, docId: now().doc.id };
    case 'mode.set': {
      const mode = String(p.mode ?? 'document');
      if (mode === 'ppt') throw new Error('LIVE_FALLBACK: 编辑器没有 ppt 模式（PPT 组件是一个分类，不是模式）；已改到无头文档上标记');
      now().setMode(mode === 'web' ? 'web' : 'document');
      return { mode: now().doc.mode, docId: now().doc.id };
    }
    case 'mode.list':
      return {
        modes: [
          { id: 'document', label: '文档模式', desc: 'A4 纸张 + 文档流，自动分页' },
          { id: 'web', label: 'Web 模式', desc: '设备画布 + 绝对定位 + 容器嵌套' },
          { id: 'ppt', label: 'PPT 模式', desc: '幻灯片；当前编辑器把 PPT 组件作为"两种模式都能用"的类别，MCP 侧按文档流处理' },
        ],
      };
    case 'page.get':
      return now().doc.document.page;
    case 'page.setSize': {
      const size = String(p.size ?? 'A4');
      const w = num(p, 'width');
      const h = num(p, 'height');
      if (size === 'Custom' && w && h) now().setPageSizeCustom(w, h);
      else now().setPageSize(size as never);
      const page = now().doc.document.page;
      return { size: page.size, width: page.width, height: page.height };
    }
    case 'page.setOrientation': {
      now().setOrientation(String(p.orientation ?? 'portrait') as never);
      const page = now().doc.document.page;
      return { orientation: page.orientation, width: page.width, height: page.height };
    }
    case 'page.setMargin': {
      now().setMargin({
        ...(num(p, 'top') != null ? { top: num(p, 'top') } : {}),
        ...(num(p, 'right') != null ? { right: num(p, 'right') } : {}),
        ...(num(p, 'bottom') != null ? { bottom: num(p, 'bottom') } : {}),
        ...(num(p, 'left') != null ? { left: num(p, 'left') } : {}),
      });
      return { margin: now().doc.document.page.margin };
    }
    case 'page.setStyle': {
      for (const k of ['defaultFont', 'defaultFontSize', 'lineHeight', 'background', 'showHeader', 'showFooter'] as const) {
        if (p[k] !== undefined) now().setPageProp(k, p[k] as never);
      }
      const page = now().doc.document.page;
      return { defaultFont: page.defaultFont, defaultFontSize: page.defaultFontSize, lineHeight: page.lineHeight, background: page.background };
    }
    case 'page.addBreak': {
      const index = num(p, 'index');
      const id = now().addComponent('pageBreak', undefined, index);
      if (!id) fail('IO_ERROR', '插入分页符失败');
      return { id, index: index ?? null, type: 'pageBreak' };
    }
    case 'canvas.get':
      return now().doc.web.canvas;
    case 'canvas.setDevice': {
      now().setDevice(String(p.device ?? 'Desktop') as never);
      if (num(p, 'width') && num(p, 'height')) now().setCanvasSize(num(p, 'width')!, num(p, 'height')!);
      const c = now().doc.web.canvas;
      return { device: c.device, width: c.width, height: c.height };
    }
    case 'canvas.setSize': {
      now().setCanvasSize(num(p, 'width') ?? 1440, num(p, 'height') ?? 900);
      const c = now().doc.web.canvas;
      return { width: c.width, height: c.height, device: c.device };
    }
    case 'canvas.setBackground': {
      now().setCanvasProp('background', String(p.background ?? '#ffffff'));
      return { background: now().doc.web.canvas.background };
    }
    case 'canvas.setGrid': {
      now().setCanvasProp('showGrid', p.show === true);
      if (num(p, 'size') != null) now().setCanvasProp('gridSize', num(p, 'size')!);
      if (typeof p.snap === 'boolean') now().setCanvasProp('snapToGrid', p.snap);
      const c = now().doc.web.canvas;
      return { showGrid: c.showGrid, gridSize: c.gridSize, snapToGrid: c.snapToGrid };
    }
    case 'canvas.setSafeArea': {
      now().setCanvasProp('safeArea', p.enabled === true);
      return { safeArea: now().doc.web.canvas.safeArea };
    }

    /* ── 节点 ── */
    case 'node.add': {
      const type = String(p.type);
      requireDef(type);
      const id = now().addComponent(type, (p.parentId as string | null) ?? null, num(p, 'index'));
      if (!id) fail('IO_ERROR', `添加 ${type} 失败`);
      if (p.props && typeof p.props === 'object') now().updateProps(id, p.props as Params);
      const d = now().doc;
      const parentId = (p.parentId as string | null) ?? null;
      const list = parentId ? (findNode(getForest(d), parentId)?.children ?? []) : getForest(d);
      return { id, type, parentId, index: list.findIndex((n) => n.id === id) };
    }
    case 'node.get': {
      const node = requireNode(String(p.id));
      if (p.includeChildren === true) return node;
      const { children, ...rest } = node;
      return { ...rest, childCount: children?.length ?? 0 };
    }
    case 'node.update': {
      const id = String(p.id);
      requireNode(id);
      now().updateProps(id, (p.props as Params) ?? {});
      const node = requireNode(id);
      return { id, type: node.type, props: node.props };
    }
    case 'node.remove': {
      if (p.confirm !== true) fail('CONFIRM_REQUIRED', 'node.remove 需要 confirm: true');
      const id = String(p.id);
      requireNode(id);
      now().removeComponent(id);
      return { removed: [id] };
    }
    case 'node.batchRemove': {
      if (p.confirm !== true) fail('CONFIRM_REQUIRED', 'node.batchRemove 需要 confirm: true');
      const ids = ((p.ids as string[]) ?? []).filter((id) => !!findNode(getForest(now().doc), id));
      if (!ids.length) fail('NODE_NOT_FOUND', `没有可删除的节点：${((p.ids as string[]) ?? []).join(', ')}`);
      ids.forEach((id) => now().removeComponent(id));
      return { removed: ids, count: ids.length };
    }
    case 'node.move': {
      const id = String(p.id);
      const parentId = (p.newParentId as string | null) ?? null;
      requireNode(id);
      if (parentId) requireNode(parentId);
      now().moveComponent(id, parentId, num(p, 'index') ?? 0);
      const node = findNode(getForest(now().doc), id);
      const list = parentId ? (findNode(getForest(now().doc), parentId)?.children ?? []) : getForest(now().doc);
      return { parentId, index: node ? list.findIndex((n) => n.id === id) : -1 };
    }
    case 'node.duplicate': {
      const id = String(p.id);
      const src = requireNode(id);
      const siblings = getForest(now().doc);
      const parentId = findParentIdOf(siblings, id);
      now().duplicateComponent(id);
      const after = getForest(now().doc);
      const list = parentId ? (findNode(after, parentId)?.children ?? []) : after;
      const at = list.findIndex((n) => n.id === id);
      const copy = list[at + 1];
      if (!copy) fail('IO_ERROR', '复制失败');
      void src;
      return { id: copy.id, type: copy.type, from: id };
    }
    case 'node.reorder': {
      const id = String(p.id);
      requireNode(id);
      const action = String(p.action) as 'front' | 'back' | 'forward' | 'backward';
      const S = now();
      if (action === 'front') S.bringToFront(id);
      else if (action === 'back') S.sendToBack(id);
      else if (action === 'forward') S.bringForward(id);
      else S.sendBackward(id);
      const forest = getForest(now().doc);
      const parentId = findParentIdOf(forest, id);
      const list = parentId ? (findNode(forest, parentId)?.children ?? []) : forest;
      return { index: list.findIndex((n) => n.id === id), total: list.length, action };
    }
    case 'node.list': {
      const all = nodeRows();
      const filterType = p.filterType ? String(p.filterType) : undefined;
      const textContains = p.textContains ? String(p.textContains) : undefined;
      let rows = all.filter((r) => !filterType || r.type === filterType);
      if (textContains) {
        const forest = getForest(now().doc);
        rows = rows.filter((r) => JSON.stringify(findNode(forest, r.id)?.props ?? {}).includes(textContains));
      }
      const limit = num(p, 'limit') ?? 200;
      if (p.flat === false) return { tree: treeRows() };
      return { nodes: rows.slice(0, limit), total: rows.length };
    }
    case 'node.tree': {
      const depth = num(p, 'depth') ?? 99;
      const walk = (list: ComponentNode[], d: number): unknown[] =>
        list.map((n) => ({ id: n.id, type: n.type, ...(d < depth && n.children?.length ? { children: walk(n.children, d + 1) } : {}) }));
      return { tree: walk(getForest(now().doc), 0) };
    }
    case 'node.find': {
      const type = p.type ? String(p.type) : undefined;
      const textContains = p.textContains ? String(p.textContains) : undefined;
      const forest = getForest(now().doc);
      const rows = nodeRows().filter((r) => {
        if (type && r.type !== type) return false;
        if (textContains && !JSON.stringify(findNode(forest, r.id)?.props ?? {}).includes(textContains)) return false;
        return true;
      });
      return { matches: rows.slice(0, num(p, 'limit') ?? 50), total: rows.length };
    }
    case 'node.setText': {
      const id = String(p.id);
      const node = requireNode(id);
      const candidates = ['text', 'html', 'items', 'data', 'caption', 'title', 'label', 'content'];
      const key = (p.key as string) ?? candidates.find((k) => k in (node.props ?? {})) ?? 'text';
      now().updateProps(id, { [key]: String(p.text ?? '') });
      return { id, key, text: p.text };
    }
    case 'node.setFrame': {
      const id = String(p.id);
      requireNode(id);
      const frame: Record<string, number> = {};
      for (const k of ['x', 'y', 'w', 'h', 'rotation'] as const) if (num(p, k) != null) frame[k] = num(p, k)!;
      now().updateFrame(id, frame);
      return { id, frame: requireNode(id).frame };
    }
    case 'node.setVisible': {
      const id = String(p.id);
      requireNode(id);
      now().setNodeHidden(id, p.visible === false);
      const node = requireNode(id);
      return { id, visible: !hiddenOf(node) };
    }
    case 'node.setLocked': {
      const id = String(p.id);
      requireNode(id);
      const S = now();
      const lockedNow = (S.ui.lockedIds ?? []).includes(id);
      if ((p.locked === true) !== lockedNow) S.toggleLocked(id);
      return { id, locked: (now().ui.lockedIds ?? []).includes(id) };
    }
    case 'node.batchUpdate': {
      const props = (p.props as Params) ?? {};
      const ids = ((p.ids as string[]) ?? []).filter((id) => !!findNode(getForest(now().doc), id));
      if (!ids.length) fail('NODE_NOT_FOUND', `没有匹配的节点：${((p.ids as string[]) ?? []).join(', ')}`);
      ids.forEach((id) => now().updateProps(id, props));
      return { changed: ids, count: ids.length };
    }

    /* ── 属性 ── */
    case 'property.get': {
      const node = requireNode(String(p.id));
      return { id: p.id, key: p.key, value: (node.props ?? {})[String(p.key)] ?? null };
    }
    case 'property.set': {
      const id = String(p.id);
      requireNode(id);
      now().updateProps(id, { [String(p.key)]: p.value });
      return { id, key: p.key, value: requireNode(id).props[String(p.key)] };
    }
    case 'property.batchSet': {
      const id = String(p.id);
      requireNode(id);
      now().updateProps(id, (p.patch as Params) ?? {});
      return { id, props: requireNode(id).props };
    }
    case 'property.reset': {
      const id = String(p.id);
      const node = requireNode(id);
      const def = getComponent(node.type);
      const key = String(p.key);
      const defaults = (def?.defaultProps ?? {}) as Params;
      if (key in defaults) {
        now().updateProps(id, { [key]: defaults[key] });
        return { id, key, value: requireNode(id).props[key], source: 'registry-default' };
      }
      const next = { ...(node.props ?? {}) };
      delete next[key];
      now().updateProps(id, next);
      return { id, key, value: null, source: 'deleted', note: '该组件注册表里没有这个属性的默认值，已改为删除该属性' };
    }
    case 'property.validate': {
      const def = getComponent(String(p.type));
      const item = def?.propSchema?.find((i) => i.key === String(p.key));
      if (!item) return { valid: null, note: `编辑器注册表里没有 ${String(p.type)}.${String(p.key)} 的 schema → 不做校验，也不假装通过` };
      const problems: string[] = [];
      const value = p.value;
      if (item.control === 'number' || item.control === 'unit' || item.control === 'slider') {
        if (typeof value !== 'number' || Number.isNaN(value)) problems.push(`应为数字，收到 ${typeof value}`);
        else {
          if (item.min != null && value < item.min) problems.push(`小于最小值 ${item.min}`);
          if (item.max != null && value > item.max) problems.push(`大于最大值 ${item.max}`);
        }
      } else if (item.control === 'switch' && typeof value !== 'boolean') {
        problems.push(`应为布尔，收到 ${typeof value}`);
      } else if (item.options?.length && !item.options.some((o) => String(o.value) === String(value))) {
        problems.push(`不在可选值里：${item.options.map((o) => String(o.value)).join(' / ')}`);
      }
      return { valid: problems.length === 0, problems, schema: { type: item.control, min: item.min, max: item.max, unit: item.unit } };
    }
    case 'property.hint': {
      const def = getComponent(String(p.type));
      const item = def?.propSchema?.find((i) => i.key === String(p.key));
      if (!item) return { found: false, note: `编辑器注册表里没有 ${String(p.type)}.${String(p.key)}（组件不存在或该属性已移除）` };
      return {
        found: true,
        label: item.label,
        control: item.control,
        group: item.group,
        defaultValue: item.defaultValue,
        options: item.options,
        min: item.min,
        max: item.max,
        unit: item.unit,
        placeholder: item.placeholder,
      };
    }

    /* ── 表格 ── */
    case 'table.getData': {
      const { rows, styles, before } = tableProps(String(p.id));
      const headerRow = before.props.headerRow !== false;
      const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
      return {
        rows: p.asText === true ? undefined : rows,
        text: p.asText === true ? serializeTableData(rows) : undefined,
        headerRow,
        rowCount: rows.length,
        colCount: cols,
        dataRowCount: Math.max(0, rows.length - (headerRow ? 1 : 0)),
        styledCells: Object.keys(styles).length,
        colWidths: parseColWidths(before.props.colWidths),
        variant: before.props.variant ?? 'normal',
      };
    }
    case 'table.setData': {
      const id = String(p.id);
      const { styles } = tableProps(id);
      const rows = parseTableData(p.data);
      const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
      const kept: Record<string, CellStyle> = {};
      for (const [k, st] of Object.entries(styles)) {
        const r = parseA1(k);
        if (!r) continue;
        if (r.r1 < rows.length && r.c1 < cols) kept[k] = st;
      }
      const next = p.keepStyles === false ? {} : kept;
      now().updateProps(id, { data: serializeTableData(padRect(rows, cols)), cellStyles: next });
      return { rowCount: rows.length, colCount: cols, styledCells: Object.keys(next).length };
    }
    case 'table.setCell': {
      const id = String(p.id);
      const { rows, styles } = tableProps(id);
      const row = num(p, 'row') ?? 0;
      const col = num(p, 'col') ?? 0;
      const cols = Math.max(col + 1, rows.reduce((n, r) => Math.max(n, r.length), 0));
      const padded = padRect(rows, cols);
      while (padded.length <= row) padded.push(Array.from({ length: cols }, () => ''));
      padded[row][col] = String(p.value ?? '');
      now().updateProps(id, { data: serializeTableData(padded), cellStyles: styles });
      return { row, col, cell: a1Key(row, col, row, col), value: p.value };
    }
    case 'table.insertRow':
    case 'table.deleteRow':
    case 'table.insertCol':
    case 'table.deleteCol': {
      const id = String(p.id);
      const { rows, styles, before } = tableProps(id);
      const at = num(p, 'at') ?? 0;
      const count = num(p, 'count') ?? 1;
      const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
      if (method === 'table.insertRow') {
        const next = padRect(rows, cols);
        for (let i = 0; i < count; i += 1) next.splice(at, 0, Array.from({ length: cols }, () => ''));
        now().updateProps(id, { data: serializeTableData(next), cellStyles: shiftCellKeys(styles, 'row', at, count) });
        return { rowCount: next.length, at, count };
      }
      if (method === 'table.deleteRow') {
        if (rows.length - count < 1) fail('INVALID_PROP_VALUE', `至少要留一行（当前 ${rows.length} 行，要删 ${count} 行）`);
        const next = rows.filter((_, i) => i < at || i >= at + count);
        now().updateProps(id, { data: serializeTableData(next), cellStyles: shiftCellKeys(styles, 'row', at, -count) });
        return { rowCount: next.length, at, count };
      }
      if (method === 'table.insertCol') {
        const width = cols + count;
        const next = rows.map((r) => {
          const copy: string[] = [];
          for (let c = 0; c < width; c += 1) copy.push(c < at ? (r[c] ?? '') : c < at + count ? '' : (r[c - count] ?? ''));
          return copy;
        });
        const pct = parseColWidths(before.props.colWidths).map((w) => Number.parseFloat(w) || 100 / cols);
        const base = pct.length === cols ? pct : Array.from({ length: cols }, () => 100 / cols);
        for (let i = 0; i < count; i += 1) base.splice(at, 0, (base[at] ?? 100 / cols) / 2);
        const sum = base.reduce((n, x) => n + x, 0);
        now().updateProps(id, {
          data: serializeTableData(padRect(next, width)),
          cellStyles: shiftCellKeys(styles, 'col', at, count),
          colWidths: base.map((x) => ((x / sum) * 100).toFixed(1)).join(','),
        });
        return { colCount: width, at, count };
      }
      if (cols - count < 1) fail('INVALID_PROP_VALUE', `至少要留一列（当前 ${cols} 列，要删 ${count} 列）`);
      const keep = (c: number): boolean => c < at || c >= at + count;
      const next = rows.map((r) => Array.from({ length: cols }, (_, c) => c).filter(keep).map((c) => r[c] ?? ''));
      const pct = parseColWidths(before.props.colWidths).map((w) => Number.parseFloat(w) || 0);
      const base = pct.length === cols ? pct.filter((_, c) => keep(c)) : Array.from({ length: cols - count }, () => 100 / (cols - count));
      const sum = base.reduce((n, x) => n + x, 0) || 1;
      now().updateProps(id, {
        data: serializeTableData(next),
        cellStyles: shiftCellKeys(styles, 'col', at, -count),
        colWidths: base.map((x) => ((x / sum) * 100).toFixed(1)).join(','),
      });
      return { colCount: cols - count, at, count };
    }
    case 'table.mergeCells': {
      const id = String(p.id);
      const { rows, styles } = tableProps(id);
      const r = rangeOf(String(p.range));
      if (r.r0 === r.r1 && r.c0 === r.c1) fail('TABLE_RANGE_INVALID', '合并至少要选 2 个格子');
      const next: Record<string, CellStyle> = { ...styles };
      for (const k of keysInRange(r)) delete next[k];
      next[a1Key(r.r0, r.c0, r.r1, r.c1)] = { merged: true };
      now().updateProps(id, { data: serializeTableData(rows), cellStyles: next });
      return { key: a1Key(r.r0, r.c0, r.r1, r.c1), rowSpan: r.r1 - r.r0 + 1, colSpan: r.c1 - r.c0 + 1 };
    }
    case 'table.splitCells': {
      const id = String(p.id);
      const { rows, styles } = tableProps(id);
      const r = rangeOf(String(p.range));
      const next: Record<string, CellStyle> = { ...styles };
      const removed: string[] = [];
      for (const k of Object.keys(next)) {
        const q = parseA1(k);
        if (!q) continue;
        if (q.r0 >= r.r0 && q.r1 <= r.r1 && q.c0 >= r.c0 && q.c1 <= r.c1) {
          delete next[k];
          removed.push(k);
        }
      }
      now().updateProps(id, { data: serializeTableData(rows), cellStyles: next });
      return { removed, remaining: Object.keys(next).length };
    }
    case 'table.setCellStyle': {
      const id = String(p.id);
      const { rows, styles } = tableProps(id);
      const r = rangeOf(String(p.range));
      const style = (p.style as CellStyle) ?? {};
      const next: Record<string, CellStyle> = { ...styles };
      const targets = new Set<string>();
      for (const k of keysInRange(r)) {
        const q = parseA1(k);
        if (!q) continue;
        targets.add(cellStyleKeyAt(next, q.r0, q.c0) ?? k);
      }
      for (const key of targets) next[key] = { ...(next[key] ?? {}), ...style };
      now().updateProps(id, { data: serializeTableData(rows), cellStyles: next });
      return { keys: [...targets], style };
    }
    case 'table.clearCellStyle': {
      const id = String(p.id);
      const { rows, styles } = tableProps(id);
      const r = rangeOf(String(p.range));
      const isMergedRangeKey = (k: string): boolean => {
        const q = parseA1(k);
        return !!q && (q.r1 > q.r0 || q.c1 > q.c0);
      };
      const next: Record<string, CellStyle> = {};
      const cleared: string[] = [];
      for (const [k, st] of Object.entries(styles)) {
        const q = parseA1(k);
        const hit = q && q.r0 >= r.r0 && q.r1 <= r.r1 && q.c0 >= r.c0 && q.c1 <= r.c1;
        if (hit) {
          cleared.push(k);
          if (isMergedRangeKey(k)) continue;
          continue;
        }
        next[k] = st;
      }
      now().updateProps(id, { data: serializeTableData(rows), cellStyles: next });
      return { cleared, remaining: Object.keys(next).length };
    }
    case 'table.setVariant': {
      const id = String(p.id);
      tableProps(id);
      now().updateProps(id, { variant: p.variant });
      return { variant: p.variant };
    }
    case 'table.setColWidths': {
      const id = String(p.id);
      tableProps(id);
      now().updateProps(id, { colWidths: String(p.widths ?? '') });
      return { colWidths: parseColWidths(p.widths) };
    }
    case 'table.autoFit': {
      const id = String(p.id);
      const { rows } = tableProps(id);
      const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
      // ★Live 的优势：能量到**真实渲染宽度**（无头只能按字符数估）
      const cells = document.querySelectorAll<HTMLElement>(`[data-node-id="${id}"] td, [data-node-id="${id}"] th`);
      let widths: number[] = [];
      if (cells.length) {
        const acc: number[] = [];
        cells.forEach((el) => {
          const col = Number(el.getAttribute('data-cell-col') ?? '-1');
          if (col < 0) return;
          acc[col] = Math.max(acc[col] ?? 0, el.getBoundingClientRect().width);
        });
        widths = acc.slice(0, cols).map((w) => w || 0);
      }
      if (!widths.length || widths.every((w) => w <= 0)) {
        widths = Array.from({ length: cols }, (_, c) => Math.max(4, rows.reduce((n, r) => Math.max(n, String(r[c] ?? '').replace(/\n/g, '').length), 0)));
      }
      const sum = widths.reduce((n, x) => n + x, 0) || 1;
      const pct = widths.map((w) => ((w / sum) * 100).toFixed(1)).join(',');
      now().updateProps(id, { colWidths: pct });
      return { colWidths: parseColWidths(pct), note: 'Live：按画布上**真实渲染宽度**自适应列宽' };
    }
    case 'table.getCellSelection': {
      const sel = now().ui.tableCells;
      return { cells: sel && sel.nodeId === String(p.id) ? sel.cells : [] };
    }
    case 'table.setCellSelection': {
      const id = String(p.id);
      const r = rangeOf(String(p.range));
      const cells = keysInRange(r).map((k) => {
        const q = parseA1(k);
        return q ? `${q.r0},${q.c0}` : k;
      });
      now().selectTableCells(id, cells);
      return { key: a1Key(r.r0, r.c0, r.r1, r.c1), cells: cells.length };
    }

    /* ── 历史 / 选择 ── */
    case 'history.undo': {
      const steps = num(p, 'steps') ?? 1;
      for (let i = 0; i < steps; i += 1) now().undo();
      return { undone: steps, ...historyInfoLive() };
    }
    case 'history.redo': {
      const steps = num(p, 'steps') ?? 1;
      for (let i = 0; i < steps; i += 1) now().redo();
      return { redone: steps, ...historyInfoLive() };
    }
    case 'history.stack':
      return { docId: now().doc.id, ...historyInfoLive(), note: '编辑器自己的撤销/重做栈（上限 50 步）' };
    case 'history.snapshot':
    case 'history.restore':
    case 'history.clear':
      throw new Error(`LIVE_FALLBACK: ${method} 作用于无头快照栈（编辑器的历史栈由它自己管，桥接不替它增删）`);
    case 'selection.get':
      return { ids: now().doc.selectedIds, docId: now().doc.id };
    case 'selection.set': {
      const ids = (p.ids as string[]) ?? [];
      now().selectComponent(ids);
      return { ids };
    }
    case 'selection.clear':
      now().selectComponent([]);
      return { ids: [] };
    case 'selection.focus': {
      const el = document.querySelector(`[data-node-id="${String(p.id)}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return { focused: !!el, note: el ? undefined : '画布上没找到该节点（可能不在当前模式或还没渲染）' };
    }

    /* ── 导出（浏览器渲染才有的能力） ── */
    case 'export.json': {
      const d = now().doc;
      const json = now().exportJSON();
      return { docId: d.id, bytes: json.length, json };
    }
    case 'export.html': {
      const d = now().doc;
      const html = buildExportHtml(d, getForest(d));
      return { docId: d.id, bytes: html.length, html };
    }
    case 'export.react': {
      const d = now().doc;
      return { docId: d.id, code: buildReactComponent(d, getForest(d)) };
    }
    case 'export.spec': {
      const md = buildComponentSpecSheet();
      return { docId: now().doc.id, markdown: md, bytes: md.length, source: 'editor' };
    }
    case 'export.pdf':
      fail('IO_ERROR', '导出 PDF 要由浏览器打印完成：请在编辑器里用「文件 → 打印 / 另存为 PDF」（MCP 侧拿不到 PDF 字节）');

    /* ── 组件注册表（编辑器是唯一真源） ── */
    case 'component.list':
    case 'component.get':
    case 'component.schema':
    case 'component.defaults':
    case 'component.categories':
    case 'component.search':
    case 'component.catalog': {
      const live = getLiveTypes();
      const meta = (d: ComponentDefinition): Record<string, unknown> => ({
        type: d.type,
        label: d.label,
        category: d.category,
        supportedModes: d.supportedModes,
        ...(d.description ? { description: d.description } : {}),
        source: live.includes(d.type) ? 'external' : 'builtin',
      });
      const all = getAllComponents();

      if (method === 'component.list') {
        const mode = p.mode as string | undefined;
        const category = p.category as string | undefined;
        const keyword = String(p.keyword ?? '').toLowerCase();
        const hits = all
          .filter((d) => (!mode || d.supportedModes.includes(mode as never)) && (!category || d.category === category))
          .filter((d) => !keyword || [d.type, d.label, d.category, d.description ?? ''].some((v) => String(v).toLowerCase().includes(keyword)));
        return {
          total: hits.length,
          components: hits.map(meta),
          sources: ['builtin:registry', ...(live.length ? [`plugins:${live.length}`] : [])],
          note: `来自编辑器运行时注册表（内建 ${all.length - live.length} + 外部 ${live.length}）`,
        };
      }
      if (method === 'component.categories') {
        const mode = (p.mode as string) ?? now().doc.mode;
        const cats = getCategoriesByMode(mode as never);
        return { mode, total: cats.reduce((n, c) => n + c.items.length, 0), categories: cats.map((c) => ({ name: c.name, count: c.items.length })) };
      }
      if (method === 'component.search') {
        const q = String(p.query ?? '').toLowerCase();
        const hits = all
          .filter((d) => [d.type, d.label, d.category, d.description ?? ''].some((v) => String(v).toLowerCase().includes(q)))
          .slice(0, num(p, 'limit') ?? 20);
        return { query: String(p.query ?? ''), total: hits.length, hits: hits.map(meta) };
      }
      if (method === 'component.catalog') {
        return {
          components: all.map(meta),
          defaults: Object.fromEntries(all.map((d) => [d.type, d.defaultProps ?? {}])),
          schemas: Object.fromEntries(all.map((d) => [d.type, d.propSchema ?? []])),
          counts: { total: all.length, builtin: all.length - live.length, external: live.length },
        };
      }
      const def = requireDef(String(p.type));
      if (method === 'component.get') return { ...meta(def), defaults: def.defaultProps ?? {}, schemaCount: (def.propSchema ?? []).length };
      if (method === 'component.schema') return { type: def.type, count: (def.propSchema ?? []).length, schema: def.propSchema ?? [] };
      return { type: def.type, defaults: def.defaultProps ?? {} };
    }

    /* ── 插件热重载 ── */
    case 'plugin.reload': {
      const { loadRuntimeComponents } = await import('../registry/live');
      const r = await loadRuntimeComponents(true);
      now().bumpRegistry();
      return { reloaded: r.ok, failed: r.failed, total: r.total, types: getLiveTypes() };
    }
    case 'bridge.ping':
      return { pong: true, docId: now().doc.id };

    default:
      fail('METHOD_NOT_FOUND', `编辑器桥接未实现 ${method}`);
  }
}

/* ══════════════ 小工具 ══════════════ */

function historyInfoLive(): { size: number; cursor: number; canUndo: boolean; canRedo: boolean } {
  const h = now().history;
  return { size: h.past.length + h.future.length + 1, cursor: h.past.length, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

function countWords(doc: EditorDocument): number {
  const count = (n: ComponentNode): number => {
    let n2 = 0;
    for (const [k, v] of Object.entries(n.props ?? {})) {
      if (typeof v !== 'string') continue;
      if (!/text|html|items|data|caption|title|label|desc|col\d/.test(k)) continue;
      n2 += v.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
    }
    return n2 + (n.children ?? []).reduce((s, c) => s + count(c), 0);
  };
  return [...doc.document.components, ...(doc.web.root.children ?? [])].reduce((s, n) => s + count(n), 0);
}

/** 扁平节点行（与无头 flatten 同形：id/type/parentId/children/depth） */
function nodeRows(): { id: string; type: string; parentId: string | null; children: number; depth: number }[] {
  return flatten(getForest(now().doc)).map((r) => ({
    id: r.node.id,
    type: r.node.type,
    parentId: r.parentId,
    children: r.node.children?.length ?? 0,
    depth: r.depth,
  }));
}

function treeRows(): unknown[] {
  const walk = (list: ComponentNode[]): unknown[] => list.map((n) => ({ id: n.id, type: n.type, ...(n.children?.length ? { children: walk(n.children) } : {}) }));
  return walk(getForest(now().doc));
}

function findParentIdOf(list: ComponentNode[], id: string): string | null {
  for (const n of list) {
    if (n.id === id) return null;
    if (n.children?.length) {
      const hit = n.children.some((c) => c.id === id) ? n.id : findParentIdOf(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}
