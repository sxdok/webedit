/**
 * 模式域 / 页面域 / 画布域 / 属性域 Tools（规格 §5.2 / §5.3 / §5.4 / §5.7）。
 * 四个域都不长，合在一个文件里，避免碎片化。
 */
import fs from 'node:fs';
import { z } from 'zod';
import { readDocument } from '../bridge/headless.js';
import {
  addPageBreak,
  findNodeInDoc,
  getCurrentDoc,
  patchCanvas,
  patchPage,
  setCanvasDevice,
  setPageOrientation,
  setPageSize,
  updateNode,
} from '../engine/session.js';
import { config } from '../config.js';
import { viaBridge } from './helper.js';

const docIdParam = z.string().optional().describe('文档 id；缺省"当前文档"');
const withDoc = <T extends { docId?: string }>(args: T): T & { docId: string } => ({
  ...args,
  docId: args.docId ?? (getCurrentDoc() ?? ''),
});

/* ══════════════ 模式域 mode.* ══════════════ */

export const modeListSchema = {};

export async function modeList() {
  return viaBridge('mode.list', {}, async () => ({
    modes: [
      { id: 'document', label: '文档模式', desc: 'A4 纸张 + 文档流，自动分页' },
      { id: 'web', label: 'Web 模式', desc: '设备画布 + 绝对定位 + 容器嵌套' },
      { id: 'ppt', label: 'PPT 模式', desc: '幻灯片；当前编辑器把 PPT 组件作为"两种模式都能用"的类别，MCP 侧按文档流处理' },
    ],
  }));
}

export const modeGetSchema = { docId: docIdParam };

export async function modeGet(args: { docId?: string }) {
  const a = withDoc(args);
  return viaBridge('mode.get', a, async () => {
    const doc = await readDocument(a.docId);
    return { mode: doc.mode, docId: a.docId };
  });
}

export const modeSetSchema = {
  mode: z.enum(['document', 'web', 'ppt']).describe('目标模式；切换只改标记，两套内容都保留（编辑器语义）'),
  docId: docIdParam,
};

export async function modeSet(args: { mode: 'document' | 'web' | 'ppt'; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'mode.set',
    a,
    async () => {
      const doc = await readDocument(a.docId);
      doc.mode = a.mode;
      const { commitDoc } = await import('../engine/session.js');
      await commitDoc(doc);
      return { mode: doc.mode, docId: a.docId };
    },
    { changed: ['mode'] },
  );
}

/* ══════════════ 页面域 page.* ══════════════ */

export const pageGetSchema = { docId: docIdParam };

export async function pageGet(args: { docId?: string }) {
  const a = withDoc(args);
  return viaBridge('page.get', a, async () => {
    const doc = await readDocument(a.docId);
    return doc.document.page;
  });
}

export const pageSetSizeSchema = {
  size: z.enum(['A4', 'A3', 'A5', 'Letter', 'Legal', 'Custom']),
  width: z.number().positive().optional().describe('自定义宽度 mm（size=Custom 时用）'),
  height: z.number().positive().optional(),
  docId: docIdParam,
};

export async function pageSetSize(args: { size: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Custom'; width?: number; height?: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'page.setSize',
    a,
    async () => {
      const page = await setPageSize(a.docId, a.size, a.width, a.height);
      return { size: page.size, width: page.width, height: page.height };
    },
    { changed: ['page.size'] },
  );
}

export const pageSetOrientationSchema = { orientation: z.enum(['portrait', 'landscape']), docId: docIdParam };

export async function pageSetOrientation(args: { orientation: 'portrait' | 'landscape'; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'page.setOrientation',
    a,
    async () => {
      const page = await setPageOrientation(a.docId, a.orientation);
      return { orientation: page.orientation, width: page.width, height: page.height };
    },
    { changed: ['page.orientation'] },
  );
}

export const pageSetMarginSchema = {
  top: z.number().min(0).optional().describe('上边距 mm'),
  right: z.number().min(0).optional(),
  bottom: z.number().min(0).optional(),
  left: z.number().min(0).optional(),
  docId: docIdParam,
};

export async function pageSetMargin(args: { top?: number; right?: number; bottom?: number; left?: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'page.setMargin',
    a,
    async () => {
      const doc = await readDocument(a.docId);
      const cur = (doc.document.page as { margin?: Record<string, number> }).margin ?? {};
      const margin = {
        top: args.top ?? cur.top ?? 25.4,
        right: args.right ?? cur.right ?? 31.7,
        bottom: args.bottom ?? cur.bottom ?? 25.4,
        left: args.left ?? cur.left ?? 31.7,
      };
      const page = await patchPage(a.docId, { margin });
      return { margin: page.margin };
    },
    { changed: ['page.margin'] },
  );
}

export const pageSetStyleSchema = {
  defaultFont: z.string().optional().describe('默认字体，如 宋体/黑体/微软雅黑'),
  defaultFontSize: z.number().positive().optional().describe('默认字号 pt'),
  lineHeight: z.number().positive().optional().describe('行距倍数'),
  background: z.string().optional().describe('纸张底色，如 #ffffff'),
  showHeader: z.boolean().optional(),
  showFooter: z.boolean().optional(),
  docId: docIdParam,
};

