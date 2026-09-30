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

/**
 * 节点在**画布坐标系**里的绝对框（容器内子元素要把各级父级偏移累加）。
 * ★原来住在 `components/canvas/WebCanvas.tsx` 里；2026-09-30 下沉到本模块 ——
 * 因为 store（换父级换算坐标）也要用它，从组件目录反向 import 会破坏分层。
 */
export function absoluteFrame(forest: ComponentNode[], id: string): Frame | null {
  const chain: ComponentNode[] = [];
  const trace = (list: ComponentNode[], trail: ComponentNode[]): boolean => {
    for (const n of list) {
      const next = [...trail, n];
      if (n.id === id) {
        chain.push(...next);
        return true;
      }
      if (n.children?.length && trace(n.children, next)) return true;
    }
    return false;
  };
  if (!trace(forest, [])) return null;
  let x = 0;
  let y = 0;
  let frame: Frame | null = null;
  for (const n of chain) {
    if (!n.frame) continue;
    x += n.frame.x;
    y += n.frame.y;
    frame = n.frame;
  }
  if (!frame) return null;
  return { ...frame, x, y };
}

/** 把 v 夹到 [0, max]（父容器装不下子元素时 max 可能为负 → 退化成 0） */
const clampTo = (v: number, max: number): number => Math.max(0, Math.min(v, Math.max(0, max)));

/**
 * 把**局部 frame** 夹进它的父容器（父级为画布根 / 父无 frame → 原样返回）。
 *
 * 用在"复制/粘贴时 +16/+24 偏移"之后：源节点若正好贴着容器边缘，偏移一下就顶出容器了
 * （2026-09-30 自检实测：A 被夹在容器下边缘 → 原地复制的 +16 让复制件超出容器 24px）。
 * 与 `frameOnReparent` 一样，目的是"任何自动改坐标的地方都别把节点弄到容器外"。
 */
export function clampFrameIntoParent(forest: ComponentNode[], parentId: string | null, frame: Frame): Frame {
  if (!parentId) return frame;
  const parentFrame = findNode(forest, parentId)?.frame;
  if (!parentFrame) return frame;
  return {
    ...frame,
    x: Math.round(clampTo(frame.x, parentFrame.w - frame.w)),
    y: Math.round(clampTo(frame.y, parentFrame.h - frame.h)),
  };
}

/**
 * ★换父级时算出"**绝对位置不变**"的新局部 frame（超出父容器就贴边）。
 *
 * 为什么必须有它：Web 模式子组件的 `frame` 是**相对父容器**的。只改树结构、不动 frame，
 * 节点就会带着"老父级下的局部坐标"出现在新父级里 —— 表现为**位置偏移、甚至跑到容器/卡片外**。
 * 2026-09-30 用户报的"卡片内容器 → 复制 → 拖动 → 调整目录树后跑到卡片外"就是这个：
 * 画布拖拽那条路原先算了坐标，**目录树那条路漏了**。现在把这段数学收敛到本函数，
 * store 的 `moveComponent` / `reparentComponent` 都走它，任何入口换父级都不会再漏。
 *
 * @returns 新局部 frame（含 clamp）；算不出来（节点无 frame / 找不到）返回 null，调用方按原样处理
 */
export function frameOnReparent(
  forest: ComponentNode[],
  id: string,
  newParentId: string | null,
): Partial<Frame> | null {
  const childAbs = absoluteFrame(forest, id);
  if (!childAbs) return null;
  if (!newParentId) {
    /* 移到画布根：局部坐标就是画布坐标 */
    return { x: Math.round(childAbs.x), y: Math.round(childAbs.y), w: childAbs.w, h: childAbs.h };
  }
  const parentAbs = absoluteFrame(forest, newParentId);
  const parentFrame = findNode(forest, newParentId)?.frame;
  if (!parentAbs || !parentFrame) return null;
  return {
    x: Math.round(clampTo(childAbs.x - parentAbs.x, parentFrame.w - childAbs.w)),
    y: Math.round(clampTo(childAbs.y - parentAbs.y, parentFrame.h - childAbs.h)),
    w: childAbs.w,
    h: childAbs.h,
  };
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
 * 读档 / 导入时的**统一规整**（幂等、纯函数；只在确实需要改时才返回新对象）：
 *
 * ① 表格类组件的 `data` 统一成**文本形态**（数组 → "a | b\nc | d"）。
 *    背景：早期组件默认属性里的 `data` 是二维数组，而属性面板的「数据」是文本域 ——
 *    数组进去只能显示成 "a,b,c"（用户反馈"表格数据不显示"）。读档与导入时规整一次即可。
 *
 * ② **组件 ID 唯一**：缺 ID 或 ID 重复的节点一律重新生成（前缀仍取组件类型前 3 个字母）。
 *    为什么必须在读档时兜一道：ID 是"组件身份"—— 选中、撤销重做、组件树、画布命中、MCP 的 `node.*`
 *    全用它，而 `createId()` 只是"类型前缀 + 10 位随机"（≈40 bit），**没有全局强校验**；
 *    手工改过的 JSON / 老存档 / 外部通道写进来的文档都可能带重复 ID，那就会出现
 *    "选一个选中俩 / 改一个动两个 / 删除连带"这类怪事（用户 2026-09-24 问"ID 都是唯一的吗"）。
 */
export function normalizeDoc(doc: EditorDocument): EditorDocument {
  const seen = new Set<string>();
  // 先把 Web 根节点占掉，避免某个组件 ID 和根 ID 撞车
  if (doc.web?.root?.id) seen.add(doc.web.root.id);
  let touched = false;

  const walk = (list: ComponentNode[]): ComponentNode[] =>
    list.map((n) => {
      const rawId = typeof n.id === 'string' ? n.id.trim() : '';
      let id = n.id;
      if (!rawId || seen.has(rawId)) {
        id = createId(String(n.type ?? 'n').slice(0, 3));
        touched = true;
      }
      seen.add(id);
      const children = n.children?.length ? walk(n.children) : n.children;
      const raw = n.props?.data;
      const needData = isTableType(n.type) && raw != null && typeof raw !== 'string';
      if (!needData && children === n.children && id === n.id) return n;
      touched = true;
      return {
        ...n,
        id,
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
