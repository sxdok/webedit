/**
 * 职责：组件树的纯函数操作（查找/插入/删除/移动/复制/层级）+ 文档两模式的读写入统一入口。
 *
 * 关键设计：把两种布局模型统一成「森林（ComponentNode[]）」——
 *   文档模式：森林 = doc.document.components（文档流数组，容器组件内部仍可嵌套）
 *   Web 模式：森林 = doc.web.root.children（顶层绝对定位元素，可嵌套进容器）
 * 这样 store 里的增删改移只写一份逻辑，模式差异只体现在 getForest/setForest。
 * 所有函数不可变（路径复制），便于 React 重渲染与历史快照。
 */
import type {
  ComponentDefinition,
  ComponentNode,
  EditorDocument,
  EditorMode,
  Frame,
} from '../registry/types';
import { createId } from '../utils/id';
import { toTableText } from '../registry/components/common/tableKit';

/* ══════════════ 森林读写（两模式统一入口） ══════════════ */

export function getForest(doc: EditorDocument): ComponentNode[] {
  return doc.mode === 'web' ? (doc.web.root.children ?? []) : doc.document.components;
}

export function setForest(doc: EditorDocument, forest: ComponentNode[]): EditorDocument {
  if (doc.mode === 'web') {
    return { ...doc, web: { ...doc.web, root: { ...doc.web.root, children: forest } } };
  }
  return { ...doc, document: { ...doc.document, components: forest } };
}

/** Web 模式的根容器 id（顶层插入时 parentId 传它或 null） */
export function getRootId(doc: EditorDocument): string {
  return doc.web.root.id;
}

/* ══════════════ 查找 ══════════════ */

export function walk(
  forest: ComponentNode[],
  fn: (node: ComponentNode, parentId: string | null, index: number) => void,
  parentId: string | null = null,
): void {
  forest.forEach((node, index) => {
    fn(node, parentId, index);
    if (node.children?.length) walk(node.children, fn, node.id);
  });
}

export function findNode(forest: ComponentNode[], id: string): ComponentNode | null {
  let hit: ComponentNode | null = null;
  walk(forest, (node) => {
    if (node.id === id) hit = node;
  });
  return hit;
}

export function findParentId(forest: ComponentNode[], id: string): string | null {
  let parent: string | null = null;
  walk(forest, (node, parentId) => {
    if (node.id === id) parent = parentId;
  });
  return parent;
}

/** 扁平化，带深度与父 id，供组件树面板与状态栏使用 */
export function flatten(
  forest: ComponentNode[],
): { node: ComponentNode; depth: number; parentId: string | null }[] {
  const out: { node: ComponentNode; depth: number; parentId: string | null }[] = [];
  const rec = (nodes: ComponentNode[], depth: number, parentId: string | null): void => {
    nodes.forEach((node) => {
      out.push({ node, depth, parentId });
      if (node.children?.length) rec(node.children, depth + 1, node.id);
    });
  };
  rec(forest, 0, null);
  return out;
}

export function isDescendant(forest: ComponentNode[], ancestorId: string, id: string): boolean {
  const ancestor = findNode(forest, ancestorId);
  if (!ancestor?.children?.length) return false;
  let hit = false;
  walk(ancestor.children, (node) => {
    if (node.id === id) hit = true;
  });
  return hit;
}

/* ══════════════ 更新 ══════════════ */

/** 局部更新节点（路径复制） */
export function updateNode(
  forest: ComponentNode[],
  id: string,
  updater: (node: ComponentNode) => ComponentNode,
): ComponentNode[] {
  return forest.map((node) => {
    if (node.id === id) return updater(node);
    if (node.children?.length) {
      const children = updateNode(node.children, id, updater);
      return children === node.children ? node : { ...node, children };
    }
    return node;
  });
}

/* ══════════════ 插入 / 删除 ══════════════ */

export function insertNode(
  forest: ComponentNode[],
  node: ComponentNode,
  parentId: string | null,
  index?: number,
): ComponentNode[] {
  if (!parentId) {
    const next = [...forest];
    next.splice(clampIndex(index, next.length), 0, node);
    return next;
  }
  return updateNode(forest, parentId, (parent) => {
    const children = [...(parent.children ?? [])];
    children.splice(clampIndex(index, children.length), 0, node);
    return { ...parent, children };
  });
}

export function removeNode(
  forest: ComponentNode[],
  id: string,
): { forest: ComponentNode[]; removed: ComponentNode | null } {
  const removed = findNode(forest, id);
  if (!removed) return { forest, removed: null };
  const prune = (nodes: ComponentNode[]): ComponentNode[] =>
    nodes
      .filter((n) => n.id !== id)
      .map((n) => (n.children?.length ? { ...n, children: prune(n.children) } : n));
  return { forest: prune(forest), removed };
}

/* ══════════════ 移动（拖拽排序 / 换父） ══════════════ */

