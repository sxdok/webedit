/**
 * 文档域 Tool：doc.*（规格 §5.1）。
 *
 * 阶段一只实现 `doc.create`（规格「阶段一：注册 3 个 Tool：doc.create / component.list / plugin.list」），
 * 其余 doc.* 在阶段三补齐；这里已经把它接到**无头引擎**上，所以现在就能真正产出可被编辑器打开的文档。
 *
 * 降级语义（规格 §二）：Live Bridge 在阶段二接入；当前一律走无头，返回 `degraded: true`。
 */
import { z } from 'zod';
import { ok, ErrorCodes, fail, runTool, type ToolResult } from '../errors.js';
import { config, safeName } from '../config.js';
import { listDocuments, makeDocument, writeDocument } from '../bridge/headless.js';
import { withBridge } from '../bridge/fallback.js';

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
}): Promise<ToolResult<{ docId: string; path?: string; mode: string; title: string; via: string }>> {
  return runTool('doc.create', args, async () => {
    // ① 先试 Live（编辑器实例）；② 不可用则无头写盘（规格 §二 的降级策略）
    const res = await withBridge<{ docId: string; path?: string; mode?: string; title?: string }>(
      'doc.create',
      args as Record<string, unknown>,
      async () => {
        if (!config.allowWrite) {
          throw new Error('WRITE_DISABLED: EDITOR_MCP_ALLOW_WRITE=false，写操作被拒绝');
        }
        const doc = makeDocument(args);
        const docId = safeName(args.docId?.trim() || `${doc.title}-${Date.now().toString(36)}`);
        if (!docId) throw new Error('IO_ERROR: 文档 id 不合法（安全化后为空）');
        const file = await writeDocument(docId, doc);
        return { docId, path: file, mode: doc.mode, title: doc.title };
      },
    );
    const d = res.data;
    if (!d?.docId) return fail(ErrorCodes.IO_ERROR, 'doc.create 没有返回 docId', `via=${res.via}`);
    return ok(
      { docId: d.docId, ...(d.path ? { path: d.path } : {}), mode: d.mode ?? args.mode ?? 'document', title: d.title ?? args.title ?? '未命名文档', via: res.via },
      { degraded: res.degraded, changed: ['document'] },
    );
  });
}

/** doc.list 的实现在阶段三暴露为 Tool；先给阶段一/二内部复用 */
export async function listWorkspace(limit = 100, offset = 0) {
  return listDocuments(limit, offset);
}
