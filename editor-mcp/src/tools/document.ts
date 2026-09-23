/**
 * 文档域 Tools：doc.*（规格 §5.1）。
 *
 * 每个 Tool 都走 `viaBridge`：编辑器开着就同步到画布（Live），没开就操作磁盘文档（无头，degraded: true）。
 */
import { z } from 'zod';
import { ok, ErrorCodes, fail, type ToolResult } from '../errors.js';
import { config, safeName } from '../config.js';
import { log } from '../log.js';
import { makeDocument, readDocument, writeDocument } from '../bridge/headless.js';
import { commitDoc, docSummary, getCurrentDoc, listDocuments, setCurrentDoc } from '../engine/session.js';
import { viaBridge, liveOnly } from './helper.js';

const docIdParam = z.string().optional().describe('文档 id（文件名去掉 .editor.json）；缺省用"当前文档"');

export const docCreateSchema = {
  title: z.string().optional().describe('文档标题，缺省「未命名文档」'),
  mode: z.enum(['document', 'web', 'ppt']).default('document').describe('目标模式：document=文档流 / web=设备画布 / ppt=幻灯片'),
  docId: z.string().optional().describe('指定文档 id（文件名，缺省按标题生成）；会做文件名安全化'),
  pageSize: z.enum(['A4', 'A3', 'A5', 'Letter', 'Legal', 'Custom']).optional().describe('文档模式纸张尺寸，缺省 A4'),
  device: z.enum(['Desktop', 'Laptop', 'Tablet', 'Mobile', 'Custom']).optional().describe('Web 模式设备预设，缺省 Desktop'),
};

export async function docCreate(args: {
  title?: string;
  mode?: 'document' | 'web' | 'ppt';
  docId?: string;
  pageSize?: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Custom';
  device?: 'Desktop' | 'Laptop' | 'Tablet' | 'Mobile' | 'Custom';
}): Promise<ToolResult<{ docId: string; path?: string; mode: string; title: string; via: string; degraded: boolean }>> {
  const res = await viaBridge<{ docId: string; path?: string; mode?: string; title?: string }>(
    'doc.create',
    args as Record<string, unknown>,
    async () => {
      if (!config.allowWrite) throw new Error('WRITE_DISABLED: EDITOR_MCP_ALLOW_WRITE=false，写操作被拒绝');
      const doc = makeDocument(args);
      const docId = safeName(args.docId?.trim() || `${doc.title}-${Date.now().toString(36)}`);
      if (!docId) throw new Error('IO_ERROR: 文档 id 不合法（安全化后为空）');
      // ★文档 id 必须等于文件名：commitDoc 是按 doc.id 回写的
      doc.id = docId;
      const file = await writeDocument(docId, doc);
      setCurrentDoc(docId);
      return { docId, path: file, mode: doc.mode, title: doc.title };
    },
    { changed: ['document'] },
  );
  if (!res.ok || !res.data?.docId) {
    return res.ok ? fail(ErrorCodes.IO_ERROR, 'doc.create 没有返回 docId') : (res as unknown as ToolResult<typeof emptyCreate>);
  }
  const d = res.data;
  setCurrentDoc(d.docId);
  const data = {
    docId: d.docId,
    ...(d.path ? { path: d.path } : {}),
    mode: d.mode ?? args.mode ?? 'document',
    title: d.title ?? args.title ?? '未命名文档',
    via: d.via,
    degraded: d.degraded,
  };
  return { ok: true, data, degraded: res.degraded, changed: ['document'] };
}

/** 仅用于上面的类型占位（保持失败分支的类型收窄） */
const emptyCreate = { docId: '', mode: '', title: '', via: '', degraded: true };

export const docOpenSchema = { docId: z.string().describe('要打开的文档 id') };

export async function docOpen(args: { docId: string }) {
  return viaBridge(
    'doc.open',
    args,
    async () => {
      const doc = await readDocument(args.docId); // 不存在会抛 DOC_NOT_FOUND
      setCurrentDoc(args.docId);
      return {
        docId: args.docId,
        title: doc.title,
        mode: doc.mode,
        nodes: (doc.document?.components?.length ?? 0) + (doc.web?.root?.children?.length ?? 0),
      };
    },
    { changed: [] },
  );
}

export const docCloseSchema = { docId: docIdParam };

export const docAttachSchema = {};

/**
 * doc.attach（阶段八）：把 MCP 会话的**当前文档**切到"编辑器里正在编辑的那一份"。
 *
 * 为什么需要它：编辑器**只有**它当前打开的那一份文档（`doc.get` 之类的 docId 若不是它，
 * Live 会如实拒绝并降级到无头，免得把别的文档内容当成结果返回）。而 MCP 会话的"当前文档"
 * 通常是 `doc.create` 在无头通道建的文档 —— 两者不是一回事。想用 MCP 改**用户正在编辑的文档**，
 * 就得先显式"接上"它；这个动作只读（只改 MCP 会话状态，不碰编辑器里的任何内容）。
 *
 * 编辑器未接入 → 如实报 `BRIDGE_OFFLINE`（不做无头降级：无头没有"编辑器当前文档"这个概念）。
 */
