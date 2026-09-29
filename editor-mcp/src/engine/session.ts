/**
 * 无头文档引擎（Headless Engine）：对 `EditorDocument` JSON 做增删改查。
 *
 * 为什么 MCP 侧需要它：规格 §二 要求"编辑器没开时降级到无头操作文档文件"，
 *   而节点操作要么走编辑器 store（Live），要么就得有一份能在磁盘文档上跑的 reducer。
 *   ★规格 §14 的正确做法是把这份 reducer 抽成 `@editor/core` 供编辑器与 MCP 共用；
 *     当前是**独立实现**（语义对齐：document.components 是文档流、web.root.children 是画布顶层、
 *     children 递归嵌套、frame 仅 Web 模式），后续抽包时这一层整体替换即可。
 *
 * 会话语义：
 *   · 每个调用都从磁盘读最新版本再改再原子写回（无长驻状态，避免多客户端互相覆盖）；
 *   · 无头没有编辑器的撤销栈，这里自带**快照栈**（每文档 50 步）实现 history.*；
 *   · selection 在无头下只是"服务端记住的最近一次"，编辑器打开时以编辑器为准（如实标注）。
 */
import { docFile } from '../config.js';
import { EditorMcpError, ErrorCodes } from '../errors.js';
import { listDocuments, makeDocument, readDocument, writeDocument, type ComponentNode, type EditorDocument, type EditorMode } from '../bridge/headless.js';

export { listDocuments, makeDocument, readDocument, writeDocument };
export type { ComponentNode, EditorDocument, EditorMode };

const HISTORY_CAP = 50;
const snapshots = new Map<string, EditorDocument[]>();
const cursor = new Map<string, number>();
let lastSelection: { docId: string | null; ids: string[] } = { docId: null, ids: [] };

/** "当前文档"：doc.get / node.add 等不带 docId 时用它（doc.create / doc.open 会更新） */
let currentDocId: string | null = null;
export function setCurrentDoc(docId: string | null): void {
  currentDocId = docId;
}
export function getCurrentDoc(): string | null {
  return currentDocId;
}
function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 顶层容器数组：文档模式 = document.components；web/ppt = web.root.children */
function roots(doc: EditorDocument): ComponentNode[] {
  if (doc.mode === 'web') {
    doc.web.root.children = doc.web.root.children ?? [];
    return doc.web.root.children;
  }
  doc.document.components = doc.document.components ?? [];
  return doc.document.components;
}

/** 深度优先找节点（含 roots 自身） */
export function findNode(nodes: ComponentNode[], id: string): ComponentNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

export function findNodeInDoc(doc: EditorDocument, id: string): ComponentNode | null {
  return findNode(roots(doc), id);
}