export async function pageSetStyle(args: {
  defaultFont?: string;
  defaultFontSize?: number;
  lineHeight?: number;
  background?: string;
  showHeader?: boolean;
  showFooter?: boolean;
  docId?: string;
}) {
  const a = withDoc(args);
  const { docId: _d, ...patch } = a;
  void _d;
  return viaBridge(
    'page.setStyle',
    a as unknown as Record<string, unknown>,
    async () => {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const page = await patchPage(a.docId, clean);
      return {
        defaultFont: page.defaultFont,
        defaultFontSize: page.defaultFontSize,
        lineHeight: page.lineHeight,
        background: page.background,
      };
    },
    { changed: ['page.style'] },
  );
}

export const pageAddBreakSchema = { index: z.number().int().min(0).optional().describe('插入位置；缺省追加到文档末尾'), docId: docIdParam };

export async function pageAddBreak(args: { index?: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'page.addBreak',
    a,
    async () => {
      const r = await addPageBreak(a.docId, a.index);
      return { id: r.node.id, index: r.index, type: 'pageBreak' };
    },
    { changed: ['components'] },
  );
}

/* ══════════════ 画布域 canvas.* ══════════════ */

export const canvasGetSchema = { docId: docIdParam };

export async function canvasGet(args: { docId?: string }) {
  const a = withDoc(args);
  return viaBridge('canvas.get', a, async () => {
    const doc = await readDocument(a.docId);
    return doc.web.canvas;
  });
}

export const canvasSetDeviceSchema = {
  device: z.enum(['Desktop', 'Laptop', 'Tablet', 'Mobile', 'Custom']),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  docId: docIdParam,
};

export async function canvasSetDevice(args: { device: 'Desktop' | 'Laptop' | 'Tablet' | 'Mobile' | 'Custom'; width?: number; height?: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'canvas.setDevice',
    a,
    async () => {
      const c = await setCanvasDevice(a.docId, a.device, a.width, a.height);
      return { device: c.device, width: c.width, height: c.height };
    },
    { changed: ['canvas'] },
  );
}

export const canvasSetSizeSchema = { width: z.number().positive(), height: z.number().positive(), docId: docIdParam };

export async function canvasSetSize(args: { width: number; height: number; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'canvas.setSize',
    a,
    async () => {
      const c = await patchCanvas(a.docId, { width: a.width, height: a.height, device: 'Custom' });
      return { width: c.width, height: c.height, device: c.device };
    },
    { changed: ['canvas'] },
  );
}

export const canvasSetBackgroundSchema = { background: z.string().describe('画布底色，如 #ffffff'), docId: docIdParam };

