/**
 * 组件注册表域 Tools：component.*（规格 §5.6）+ 历史 / 选择 / 导出域（§5.9~§5.11）。
 *
 * 注册表的**唯一真源是编辑器**（44 个内置组件的 label/category/schema/defaults 都在它的注册表里）。
 * 没连桥接时，退到工作区的 `component-catalog.json`（编辑器可导出；格式见下），
 * 两者都没有就**如实说缺什么**，不编造组件清单。
 *
 *   component-catalog.json = {
 *     "generatedAt": "...",
 *     "components": [{ type, label, category, supportedModes, description }],
 *     "defaults":   { "<type>": { ...defaultProps } },
 *     "schemas":    { "<type>": [{ key, label, control, group, defaultValue, min, max, unit, options, hint }] }
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { ok } from '../errors.js';
import { readDocument } from '../bridge/headless.js';
import { clearHistory, getCurrentDoc, getSelection, historyInfo, redo, setSelection, undo } from '../engine/session.js';
import { viaBridge, liveOnly } from './helper.js';

const docIdParam = z.string().optional().describe('文档 id；缺省"当前文档"');
const withDoc = <T extends { docId?: string }>(args: T): T & { docId: string } => ({
  ...args,
  docId: args.docId ?? (getCurrentDoc() ?? ''),
});

/* ══════════════ 组件目录读取 ══════════════ */

export interface CatalogComponent {
  type: string;
  label: string;
  category: string;
  supportedModes: string[];
  description?: string;
  source?: string;
}

interface Catalog {
  generatedAt?: string;
  components?: CatalogComponent[];
  defaults?: Record<string, Record<string, unknown>>;
  schemas?: Record<string, Record<string, unknown>[]>;
}

export function catalogPath(): string {
  return path.join(config.workspace, 'component-catalog.json');
}

export function readCatalog(): Catalog | null {
  const p = catalogPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Catalog;
  } catch {
    return null;
  }
}

/** 组件目录缺失时的统一提示（各 Tool 通过抛 `BRIDGE_OFFLINE: ...` 走同一条路） */
export function catalogHint(tool: string): string {
  return `${tool} 需要组件注册表，但当前既没连编辑器、工作区也没有 component-catalog.json。两种办法：①编辑器菜单「帮助 → 开启 MCP 桥接」；②把组件目录导出为 component-catalog.json 放到工作区。`;
}

/* ══════════════ component.* ══════════════ */

export const componentGetSchema = { type: z.string().describe('组件类型 key，如 table / heading'), docId: docIdParam };

export async function componentGet(args: { type: string }) {
  return viaBridge('component.get', args as unknown as Record<string, unknown>, async () => {
    const cat = readCatalog();
    const meta = cat?.components?.find((c) => c.type === args.type);
    if (!meta) throw new Error(`COMPONENT_NOT_FOUND: 组件目录里没有 ${args.type}`);
    return { ...meta, defaults: cat?.defaults?.[args.type] ?? null, schemaCount: cat?.schemas?.[args.type]?.length ?? 0 };
  });
}

export const componentSchemaSchema = { type: z.string(), docId: docIdParam };

export async function componentSchema(args: { type: string }) {
  return viaBridge('component.schema', args as unknown as Record<string, unknown>, async () => {
    const cat = readCatalog();
    if (!cat) throw new Error('BRIDGE_OFFLINE: 没有组件目录（component-catalog.json）');
    const items = cat.schemas?.[args.type];
    if (!items) throw new Error(`COMPONENT_NOT_FOUND: 组件目录里没有 ${args.type} 的属性 schema`);
    return { type: args.type, count: items.length, schema: items };
  });
}

export const componentCategoriesSchema = { mode: z.enum(['document', 'web', 'ppt']).optional() };

export async function componentCategories(args: { mode?: 'document' | 'web' | 'ppt' }) {
  return viaBridge('component.categories', args as unknown as Record<string, unknown>, async () => {
    const cat = readCatalog();
    if (!cat) throw new Error('BRIDGE_OFFLINE: 没有组件目录');
    const list = (cat.components ?? []).filter((c) => !args.mode || (c.supportedModes ?? []).includes(args.mode));
    const counts = new Map<string, number>();
    list.forEach((c) => counts.set(c.category, (counts.get(c.category) ?? 0) + 1));
    return { categories: [...counts.entries()].map(([name, count]) => ({ name, count })), total: list.length };
  });
}

export const componentDefaultsSchema = { type: z.string() };

