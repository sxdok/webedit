/**
 * 节点域 Tools：node.*（规格 §5.5）—— 最常用的一域。
 *
 * 全部走 `viaBridge`：Live 时由编辑器 store 执行（画布立刻变），无头时由 `engine/session` 改文档 JSON。
 * `node.list` 默认**只返回 id/type/parentId**（规格 §14「返回体尽量小」），要完整属性用 node.get。
 */
import { z } from 'zod';
import { readDocument } from '../bridge/headless.js';
import {
  addNode,
  batchUpdate,
  duplicateNode,
  findNodeInDoc,
  flatten,
  getCurrentDoc,
  moveNode,
  removeNodes,
  reorderNode,
  setNodeFlag,
  setNodeFrame,
  setNodeText,
  tree,
  updateNode,
} from '../engine/session.js';
import { viaBridge } from './helper.js';

const docIdParam = z.string().optional().describe('文档 id；缺省"当前文档"');
const idParam = z.string().describe('节点 id');

const withDoc = <T extends { docId?: string }>(args: T): T & { docId: string } => ({
  ...args,
  docId: args.docId ?? (getCurrentDoc() ?? ''),
});

export const nodeAddSchema = {
  type: z.string().describe('组件类型 key，如 heading / paragraph / table / button'),
  docId: docIdParam,
  parentId: z.string().nullish().describe('父容器 id；空 = 文档根（文档模式）或画布根（Web 模式）'),
  index: z.number().int().min(0).optional().describe('插入位置索引；缺省追加到末尾'),
  props: z.record(z.string(), z.unknown()).optional().describe('初始属性（会与组件默认值合并）'),
  clientId: z.string().optional().describe('幂等用：同一次会话里重复提交同一 clientId 不会插两次'),
};

const seenClientIds = new Set<string>();

export async function nodeAdd(args: {
  type: string;
  docId?: string;
  parentId?: string | null;
  index?: number;
  props?: Record<string, unknown>;
  clientId?: string;
}) {
  const a = withDoc(args);
  if (a.clientId && seenClientIds.has(a.clientId)) {
    return viaBridge('node.add', a as unknown as Record<string, unknown>, async () => ({
      duplicated: true,
      note: `clientId=${a.clientId} 已处理过，本次未重复插入（幂等）`,
    }));
  }
  const res = await viaBridge(
    'node.add',
    a as unknown as Record<string, unknown>,
    async () => {
      const r = await addNode(a.docId, { type: a.type, parentId: a.parentId ?? null, ...(a.index != null ? { index: a.index } : {}), ...(a.props ? { props: a.props } : {}) });
      return { id: r.node.id, type: r.node.type, parentId: r.parentId, index: r.index };
    },
    { changed: ['components'] },
  );
  if (a.clientId && res.ok) seenClientIds.add(a.clientId);
  return res;
}

export const nodeGetSchema = { id: idParam, docId: docIdParam, includeChildren: z.boolean().default(false).describe('是否连子节点一起返回') };

export async function nodeGet(args: { id: string; docId?: string; includeChildren?: boolean }) {
  const a = withDoc(args);
  return viaBridge('node.get', a, async () => {
    const doc = await readDocument(a.docId);
    const node = findNodeInDoc(doc, a.id);
    if (!node) throw new Error(`NODE_NOT_FOUND: 找不到节点 ${a.id}`);
    if (a.includeChildren) return node;
    const { children, ...rest } = node;
    return { ...rest, childCount: children?.length ?? 0 };
  });
}

export const nodeUpdateSchema = {
  id: idParam,
  docId: docIdParam,
  props: z.record(z.string(), z.unknown()).describe('要合并写入的属性（部分更新）'),
};

export async function nodeUpdate(args: { id: string; docId?: string; props: Record<string, unknown> }) {
  const a = withDoc(args);
  return viaBridge(
    'node.update',
    a,
    async () => {
      const node = await updateNode(a.docId, a.id, a.props);
      return { id: node.id, type: node.type, props: node.props };
    },
    { changed: ['props'] },
  );
}