export function findParentList(doc: EditorDocument, id: string): ComponentNode[] | null {
  const walk = (list: ComponentNode[]): ComponentNode[] | null => {
    for (const n of list) {
      if (n.id === id) return list;
      if (n.children?.length) {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(roots(doc));
}

/** 列出所有节点（扁平，带父 id），供 node.list / find 用 */
export interface FlatNode {
  id: string;
  type: string;
  parentId: string | null;
  children: number;
  depth: number;
}

export function flatten(doc: EditorDocument): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (list: ComponentNode[], parentId: string | null, depth: number): void => {
    for (const n of list) {
      out.push({ id: n.id, type: n.type, parentId, children: n.children?.length ?? 0, depth });
      if (n.children?.length) walk(n.children, n.id, depth + 1);
    }
  };
  walk(roots(doc), null, 0);
  return out;
}

/** 树形（精简：id / type / 子节点），depth 控制展开层数 */
export function tree(doc: EditorDocument, depth = 99): unknown {
  const walk = (list: ComponentNode[], d: number): unknown[] =>
    list.map((n) => ({
      id: n.id,
      type: n.type,
      ...(d < depth && n.children?.length ? { children: walk(n.children, d + 1) } : {}),
    }));
  return walk(roots(doc), 0);
}

/* ══════════════ 快照栈（无头 history） ══════════════ */

export function pushSnapshot(doc: EditorDocument): void {
  const stack = snapshots.get(doc.id) ?? [];
  const at = cursor.get(doc.id) ?? stack.length - 1;
  stack.splice(at + 1); // 撤销后再改 → 丢掉"未来"
  stack.push(JSON.parse(JSON.stringify(doc)) as EditorDocument);
  while (stack.length > HISTORY_CAP) stack.shift();
  snapshots.set(doc.id, stack);
  cursor.set(doc.id, stack.length - 1);
}

export function undo(docId: string, steps = 1): EditorDocument | null {
  const stack = snapshots.get(docId) ?? [];
  let at = (cursor.get(docId) ?? stack.length - 1) - steps;
  if (at < 0) at = 0;
  if (!stack.length) return null;
  cursor.set(docId, at);
  return JSON.parse(JSON.stringify(stack[at])) as EditorDocument;
}

export function redo(docId: string, steps = 1): EditorDocument | null {
  const stack = snapshots.get(docId) ?? [];
  if (!stack.length) return null;
  let at = (cursor.get(docId) ?? stack.length - 1) + steps;
  if (at > stack.length - 1) at = stack.length - 1;
  cursor.set(docId, at);
  return JSON.parse(JSON.stringify(stack[at])) as EditorDocument;
}

export function historyInfo(docId: string): { size: number; cursor: number } {
  const stack = snapshots.get(docId) ?? [];
  return { size: stack.length, cursor: cursor.get(docId) ?? stack.length - 1 };
}

export function clearHistory(docId: string): void {
  snapshots.delete(docId);
  cursor.delete(docId);
}

/** 取某一份快照（history.restore 用）：只设置游标，不落盘（由调用方写文件） */
export function restoreSnapshot(docId: string, index: number): EditorDocument | null {
  const stack = snapshots.get(docId) ?? [];
  if (index < 0 || index >= stack.length) return null;
  cursor.set(docId, index);
  return JSON.parse(JSON.stringify(stack[index])) as EditorDocument;
}

/* ══════════════ selection（无头：服务端记住即可） ══════════════ */

export function setSelection(docId: string | null, ids: string[]): void {
  lastSelection = { docId, ids };
}
export function getSelection(): { docId: string | null; ids: string[] } {
  return lastSelection;
}

/* ══════════════ 文档级 ══════════════ */

export async function withDoc<T>(docId: string, fn: (doc: EditorDocument) => T | Promise<T>): Promise<T> {
  const doc = await readDocument(docId);
  const result = await fn(doc);
  return result;
}

/** 改完落盘（自动推快照 + 原子写） */
export async function commitDoc(doc: EditorDocument): Promise<string> {
  pushSnapshot(doc);
  return writeDocument(doc.id, doc);
}

export interface DocSummary {
  docId: string;
  title: string;
  mode: string;
  /** 当前模式下的节点数（编辑器两套内容是独立的，所以这里分开给） */
  nodes: number;
  documentNodes: number;
  webNodes: number;
  pages: number;
  words: number;
  bytes: number;
  mtime: number;
}

function countText(node: ComponentNode): number {
  return countOf(node) + (node.children ?? []).reduce((n, c) => n + countText(c), 0);
}

export async function docSummary(docId: string): Promise<DocSummary> {
  const doc = await readDocument(docId);
  // 两套内容互相独立（编辑器的语义）：分开统计，并且**都**报出来，避免"切到 web 后 nodes=0"的困惑
  const documentNodes = flatten({ ...doc, mode: 'document' } as EditorDocument).length;
  const webNodes = flatten({ ...doc, mode: 'web' } as EditorDocument).length;
  const words = (doc.document?.components ?? []).reduce((n, c) => n + countText(c), 0) +
    (doc.web?.root?.children ?? []).reduce((n, c) => n + countText(c), 0);
  const active = doc.mode === 'web' ? webNodes : documentNodes;
  const pageCount = Math.max(1, Math.ceil(words / 900)); // 粗估：按 ~900 字/页
  const { size, mtimeMs } = await statOf(docId);
  return {
    docId,
    title: doc.title,
    mode: doc.mode,
    nodes: active,
    documentNodes,
    webNodes,
    pages: doc.mode === 'web' ? 1 : pageCount,
    words,
    bytes: size,
    mtime: Math.round(mtimeMs),
  };
}

/** 单节点的文本字数（只看文本类字段） */
function countOf(node: ComponentNode): number {
  let n = 0;
  for (const [k, v] of Object.entries(node.props ?? {})) {
    if (typeof v !== 'string') continue;
    if (!/text|html|items|data|caption|title|label|desc|col\d/.test(k)) continue;
    n += v.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
  }
  return n;
}

async function statOf(docId: string): Promise<{ size: number; mtimeMs: number }> {
  const fs = await import('node:fs/promises');
  const st = await fs.stat(docFile(docId));
  return { size: st.size, mtimeMs: st.mtimeMs };
}

/* ══════════════ 节点操作 ══════════════ */

export interface AddNodeArgs {
  type: string;
  parentId?: string | null;
  index?: number;
  props?: Record<string, unknown>;
  id?: string;
}

export async function addNode(docId: string, args: AddNodeArgs): Promise<{ node: ComponentNode; index: number; parentId: string | null }> {
  const doc = await readDocument(docId);
  const node: ComponentNode = {
    id: args.id ?? newId(args.type.slice(0, 3) || 'nd'),
    type: args.type,
    props: args.props ?? {},
    ...(doc.mode === 'web' ? { frame: { x: 40, y: 40, w: 240, h: 40 } } : {}),
  };
  let list: ComponentNode[];
  let parentId: string | null = args.parentId ?? null;
  if (parentId) {
    const parent = findNodeInDoc(doc, parentId);
    if (!parent) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到父容器 ${parentId}`);
    parent.children = parent.children ?? [];
    list = parent.children;
  } else {
    list = roots(doc);
  }
  const index = args.index == null ? list.length : Math.max(0, Math.min(args.index, list.length));
  list.splice(index, 0, node);
  await commitDoc(doc);
  return { node, index, parentId };
}

export async function updateNode(docId: string, id: string, props: Record<string, unknown>): Promise<ComponentNode> {
  const doc = await readDocument(docId);
  const node = findNodeInDoc(doc, id);
  if (!node) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到节点 ${id}`);
  node.props = { ...node.props, ...props };
  await commitDoc(doc);
  return node;
}

export async function setNodeFrame(
  docId: string,
  id: string,
  frame: { x?: number; y?: number; w?: number; h?: number; rotation?: number },
): Promise<ComponentNode> {
  const doc = await readDocument(docId);
  const node = findNodeInDoc(doc, id);
  if (!node) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到节点 ${id}`);
  node.frame = { x: 0, y: 0, w: 100, h: 40, ...(node.frame ?? {}), ...frame };
  await commitDoc(doc);
  return node;
}

export async function removeNodes(docId: string, ids: string[]): Promise<string[]> {
  const doc = await readDocument(docId);
  const removed: string[] = [];
  for (const id of ids) {
    const list = findParentList(doc, id);
    if (!list) continue;
    const i = list.findIndex((n) => n.id === id);
    if (i >= 0) {
      list.splice(i, 1);
      removed.push(id);
    }
  }
  if (!removed.length) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `没有可删除的节点：${ids.join(', ')}`);
  await commitDoc(doc);
  return removed;
}

export async function moveNode(
  docId: string,
  id: string,
  newParentId?: string | null,
  index?: number,
): Promise<{ parentId: string | null; index: number }> {
  const doc = await readDocument(docId);
  const node = findNodeInDoc(doc, id);
  if (!node) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到节点 ${id}`);
  if (newParentId && (newParentId === id || findNode(node.children ?? [], newParentId))) {
    throw new EditorMcpError(ErrorCodes.INVALID_PROP_VALUE, '不能把节点移动到它自己或它的子孙里');
  }
  const from = findParentList(doc, id);
  if (from) from.splice(from.findIndex((n) => n.id === id), 1);
  const target = newParentId ? findNodeInDoc(doc, newParentId) : null;
  if (newParentId && !target) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到目标容器 ${newParentId}`);
  const list = target ? (target.children = target.children ?? []) : roots(doc);
  const at = index == null ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, node);
  await commitDoc(doc);
  return { parentId: newParentId ?? null, index: at };
}

export function cloneWithNewIds(node: ComponentNode): ComponentNode {
  return {
    ...JSON.parse(JSON.stringify(node)),
    id: newId(node.type.slice(0, 3) || 'nd'),
    ...(node.children ? { children: node.children.map(cloneWithNewIds) } : {}),
  } as ComponentNode;
}

export async function duplicateNode(docId: string, id: string, includeChildren = true): Promise<ComponentNode> {
  const doc = await readDocument(docId);
  const node = findNodeInDoc(doc, id);
  if (!node) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到节点 ${id}`);
  const copy = cloneWithNewIds(includeChildren ? node : { ...node, children: [] });
  const list = findParentList(doc, id) ?? roots(doc);
  list.splice(list.findIndex((n) => n.id === id) + 1, 0, copy);
  await commitDoc(doc);
  return copy;
}

