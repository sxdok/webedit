/**
 * 职责：编辑器中央状态（zustand + persist）。包含
 *   · 双模式文档数据（document / web 两套，切模式互不覆盖）
 *   · 全部文档修改 action（自动路由到当前模式 + 自动入历史栈）
 *   · 视图状态（缩放、网格、标尺、组件树、预览）
 *   · 撤销/重做、导入导出
 * 约定：所有会改文档的 action 都走 commit()，连续输入用 MergeGate 合并成一步。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEVICE_PRESETS,
  PAGE_SIZES,
  createDefaultCanvasConfig,
  createDefaultPageConfig,
  type ComponentNode,
  type DeviceKey,
  type DocumentPageConfig,
  type EditorDocument,
  type EditorMode,
  type Frame,
  type PageSizeKey,
} from '../registry/types';
import { getComponent } from '../registry';
import {
  applyLayer,
  cloneSubtreeWithNewIds,
  createNode,
  findNode,
  getForest,
  moveNode,
  normalizeDocTables,
  removeNode,
  insertNode,
  setForest,
  updateNode,
  type LayerOp,
} from './treeUtils';
import { MergeGate, emptyHistory, pushHistory, redo, undo, type HistoryState } from './history';
import { createId } from '../utils/id';
import { log } from '../utils/logger';
import { buildExportHtml, buildWordDoc } from '../utils/export/docExport';
import { buildReactComponent } from '../utils/export/reactExport';

/* ══════════════ 视图状态 ══════════════ */

export interface UIState {
  showGrid: boolean;
  showRuler: boolean;
  showGuides: boolean;
  showTree: boolean;
  snap: boolean;
  preview: boolean;
  /** 面板折叠（宽度见 leftWidth / rightWidth） */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** 左（组件）面板宽度 px —— 可拖拽调整，随 ui 持久化 */
  leftWidth: number;
  /** 右（属性）面板宽度 px —— 可拖拽调整，随 ui 持久化 */
  rightWidth: number;
  /** 诊断面板（帮助 → 诊断信息 / ?diag=1） */
  showDiagnostics: boolean;
  /** 组件注册表版本：运行时（热加载）注册组件后 +1，面板据此重渲染 */
  registryVersion: number;
  /** 编辑器主题：light=浅色，monokai=深色（参考 Monokai 配色） */
  theme: 'light' | 'monokai';
  /** 文档模式当前页数（画布分页后回写，供页面属性面板显示） */
  docPageCount: number;
  /**
   * 表格**单元格选择**（编辑器态：不写进文档、不入导出、打印时也不显示）：
   * nodeId = 哪张表，cells = 选中的 "行,列" 键集合（行列从 0 起，含表头时第 0 行就是表头行）。
   * 用于「单元格背景色」按单元格填充 —— 颜色写进表格的 cellFills 属性（那是文档数据）。
   */
  tableCells: { nodeId: string; cells: string[] } | null;
  /** 锁定的组件 id（编辑器态：不进文档、不导出；锁定时画布不可拖拽） */
  lockedIds: string[];
  /**
   * 属性面板的**折叠状态**（编辑器态，随 `ui` 一起持久化 → 刷新后保持）。
   * 键带面板前缀，避免两类面板的分组同名互串：`node:内容`（组件面板）/ `page:纸张`（页面面板）；
   * 值为 `true` 表示**已折叠**。
   */
  propClosed: { groups: Record<string, boolean>; drawers: Record<string, boolean> };
}

const initialUI: UIState = {
  showGrid: false,
  showRuler: true,
  showGuides: true,
  showTree: false,
  snap: true,
  preview: false,
  leftCollapsed: false,
  rightCollapsed: false,
  leftWidth: 240,
  rightWidth: 300,
  showDiagnostics: false,
  registryVersion: 0,
  theme: 'light',
  docPageCount: 1,
  tableCells: null,
  lockedIds: [],
  propClosed: { groups: {}, drawers: {} },
};

