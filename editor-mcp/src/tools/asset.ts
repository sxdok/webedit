/**
 * 资产域 Tools：`asset.*`（2026-09-23 新增）。
 *
 * 解决一个真实痛点：**图片的 base64 不该经过模型上下文**。
 * 上一轮把 AGV 方案的 5 张图留成 `__AGVIMG1__` 占位符，理由就是"传 base64 太占 token"——
 * 但源 HTML 里这 5 张图本来就是内嵌 `data:image/...;base64`。让服务端自己读文件、自己把
 * data URL 写进节点，模型只看到"字节数/格式"这种小结果，就两边都不牺牲。
 *
 *   · `asset.embed { nodeId, path }`            —— 本地图片文件 → 该节点的 `src`（data URL）
 *   · `asset.embedFromHtml { htmlPath, ... }`   —— HTML 里的第 N 个内嵌图片 → 该节点（不给 nodeId 就只列出清单）
 *
 * 读写边界：
 *   · **读**允许调用方指定的本地路径（这是"把用户手上的图搬进来"的前提），但有：图片后缀白名单、
 *     体积上限（`EDITOR_MCP_ASSET_MAX_MB`，默认 20MB）、每次调用都记审计；
 *   · **写**仍然只允许工作区/插件目录（沿用 `assertInside`），新增的是"读到内存再通过属性写回"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { ok, runTool, type ToolResult } from '../errors.js';
import { log } from '../log.js';
import { propertySet } from './domains.js';

const IMAGE_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

function readImageFile(file: string): { dataUrl: string; bytes: number; mime: string } {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`IO_ERROR: 文件不存在 ${abs}`);
  const mime = IMAGE_EXT[path.extname(abs).toLowerCase()];
  if (!mime) throw new Error(`IO_ERROR: 不是支持的图片格式（${Object.keys(IMAGE_EXT).join('/')}）`);
  const buf = fs.readFileSync(abs);
  const max = config.assetMaxBytes;
  if (buf.length > max) {
    throw new Error(`IO_ERROR: 图片 ${(buf.length / 1024 / 1024).toFixed(1)}MB 超过上限 ${(max / 1024 / 1024).toFixed(0)}MB（改 EDITOR_MCP_ASSET_MAX_MB）`);
  }
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length, mime };
}

export const assetEmbedSchema = {
  nodeId: z.string().describe('要嵌图的节点 id（image 组件）'),
  path: z.string().describe('本地图片文件路径（png/jpg/jpeg/gif/webp/bmp/svg）'),
  docId: z.string().optional().describe('文档 id；缺省"当前文档"'),
  key: z.string().default('src').describe('写到哪个属性，默认 src（多图可写 images）'),
};

/** asset.embed：本地图片 → 节点属性（服务端完成 base64，不经过模型上下文） */
export async function assetEmbed(args: { nodeId: string; path: string; docId?: string; key?: string }) {
  return runTool('asset.embed', args, async () => {
    const { dataUrl, bytes, mime } = readImageFile(args.path);
    const r = await propertySet({
      id: args.nodeId,
      key: args.key ?? 'src',
      value: dataUrl,
      ...(args.docId ? { docId: args.docId } : {}),
    });
    if (!r.ok) return r as unknown as ToolResult<never>;
    log.info(`asset.embed：已把 ${path.basename(args.path)}（${(bytes / 1024).toFixed(0)}KB ${mime}）嵌进节点 ${args.nodeId}`);
    // ★回包只说"嵌好了 + 多大"，**不回传 base64 本身**
    return ok(
      { nodeId: args.nodeId, key: args.key ?? 'src', bytes, mime, dataUrlChars: dataUrl.length, via: r.data?.via, degraded: r.degraded },
      { changed: [args.key ?? 'src'] },
    );
  });
}

export const assetEmbedFromHtmlSchema = {
  htmlPath: z.string().describe('本地 HTML 文件路径（内含 data:image/... 的 <img>）'),
  index: z.number().int().min(0).optional().describe('取第几个内嵌图（0 基）；不给就只列出清单'),
  nodeId: z.string().optional().describe('要嵌进的 image 节点 id（给了 index 才生效）'),
  docId: z.string().optional().describe('文档 id；缺省"当前文档"'),
  key: z.string().default('src'),
};

/**
 * asset.embedFromHtml：从 HTML 里取出内嵌图片 → 嵌进节点。
 * 不给 `index`/`nodeId` 时只返回清单（序号 / mime / 字节数 / 附近 alt 与 figcaption），模型据此挑选要哪几张。
 */
export async function assetEmbedFromHtml(args: {
  htmlPath: string;
  index?: number;
  nodeId?: string;
  docId?: string;
  key?: string;
}) {
  // 两种返回形状（清单 / 嵌好一张）→ 用 unknown 收口，避免 SDK 泛型打架
  return runTool('asset.embedFromHtml', args, async (): Promise<ToolResult<Record<string, unknown>>> => {
    const abs = path.resolve(args.htmlPath);
    if (!fs.existsSync(abs)) throw new Error(`IO_ERROR: 文件不存在 ${abs}`);
    if (!/\.html?$/i.test(abs)) throw new Error('IO_ERROR: 只支持 .html/.htm');
    const html = fs.readFileSync(abs, 'utf8');
    const found: { index: number; mime: string; chars: number; alt: string; caption: string; dataUrl: string }[] = [];
    const re = /<img\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const src = m[1];
      if (!/^data:image\//i.test(src)) continue;
      const mime = /^data:([^;,]+)/.exec(src)?.[1] ?? 'image/*';
      const alt = /\balt\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? '';
      // 就近找 figcaption（同一 figure 或后面 200 字符内）
      const after = html.slice(m.index, m.index + 600);
      const cap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(after)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
      found.push({ index: found.length, mime, chars: src.length, alt, caption: cap, dataUrl: src });
    }
    if (!found.length) throw new Error('IO_ERROR: 这份 HTML 里没有内嵌（data:）图片');
    const list = found.map(({ dataUrl: _d, ...rest }) => rest);

    if (args.index == null || !args.nodeId) {
      return ok({ htmlPath: abs, inlineImages: found.length, list, note: '给出 index + nodeId 即可把这第 index 张嵌进该节点' });
    }
    const pick = found[args.index];
    if (!pick) throw new Error(`NODE_NOT_FOUND: index ${args.index} 超出范围（共 ${found.length} 张）`);
    const r = await propertySet({
      id: args.nodeId,
      key: args.key ?? 'src',
      value: pick.dataUrl,
      ...(args.docId ? { docId: args.docId } : {}),
    });
    if (!r.ok) return r as unknown as ToolResult<never>;
    log.info(`asset.embedFromHtml：已把第 ${args.index} 张内嵌图（${(pick.chars / 1024).toFixed(0)}KB base64）嵌进节点 ${args.nodeId}`);
    return ok(
      { nodeId: args.nodeId, key: args.key ?? 'src', index: args.index, mime: pick.mime, dataUrlChars: pick.chars, caption: pick.caption, via: r.data?.via, degraded: r.degraded },
      { changed: [args.key ?? 'src'] },
    );
  });
}