/** 层级调整：front / back / forward / backward（在同级里移动） */
export async function reorderNode(docId: string, id: string, action: 'front' | 'back' | 'forward' | 'backward'): Promise<{ index: number; total: number }> {
  const doc = await readDocument(docId);
  const list = findParentList(doc, id);
  if (!list) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到节点 ${id}`);
  const i = list.findIndex((n) => n.id === id);
  const [node] = list.splice(i, 1);
  const at = action === 'front' ? list.length : action === 'back' ? 0 : action === 'forward' ? Math.min(list.length, i + 1) : Math.max(0, i - 1);
  list.splice(at, 0, node);
  await commitDoc(doc);
  return { index: at, total: list.length };
}

export async function batchUpdate(docId: string, ids: string[], props: Record<string, unknown>): Promise<string[]> {
  const doc = await readDocument(docId);
  const changed: string[] = [];
  for (const id of ids) {
    const node = findNodeInDoc(doc, id);
    if (!node) continue;
    node.props = { ...node.props, ...props };
    changed.push(id);
  }
  if (!changed.length) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `没有匹配的节点：${ids.join(', ')}`);
  await commitDoc(doc);
  return changed;
}

/** node.setText：按组件习惯自动挑文本字段（text / html / items / caption…） */
export async function setNodeText(docId: string, id: string, text: string, key?: string): Promise<{ key: string }> {
  const doc = await readDocument(docId);
  const node = findNodeInDoc(doc, id);
  if (!node) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到节点 ${id}`);
  const candidates = ['text', 'html', 'items', 'data', 'caption', 'title', 'label', 'content'];
  const picked = key ?? candidates.find((k) => k in (node.props ?? {})) ?? 'text';
  node.props = { ...node.props, [picked]: text };
  await commitDoc(doc);
  return { key: picked };
}