/* ══════════════ 初始文档 ══════════════ */

export function createInitialDocument(): EditorDocument {
  const page = createDefaultPageConfig();
  const canvas = createDefaultCanvasConfig();
  return {
    id: createId('doc'),
    title: '未命名文档',
    mode: 'document',
    document: { page, components: [] },
    web: {
      canvas,
      root: { id: createId('root'), type: 'root', props: {}, children: [] },
    },
    selectedIds: [],
  };
}

/* ══════════════ Store 接口 ══════════════ */

export interface EditorStore {
  doc: EditorDocument;
  zoom: number;
  history: HistoryState;
  ui: UIState;
  /** 复制/粘贴缓冲（不入持久化） */
  clipboard: ComponentNode | null;

  /* 模式 */
  setMode(mode: EditorMode): void;

  /* 表格单元格选择（编辑器态，见 UIState.tableCells） */
  selectTableCells(nodeId: string, cells: string[]): void;
  clearTableCells(): void;
  /** 合并写属性面板折叠状态（编辑器态；随 ui 持久化，刷新后保持） */
  setPropClosed(patch: { groups?: Record<string, boolean>; drawers?: Record<string, boolean> }): void;

  /* 组件操作（自动路由到当前模式的数据） */
  addComponent(type: string, parentId?: string | null, index?: number): string | null;
  updateProps(id: string, patch: Record<string, unknown>): void;
  setNodeHidden(id: string, hidden: boolean): void;
  toggleLocked(id: string): void;
  updateFrame(id: string, frame: Partial<Frame>): void;
  removeComponent(id: string): void;
  moveComponent(id: string, newParentId: string | null, index: number): void;
  reparentComponent(id: string, newParentId: string | null): void;
  duplicateComponent(id: string): void;
  selectComponent(ids: string[]): void;
  toggleSelect(id: string): void;
  bringForward(id: string): void;
  sendBackward(id: string): void;
  bringToFront(id: string): void;
  sendToBack(id: string): void;
  copySelection(): void;
  pasteClipboard(): void;
  clearAll(): void;

  /* 页面 / 画布 */
  setPageSize(size: PageSizeKey): void;
  setOrientation(o: DocumentPageConfig['orientation']): void;
  setPageSizeCustom(width: number, height: number): void;
  setMargin(margin: Partial<DocumentPageConfig['margin']>): void;
  setPageProp<K extends keyof DocumentPageConfig>(key: K, value: DocumentPageConfig[K]): void;
  setDevice(device: DeviceKey): void;
  setCanvasSize(w: number, h: number): void;
  setCanvasProp<K extends keyof EditorDocument['web']['canvas']>(
    key: K,
    value: EditorDocument['web']['canvas'][K],
  ): void;

  /* 视图 */
  setZoom(z: number): void;
  toggleUI(key: keyof UIState): void;
  /** 拖拽调整面板宽度（side=left 组件面板 / right 属性面板） */
  setPanelWidth(side: 'left' | 'right', width: number): void;
  setTitle(title: string): void;
  /** 组件注册表变化（热加载后调用） */
  bumpRegistry(): void;
  /** 切换编辑器主题（浅色 / 深色 Monokai） */
  setTheme(theme: 'light' | 'monokai'): void;
  /** 画布分页后回写当前页数 */
  setDocPageCount(n: number): void;

  /* 历史 */
  undo(): void;
  redo(): void;

  /* 导入导出 */
  importJSON(json: string): boolean;
  exportJSON(): string;
  exportHTML(): string;
  /** 导出 Word（.doc，Word 可直接打开；版式按 @page 段落设置） */
  exportWord(): string;
  exportReact(): string;
}

/* ══════════════ 内部工具 ══════════════ */

const gate = new MergeGate();

const clamp01 = (n: number) => Math.max(0.1, Math.min(4, n));