export async function componentDefaultsTool(args: { type: string }) {
  return viaBridge('component.defaults', args as unknown as Record<string, unknown>, async () => {
    const cat = readCatalog();
    const d = cat?.defaults?.[args.type];
    if (!d) throw new Error(`COMPONENT_NOT_FOUND: 没有 ${args.type} 的默认属性（组件目录缺失或该组件没导出 defaults）`);
    return { type: args.type, defaults: d };
  });
}

export const componentSearchSchema = { query: z.string().describe('模糊搜索：匹配 type / label / category / description'), limit: z.number().int().positive().max(100).default(20) };

export async function componentSearch(args: { query: string; limit?: number }) {
  return viaBridge('component.search', args as unknown as Record<string, unknown>, async () => {
    const cat = readCatalog();
    if (!cat) throw new Error('BRIDGE_OFFLINE: 没有组件目录');
    const q = args.query.toLowerCase();
    const hits = (cat.components ?? []).filter((c) =>
      [c.type, c.label, c.category, c.description ?? ''].some((v) => String(v).toLowerCase().includes(q)),
    );
    return { query: args.query, total: hits.length, hits: hits.slice(0, args.limit ?? 20) };
  });
}

/** 把组件目录写进工作区（供编辑器侧导出，或测试用）；只允许写在 workspace 下 */
export async function writeCatalog(cat: Catalog): Promise<string> {
  const p = catalogPath();
  fs.mkdirSync(config.workspace, { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...cat }, null, 2)}\n`, 'utf8');
  return p;
}

export const componentCatalogSchema = {
  path: z.string().optional().describe('落盘路径（相对 workspace，缺省 component-catalog.json）'),
  save: z.boolean().default(true).describe('是否把快照写进工作区（写进去之后，编辑器不在线时 component.* / export.spec 也能用）'),
};

/**
 * component.catalog：把编辑器的**完整注册表快照**（组件清单 + 默认属性 + 属性 schema）取回来并落盘。
 * ★这条是离线能力的"上游"：没有它，工作区里的 component-catalog.json 没有任何产生途径，
 *   编辑器一关，component.get('table') / export.spec 就只剩"没有组件目录"。
 */
export async function componentCatalog(args: { path?: string; save?: boolean }) {
  return viaBridge<{ components?: CatalogComponent[]; defaults?: Record<string, Record<string, unknown>>; schemas?: Record<string, Record<string, unknown>[]>; counts?: Record<string, number> }>(
    'component.catalog',
    args as Record<string, unknown>,
    async () => {
      const cat = readCatalog();
      if (!cat) throw new Error(`BRIDGE_OFFLINE: ${catalogHint('component.catalog')}`);
      return {
        components: cat.components ?? [],
        defaults: cat.defaults ?? {},
        schemas: cat.schemas ?? {},
        counts: { total: cat.components?.length ?? 0 },
        fromFile: catalogPath(),
      };
    },
  ).then(async (res) => {
    if (!res.ok || !res.data || args.save === false) return res;
    const { components, defaults, schemas, counts } = res.data;
    if (!components?.length) return res; // 空快照不覆盖已有目录
    const target = args.path ?? 'component-catalog.json';
    const { assertInside } = await import('../config.js');
    const out = assertInside(config.workspace, target);
    const fsMod = await import('node:fs/promises');
    await fsMod.mkdir(path.dirname(out), { recursive: true });
    await fsMod.writeFile(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), components, defaults, schemas }, null, 2)}\n`, 'utf8');
    return ok({ ...res.data, path: out, saved: true, counts, note: `已写入 ${out}（编辑器不在线时 component.* 会读它）` });
  });
}

/* ══════════════ history.*（§5.9）══════════════ */

export const historyUndoSchema = { docId: docIdParam, steps: z.number().int().min(1).max(50).default(1) };

export async function historyUndo(args: { docId?: string; steps?: number }) {
  const a = withDoc(args);
  return viaBridge(
    'history.undo',
    a,
    async () => {
      const doc = undo(a.docId, a.steps ?? 1);
      if (!doc) throw new Error('IO_ERROR: 无头模式下这个文档还没有快照可撤销（快照在每次写操作时生成）');
      const { writeDocument } = await import('../bridge/headless.js');
      await writeDocument(a.docId, doc);
      return { docId: a.docId, ...historyInfo(a.docId), nodes: (doc.document?.components?.length ?? 0) + (doc.web?.root?.children?.length ?? 0) };
    },
    { changed: ['document'] },
  );
}

export const historyRedoSchema = { docId: docIdParam, steps: z.number().int().min(1).max(50).default(1) };

