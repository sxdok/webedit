/**
 * 插件域 Tools：plugin.*（规格 §5.12，20 个）—— **重点域**：外部组件（插件）能力的全覆盖。
 *
 * 能力分组：
 *   · 文件：list / get / create（生成骨架并进清单）/ update（覆盖前自动备份，保留最近 N 个）/
 *           patch（按锚点局部替换）/ delete / rename / import（URL 或本地文件）/ export
 *   · 校验：validate（语法 + 契约 + live 前缀）/ dryRun（vm 沙箱执行 + React SSR 出 HTML）/ deps
 *   · 清单：manifest.get / set / add / remove（`public/组件/_manifest.json`，编辑器热加载的退化清单）
 *   · 辅助：template（4 种骨架）/ types（契约声明，给 AI 对齐）/ logs（插件 console 环形缓冲）/
 *           reload（编辑器在线时触发重载；不在线只更新磁盘并如实提示）
 *
 * 安全（规格 §10）：写操作只允许落在插件目录内（`assertInside` 思路：解析后必须是目录内文件），
 * delete/rename 要 `confirm: true`，写开关 `ALLOW_WRITE=false` 由 `runTool` 统一拦（见 errors.ts）。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { ErrorCodes, fail, ok, runTool, type ToolResult } from '../errors.js';
import { log } from '../log.js';
import { dryRunPlugin, pluginLogs, pushPluginLog, validatePluginSource } from '../engine/pluginSandbox.js';
import { liveOnly } from './helper.js';

/* ══════════════ 目录 / 清单 基础 ══════════════ */

const MANIFEST = '_manifest.json';

function dir(): string {
  return config.pluginDir;
}

/** 解析插件文件路径并做目录白名单校验（规格 §10「拒绝 ../ 与绝对路径」） */
function pluginFile(name: string): string {
  const clean = name.replace(/\.js$/, '');
  const full = path.resolve(dir(), `${clean}.js`);
  const rel = path.relative(dir(), full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`PATH_NOT_ALLOWED: 只允许操作插件目录 ${dir()} 下的文件（收到 ${name}）`);
  }
  return full;
}

export function manifestPath(): string {
  return path.join(dir(), MANIFEST);
}

async function readManifest(): Promise<string[]> {
  const p = manifestPath();
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(await fsp.readFile(p, 'utf8')) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
    const files = (parsed as { files?: unknown })?.files;
    return Array.isArray(files) ? files.map(String) : [];
  } catch {
    return [];
  }
}

async function writeManifest(list: string[]): Promise<string> {
  await fsp.mkdir(dir(), { recursive: true });
  const uniq = [...new Set(list)];
  await fsp.writeFile(manifestPath(), `${JSON.stringify(uniq, null, 2)}\n`, 'utf8');
  return manifestPath();
}

/** 备份：`<name>.js.bak.<时间戳>`，只保留最近 N 个（规格 §5.12 / §10） */
async function backup(file: string): Promise<string | null> {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const target = `${file}.bak.${stamp}`;
  await fsp.copyFile(file, target);
  const all = (await fsp.readdir(dir())).filter((f) => f.startsWith(`${path.basename(file)}.bak.`)).sort();
  const keep = Math.max(1, config.backupKeep);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    await fsp.rm(path.join(dir(), old), { force: true });
    log.debug(`清理旧备份：${old}`);
  }
  return target;
}

async function readPlugin(name: string): Promise<{ file: string; source: string }> {
  const file = pluginFile(name);
  if (!fs.existsSync(file)) throw new Error(`PLUGIN_NOT_FOUND: 插件目录里没有 ${path.basename(file)}`);
  return { file, source: await fsp.readFile(file, 'utf8') };
}

/* ══════════════ 模板（plugin.template / plugin.create） ══════════════ */

export type TemplateKind = 'basic' | 'form' | 'chart' | 'container';

function header(type: string, label: string, category: string, modes: string, desc: string): string {
  // ★编辑器真实的 window.EditorKit **只暴露 React**（没有 reactJsxRuntime，规格 §7.2/§7.3 与实现不一致）
  //   → 模板统一用 React.createElement；下面这行别名只是让代码读起来像 jsx。
  return `(function () {
  const K = window.EditorKit;
  const React = K.React;
  const jsx = React.createElement; // 经典签名 jsx(type, props, ...children)，与 createElement 等价

  window.EditorKit.register({
    type: '${type}',
    label: '${label}',
    category: '${category}',
    supportedModes: ${modes},
    icon: ({ className }) => jsx('span', { className }, '◆'),
    description: '${desc}',
`;
}