export async function canvasSetBackground(args: { background: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('canvas.setBackground', a, async () => ({ background: (await patchCanvas(a.docId, { background: a.background })).background }), {
    changed: ['canvas'],
  });
}

export const canvasSetGridSchema = {
  show: z.boolean().describe('是否显示网格'),
  size: z.number().positive().optional().describe('网格尺寸 px'),
  snap: z.boolean().optional().describe('是否吸附到网格'),
  docId: docIdParam,
};

export async function canvasSetGrid(args: { show: boolean; size?: number; snap?: boolean; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'canvas.setGrid',
    a,
    async () => {
      const c = await patchCanvas(a.docId, {
        showGrid: a.show,
        ...(a.size != null ? { gridSize: a.size } : {}),
        ...(a.snap != null ? { snapToGrid: a.snap } : {}),
      });
      return { showGrid: c.showGrid, gridSize: c.gridSize, snapToGrid: c.snapToGrid };
    },
    { changed: ['canvas'] },
  );
}

export const canvasSetSafeAreaSchema = { enabled: z.boolean(), docId: docIdParam };

export async function canvasSetSafeArea(args: { enabled: boolean; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('canvas.setSafeArea', a, async () => ({ safeArea: (await patchCanvas(a.docId, { safeArea: a.enabled })).safeArea }), {
    changed: ['canvas'],
  });
}

/* ══════════════ 属性域 property.* ══════════════ */

const nodeIdParam = z.string().describe('节点 id');
const keyParam = z.string().describe('属性 key（与组件 schema 一致，如 text / fontSize / colWidths）');

export const propertyGetSchema = { id: nodeIdParam, key: keyParam, docId: docIdParam };

export async function propertyGet(args: { id: string; key: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('property.get', a, async () => {
    const doc = await readDocument(a.docId);
    const node = findNodeInDoc(doc, a.id);
    if (!node) throw new Error(`NODE_NOT_FOUND: 找不到节点 ${a.id}`);
    return { id: a.id, key: a.key, value: (node.props ?? {})[a.key] ?? null };
  });
}

export const propertySetSchema = {
  id: nodeIdParam,
  key: keyParam,
  value: z.unknown().describe('属性值（类型由组件 schema 决定）'),
  docId: docIdParam,
};

export async function propertySet(args: { id: string; key: string; value: unknown; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'property.set',
    a as unknown as Record<string, unknown>,
    async () => {
      const node = await updateNode(a.docId, a.id, { [a.key]: a.value });
      return { id: node.id, key: a.key, value: (node.props ?? {})[a.key] };
    },
    { changed: [a.key] },
  );
}

export const propertyBatchSetSchema = {
  id: nodeIdParam,
  patch: z.record(z.string(), z.unknown()).describe('要合并写入的多个属性'),
  docId: docIdParam,
};

export async function propertyBatchSet(args: { id: string; patch: Record<string, unknown>; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'property.batchSet',
    a,
    async () => {
      const node = await updateNode(a.docId, a.id, a.patch);
      return { id: node.id, props: node.props };
    },
    { changed: Object.keys(args.patch) },
  );
}

export const propertyResetSchema = { id: nodeIdParam, key: keyParam, docId: docIdParam };

export async function propertyReset(args: { id: string; key: string; docId?: string }) {
  const a = withDoc(args);
  return viaBridge(
    'property.reset',
    a,
    async () => {
      const doc = await readDocument(a.docId);
      const node = findNodeInDoc(doc, a.id);
      if (!node) throw new Error(`NODE_NOT_FOUND: 找不到节点 ${a.id}`);
      const defaults = readCatalogDefaults(node.type);
      if (defaults && a.key in defaults) {
        return { id: a.id, key: a.key, value: (await updateNode(a.docId, a.id, { [a.key]: defaults[a.key] })).props[a.key], source: 'catalog-default' };
      }
      delete (node.props ?? {})[a.key];
      const { commitDoc } = await import('../engine/session.js');
      await commitDoc(doc);
      return {
        id: a.id,
        key: a.key,
        value: null,
        source: 'deleted',
        note: '没有组件目录（component-catalog.json / 桥接），不知道注册表默认值，已改为删除该属性（编辑器打开时按默认值渲染）',
      };
    },
    { changed: [a.key] },
  );
}

export const propertyValidateSchema = {
  type: z.string().describe('组件类型'),
  key: keyParam,
  value: z.unknown(),
};

export async function propertyValidate(args: { type: string; key: string; value: unknown }) {
  return viaBridge('property.validate', args as unknown as Record<string, unknown>, async () => {
    const item = readCatalogSchema(args.type, args.key);
    if (!item) {
      return {
        valid: null,
        note: '没有该组件的 schema（未连桥接且工作区没有 component-catalog.json）→ 不做校验，也不假装通过',
      };
    }
    const problems: string[] = [];
    const t = item.control;
    if (t === 'number' || t === 'unit' || t === 'slider') {
      if (typeof args.value !== 'number' || Number.isNaN(args.value)) problems.push(`应为数字，收到 ${typeof args.value}`);
      else {
        if (item.min != null && args.value < item.min) problems.push(`小于最小值 ${item.min}`);
        if (item.max != null && args.value > item.max) problems.push(`大于最大值 ${item.max}`);
      }
    } else if (t === 'switch' && typeof args.value !== 'boolean') {
      problems.push(`应为布尔，收到 ${typeof args.value}`);
    } else if ((t === 'select' || t === 'font' || t === 'align') && Array.isArray(item.options)) {
      const allowed = item.options.map((o) => String((o as { value: unknown }).value));
      if (allowed.length && !allowed.includes(String(args.value))) problems.push(`不在可选值里：${allowed.join(' / ')}`);
    }
    return { valid: problems.length === 0, problems, schema: { type: t, min: item.min, max: item.max, unit: item.unit } };
  });
}

export const propertyHintSchema = { type: z.string(), key: keyParam };

export async function propertyHint(args: { type: string; key: string }) {
  return viaBridge('property.hint', args as unknown as Record<string, unknown>, async () => {
    const item = readCatalogSchema(args.type, args.key);
    if (!item) return { found: false, note: '没有组件目录，拿不到属性说明（连上桥接或导出 catalog 后可用）' };
    return { found: true, label: item.label, control: item.control, group: item.group, hint: item.hint, defaultValue: item.defaultValue };
  });
}

/* ── 组件目录（工作区 component-catalog.json）读取：属性域的校验/说明/默认值都依赖它 ── */

interface CatalogItem {
  key: string;
  label?: string;
  control?: string;
  group?: string;
  hint?: string;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  unit?: string;
  options?: unknown[];
}

interface Catalog {
  generatedAt?: string;
  components?: unknown[];
  /** 组件的默认 props：{ table: { cellPadding: 6, ... } } */
  defaults?: Record<string, Record<string, unknown>>;
  /** 组件的属性 schema：{ table: [{ key, label, control, ... }] } */
  schemas?: Record<string, CatalogItem[]>;
}

function readCatalog(): Catalog | null {
  const p = `${config.workspace}\\component-catalog.json`;
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Catalog;
  } catch {
    return null;
  }
}

function readCatalogDefaults(type: string): Record<string, unknown> | null {
  return readCatalog()?.defaults?.[type] ?? null;
}

function readCatalogSchema(type: string, key: string): CatalogItem | null {
  const items = readCatalog()?.schemas?.[type] ?? [];
  return items.find((i) => i.key === key) ?? null;
}