export async function historyRedo(args: { docId?: string; steps?: number }) {
  const a = withDoc(args);
  return viaBridge(
    'history.redo',
    a,
    async () => {
      const doc = redo(a.docId, a.steps ?? 1);
      if (!doc) throw new Error('IO_ERROR: 没有可重做的快照');
      const { writeDocument } = await import('../bridge/headless.js');
      await writeDocument(a.docId, doc);
      return { docId: a.docId, ...historyInfo(a.docId) };
    },
    { changed: ['document'] },
  );
}

export const historySnapshotSchema = { docId: docIdParam, label: z.string().optional().describe('快照标签（无头模式下仅记录在返回里）') };

export async function historySnapshot(args: { docId?: string; label?: string }) {
  const a = withDoc(args);
  return viaBridge('history.snapshot', a, async () => {
    const doc = await readDocument(a.docId);
    const { pushSnapshot } = await import('../engine/session.js');
    pushSnapshot(doc);
    return { docId: a.docId, label: args.label ?? null, ...historyInfo(a.docId) };
  });
}

export const historyRestoreSchema = { docId: docIdParam, snapshotId: z.number().int().min(0).describe('快照序号（history.stack 里给的下标）') };

export async function historyRestore(args: { docId?: string; snapshotId: number }) {
  const a = withDoc(args);
  return viaBridge(
    'history.restore',
    a,
    async () => {
      const { restoreSnapshot } = await import('../engine/session.js');
      const doc = restoreSnapshot(a.docId, args.snapshotId);
      if (!doc) throw new Error('IO_ERROR: 快照序号不存在');
      return { docId: a.docId, restored: args.snapshotId, ...historyInfo(a.docId) };
    },
    { changed: ['document'] },
  );
}

export const historyClearSchema = { docId: docIdParam, confirm: z.boolean().default(false).describe('清空历史是不可逆的，必须显式传 true') };

export async function historyClear(args: { docId?: string; confirm?: boolean }) {
  const a = withDoc(args);
  return viaBridge(
    'history.clear',
    a,
    async () => {
      if (args.confirm !== true) throw new Error('CONFIRM_REQUIRED: history.clear 需要 confirm: true');
      clearHistory(a.docId);
      return { docId: a.docId, cleared: true };
    },
    { changed: [] },
  );
}

export const historyStackSchema = { docId: docIdParam };

export async function historyStack(args: { docId?: string }) {
  const a = withDoc(args);
  return viaBridge('history.stack', a, async () => ({ docId: a.docId, ...historyInfo(a.docId), note: '无头快照栈：每次写操作自动压栈，上限 50 步（编辑器的历史栈由编辑器自己管）' }));
}

/* ══════════════ selection.*（§5.10）══════════════ */

export const selectionGetSchema = { docId: docIdParam };

export async function selectionGet(args: { docId?: string }) {
  const a = withDoc(args);
  return viaBridge('selection.get', a, async () => {
    const sel = getSelection();
    const mine = !sel.docId || sel.docId === a.docId;
    return {
      ids: mine ? sel.ids : [],
      docId: sel.docId,
      note: mine ? undefined : '选择属于另一个文档；无头模式下选择只是服务端记住的最近一次',
    };
  });
}

export const selectionSetSchema = { ids: z.array(z.string()).describe('要选中的节点 id'), docId: docIdParam };

export async function selectionSet(args: { ids: string[]; docId?: string }) {
  const a = withDoc(args);
  return viaBridge('selection.set', a, async () => {
    setSelection(a.docId, args.ids);
    return { ids: args.ids, note: '无头模式下仅服务端记录（编辑器在线时会同步到画布选中并 scrollIntoView）' };
  });
}

export const selectionClearSchema = { docId: docIdParam };

export async function selectionClear(args: { docId?: string }) {
  const a = withDoc(args);
  return viaBridge('selection.clear', a, async () => {
    setSelection(a.docId, []);
    return { ids: [] };
  });
}

export const selectionFocusSchema = { id: z.string(), docId: docIdParam };

/** selection.focus 需要浏览器视口 → 只有 Live 有意义 */
export async function selectionFocus(args: { id: string; docId?: string }) {
  return liveOnly('selection.focus', args as unknown as Record<string, unknown>);
}

/* ══════════════ export.*（§5.11）══════════════ */

export const exportJsonSchema = {
  docId: docIdParam,
  path: z.string().optional().describe('相对 workspace 的输出文件名；缺省返回内容不落盘'),
};