export function templateSource(kind: TemplateKind, opts: { type: string; label: string; category?: string; modes?: string[] }): string {
  const { type, label } = opts;
  const category = opts.category ?? '通用';
  const modes = JSON.stringify(opts.modes ?? ['document', 'web']);
  const desc = `【外部热加载】${label}`;
  const props = (items: string): string => `    defaultProps: {\n${items}\n    },\n`;
  const schema = (items: string): string => `    propSchema: [\n${items}\n    ],\n`;

  if (kind === 'form') {
    return (
      header(type, label, category, modes, desc) +
      props(`      title: '${label}',\n      fields: '姓名 | 电话 | 部门',\n      labelWidth: 84,\n      border: true,`) +
      schema(
        [
          `      { key: 'title', label: '标题', control: 'text', group: '内容', defaultValue: '${label}' },`,
          `      { key: 'fields', label: '字段（每行一条，用 | 分列）', control: 'textarea', group: '内容', defaultValue: '姓名 | 电话 | 部门' },`,
          `      { key: 'labelWidth', label: '标签宽度（px）', control: 'number', group: '尺寸', defaultValue: 84, min: 40, max: 200 },`,
          `      { key: 'border', label: '显示边框', control: 'switch', group: '外观', defaultValue: true },`,
        ].join('\n'),
      ) +
      `    render(props) {
      const rows = String(props.fields || '').split('\\n').filter(Boolean).map((line) => line.split('|').map((s) => s.trim()));
      return jsx('div', { style: { border: props.border ? '1px solid #d9dde3' : 'none', borderRadius: 6, overflow: 'hidden' } },
        jsx('div', { style: { background: '#e8f1f9', padding: '6px 10px', fontWeight: 600 } }, String(props.title || '')),
        ...rows.map((cells, i) => jsx('div', { key: i, style: { display: 'flex', borderTop: '1px solid #eef2f6' } },
          jsx('div', { style: { width: Number(props.labelWidth) || 84, padding: '6px 10px', color: '#5b6472', background: '#fafcfe' } }, cells[0] || ''),
          jsx('div', { style: { flex: 1, padding: '6px 10px' } }, cells.slice(1).join(' / ')),
        )),
      );
    },
  });
})();
`
    );
  }

  if (kind === 'chart') {
    return (
      header(type, label, category, modes, desc) +
      props(`      items: '一月|120\\n二月|180\\n三月|150',\n      height: 140,\n      color: '#1677ff',`) +
      schema(
        [
          `      { key: 'items', label: '数据（每行一条，名称|数值）', control: 'textarea', group: '内容', defaultValue: '一月|120\\n二月|180\\n三月|150' },`,
          `      { key: 'height', label: '高度（px）', control: 'number', group: '尺寸', defaultValue: 140, min: 60, max: 400 },`,
          `      { key: 'color', label: '柱色', control: 'color', group: '外观', defaultValue: '#1677ff' },`,
        ].join('\n'),
      ) +
      `    render(props) {
      const rows = String(props.items || '').split('\\n').map((l) => l.split('|')).filter((r) => r.length >= 1 && r[0].trim());
      const max = Math.max(1, ...rows.map((r) => Number(r[1]) || 0));
      const h = Number(props.height) || 140;
      return jsx('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 12, height: h } },
        ...rows.map((r, i) => {
          const v = Number(r[1]) || 0;
          return jsx('div', { key: i, style: { flex: 1, textAlign: 'center' } },
            jsx('div', { style: { fontSize: 11, color: '#5b6472' } }, String(v)),
            jsx('div', { style: { height: Math.round((v / max) * (h - 32)), background: String(props.color || '#1677ff'), borderRadius: 3 } }),
            jsx('div', { style: { fontSize: 11, color: '#5b6472' } }, String(r[0]).trim()),
          );
        }),
      );
    },
  });
})();
`
    );
  }

  if (kind === 'container') {
    return (
      header(type, label, category, modes, desc) +
      `    isContainer: true,\n` +
      props(`      title: '${label}',\n      padding: 12,\n      background: '#ffffff',\n      borderColor: '#e5e7eb',`) +
      schema(
        [
          `      { key: 'title', label: '标题', control: 'text', group: '内容', defaultValue: '${label}' },`,
          `      { key: 'padding', label: '内边距（px）', control: 'number', group: '尺寸', defaultValue: 12, min: 0, max: 48 },`,
          `      { key: 'background', label: '背景', control: 'color', group: '外观', defaultValue: '#ffffff' },`,
          `      { key: 'borderColor', label: '边框色', control: 'color', group: '外观', defaultValue: '#e5e7eb' },`,
          `      { key: 'children', label: '子组件', control: 'children', group: '高级', defaultValue: null },`,
        ].join('\n'),
      ) +
      `    render(props, ctx, children) {
      // ★容器必须把第三个参数 children 放进自己的 DOM（规格 §3.1/§8.1），否则子组件不显示
      return jsx('div', { style: { padding: Number(props.padding) || 12, background: String(props.background), border: '1px solid ' + String(props.borderColor), borderRadius: 8 } },
        props.title ? jsx('div', { style: { fontWeight: 600, marginBottom: 8 } }, String(props.title)) : null,
        children ?? null,
      );
    },
  });
})();
`
    );
  }

  return (
    header(type, label, category, modes, desc) +
    props(`      text: '${label} 的默认文字',\n      fontSize: 12,\n      color: '#1f2329',\n      background: '#e8f1f9',`) +
    schema(
      [
        `      { key: 'text', label: '文字', control: 'textarea', group: '内容', defaultValue: '${label} 的默认文字' },`,
        `      { key: 'fontSize', label: '字号（pt）', control: 'unit', group: '排版', defaultValue: 12, unit: 'pt', min: 6, max: 36 },`,
        `      { key: 'color', label: '文字色', control: 'color', group: '排版', defaultValue: '#1f2329' },`,
        `      { key: 'background', label: '底色', control: 'color', group: '外观', defaultValue: '#e8f1f9' },`,
      ].join('\n'),
    ) +
    `    render(props) {
      return jsx('div', {
        style: {
          padding: '8px 12px',
          borderRadius: 6,
          background: String(props.background),
          color: String(props.color),
          fontSize: Number(props.fontSize) || 12,
        },
      }, String(props.text || ''));
    },
  });
})();
`
  );
}