export function moveNode(
  forest: ComponentNode[],
  id: string,
  newParentId: string | null,
  index: number,
): ComponentNode[] {
  if (id === newParentId) return forest;
  if (newParentId && isDescendant(forest, id, newParentId)) return forest; // 不能把父节点拖进自己的子孙

  const { forest: pruned, removed } = removeNode(forest, id);
  if (!removed) return forest;

  // 同一父容器内向后移动时，删除会让目标索引前移 1
  const oldParent = findParentId(forest, id);
  const sameParent = (oldParent ?? null) === (newParentId ?? null);
  let target = index;
  if (sameParent) {
    const siblings = oldParent ? (findNode(forest, oldParent)?.children ?? []) : forest;
    const oldIndex = siblings.findIndex((n) => n.id === id);
    if (oldIndex >= 0 && oldIndex < index) target = index - 1;
  }
  return insertNode(pruned, removed, newParentId, target);
}

/* ══════════════ 层级（前移/后移/置顶/置底） ══════════════ */

export type LayerOp = 'forward' | 'backward' | 'front' | 'back';

export function applyLayer(forest: ComponentNode[], id: string, op: LayerOp): ComponentNode[] {
  const parentId = findParentId(forest, id);
  const siblings = parentId ? (findNode(forest, parentId)?.children ?? []) : forest;
  const i = siblings.findIndex((n) => n.id === id);
  if (i < 0) return forest;
  const target =
    op === 'forward' ? Math.min(siblings.length - 1, i + 1)
    : op === 'backward' ? Math.max(0, i - 1)
    : op === 'front' ? siblings.length - 1
    : 0;
  if (target === i) return forest;
  const next = [...siblings];
  const [node] = next.splice(i, 1);
  next.splice(target, 0, node);
  if (!parentId) return next;
  return updateNode(forest, parentId, (parent) => ({ ...parent, children: next }));
}

/* ══════════════ 复制 ══════════════ */

/** 深拷贝子树并重新生成 id（原地复制 / 粘贴） */
export function cloneSubtreeWithNewIds(node: ComponentNode): ComponentNode {
  return {
    ...structuredClone(node),
    id: createId(),
    children: node.children?.map(cloneSubtreeWithNewIds),
  };
}

/* ══════════════ 节点工厂 ══════════════ */

function clampIndex(index: number | undefined, length: number): number {
  if (index == null || Number.isNaN(index)) return length;
  return Math.max(0, Math.min(length, index));
}

export function defaultFrameFor(def: ComponentDefinition, mode: EditorMode): Frame | undefined {
  if (mode !== 'web') return undefined;
  return {
    x: def.defaultFrame?.x ?? 40,
    y: def.defaultFrame?.y ?? 40,
    w: def.defaultFrame?.w ?? 240,
    h: def.defaultFrame?.h ?? 40,
    rotation: def.defaultFrame?.rotation ?? 0,
  };
}

export function createNode(def: ComponentDefinition, mode: EditorMode): ComponentNode {
  const frame = defaultFrameFor(def, mode);
  const node: ComponentNode = {
    id: createId(def.type.slice(0, 3)),
    type: def.type,
    props: structuredClone(def.defaultProps),
  };
  if (def.isContainer) node.children = [];
  if (frame) node.frame = frame;
  return node;
}

/* ══════════════ 文档规整（读档/导入时统一一次） ══════════════ */

const isTableType = (t: string): boolean => t === 'table' || /Table$/.test(t);

/**
 * 把表格类组件的 `data` 统一成**文本形态**（数组 → "a | b\nc | d"）。
 *
 * 背景：早期组件默认属性里的 `data` 是二维数组，而属性面板的「数据」是文本域 ——
 * 数组进去只能显示成 "a,b,c"（用户反馈"表格数据不显示"）。
 * 在**读档与导入**时规整一次，旧存档与新拖入的表格就都是同一种形态。
 * 纯函数、不改结构（只把 props.data 换掉），可安全用在 persist merge 里。
 */
export function normalizeDocTables(doc: EditorDocument): EditorDocument {
  let touched = false;
  const walk = (list: ComponentNode[]): ComponentNode[] =>
    list.map((n) => {
      const children = n.children?.length ? walk(n.children) : n.children;
      const raw = n.props?.data;
      const needData = isTableType(n.type) && raw != null && typeof raw !== 'string';
      if (!needData && children === n.children) return n;
      touched = true;
      return {
        ...n,
        ...(needData ? { props: { ...n.props, data: toTableText(raw) } } : {}),
        ...(children !== n.children ? { children } : {}),
      };
    });
  const components = walk(doc.document.components);
  const webChildren = walk(doc.web.root.children ?? []);
  if (!touched) return doc;
  return {
    ...doc,
    document: { ...doc.document, components },
    web: { ...doc.web, root: { ...doc.web.root, children: webChildren } },
  };
}