export const nodeRemoveSchema = { id: idParam, docId: docIdParam, confirm: z.boolean().default(false).describe('删节点是破坏性操作，建议传 true') };

export async function nodeRemove(args: { id: string; docId?: string; confirm?: boolean }) {
  const a = withDoc(args);
  return viaBridge(
    'node.remove',
    a,
    async () => {
      const removed = await removeNodes(a.docId, [a.id]);
      return { removed };
    },
    { changed: ['components'] },
  );
}

export const nodeBatchRemoveSchema = {
  ids: z.array(z.string()).min(1).describe('要批量删除的节点 id'),
  docId: docIdParam,
  // 同 doc.delete：收 boolean，由 handler 返回结构化 CONFIRM_REQUIRED（否则协议层就拒了，客户端拿不到错误码）
  confirm: z.boolean().default(false).describe('批量删除必须显式传 true'),
};

export async function nodeBatchRemove(args: { ids: string[]; docId?: string; confirm?: boolean }) {
  const a = withDoc(args);
  return viaBridge(
    'node.batchRemove',
    a,
    async () => {
      if (a.confirm !== true) throw new Error('CONFIRM_REQUIRED: node.batchRemove 需要 confirm: true');
      const removed = await removeNodes(a.docId, a.ids);
      return { removed, count: removed.length };
    },
    { changed: ['components'] },
  );
}

export const nodeMoveSchema = {
  id: idParam,
  docId: docIdParam,
  newParentId: z.string().nullish().describe('新父容器 id；空 = 根'),
  index: z.number().int().min(0).optional().describe('在新父容器里的位置'),
};

export async function nodeMove(args: { id: string; docId?: string; newParentId?: string | null; index?: number }) {
  const a = withDoc(args);
  return viaBridge(
    'node.move',
    a,
    async () => moveNode(a.docId, a.id, a.newParentId ?? null, a.index),
    { changed: ['components'] },
  );
}

export const nodeDuplicateSchema = { id: idParam, docId: docIdParam, includeChildren: z.boolean().default(true) };

export async function nodeDuplicate(args: { id: string; docId?: string; includeChildren?: boolean }) {
  const a = withDoc(args);
  return viaBridge(
    'node.duplicate',
    a,
    async () => {
      const copy = await duplicateNode(a.docId, a.id, a.includeChildren !== false);
      return { id: copy.id, type: copy.type };
    },
    { changed: ['components'] },
  );
}

export const nodeListSchema = {
  docId: docIdParam,
  flat: z.boolean().default(true).describe('true=扁平列表（带 parentId/depth）；false=树形'),
  filterType: z.string().optional().describe('只看某个组件类型'),
  textContains: z.string().optional().describe('只看属性里含该文本的节点'),
  limit: z.number().int().positive().max(500).default(200),
};

export async function nodeList(args: { docId?: string; flat?: boolean; filterType?: string; textContains?: string; limit?: number }) {
  const a = withDoc(args);
  return viaBridge('node.list', a, async () => {
    const doc = await readDocument(a.docId);
    let rows = flatten(doc);
    if (a.filterType) rows = rows.filter((r) => r.type === a.filterType);
    if (a.textContains) {
      const kw = a.textContains;
      rows = rows.filter((r) => {
        const node = findNodeInDoc(doc, r.id);
        return !!node && JSON.stringify(node.props ?? {}).includes(kw);
      });
    }
    const limited = rows.slice(0, a.limit ?? 200);
    return a.flat === false ? { tree: tree(doc) } : { nodes: limited, total: rows.length };
  });
}

export const nodeTreeSchema = { docId: docIdParam, depth: z.number().int().min(1).max(20).default(99).describe('展开层数') };

export async function nodeTree(args: { docId?: string; depth?: number }) {
  const a = withDoc(args);
  return viaBridge('node.tree', a, async () => {
    const doc = await readDocument(a.docId);
    return { tree: tree(doc, a.depth ?? 99) };
  });
}

export const nodeFindSchema = {
  docId: docIdParam,
  type: z.string().optional().describe('按类型'),
  textContains: z.string().optional().describe('按属性文本'),
  limit: z.number().int().positive().max(200).default(50),
};

