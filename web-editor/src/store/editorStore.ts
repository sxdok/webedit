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
  normalizeDoc,
  removeNode,
  insertNode,
  setForest,
  updateNode,
  type LayerOp,
} from './treeUtils';
import { MergeGate, emptyHistory, pushHistory, redo, undo, type HistoryState } from './history';
import { createId } from '../utils/id';
import { log } from '../utils/logger';
import { buildExportHtml } from '../utils/export/docExport';
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
  /** 新建文档对话框（文件 → 新建 / Ctrl+N）：先选模式再填参数（类似 PS 的新建） */
  newDocOpen: boolean;
  /**
   * 组件箱是否显示**真渲染缩略图**（B9）：开=单列卡片带预览，关=紧凑两列（**默认关**，2026-09-23 用户要求）。
   * 随 ui 持久化；在「视图 → 首选项…」里改（组件箱头部也留了一个快捷眼睛图标）。
   */
  compPreview: boolean;
  /** 「首选项」对话框（视图 → 首选项…）：编辑器各项设置集中在这里 */
  prefsOpen: boolean;
  /** Markdown 源码视图（B10，视图菜单打开；只读弹窗） */
  showMarkdown: boolean;
  /**
   * 图表按章编号（B11）：打开后图片/柱状图显示「图 X-Y」、表格显示「表 X-Y」
   * （章号 = `heading(level=1)` 的序号，章内图/表各自计数）。默认关，随 ui 持久化。
   */
  autoNumber: boolean;
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
  /**
   * 画布视图的**平移偏移**（px，屏幕像素；PS 式手抓）：内容层整体 translate，
   * **不夹边界**（可以把纸张拖到视口任意位置，甚至拖出可视区）。
   */
  pan: { x: number; y: number };
}

/** 一"页" = 画布上方分页里的一个标签；每页是一份**独立文档**（有自己的模式与内容） */
export interface EditorPage {
  id: string;
  title: string;
  mode: EditorMode;
  doc: EditorDocument;
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
  newDocOpen: false,
  compPreview: false,
  prefsOpen: false,
  showMarkdown: false,
  autoNumber: false,
  registryVersion: 0,
  theme: 'light',
  docPageCount: 1,
  tableCells: null,
  lockedIds: [],
  propClosed: { groups: {}, drawers: {} },
  pan: { x: 0, y: 0 },
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
  /**
   * 画布上方的**分页**（每页一份独立文档）+ 当前页 id。
   * 当前页的内容就是上面的 `doc`；切页时把 `doc` 写回旧页、再把新页的 doc 载入 `doc`。
   */
  pages: EditorPage[];
  activePageId: string;