export async function docAttach() {
  const res = await liveOnly<{ docId: string; title?: string; mode?: string; counts?: Record<string, number> }>(
    'doc.attach',
    {},
  );
  if (res.ok && res.data?.docId) {
    setCurrentDoc(res.data.docId);
    log.info(`MCP 会话已接到编辑器当前文档：${res.data.docId}`);
    // 与其它 Tool 的返回形状保持一致：liveOnly 成功 = 走的就是 Live 通道
    return { ...res, data: { ...res.data, via: 'live' as const, degraded: false } };
  }
  return res;
}

/** doc.close：Live 时关闭编辑器里的文档；无头时只是把"当前文档"清掉 */
export async function docClose(args: { docId?: string }) {
  return viaBridge('doc.close', args, async () => {
    const id = args.docId ?? getCurrentDoc();
    if (getCurrentDoc() === id) setCurrentDoc(null);
    return { docId: id, closed: true };
  });
}

export const docListSchema = {
  limit: z.number().int().positive().max(200).default(50).describe('最多返回多少条'),
  offset: z.number().int().min(0).default(0).describe('跳过多少条'),
};

export async function docList(args: { limit?: number; offset?: number }) {
  return viaBridge('doc.list', args, async () => {
    const docs = await listDocuments(args.limit ?? 50, args.offset ?? 0);
    return { docs, current: getCurrentDoc(), workspace: config.workspace };
  });
}

export const docGetSchema = {
  docId: docIdParam,
  includeNodes: z.boolean().default(false).describe('是否连节点一起返回（默认只给骨架，避免返回体过大）'),
};

export async function docGet(args: { docId?: string; includeNodes?: boolean }) {
  return viaBridge('doc.get', args, async () => {
    const id = args.docId ?? getCurrentDoc();
    if (!id) throw new Error('DOC_NOT_FOUND: 当前没有打开的文档（先 doc.create / doc.open）');
    const doc = await readDocument(id);
    if (args.includeNodes) return { docId: id, document: doc };
    return {
      docId: id,
      title: doc.title,
      mode: doc.mode,
      page: doc.document?.page,
      canvas: doc.web?.canvas,
      counts: { documentNodes: doc.document?.components?.length ?? 0, webTop: doc.web?.root?.children?.length ?? 0 },
    };
  });
}

export const docRenameSchema = { docId: docIdParam, title: z.string().min(1).describe('新标题') };

export async function docRename(args: { docId?: string; title: string }) {
  return viaBridge(
    'doc.rename',
    args,
    async () => {
      const id = args.docId ?? getCurrentDoc();
      if (!id) throw new Error('DOC_NOT_FOUND: 当前没有打开的文档');
      const doc = await readDocument(id);
      doc.title = args.title;
      await commitDoc(doc);
      return { docId: id, title: doc.title };
    },
    { changed: ['title'] },
  );
}

// ★不用 z.literal(true)：那样缺 confirm 的请求会在**协议层**被 zod 拒掉，客户端拿不到
//   CONFIRM_REQUIRED 这个可编程的错误码。这里收 boolean，由 handler 返回结构化 CONFIRM_REQUIRED。
export const docDeleteSchema = { docId: docIdParam, confirm: z.boolean().default(false).describe('破坏性操作，必须显式传 true') };

export async function docDelete(args: { docId?: string; confirm?: boolean }) {
  return viaBridge(
    'doc.delete',
    args,
    async () => {
      const id = args.docId ?? getCurrentDoc();
      if (!id) throw new Error('DOC_NOT_FOUND: 当前没有打开的文档');
      if (args.confirm !== true) throw new Error('CONFIRM_REQUIRED: doc.delete 需要 confirm: true');
      const file = `${config.workspace}\\${id}.editor.json`;
      const fs = await import('node:fs/promises');
      await fs.rm(file, { force: true });
      if (getCurrentDoc() === id) setCurrentDoc(null);
      return { docId: id, deleted: true, path: file };
    },
    { changed: ['document'] },
  );
}

export const docDuplicateSchema = { docId: docIdParam, newDocId: z.string().optional().describe('新文档 id；缺省在原 id 后加 -copy') };

export async function docDuplicate(args: { docId?: string; newDocId?: string }) {
  return viaBridge(
    'doc.duplicate',
    args,
    async () => {
      const id = args.docId ?? getCurrentDoc();
      if (!id) throw new Error('DOC_NOT_FOUND: 当前没有打开的文档');
      const doc = await readDocument(id);
      const newId = safeName(args.newDocId ?? `${id}-copy`);
      doc.id = newId;
      const file = await writeDocument(newId, doc);
      return { docId: newId, from: id, path: file };
    },
    { changed: ['document'] },
  );
}

export const docSummarySchema = { docId: docIdParam };

export async function docSummaryTool(args: { docId?: string }) {
  return viaBridge('doc.summary', args, async () => {
    const id = args.docId ?? getCurrentDoc();
    if (!id) throw new Error('DOC_NOT_FOUND: 当前没有打开的文档');
    return docSummary(id);
  });
}

export { ok, fail, ErrorCodes };