/* ══════════════ 扫描（plugin.list / validate 共用） ══════════════ */

export interface PluginEntry {
  name: string;
  file: string;
  bytes: number;
  mtime: number;
  inManifest: boolean;
  hasRegister: boolean;
  type?: string;
  label?: string;
  category?: string;
  supportedModes?: string[];
  backups: number;
  status: 'ok' | 'invalid';
  problems: string[];
}

export interface PluginScan {
  dir: string;
  manifestFile: string | null;
  manifest: string[];
  entries: PluginEntry[];
}

export async function scanPlugins(): Promise<PluginScan> {
  const d = dir();
  const manifest = await readManifest();
  const manifestFile = fs.existsSync(manifestPath()) ? manifestPath() : null;
  if (!fs.existsSync(d)) return { dir: d, manifestFile, manifest, entries: [] };
  const all = await fsp.readdir(d);
  const sources = all.filter((f) => f.endsWith('.js'));
  const backups = all.filter((f) => /\.js\.bak\./.test(f));

  const entries: PluginEntry[] = [];
  for (const f of sources) {
    const full = path.join(d, f);
    const st = await fsp.stat(full);
    const source = await fsp.readFile(full, 'utf8');
    const v = validatePluginSource(source);
    entries.push({
      name: f.replace(/\.js$/, ''),
      file: full,
      bytes: st.size,
      mtime: Math.round(st.mtimeMs),
      inManifest: manifest.includes(f),
      hasRegister: v.callsRegister,
      ...v.sniffed,
      backups: backups.filter((b) => b.startsWith(f)).length,
      status: v.ok ? 'ok' : 'invalid',
      problems: v.problems.filter((p) => p.level === 'error').map((p) => `${p.code}: ${p.message}`),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { dir: d, manifestFile, manifest, entries };
}

/* ══════════════ Tools ══════════════ */

export const pluginListSchema = { includeInvalid: z.boolean().default(true).describe('是否包含校验不通过的插件（默认包含，便于修复）') };

export async function pluginList(args: { includeInvalid?: boolean }): Promise<ToolResult<unknown>> {
  return runTool('plugin.list', args, async () => {
    const scan = await scanPlugins();
    const shown = args.includeInvalid === false ? scan.entries.filter((e) => e.status === 'ok') : scan.entries;
    return ok({
      dir: scan.dir,
      manifestFile: scan.manifestFile,
      total: shown.length,
      ok: scan.entries.filter((e) => e.status === 'ok').length,
      invalid: scan.entries.filter((e) => e.status === 'invalid').length,
      notInManifest: scan.entries.filter((e) => !e.inManifest).map((e) => `${e.name}.js`),
      plugins: shown,
    });
  });
}

export const pluginGetSchema = { name: z.string().describe('插件名（文件名去掉 .js）'), withSource: z.boolean().default(true).describe('是否连源码一起返回') };

export async function pluginGet(args: { name: string; withSource?: boolean }) {
  return runTool('plugin.get', args, async () => {
    const { file, source } = await readPlugin(args.name);
    const st = await fsp.stat(file);
    const v = validatePluginSource(source);
    return ok({
      name: path.basename(file, '.js'),
      file,
      bytes: st.size,
      mtime: Math.round(st.mtimeMs),
      inManifest: (await readManifest()).includes(path.basename(file)),
      validate: { ok: v.ok, syntaxOk: v.syntaxOk, problems: v.problems },
      ...(args.withSource === false ? {} : { source }),
    });
  });
}

export const pluginCreateSchema = {
  name: z.string().describe('插件名（文件名，建议英文/数字/短横线；type 会自动加 live 前缀）'),
  label: z.string().describe('左侧面板显示名'),
  category: z.enum(['Word 常用', 'Excel 表格', 'PPT 专用', '通用', '布局分页', 'Web 控件', 'Web 容器']).default('通用'),
  supportedModes: z.array(z.enum(['document', 'web', 'ppt'])).default(['document', 'web']),
  kind: z.enum(['basic', 'form', 'chart', 'container']).default('basic').describe('骨架类型'),
  type: z.string().optional().describe('组件 type（缺省 live + 驼峰化的 name）'),
  overwrite: z.boolean().default(false).describe('已存在时是否覆盖（覆盖会先备份）'),
};

export async function pluginCreate(args: {
  name: string;
  label: string;
  category?: string;
  supportedModes?: string[];
  kind?: TemplateKind;
  type?: string;
  overwrite?: boolean;
}) {
  return runTool('plugin.create', args as unknown as Record<string, unknown>, async () => {
    const base = args.name.replace(/\.js$/, '').replace(/[^\w-]/g, '-');
    if (!base) return fail(ErrorCodes.IO_ERROR, 'name 不合法（清洗后为空）');
    const type = args.type?.trim() || `live${base.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase())}`;
    if (!type.startsWith('live')) {
      return fail(ErrorCodes.PLUGIN_TYPE_PREFIX, `type「${type}」必须以 live 开头`, '外部组件用 live 前缀与内置组件隔离（规格 §7.2）');
    }
    const file = pluginFile(base);
    if (fs.existsSync(file) && args.overwrite !== true) {
      return fail(ErrorCodes.IO_ERROR, `${path.basename(file)} 已存在`, '要么换个 name，要么传 overwrite: true（会先自动备份）');
    }
    await fsp.mkdir(dir(), { recursive: true });
    const backupPath = fs.existsSync(file) ? await backup(file) : null;
    const source = templateSource((args.kind ?? 'basic') as TemplateKind, {
      type,
      label: args.label,
      category: args.category ?? '通用',
      modes: (args.supportedModes ?? ['document', 'web']) as string[],
    });
    await fsp.writeFile(file, source, 'utf8');
    const manifest = await readManifest();
    const fileName = path.basename(file);
    const added = !manifest.includes(fileName);
    if (added) await writeManifest([...manifest, fileName]);
    const v = validatePluginSource(source);
    return ok({
      name: base,
      type,
      file,
      bytes: Buffer.byteLength(source, 'utf8'),
      inManifest: true,
      addedToManifest: added,
      backup: backupPath,
      validate: { ok: v.ok, problems: v.problems },
    });
  });
}

export const pluginUpdateSchema = { name: z.string(), source: z.string().describe('新的完整源码（覆盖前自动备份）') };

export async function pluginUpdate(args: { name: string; source: string }) {
  return runTool('plugin.update', args, async () => {
    const file = pluginFile(args.name);
    const existed = fs.existsSync(file);
    const backupPath = existed ? await backup(file) : null;
    await fsp.mkdir(dir(), { recursive: true });
    await fsp.writeFile(file, args.source, 'utf8');
    const manifest = await readManifest();
    const fileName = path.basename(file);
    if (!manifest.includes(fileName)) await writeManifest([...manifest, fileName]);
    const v = validatePluginSource(args.source);
    return ok({
      name: path.basename(file, '.js'),
      file,
      bytes: Buffer.byteLength(args.source, 'utf8'),
      backup: backupPath,
      validate: { ok: v.ok, problems: v.problems },
    });
  });
}

export const pluginPatchSchema = {
  name: z.string(),
  find: z.string().describe('要被替换的原文（必须唯一，避免改错位置）'),
  replace: z.string().describe('替换成的内容'),
};

export async function pluginPatch(args: { name: string; find: string; replace: string }) {
  return runTool('plugin.patch', args, async () => {
    const { file, source } = await readPlugin(args.name);
    const hits = source.split(args.find).length - 1;
    if (hits === 0) return fail(ErrorCodes.PLUGIN_CONTRACT_ERROR, '没找到要替换的原文（find）');
    if (hits > 1) return fail(ErrorCodes.PLUGIN_CONTRACT_ERROR, `原文出现 ${hits} 次，无法唯一定位（请给更长的上下文）`);
    const next = source.replace(args.find, args.replace);
    const backupPath = await backup(file);
    await fsp.writeFile(file, next, 'utf8');
    const v = validatePluginSource(next);
    return ok({ name: path.basename(file, '.js'), bytes: Buffer.byteLength(next, 'utf8'), backup: backupPath, validate: { ok: v.ok, problems: v.problems } });
  });
}

export const pluginDeleteSchema = {
  name: z.string(),
  confirm: z.boolean().default(false).describe('删除不可逆，必须显式传 true'),
  keepBackup: z.boolean().default(true).describe('删除前是否留一份备份'),
};

export async function pluginDelete(args: { name: string; confirm?: boolean; keepBackup?: boolean }) {
  return runTool('plugin.delete', args, async () => {
    if (args.confirm !== true) return fail(ErrorCodes.CONFIRM_REQUIRED, 'plugin.delete 需要 confirm: true');
    const file = pluginFile(args.name);
    if (!fs.existsSync(file)) return fail(ErrorCodes.PLUGIN_NOT_FOUND, `插件目录里没有 ${path.basename(file)}`);
    const backupPath = args.keepBackup === false ? null : await backup(file);
    await fsp.rm(file, { force: true });
    const fileName = path.basename(file);
    const manifest = await readManifest();
    if (manifest.includes(fileName)) await writeManifest(manifest.filter((f) => f !== fileName));
    return ok({ name: path.basename(file, '.js'), deleted: true, backup: backupPath });
  });
}

export const pluginRenameSchema = { name: z.string(), newName: z.string(), confirm: z.boolean().default(false).describe('重命名会同步改清单，传 true 确认') };

export async function pluginRename(args: { name: string; newName: string; confirm?: boolean }) {
  return runTool('plugin.rename', args, async () => {
    if (args.confirm !== true) return fail(ErrorCodes.CONFIRM_REQUIRED, 'plugin.rename 需要 confirm: true');
    const from = pluginFile(args.name);
    const to = pluginFile(args.newName);
    if (!fs.existsSync(from)) return fail(ErrorCodes.PLUGIN_NOT_FOUND, `插件目录里没有 ${path.basename(from)}`);
    if (fs.existsSync(to)) return fail(ErrorCodes.IO_ERROR, `${path.basename(to)} 已存在`);
    await fsp.rename(from, to);
    const manifest = await readManifest();
    await writeManifest([...manifest.filter((f) => f !== path.basename(from)), path.basename(to)]);
    return ok({ from: path.basename(from), to: path.basename(to), manifestUpdated: true });
  });
}

export const pluginValidateSchema = {
  name: z.string().optional().describe('插件名；不传则校验目录里所有插件'),
  source: z.string().optional().describe('直接给源码校验（不读文件）'),
};

export async function pluginValidate(args: { name?: string; source?: string }): Promise<ToolResult<unknown>> {
  // ★显式给 runTool<unknown>：这个 Tool 三个分支返回的数据结构不同，交给 TS 推断会收窄成一个分支
  return runTool<unknown>('plugin.validate', args, async () => {
    if (args.source != null) return ok({ source: 'inline', ...validatePluginSource(args.source) });
    if (args.name) {
      const { file, source } = await readPlugin(args.name);
      return ok({ name: path.basename(file, '.js'), ...validatePluginSource(source) });
    }
    const scan = await scanPlugins();
    const results = await Promise.all(
      scan.entries.map(async (e) => {
        const src = await fsp.readFile(e.file, 'utf8');
        const v = validatePluginSource(src);
        return { name: e.name, ok: v.ok, problems: v.problems };
      }),
    );
    return ok({ dir: scan.dir, total: results.length, failed: results.filter((r) => !r.ok).length, results });
  });
}

export const pluginDryRunSchema = {
  name: z.string().optional().describe('插件名（读文件）'),
  source: z.string().optional().describe('直接给源码（不读文件）'),
  props: z.record(z.string(), z.unknown()).optional().describe('覆盖默认属性的入参，用来试不同取值'),
};

export async function pluginDryRun(args: { name?: string; source?: string; props?: Record<string, unknown> }) {
  return runTool('plugin.dryRun', args as unknown as Record<string, unknown>, async () => {
    const name = args.name ?? '(inline)';
    let source = args.source;
    if (source == null) {
      if (!args.name) return fail(ErrorCodes.PLUGIN_NOT_FOUND, 'dryRun 需要 name 或 source 之一');
      source = (await readPlugin(args.name)).source;
    }
    const sink = { push: (line: string) => pushPluginLog(name, line) };
    const r = dryRunPlugin(source, args.props, sink);
    if (!r.ok) {
      return fail(r.error?.code ?? ErrorCodes.PLUGIN_DRYRUN_FAILED, r.error?.message ?? 'dryRun 失败', `durationMs=${r.durationMs}`);
    }
    return ok({ name, def: r.def, html: r.html, htmlBytes: r.html?.length ?? 0, logs: r.logs, durationMs: r.durationMs });
  });
}

export const pluginManifestGetSchema = {};

export async function pluginManifestGet() {
  return runTool('plugin.manifest.get', {}, async () =>
    ok({ file: manifestPath(), exists: fs.existsSync(manifestPath()), files: await readManifest(), dir: dir() }),
  );
}

export const pluginManifestSetSchema = { list: z.array(z.string()).describe('完整清单（文件名数组，会去重）') };

export async function pluginManifestSet(args: { list: string[] }) {
  return runTool('plugin.manifest.set', args, async () => {
    const missing = args.list.filter((f) => !fs.existsSync(path.join(dir(), f)));
    const file = await writeManifest(args.list);
    return ok({
      file,
      count: [...new Set(args.list)].length,
      missingFiles: missing,
      ...(missing.length ? { note: '这些文件在插件目录里不存在（清单可以有它，但编辑器加载时会失败）' } : {}),
    });
  });
}

export const pluginManifestAddSchema = { name: z.string() };

export async function pluginManifestAdd(args: { name: string }) {
  return runTool('plugin.manifest.add', args, async () => {
    const fileName = `${args.name.replace(/\.js$/, '')}.js`;
    if (!fs.existsSync(path.join(dir(), fileName))) return fail(ErrorCodes.PLUGIN_NOT_FOUND, `插件目录里没有 ${fileName}`);
    const list = await readManifest();
    if (list.includes(fileName)) return ok({ file: manifestPath(), added: false, count: list.length });
    const file = await writeManifest([...list, fileName]);
    return ok({ file, added: true, count: list.length + 1 });
  });
}

export const pluginManifestRemoveSchema = { name: z.string() };

export async function pluginManifestRemove(args: { name: string }) {
  return runTool('plugin.manifest.remove', args, async () => {
    const fileName = `${args.name.replace(/\.js$/, '')}.js`;
    const list = await readManifest();
    if (!list.includes(fileName)) return ok({ file: manifestPath(), removed: false, count: list.length });
    const file = await writeManifest(list.filter((f) => f !== fileName));
    return ok({ file, removed: true, count: list.length - 1 });
  });
}

export const pluginTemplateSchema = {
  kind: z.enum(['basic', 'form', 'chart', 'container']).describe('骨架类型'),
  name: z.string().default('myWidget'),
  label: z.string().default('我的组件'),
  category: z.string().default('通用'),
};

export async function pluginTemplate(args: { kind: TemplateKind; name?: string; label?: string; category?: string }) {
  return runTool('plugin.template', args as unknown as Record<string, unknown>, async () => {
    const name = args.name ?? 'myWidget';
    const type = `live${name.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase())}`;
    const source = templateSource(args.kind, { type, label: args.label ?? '我的组件', category: args.category ?? '通用' });
    return ok({
      kind: args.kind,
      type,
      source,
      bytes: Buffer.byteLength(source, 'utf8'),
      hint: '把 source 交给 plugin.update 落盘；或直接用 plugin.create 一步生成',
    });
  });
}

export const pluginTypesSchema = {};

/** 契约声明（给 AI 对齐用）：与编辑器 registry/types.ts 的字段一一对应 */
const CONTRACT = `// 可视化编辑器 · 外部组件契约（外部插件只能用 JS + window.EditorKit，不能用 TS/JSX/import）
interface ComponentDefinition {
  type: string;              // 唯一 key，外部组件必须以 live 开头（如 liveNotice）
  label: string;             // 左侧面板显示名
  category: string;          // 'Word 常用' | 'Excel 表格' | 'PPT 专用' | '通用' | '布局分页' | 'Web 控件' | 'Web 容器'
  supportedModes: ('document' | 'web' | 'ppt')[];
  icon: (props: { className?: string }) => any;   // 用 jsx('span') 或内联 SVG，不能 import lucide-react
  description?: string;
  isContainer?: boolean;     // true 时 render 会收到第三个参数 children，必须把它放进自己的 DOM
  defaultProps: Record<string, unknown>;
  propSchema: PropSchemaItem[];
  render(props: Record<string, unknown>, ctx: RenderContext, children?: any): any;
}

interface PropSchemaItem {
  key: string;               // 属性 key（写进 node.props）
  label: string;             // 面板显示名：'主名（说明）' —— 说明只在悬停气泡里显示
  control: 'text' | 'textarea' | 'richtext' | 'number' | 'slider' | 'color' | 'select'
         | 'switch' | 'align' | 'font' | 'spacing' | 'edge' | 'image' | 'unit' | 'frame'
         | 'children' | 'cells' | 'tableSize' | 'tableHtml';
  group: string;             // '内容' | '排版' | '外观' | '尺寸' | '布局' | '高级' | '表格' | '单元格'
  defaultValue: unknown;
  options?: { label: string; value: string | number }[];
  min?: number; max?: number; step?: number;
  unit?: 'mm' | 'px' | 'pt' | '%';
  placeholder?: string;
  visibleWhen?: (props: Record<string, unknown>, ctx: RenderContext) => boolean;
}

interface RenderContext {
  mode: 'document' | 'web' | 'ppt';
  page?: { defaultFont: string; defaultFontSize: number; lineHeight: number };  // 文档模式
  canvas?: { width: number; height: number };                                   // Web 模式
  isEditing: boolean;
  isSelected: boolean;
  mmToPx(mm: number): number;
  ptToPx(pt: number): number;
}

// 注册方式（文件放在 <编辑器>/public/组件/ 下，改完点「重载外部组件」即生效）
(function () {
  const React = window.EditorKit.React;   // ★编辑器只暴露 React（没有 reactJsxRuntime）
  window.EditorKit.register({ /* ComponentDefinition */ });
})();

// ── 表格类插件：直接用编辑器暴露的**表格内核**，就有和内置「表格」一样的单元格逻辑 ──
//    renderTable(props, ctx)                 → 渲染真实 table（带 data-cell 标记，可点选/拖选单元格）
//    tableSchema(二维数组, variant, opts)     → 表格属性 schema（含「单元格格式」「行 / 列数量」两个控件）
//    parseTableData / serializeTableData / escapeCell / parseCellStyles / parseColWidths
//    ★表格内容以**单元格**为主：schema 里没有「数据」整块文本属性，
//      默认内容要自己给 defaultProps.data = serializeTableData(rows)（'\\|' 格内竖线、'\\n' 格内换行、A1 格式键）
(function () {
  const K = window.EditorKit;
  const DATA = [['参数', '方案 A', '方案 B'], ['载重', '1000kg', '1500kg']];
  K.register({
    type: 'liveCompareTable', label: '对比表', category: 'Excel 表格', supportedModes: ['document', 'web'],
    icon: 'Table', defaultProps: Object.assign(K.defaultsOf(K.tableSchema(DATA, 'hLines')), { data: K.serializeTableData(DATA) }),
    propSchema: K.tableSchema(DATA, 'hLines'),
    render: (props, ctx) => K.renderTable(props, ctx),
  });
})();
`;

export async function pluginTypes() {
  return runTool('plugin.types', {}, async () =>
    ok({
      contract: CONTRACT,
      notes: [
        '外部插件在浏览器里**直接执行**：没有 require / process / fs / fetch，也不能用 import；请用 window.EditorKit。',
        'type 必须以 live 开头，否则编辑器会拒绝注册（避免顶掉内置组件）。',
        "想用图标：jsx('span', { className }, '★') 或内联 SVG，不能 import lucide-react。",
        '容器组件必须把 render 的第三个参数 children 放进自己的 DOM，否则子组件不显示。',
        '表格类插件用 EditorKit.renderTable + tableSchema 渲染/取 schema，即可获得与内置表格一致的**单元格编辑**（点选一格改内容、行/列数量增删）；表格内容不再有整块「数据」属性，默认内容用 defaultProps.data = serializeTableData(rows)。',
      ],
    }),
  );
}

export const pluginLogsSchema = { name: z.string().optional().describe('只看某个插件的日志'), since: z.number().optional().describe('只看这个时间戳（毫秒）之后的') };

export async function pluginLogsTool(args: { name?: string; since?: number }) {
  return runTool('plugin.logs', args, async () => {
    const entries = pluginLogs(args.name, args.since);
    return ok({
      count: entries.length,
      entries,
      note: '这里收集的是 **MCP 侧**执行插件时的 console 输出（validate/dryRun，环形缓冲 500 条）；编辑器运行时的插件日志要连桥接后由它提供。',
    });
  });
}

export const pluginDepsSchema = { name: z.string(), source: z.string().optional() };

export async function pluginDeps(args: { name: string; source?: string }) {
  return runTool('plugin.deps', args, async () => {
    const source = args.source ?? (await readPlugin(args.name)).source;
    const helpers = ['React', 'createElement', 'jsx', 'defaultsOf', 'boxStyle', 'typographyStyle', 'alignOf', 'spacingCss', 'icon', 'mmToPx', 'ptToPx'].filter((h) =>
      new RegExp(`(K|EditorKit)\\s*\\.\\s*${h}\\b`).test(source),
    );
    const hooks = ['useState', 'useEffect', 'useMemo', 'useRef', 'useCallback'].filter((h) => new RegExp(`\\b${h}\\b`).test(source));
    const forbidden = ['require(', 'process.', 'fs.', 'fetch(', 'import '].filter((f) => source.includes(f));
    const lucide = /lucide-react/.test(source);
    return ok({
      name: args.name,
      bytes: Buffer.byteLength(source, 'utf8'),
      editorKitHelpers: helpers,
      reactHooks: hooks,
      forbidden,
      lucideImport: lucide,
      verdict: forbidden.length || lucide ? '有沙箱里不存在的依赖，插件会加载失败' : '只依赖 window.EditorKit，符合外部组件约束',
      ...(hooks.length ? { note: '外部组件的 render 应是纯函数（编辑器会频繁重渲染）；确有状态需求请确认编辑器版本支持。' } : {}),
    });
  });
}

export const pluginImportSchema = {
  source: z.string().describe('URL（http/https）或本地文件绝对路径'),
  name: z.string().describe('导入后的插件名（不含 .js）'),
  overwrite: z.boolean().default(false),
};

export async function pluginImport(args: { source: string; name: string; overwrite?: boolean }) {
  return runTool('plugin.import', args, async () => {
    let text: string;
    let origin: string;
    if (/^https?:\/\//i.test(args.source)) {
      const res = await fetch(args.source);
      if (!res.ok) return fail(ErrorCodes.IO_ERROR, `下载失败：HTTP ${res.status}`);
      text = await res.text();
      origin = `url:${args.source}`;
    } else {
      const p = path.resolve(args.source);
      if (!fs.existsSync(p)) return fail(ErrorCodes.IO_ERROR, `本地文件不存在：${p}`);
      text = await fsp.readFile(p, 'utf8');
      origin = `file:${p}`;
    }
    const v0 = validatePluginSource(text);
    if (!v0.ok) {
      return fail(
        ErrorCodes.PLUGIN_CONTRACT_ERROR,
        `导入的内容不是合格的外部组件：${v0.problems.filter((p) => p.level === 'error').map((p) => p.message).join('；')}`,
      );
    }
    const file = pluginFile(args.name);
    if (fs.existsSync(file) && args.overwrite !== true) {
      return fail(ErrorCodes.IO_ERROR, `${path.basename(file)} 已存在`, '传 overwrite: true 覆盖（会先备份）');
    }
    await fsp.mkdir(dir(), { recursive: true });
    const backupPath = fs.existsSync(file) ? await backup(file) : null;
    await fsp.writeFile(file, text, 'utf8');
    const manifest = await readManifest();
    const fileName = path.basename(file);
    if (!manifest.includes(fileName)) await writeManifest([...manifest, fileName]);
    return ok({ name: path.basename(file, '.js'), file, origin, bytes: Buffer.byteLength(text, 'utf8'), backup: backupPath });
  });
}

export const pluginExportSchema = { name: z.string(), path: z.string().optional().describe('导出到工作区下的相对路径；缺省返回源码') };

export async function pluginExport(args: { name: string; path?: string }): Promise<ToolResult<unknown>> {
  return runTool<unknown>('plugin.export', args, async () => {
    const { file, source } = await readPlugin(args.name);
    if (!args.path) return ok({ name: path.basename(file, '.js'), bytes: Buffer.byteLength(source, 'utf8'), source });
    const { assertInside } = await import('../config.js');
    const out = assertInside(config.workspace, args.path);
    await fsp.writeFile(out, source, 'utf8');
    return ok({ name: path.basename(file, '.js'), path: out, bytes: Buffer.byteLength(source, 'utf8') });
  });
}

export const pluginReloadSchema = { name: z.string().optional().describe('只重载某个插件；缺省重载全部') };

/** reload：编辑器在线时让它重新加载（编辑器侧的菜单/按钮走同一个函数）；否则只提示需手动重载 */
export async function pluginReload(args: { name?: string }) {
  const live = await liveOnly<{ reloaded?: number; types?: string[] }>('plugin.reload', args as unknown as Record<string, unknown>);
  if (live.ok) return live;
  const scan = await scanPlugins();
  return ok(
    {
      dir: scan.dir,
      files: scan.entries.map((e) => `${e.name}.js`),
      note: '编辑器不在线：磁盘上的插件已是最新，但**需要你在编辑器里点「重载外部组件」**（开启 MCP 桥接后本工具可直接触发）。',
    },
    { degraded: true },
  );
}