function commit(
  set: (partial: Partial<EditorStore>) => void,
  get: () => EditorStore,
  mutate: (doc: EditorDocument) => EditorDocument,
  opts?: { mergeKey?: string; label?: string },
): void {
  const state = get();
  const next = mutate(state.doc);
  if (next === state.doc) {
    log.debug('store', `${opts?.label ?? 'mutate'} 未产生变更`);
    return;
  }
  const merge = gate.shouldMerge(opts?.mergeKey);
  const history = merge ? state.history : pushHistory(state.history, state.doc);
  // 审计轨迹：任何文档变更都留痕（console 按级别输出；内存缓冲与落盘始终记录）
  log.info('store', opts?.label ?? 'doc 变更', {
    merged: merge,
    mode: next.mode,
    文档组件: next.document.components.length,
    Web顶层: next.web.root.children?.length ?? 0,
    选中: next.selectedIds.length,
    历史: `${history.past.length}/${history.future.length}`,
  });
  set({ doc: next, history });
}

function mapNode(
  doc: EditorDocument,
  id: string,
  updater: (node: ComponentNode) => ComponentNode,
): EditorDocument {
  const forest = getForest(doc);
  const next = updateNode(forest, id, updater);
  return next === forest ? doc : setForest(doc, next);
}

/* ══════════════ Store ══════════════ */