export async function setNodeFlag(docId: string, id: string, flag: 'hidden', value: boolean): Promise<ComponentNode> {
  const doc = await readDocument(docId);
  const node = findNodeInDoc(doc, id);
  if (!node) throw new EditorMcpError(ErrorCodes.NODE_NOT_FOUND, `找不到节点 ${id}`);
  if (flag === 'hidden') node.hidden = value;
  await commitDoc(doc);
  return node;
}

/* ══════════════ 页面 / 画布 ══════════════ */

const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  Custom: { width: 210, height: 297 },
};

const DEVICE_PRESETS: Record<string, { width: number; height: number }> = {
  Desktop: { width: 1440, height: 900 },
  Laptop: { width: 1280, height: 800 },
  Tablet: { width: 768, height: 1024 },
  Mobile: { width: 375, height: 812 },
  Custom: { width: 1440, height: 900 },
};

export async function patchPage(docId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const doc = await readDocument(docId);
  const page = doc.document.page as Record<string, unknown>;
  Object.assign(page, patch);
  await commitDoc(doc);
  return page;
}

export async function setPageSize(docId: string, size: string, width?: number, height?: number): Promise<Record<string, unknown>> {
  const doc = await readDocument(docId);
  const page = doc.document.page as Record<string, unknown>;
  const preset = PAGE_SIZES[size] ?? PAGE_SIZES.A4;
  const landscape = page.orientation === 'landscape';
  page.size = size;
  page.width = width ?? (landscape ? preset.height : preset.width);
  page.height = height ?? (landscape ? preset.width : preset.height);
  await commitDoc(doc);
  return page;
}

export async function setPageOrientation(docId: string, orientation: 'portrait' | 'landscape'): Promise<Record<string, unknown>> {
  const doc = await readDocument(docId);
  const page = doc.document.page as Record<string, unknown>;
  const was = page.orientation;
  page.orientation = orientation;
  if (was !== orientation) {
    const w = page.width as number;
    page.width = page.height;
    page.height = w;
  }
  await commitDoc(doc);
  return page;
}

export async function patchCanvas(docId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const doc = await readDocument(docId);
  const canvas = doc.web.canvas as Record<string, unknown>;
  Object.assign(canvas, patch);
  await commitDoc(doc);
  return canvas;
}

export async function setCanvasDevice(docId: string, device: string, width?: number, height?: number): Promise<Record<string, unknown>> {
  const doc = await readDocument(docId);
  const canvas = doc.web.canvas as Record<string, unknown>;
  const preset = DEVICE_PRESETS[device] ?? DEVICE_PRESETS.Desktop;
  canvas.device = device;
  canvas.width = width ?? preset.width;
  canvas.height = height ?? preset.height;
  await commitDoc(doc);
  return canvas;
}

/** 分页符：在文档流指定位置插入一个 pageBreak 节点 */
export async function addPageBreak(docId: string, index?: number): Promise<{ node: ComponentNode; index: number }> {
  /**
   * ★B2（ARCHITECTURE §7.5 E2-补）：**缺省不再"追加到末尾"**。
   * 追加到末尾必然在文档最后留下一个分页符 → 打印/导出 HTML/导出 Word **三个出口都多一张空白页**。
   * 缺省位置改为"末尾分页符**之前**"（即规范化后的长度）：连续调两次也只会得到一个分页符。
   */
  let at = index;
  if (at === undefined) {
    const doc = await readDocument(docId);
    const nodes: ComponentNode[] = doc.document.components;
    at = nodes.length;
    while (at > 0 && nodes[at - 1]?.type === 'pageBreak') at -= 1;
  }
  const res = await addNode(docId, { type: 'pageBreak', index: at, props: {} });
  return { node: res.node, index: res.index };
}