export async function exportJson(args: { docId?: string; path?: string }) {
  const a = withDoc(args);
  const r = await viaBridge('export.json', a, async () => {
    const doc = await readDocument(a.docId);
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    if (!a.path) return { docId: a.docId, bytes: text.length, json: text };
    const { assertInside } = await import('../config.js');
    const fsMod = await import('node:fs/promises');
    const out = assertInside(config.workspace, a.path);
    await fsMod.writeFile(out, text, 'utf8');
    return { docId: a.docId, bytes: text.length, path: out };
  });

  /**
   * ★`{path}` 的语义要**与通道无关**：Live 侧是浏览器，写不了工作区里的任意路径，
   *   它只回 JSON 文本 —— 那就由 MCP 这一侧补写盘。否则同一个 Tool 在"编辑器开着"时
   *   会静默不落盘（阶段八端到端就是这么发现的：文件节点数 = -1）。
   */
  const data = r.data as { docId?: string; bytes?: number; json?: string; path?: string } | null;
  if (a.path && data && typeof data.json === 'string' && !data.path) {
    const { assertInside } = await import('../config.js');
    const fsMod = await import('node:fs/promises');
    const out = assertInside(config.workspace, a.path);
    await fsMod.writeFile(out, data.json, 'utf8');
    return { ...r, data: { ...data, path: out, bytes: data.json.length } };
  }
  return r;
}

export const exportHtmlSchema = { docId: docIdParam, path: z.string().optional(), inlineAssets: z.boolean().default(true) };
export const exportReactSchema = { docId: docIdParam, path: z.string().optional(), componentName: z.string().default('ExportedDocument') };
export const exportPdfSchema = { docId: docIdParam, path: z.string().optional() };
export const exportSpecSchema = { path: z.string().optional() };

/** 导出 HTML / React / PDF：只有编辑器里实现（浏览器渲染 + 打印），无头老实报 BRIDGE_OFFLINE */
export async function exportHtml(args: { docId?: string; path?: string; inlineAssets?: boolean }) {
  return liveOnly('export.html', { ...args, docId: args.docId ?? getCurrentDoc() ?? undefined });
}

export async function exportReact(args: { docId?: string; path?: string; componentName?: string }) {
  return liveOnly('export.react', { ...args, docId: args.docId ?? getCurrentDoc() ?? undefined });
}

export async function exportPdf(args: { docId?: string; path?: string }) {
  return liveOnly('export.pdf', { ...args, docId: args.docId ?? getCurrentDoc() ?? undefined });
}

/** 说明清单：Live 走编辑器（与「帮助 → 导出说明清单」一致）；无头用组件目录生成精简版并标注差异 */
export async function exportSpec(args: { path?: string }) {
  const live = await liveOnly<{ path?: string; markdown?: string; bytes?: number }>('export.spec', args);
  if (live.ok) return live;
  const cat = readCatalog();
  if (!cat) return live; // 桥接也没有、目录也没有 → 如实返回 BRIDGE_OFFLINE
  const md = [
    '# 组件与属性说明清单（由 component-catalog.json 生成 · 精简版）',
    '',
    `> 生成时间：${new Date().toISOString()}；来源：${catalogPath()}`,
    '> 与编辑器「帮助 → 导出组件与属性说明清单」相比，这里只有目录里带的信息（缺面板状态等运行时描述）。',
    '',
    ...(cat.components ?? []).flatMap((c) => {
      const items = cat.schemas?.[c.type] ?? [];
      return [
        `## ${c.label}　\`${c.type}\``,
        `- 分类：${c.category}；模式：${(c.supportedModes ?? []).join(' / ')}`,
        `- 说明：${c.description ?? '—'}`,
        ...(items.length
          ? ['', '| 属性 | key | 控件 | 默认值 | 说明 |', '|---|---|---|---|---|', ...items.map((i) => `| ${String(i.label ?? '')} | \`${String(i.key ?? '')}\` | ${String(i.control ?? '')} | ${String(i.defaultValue ?? '—').slice(0, 20)} | ${String(i.hint ?? '—')} |`)]
          : ['', '（目录里没有该组件的属性 schema）']),
        '',
      ];
    }),
  ].join('\n');
  if (!args.path) return ok({ markdown: md, bytes: md.length, source: 'catalog' });
  const { assertInside } = await import('../config.js');
  const fsMod = await import('node:fs/promises');
  const out = assertInside(config.workspace, args.path);
  await fsMod.writeFile(out, md, 'utf8');
  return ok({ path: out, bytes: md.length, source: 'catalog' });
}