export const useEditorStore = create<EditorStore>()(
  persist(
    (set, get) => ({
      doc: createInitialDocument(),
      zoom: 1,
      history: emptyHistory(),
      ui: initialUI,
      clipboard: null,

      /* ── 模式：两套内容各自保留，只切换渲染层与面板过滤；切换本身入栈可撤销 ── */
      setMode: (mode) => {
        log.action('setMode', { from: get().doc.mode, to: mode });
        if (get().doc.mode === mode) return;
        commit(set, get, (doc) => ({ ...doc, mode, selectedIds: [] }));
        // 换模式后画布内容变了，单元格选择随之失效
        set((s) => ({ ui: { ...s.ui, tableCells: null } }));
        gate.reset();
      },

      /* ── 组件操作 ── */
      addComponent: (type, parentId = null, index) => {
        log.action('addComponent', { type, parentId, index, mode: get().doc.mode });
        const def = getComponent(type);
        if (!def) {
          console.warn(`[store] 未注册的组件类型：${type}`);
          return null;
        }
        const state = get();
        if (!def.supportedModes.includes(state.doc.mode)) {
          console.warn(`[store] 组件 ${type} 不支持当前模式 ${state.doc.mode}`);
          return null;
        }
        const node = createNode(def, state.doc.mode);
        const targetParent =
          state.doc.mode === 'web' ? (parentId ?? state.doc.web.root.id) : parentId;
        // Web 模式顶层元素挂在 root.children 下
        const isRoot = state.doc.mode === 'web' && targetParent === state.doc.web.root.id;
        commit(set, get, (doc) => {
          const forest = getForest(doc);
          const next = isRoot
            ? insertNode(forest, node, null, index)
            : insertNode(forest, node, targetParent, index);
          const withForest = setForest(doc, next);
          return { ...withForest, selectedIds: [node.id] };
        });
        return node.id;
      },

      updateProps: (id, patch) =>
        commit(
          set,
          get,
          (doc) =>
            mapNode(doc, id, (node) => ({ ...node, props: { ...node.props, ...patch } })),
          { mergeKey: `props:${id}`, label: 'updateProps' },
        ),

      /** 显示 / 隐藏（文档数据：隐藏的节点画布不渲染、导出仍保留） */
      setNodeHidden: (id, hidden) => {
        log.action('setNodeHidden', { id, hidden });
        commit(set, get, (doc) => mapNode(doc, id, (node) => ({ ...node, hidden })), { label: 'setNodeHidden' });
      },

      /** 锁定 / 解锁：**编辑器态**（存 ui.lockedIds，不进文档、不入导出），锁定时画布不可拖拽 */
      toggleLocked: (id) => {
        set((s) => {
          const locked = s.ui.lockedIds ?? []; // 旧持久化数据可能没有这个字段（见下方 persist.merge）
          const has = locked.includes(id);
          log.debug('store', 'toggleLocked', { id, locked: !has });
          return {
            ui: {
              ...s.ui,
              lockedIds: has ? locked.filter((x) => x !== id) : [...locked, id],
            },
          };
        });
      },

      updateFrame: (id, frame) =>
        commit(
          set,
          get,
          (doc) =>
            mapNode(doc, id, (node) => ({
              ...node,
              frame: { x: 0, y: 0, w: 100, h: 40, ...node.frame, ...frame },
            })),
          { mergeKey: `frame:${id}`, label: 'updateFrame' },
        ),

      removeComponent: (id) => {
        log.action('removeComponent', { id });
        commit(set, get, (doc) => {
          const { forest, removed } = removeNode(getForest(doc), id);
          if (!removed) return doc;
          return { ...setForest(doc, forest), selectedIds: doc.selectedIds.filter((x) => x !== id) };
        })
      },

      moveComponent: (id, newParentId, index) => {
        log.action('moveComponent', { id, newParentId, index });
        commit(set, get, (doc) => setForest(doc, moveNode(getForest(doc), id, newParentId, index)))
      },

      reparentComponent: (id, newParentId) => {
        log.action('reparentComponent', { id, newParentId });
        commit(set, get, (doc) => {
          const parent = newParentId ? findNode(getForest(doc), newParentId) : null;
          const index = parent?.children?.length ?? 0;
          return setForest(doc, moveNode(getForest(doc), id, newParentId, index));
        })
      },

      duplicateComponent: (id) => {
        log.action('duplicateComponent', { id });
        commit(set, get, (doc) => {
          const forest = getForest(doc);
          const src = findNode(forest, id);
          if (!src) return doc;
          const copy = cloneSubtreeWithNewIds(src);
          if (copy.frame) copy.frame = { ...copy.frame, x: copy.frame.x + 16, y: copy.frame.y + 16 };
          const siblings = forest.filter((n) => n.id === id).length ? forest : forest;
          const idx = siblings.findIndex((n) => n.id === id);
          const next =
            idx >= 0
              ? insertNode(forest, copy, null, idx + 1)
              : (() => {
                  const parentId = findParentIdOf(forest, id);
                  const list = parentId ? (findNode(forest, parentId)?.children ?? []) : forest;
                  const i = list.findIndex((n) => n.id === id);
                  return insertNode(forest, copy, parentId, i + 1);
                })();
          return { ...setForest(doc, next), selectedIds: [copy.id] };
        })
      },

      selectComponent: (ids) => {
        log.debug('store', 'selectComponent', { count: ids.length });
        set((s) => ({
          doc: { ...s.doc, selectedIds: ids },
          // 选中的不再是同一张表 → 清掉单元格选择（避免"给别的表填色"的错觉）
          ui: s.ui.tableCells && !ids.includes(s.ui.tableCells.nodeId) ? { ...s.ui, tableCells: null } : s.ui,
        }));
      },

      selectTableCells: (nodeId, cells) => {
        log.debug('store', 'selectTableCells', { nodeId, count: cells.length });
        set((s) => ({ ui: { ...s.ui, tableCells: cells.length ? { nodeId, cells } : null } }));
      },

      clearTableCells: () => set((s) => ({ ui: { ...s.ui, tableCells: null } })),

      setPropClosed: (patch) =>
        set((s) => {
          const cur = s.ui.propClosed ?? { groups: {}, drawers: {} };
          // ★按**增量合并**（只写变化的键）：面板一次点击只报自己那一项，
          //   同一 tick 里的多次点击（如自检遍历点开全部分组）才不会互相覆盖。
          return {
            ui: {
              ...s.ui,
              propClosed: {
                groups: { ...cur.groups, ...(patch.groups ?? {}) },
                drawers: { ...cur.drawers, ...(patch.drawers ?? {}) },
              },
            },
          };
        }),

      toggleSelect: (id) => {
        log.debug('store', 'toggleSelect', { id });
        set((s) => {
          const has = s.doc.selectedIds.includes(id);
          return {
            doc: {
              ...s.doc,
              selectedIds: has
                ? s.doc.selectedIds.filter((x) => x !== id)
                : [...s.doc.selectedIds, id],
            },
          };
        });
      },

      bringForward: (id) => {
        log.action('bringForward', { id });
commit(set, get, (doc) => layer(doc, id, 'forward'))
      },
      sendBackward: (id) => {
        log.action('sendBackward', { id });
commit(set, get, (doc) => layer(doc, id, 'backward'))
      },
      bringToFront: (id) => {
        log.action('bringToFront', { id });
commit(set, get, (doc) => layer(doc, id, 'front'))
      },
      sendToBack: (id) => {
        log.action('sendToBack', { id });
commit(set, get, (doc) => layer(doc, id, 'back'))
      },

      copySelection: () => {
        const { doc } = get();
        const id = doc.selectedIds[0];
        if (!id) return;
        const node = findNode(getForest(doc), id);
        if (node) set({ clipboard: structuredClone(node) });
      },

      pasteClipboard: () => {
        log.action('pasteClipboard');
        const clip = get().clipboard;
        if (!clip) return;
        const copy = cloneSubtreeWithNewIds(clip);
        if (copy.frame) copy.frame = { ...copy.frame, x: copy.frame.x + 24, y: copy.frame.y + 24 };
        commit(set, get, (doc) => {
          const forest = getForest(doc);
          const next = insertNode(forest, copy, null, forest.length);
          return { ...setForest(doc, next), selectedIds: [copy.id] };
        });
      },

      clearAll: () => {
        log.action('clearAll', { mode: get().doc.mode });
        commit(set, get, (doc) => {
          const cleared = setForest(doc, []);
          return { ...cleared, selectedIds: [] };
        })
      },

      /* ── 页面 / 画布 ── */
      setPageSize: (size) => {
        log.action('setPageSize', { size });
        commit(set, get, (doc) => {
          const preset = PAGE_SIZES[size];
          const landscape = doc.document.page.orientation === 'landscape';
          return {
            ...doc,
            document: {
              ...doc.document,
              page: {
                ...doc.document.page,
                size,
                width: landscape ? preset.height : preset.width,
                height: landscape ? preset.width : preset.height,
              },
            },
          };
        })
      },

      setOrientation: (orientation) => {
        log.action('setOrientation', { orientation });
        commit(set, get, (doc) => {
          const { size, width, height } = doc.document.page;
          const base = PAGE_SIZES[size];
          const w = size === 'Custom' ? width : base.width;
          const h = size === 'Custom' ? height : base.height;
          return {
            ...doc,
            document: {
              ...doc.document,
              page: {
                ...doc.document.page,
                orientation,
                width: orientation === 'landscape' ? h : w,
                height: orientation === 'landscape' ? w : h,
              },
            },
          };
        })
      },

      setPageSizeCustom: (width, height) => {
        log.action('setPageSizeCustom', { width, height });
        commit(set, get, (doc) => ({
          ...doc,
          document: { ...doc.document, page: { ...doc.document.page, size: 'Custom', width, height } },
        }))
      },

      setMargin: (margin) =>
        commit(
          set,
          get,
          (doc) => ({
            ...doc,
            document: {
              ...doc.document,
              page: { ...doc.document.page, margin: { ...doc.document.page.margin, ...margin } },
            },
          }),
          { mergeKey: 'page:margin', label: 'setMargin' },
        ),

      setPageProp: (key, value) =>
        commit(
          set,
          get,
          (doc) => ({
            ...doc,
            document: { ...doc.document, page: { ...doc.document.page, [key]: value } },
          }),
          { mergeKey: `page:${String(key)}`, label: 'setPageProp' },
        ),

      setDevice: (device) => {
        log.action('setDevice', { device });
        commit(set, get, (doc) => {
          const preset = DEVICE_PRESETS[device];
          return {
            ...doc,
            web: {
              ...doc.web,
              canvas: {
                ...doc.web.canvas,
                device,
                width: preset.width,
                height: preset.height,
              },
            },
          };
        })
      },

      setCanvasSize: (width, height) => {
        log.action('setCanvasSize', { width, height });
        commit(set, get, (doc) => ({
          ...doc,
          web: { ...doc.web, canvas: { ...doc.web.canvas, device: 'Custom', width, height } },
        }))
      },

      setCanvasProp: (key, value) =>
        commit(
          set,
          get,
          (doc) => ({
            ...doc,
            web: { ...doc.web, canvas: { ...doc.web.canvas, [key]: value } },
          }),
          { mergeKey: `canvas:${String(key)}`, label: 'setCanvasProp' },
        ),

      /* ── 视图 ── */
      setZoom: (z) => {
        log.debug('store', 'setZoom', { z });
        set({ zoom: clamp01(z) });
      },
      toggleUI: (key) => {
        log.debug('store', 'toggleUI', { key });
        set((s) => ({ ui: { ...s.ui, [key]: !s.ui[key] } }));
      },
      /** 拖拽调整左右面板宽度（夹在 180–560px；越界时不写盘，避免拖出不可用布局） */
      setPanelWidth: (side, width) => {
        const w = Math.round(Math.max(180, Math.min(560, width)));
        const cur = side === 'left' ? get().ui.leftWidth : get().ui.rightWidth;
        if (Math.round(cur ?? 0) === w) return;
        log.debug('store', 'setPanelWidth', { side, w });
        set((s) => ({ ui: { ...s.ui, [side === 'left' ? 'leftWidth' : 'rightWidth']: w } }));
      },
      setTitle: (title) => commit(set, get, (doc) => ({ ...doc, title }), { mergeKey: 'title', label: 'setTitle' }),
      setDocPageCount: (n) => {
        if (get().ui.docPageCount === n) return;
        set((s) => ({ ui: { ...s.ui, docPageCount: n } }));
      },
      setTheme: (theme) => {
        log.info('store', 'setTheme', { theme });
        set((s) => ({ ui: { ...s.ui, theme } }));
      },
      bumpRegistry: () => {
        log.info('store', 'bumpRegistry（组件注册表已更新）');
        set((s) => ({ ui: { ...s.ui, registryVersion: s.ui.registryVersion + 1 } }));
      },

      /* ── 历史 ── */
      undo: () => {
        log.action('undo', { past: get().history.past.length });
        const state = get();
        const r = undo(state.history, state.doc);
        if (!r) return;
        gate.reset();
        set({ doc: r.doc, history: r.history });
      },
      redo: () => {
        log.action('redo', { future: get().history.future.length });
        const state = get();
        const r = redo(state.history, state.doc);
        if (!r) return;
        gate.reset();
        set({ doc: r.doc, history: r.history });
      },

      /* ── 导入导出 ── */
      importJSON: (json) => {
        log.action('importJSON', { bytes: json.length });
        try {
          const parsed = JSON.parse(json) as EditorDocument;
          if (!parsed || typeof parsed !== 'object' || !parsed.document || !parsed.web) {
            log.error('store', 'importJSON 结构不合法', { keys: Object.keys(parsed ?? {}) });
            return false;
          }
          const history = pushHistory(get().history, get().doc);
          set({ doc: normalizeDocTables(parsed), history, selectionReset: undefined } as Partial<EditorStore>);
          return true;
        } catch (e) {
          console.error('[store] importJSON 解析失败', e);
          return false;
        }
      },

      exportJSON: () => {
        const out = JSON.stringify(get().doc, null, 2);
        log.info('store', 'exportJSON', { bytes: out.length });
        return out;
      },

      exportHTML: () => {
        const out = buildExportHtml(get().doc, getForest(get().doc));
        log.info('store', 'exportHTML', { bytes: out.length, mode: get().doc.mode });
        return out;
      },

      exportWord: () => {
        const out = buildWordDoc(get().doc, getForest(get().doc));
        log.info('store', 'exportWord', { bytes: out.length });
        return out;
      },

      exportReact: () => {
        const out = buildReactComponent(get().doc, getForest(get().doc));
        log.info('store', 'exportReact', { bytes: out.length, mode: get().doc.mode });
        return out;
      },
    }),
    {
      name: 'visual-editor-v1',
      version: 1,
      partialize: (s) =>
        ({
          doc: s.doc,
          zoom: s.zoom,
          // 诊断面板属于临时弹层，不持久化（否则刷新后会自动弹出）
          ui: { ...s.ui, showDiagnostics: false },
        }) as unknown as EditorStore,
      /**
       * ★恢复时**深合并**，而不是默认的顶层浅合并。
       *
       * 默认 merge 是 `{...current, ...persisted}`：持久化里的 `ui` 会整体替换默认 ui，
       * 于是**新加的 ui 字段**（如 `lockedIds`、`tableCells`）在旧数据里就是 undefined ——
       * 一读 `.includes` 就崩。真实现场：旧 localStorage + 选中组件 →
       * 属性面板 `TypeError: Cannot read properties of undefined (reading 'includes')`。
       * 这里把 ui 与新字段默认值合并、并把嵌套的纸张/画布配置也合到默认值上，
       * 以后再加字段不会再让老数据崩。
       */
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<EditorStore>;
        const pDoc = p.doc as EditorDocument | undefined;
        return {
          ...current,
          ...p,
          doc: pDoc
            ? normalizeDocTables({
                ...current.doc,
                ...pDoc,
                document: {
                  ...current.doc.document,
                  ...pDoc.document,
                  page: { ...current.doc.document.page, ...(pDoc.document?.page ?? {}) },
                },
                web: {
                  ...current.doc.web,
                  ...pDoc.web,
                  canvas: { ...current.doc.web.canvas, ...(pDoc.web?.canvas ?? {}) },
                },
                selectedIds: pDoc.selectedIds ?? [],
              })
            : current.doc,
          // ★关键：旧数据缺的新字段一律回落到默认值
          ui: { ...initialUI, ...(p.ui ?? {}), showDiagnostics: false },
          // 撤销栈不持久化（partialize 里也没存）；这里显式清空，避免将来加字段时
          // 把一份指向已不存在节点的旧历史合并进来。
          history: emptyHistory(),
        };
      },
    },
  ),
);