export async function nodeFind(args: { docId?: string; type?: string; textContains?: string; limit?: number }) {
  const a = withDoc(args);
  return viaBridge('node.find', a, async () => {
    const doc = await readDocument(a.docId);
    const rows = flatten(doc).filter((r) => {
      if (a.type && r.type !== a.type) return false;
      if (a.textContains) {
        const node = findNodeInDoc(doc, r.id);
        if (!node || !JSON.stringify(node.props ?? {}).includes(a.textContains)) return false;
      }
      return true;
    });
    return { matches: rows.slice(0, a.limit ?? 50), total: rows.length };
  });
}

export const nodeSetTextSchema = {
  id: idParam,
  text: z.string().describe('要写入的文本'),
  docId: docIdParam,
  key: z.string().optional().describe('指定写入哪个属性（缺省自动挑 text/html/items/caption…）'),
};

export async function nodeSetText(args: { id: string; text: string; docId?: string; key?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'node.setText',
    a,
    async () => {
      const r = await setNodeText(a.docId, a.id, a.text, a.key);
      return { id: a.id, key: r.key, text: a.text };
    },
    { changed: ['props'] },
  );
}

export const nodeSetFrameSchema = {
  id: idParam,
  docId: docIdParam,
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  rotation: z.number().optional().describe('旋转角度（度）'),
};

export async function nodeSetFrame(args: { id: string; docId?: string; x?: number; y?: number; w?: number; h?: number; rotation?: number }) {
  const a = withDoc(args);
  const { docId: _d, id, ...frame } = a;
  void _d;
  return viaBridge(
    'node.setFrame',
    a as unknown as Record<string, unknown>,
    async () => {
      const node = await setNodeFrame(a.docId, id, frame);
      return { id: node.id, frame: node.frame };
    },
    { changed: ['frame'] },
  );
}

export const nodeSetVisibleSchema = { id: idParam, docId: docIdParam, visible: z.boolean().describe('false = 画布上不渲染（编辑器里仍可见）') };

export async function nodeSetVisible(args: { id: string; docId?: string; visible: boolean }) {
  const a = withDoc(args);
  return viaBridge(
    'node.setVisible',
    a,
    async () => {
      const node = await setNodeFlag(a.docId, a.id, 'hidden', !a.visible);
      return { id: node.id, visible: node.hidden !== true };
    },
    { changed: ['hidden'] },
  );
}

export const nodeSetLockedSchema = { id: idParam, docId: docIdParam, locked: z.boolean().describe('锁定后画布不可拖拽（编辑器态，不导出）') };

export async function nodeSetLocked(args: { id: string; docId?: string; locked: boolean }) {
  const a = withDoc(args);
  // 锁定是**编辑器态**（存 ui.lockedIds，不进文档）→ 只有 Live 才有意义
  return viaBridge('node.setLocked', a, async () => ({
    id: a.id,
    locked: a.locked,
    note: '锁定是编辑器态（不写进文档 JSON）：无头模式下无副作用，请在编辑器里查看效果',
  }));
}

export const nodeReorderSchema = {
  id: idParam,
  docId: docIdParam,
  action: z.enum(['front', 'back', 'forward', 'backward']).describe('层级调整方向'),
};

export async function nodeReorder(args: { id: string; docId?: string; action: 'front' | 'back' | 'forward' | 'backward' }) {
  const a = withDoc(args);
  return viaBridge('node.reorder', a, async () => reorderNode(a.docId, a.id, a.action), { changed: ['components'] });
}

export const nodeBatchUpdateSchema = {
  ids: z.array(z.string()).min(1),
  docId: docIdParam,
  props: z.record(z.string(), z.unknown()),
};

export async function nodeBatchUpdate(args: { ids: string[]; docId?: string; props: Record<string, unknown> }) {
  const a = withDoc(args);
  return viaBridge(
    'node.batchUpdate',
    a,
    async () => {
      const changed = await batchUpdate(a.docId, a.ids, a.props);
      return { changed, count: changed.length };
    },
    { changed: ['props'] },
  );
}
