/**
 * 无头引擎（Headless）：直接读写磁盘上的文档 JSON（规格 §4.2）。
 *
 * 文档格式与编辑器「文件 → 导出 JSON」**完全一致**（`EditorDocument`）：
 *   { id, title, mode, document: { page, components }, web: { canvas, root }, selectedIds }
 * 这样同一份文件既能被编辑器打开，也能被 MCP 无头读写。
 *
 * 阶段一只用得到"新建 / 读 / 写 / 列目录"；节点级操作在阶段二接入
 * （规格 §14：不要在 MCP 里重写业务逻辑，无头侧要复用同一份 reducer）。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, docFile } from '../config.js';
import { EditorMcpError, ErrorCodes } from '../errors.js';

export type EditorMode = 'document' | 'web' | 'ppt';

export interface ComponentNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: ComponentNode[];
  frame?: { x: number; y: number; w: number; h: number; rotation?: number };
  hidden?: boolean;
}

export interface EditorDocument {
  id: string;
  title: string;
  mode: EditorMode;
  document: { page: Record<string, unknown>; components: ComponentNode[] };
  web: { canvas: Record<string, unknown>; root: ComponentNode };
  selectedIds: string[];
}

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

/** 与编辑器 `createDefaultPageConfig()` 对齐（阶段二起抽到共享包，避免两处各写一份） */
export function defaultPage(size = 'A4'): Record<string, unknown> {
  const s = PAGE_SIZES[size] ?? PAGE_SIZES.A4;
  return {
    size,
    width: s.width,
    height: s.height,
    orientation: 'portrait',
    margin: { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 },
    background: '#ffffff',
    defaultFont: '宋体',
    defaultFontSize: 12,
    lineHeight: 1.5,
    showHeader: false,
    showFooter: true,
    header: { left: '', center: '', right: '', fontSize: 10.5, color: '#5b6472', showBorder: true, offset: 12.7 },
    footer: { left: '', center: '第 {page} 页 / 共 {total} 页', right: '', fontSize: 10.5, color: '#5b6472', showBorder: true, offset: 12.7 },
    numbering: { hideFirstPage: false, frontMatterPages: 0, bodyRestart: false, bodyStartPage: 1 },
  };
}

/** 与编辑器 `createDefaultCanvasConfig()` 对齐 */
export function defaultCanvas(device = 'Desktop'): Record<string, unknown> {
  const d = DEVICE_PRESETS[device] ?? DEVICE_PRESETS.Desktop;
  return {
    device,
    width: d.width,
    height: d.height,
    background: '#ffffff',
    showGrid: false,
    gridSize: 8,
    snapToGrid: true,
    safeArea: false,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** 新建一份与编辑器同构的空文档 */
export function makeDocument(opts: { title?: string; mode?: EditorMode; pageSize?: string; device?: string }): EditorDocument {
  const mode = opts.mode ?? 'document';
  return {
    id: newId('doc'),
    title: opts.title?.trim() || '未命名文档',
    mode,
    document: { page: defaultPage(opts.pageSize ?? 'A4'), components: [] },
    web: {
      canvas: defaultCanvas(opts.device ?? 'Desktop'),
      root: { id: newId('root'), type: 'root', props: {}, children: [] },
    },
    selectedIds: [],
  };
}

/** 原子写：先写 .tmp 再 rename，避免半写坏文件（规格 §4.2） */
export async function writeDocument(docId: string, doc: EditorDocument): Promise<string> {
  const file = docFile(docId);
  const tmp = `${file}.tmp`;
  await fsp.mkdir(config.workspace, { recursive: true });
  await fsp.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, file);
  return file;
}

export async function readDocument(docId: string): Promise<EditorDocument> {
  const file = docFile(docId);
  if (!fs.existsSync(file)) {
    throw new EditorMcpError(ErrorCodes.DOC_NOT_FOUND, `工作区里没有文档 ${docId}`, `可用 doc.list 查看；目录：${config.workspace}`);
  }
  const raw = await fsp.readFile(file, 'utf8');
  const parsed = JSON.parse(raw) as EditorDocument;
  if (!parsed || typeof parsed !== 'object' || !parsed.document || !parsed.web) {
    throw new EditorMcpError(ErrorCodes.IO_ERROR, `${docId}.editor.json 结构不合法（缺 document/web）`);
  }
  /**
   * ★把 `id` 统一成**文件名**。
   *   否则会出现"文件名是 A、JSON 里 id 是 B"，而 `commitDoc` 是按 `doc.id` 回写的 →
   *   改动被写进另一个文件、原文件永远是空的（真踩过：node.add 返回了 id，文档里却一个节点都没有）。
   *   顺手也自愈了从别处导入、id 与文件名不一致的文档。
   */
  if (parsed.id !== docId) parsed.id = docId;
  return parsed;
}

export interface DocSummary {
  docId: string;
  title: string;
  mode: string;
  bytes: number;
  mtime: number;
  nodes: number;
}

export async function listDocuments(limit = 100, offset = 0): Promise<DocSummary[]> {
  if (!fs.existsSync(config.workspace)) return [];
  const files = (await fsp.readdir(config.workspace)).filter((f) => f.endsWith('.editor.json'));
  const rows: DocSummary[] = [];
  for (const f of files) {
    const full = path.join(config.workspace, f);
    const st = await fsp.stat(full);
    let title = '(无法解析)';
    let mode = '?';
    let nodes = 0;
    try {
      const doc = JSON.parse(await fsp.readFile(full, 'utf8')) as EditorDocument;
      title = doc.title ?? title;
      mode = doc.mode ?? mode;
      nodes = (doc.document?.components?.length ?? 0) + (doc.web?.root?.children?.length ?? 0);
    } catch {
      /* 坏文件也要列出来，但标注无法解析 */
    }
    rows.push({ docId: f.replace(/\.editor\.json$/, ''), title, mode, bytes: st.size, mtime: Math.round(st.mtimeMs), nodes });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows.slice(offset, offset + limit);
}