/* ══════════════ 局部辅助 ══════════════ */

function layer(doc: EditorDocument, id: string, op: LayerOp): EditorDocument {
  const forest = getForest(doc);
  const next = applyLayer(forest, id, op);
  return next === forest ? doc : setForest(doc, next);
}

function findParentIdOf(forest: ComponentNode[], id: string): string | null {
  let parent: string | null = null;
  const rec = (nodes: ComponentNode[], pid: string | null): void => {
    nodes.forEach((n) => {
      if (n.id === id) parent = pid;
      if (n.children?.length) rec(n.children, n.id);
    });
  };
  rec(forest, null);
  return parent;
}

/* ══════════════ 选择器（供组件订阅，避免全量重渲染） ══════════════ */

export const selectMode = (s: EditorStore): EditorMode => s.doc.mode;
export const selectForest = (s: EditorStore): ComponentNode[] => getForest(s.doc);
export const selectSelectedIds = (s: EditorStore): string[] => s.doc.selectedIds;
export const selectPrimarySelected = (s: EditorStore): ComponentNode | null => {
  const id = s.doc.selectedIds[0];
  if (!id) return null;
  return findNode(getForest(s.doc), id);
};
export const selectCanUndo = (s: EditorStore): boolean => s.history.past.length > 0;
export const selectCanRedo = (s: EditorStore): boolean => s.history.future.length > 0;