  /* 分页（每页一个模式 + 一份内容） */
  addPage(doc: EditorDocument): string;
  /** 整体替换分页（示例文档 / 打开工作区用）：`activeId` 不存在时取第一页 */
  setPages(pages: EditorPage[], activeId?: string): void;
  /**
   * 载入一份文档（示例 / 打开 JSON）：当前只有一页且是**空白页**时直接替换它（不留空标签），
   * 否则新增一页。返回最终生效的页 id。
   */
  loadDocument(doc: EditorDocument): string;
  setActivePage(id: string): void;
  /** 重命名某一页（分页标签 F2 / 双击就地改名）；改的是当前页时同步文档标题 */
  renamePage(id: string, title: string): void;
  closePage(id: string): void;
  /** 画布平移（PS 式手抓；不夹边界） */
  setPan(pan: { x: number; y: number }): void;
  /** 把当前页的信息（标题/模式）同步进分页标签 */
  syncActivePage(): void;

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
  /**
   * 换父容器（拖入容器 / 组件树拖拽）。
   * `frame`：**相对新父容器**的新位置尺寸；Web 模式的子组件坐标是相对父容器的，
   * 只改树结构不换算坐标的话，子组件会按原来的画布坐标跑到容器外（被裁剪后直接看不见）。
   * 与树结构**一次提交**（一步历史），避免"先跳一下再归位"的闪动。
   */
  reparentComponent(id: string, newParentId: string | null, frame?: Partial<Frame>): void;
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
  /** 打开/关闭「新建文档」对话框（先选模式 → 再填参数） */
  setNewDocOpen(open: boolean): void;
  /** 组件箱「显示预览」开关（B9，随 ui 持久化） */
  setCompPreview(on: boolean): void;
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
  /* ★2026-09-23 用户要求：移除"导出 .doc"（HTML 版式的 Word），只保留真 .docx
     （见 utils/export/docx.ts，菜单「文件 → 导出 Word（.docx）」）。 */
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

/** 初始页（分页里的第一页，就是初始文档） */
const initialPage: EditorPage = (() => {
  const d = createInitialDocument();
  return { id: d.id, title: d.title, mode: d.mode, doc: d };
})();

export const useEditorStore = create<EditorStore>()(
  persist(
    (set, get) => ({
      doc: initialPage.doc,
      zoom: 1,
      history: emptyHistory(),
      ui: initialUI,
      clipboard: null,
      /* 分页：初始一页 */
      pages: [initialPage],
      activePageId: initialPage.id,

      /* ── 分页（每页一份独立文档）── */

      /** 新建一页并切过去（新建文档对话框 / 打开 JSON 都用它） */
      addPage: (doc) => {
        const id = doc.id || createId('doc');
        const page: EditorPage = { id, title: doc.title, mode: doc.mode, doc: { ...doc, id } };
        log.info('store', 'addPage', { id, title: doc.title, mode: doc.mode, total: get().pages.length + 1 });
        set((s) => ({
          pages: [...s.pages, page],
          activePageId: id,
          doc: page.doc,
          history: emptyHistory(),
          ui: { ...s.ui, tableCells: null, pan: { x: 0, y: 0 } },
        }));
        return id;
      },

      /** 整体替换分页（示例文档 / 打开工作区用） */
      setPages: (pages, activeId) => {
        if (!pages.length) return;
        const active = pages.find((p) => p.id === activeId) ?? pages[0];
        log.info('store', 'setPages', { count: pages.length, active: active.id, title: active.title, mode: active.mode });
        set((s) => ({
          pages,
          activePageId: active.id,
          doc: active.doc,
          history: emptyHistory(),
          ui: { ...s.ui, tableCells: null, pan: { x: 0, y: 0 } },
        }));
      },

      /** 载入一份文档：空白首页直接替换，否则新增一页 */
      loadDocument: (doc) => {
        const s = get();
        const page: EditorPage = { id: doc.id, title: doc.title, mode: doc.mode, doc };
        const blank = (d: EditorDocument): boolean => d.document.components.length === 0 && (d.web.root.children?.length ?? 0) === 0;
        if (s.pages.length === 1 && blank(s.doc)) {
          log.info('store', 'loadDocument(替换空白首页)', { title: doc.title, mode: doc.mode });
          set((st) => ({ pages: [page], activePageId: page.id, doc, history: emptyHistory(), ui: { ...st.ui, tableCells: null, pan: { x: 0, y: 0 } } }));
          return page.id;
        }
        return get().addPage(doc);
      },

      /** 重命名某一页（F2 / 双击标签）；改当前页时同步 doc.title（并被 commit 记入历史） */
      renamePage: (id, title) => {
        const s = get();
        const name = title.trim() || '未命名';
        const pages = s.pages.map((p) => (p.id === id ? { ...p, title: name } : p));
        log.info('store', 'renamePage', { id, title: name, active: id === s.activePageId });
        set({ pages });
        if (id === s.activePageId) get().setTitle(name);
      },

      setActivePage: (id) => {        const s = get();
        if (s.activePageId === id) return;
        const target = s.pages.find((p) => p.id === id);
        if (!target) return;
        // 先把当前页的改动写回它的槽位（标题/模式也跟着同步），再载入目标页
        const flushed = s.pages.map((p) => (p.id === s.activePageId ? { ...p, title: s.doc.title, mode: s.doc.mode, doc: s.doc } : p));
        log.info('store', 'setActivePage', { from: s.activePageId, to: id, title: target.title, mode: target.mode });
        set({
          pages: flushed,
          activePageId: id,
          doc: target.doc,
          history: emptyHistory(), // 每页各自的编辑历史不跨页混（撤销不会撤到别的页上）
          ui: { ...s.ui, tableCells: null, pan: { x: 0, y: 0 } },
        });
      },

      closePage: (id) => {
        const s = get();
        if (s.pages.length <= 1) return; // 至少留一页
        const idx = s.pages.findIndex((p) => p.id === id);
        if (idx < 0) return;
        const pages = s.pages.filter((p) => p.id !== id);
        if (s.activePageId !== id) {
          log.info('store', 'closePage', { id, remain: pages.length });
          set({ pages });
          return;
        }
        const next = pages[Math.min(idx, pages.length - 1)];
        log.info('store', 'closePage(active)', { id, next: next.id, remain: pages.length });
        set({ pages, activePageId: next.id, doc: next.doc, history: emptyHistory(), ui: { ...s.ui, tableCells: null, pan: { x: 0, y: 0 } } });
      },

      /** 当前页的标题/模式同步到标签上（改名、切模式后调用） */
      syncActivePage: () => {
        const s = get();
        const pages = s.pages.map((p) => (p.id === s.activePageId ? { ...p, title: s.doc.title, mode: s.doc.mode, doc: s.doc } : p));
        set({ pages });
      },

      setPan: (pan) => {
        const cur = get().ui.pan;
        if (cur && cur.x === pan.x && cur.y === pan.y) return;
        set((s) => ({ ui: { ...s.ui, pan } }));
      },

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

      reparentComponent: (id, newParentId, frame) => {
        log.action('reparentComponent', { id, newParentId, frame: frame ?? null });
        commit(set, get, (doc) => {
          const parent = newParentId ? findNode(getForest(doc), newParentId) : null;
          const index = parent?.children?.length ?? 0;
          const moved = setForest(doc, moveNode(getForest(doc), id, newParentId, index));
          if (!frame) return moved;
          return setForest(
            moved,
            updateNode(getForest(moved), id, (n) => ({
              ...n,
              frame: { x: 0, y: 0, w: 100, h: 40, ...n.frame, ...frame },
            })),
          );
        });
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
      setNewDocOpen: (open) => {
        log.debug('store', 'setNewDocOpen', { open });
        set((s) => ({ ui: { ...s.ui, newDocOpen: open } }));
      },
      setCompPreview: (on) => {
        log.debug('store', 'setCompPreview', { on });
        set((s) => ({ ui: { ...s.ui, compPreview: on } }));
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
          set({ doc: normalizeDoc(parsed), history, selectionReset: undefined } as Partial<EditorStore>);
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
          // 分页：持久化时把**当前页**的槽位刷新成最新的 doc（否则切页会回退到旧内容）
          pages: s.pages.map((p) => (p.id === s.activePageId ? { ...p, title: s.doc.title, mode: s.doc.mode, doc: s.doc } : p)),
          activePageId: s.activePageId,
          // 诊断面板属于临时弹层，不持久化（否则刷新后会自动弹出）
          ui: { ...s.ui, showDiagnostics: false, newDocOpen: false },
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
            ? normalizeDoc({
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
          /* 分页：老存档没有 pages → 用当前文档造一页；有 pages 但**当前页槽位**是旧的 →
             以持久化的 `doc`（每次改动都会写）为准覆盖它。 */
          pages: (() => {
            const live = (pDoc ? normalizeDoc({ ...current.doc, ...pDoc }) : current.doc) as EditorDocument;
            const stored = Array.isArray(p.pages) ? (p.pages as EditorPage[]) : [];
            if (!stored.length) return [{ id: live.id, title: live.title, mode: live.mode, doc: live }];
            const activeId = typeof p.activePageId === 'string' && p.activePageId ? p.activePageId : stored[0].id;
            return stored.map((pg) => (pg.id === activeId ? { ...pg, title: live.title, mode: live.mode, doc: live } : pg));
          })(),
          activePageId:
            typeof p.activePageId === 'string' && p.activePageId && (p.pages ?? []).some((pg) => pg.id === p.activePageId)
              ? p.activePageId
              : ((p.pages ?? [])[0]?.id ?? current.activePageId),
          // ★关键：旧数据缺的新字段一律回落到默认值
          ui: { ...initialUI, ...(p.ui ?? {}), showDiagnostics: false, newDocOpen: false },
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
