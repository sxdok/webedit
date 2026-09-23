/**
 * 插件域 Tool：plugin.*（规格 §5.12）——**重点域**。
 *
 * 阶段一只实现 `plugin.list`（外加内部复用的 `scanPlugins`），其余 19 个 Tool
 * （create/update/patch/delete/rename/validate/reload/dryRun/manifest/template/types/logs/deps/import/export）
 * 按规格在阶段五补齐。
 *
 * `plugin.list` 现在就是**真的**：直接扫插件目录，逐个判断
 *   · 是否在 manifest 里（编辑器热加载清单：`_manifest.json`，兼容 `manifest.json`）
 *   · 是否调用了 `window.EditorKit.register`（外部组件契约）
 *   · 是否声明了 `live` 前缀的 type（编辑器侧已强制，规格 §7.2）
 *   · 备份文件个数（plugin.update 会生成 `<name>.js.bak.<时间戳>`）
 * 并给出 status：ok / invalid / missing。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { ok, runTool, type ToolResult } from '../errors.js';

export const pluginListSchema = {
  includeInvalid: z.boolean().default(true).describe('是否包含校验不通过的插件（默认包含，便于 AI 修复）'),
};

export interface PluginEntry {
  name: string;
  file: string;
  bytes: number;
  mtime: number;
  inManifest: boolean;
  hasRegister: boolean;
  /** 源码里声明的 type（能识别出来才有） */
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

const MANIFEST_CANDIDATES = ['_manifest.json', 'manifest.json'];

/** 读编辑器用的热加载清单（两个名字都认） */
async function readManifest(dir: string): Promise<{ file: string | null; list: string[] }> {
  for (const name of MANIFEST_CANDIDATES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as unknown;
      const list = Array.isArray(parsed)
        ? (parsed as string[])
        : Array.isArray((parsed as { files?: string[] })?.files)
          ? ((parsed as { files: string[] }).files ?? [])
          : [];
      return { file, list };
    } catch {
      return { file, list: [] };
    }
  }
  return { file: null, list: [] };
}

/** 从源码里粗略取字段：静态正则即可（阶段五的 plugin.validate 会换成 acorn + vm 沙箱做真校验） */
function sniff(source: string): Pick<PluginEntry, 'type' | 'label' | 'category' | 'supportedModes'> {
  const pick = (key: string): string | undefined => {
    const m = source.match(new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`));
    return m?.[1];
  };
  const modes = source.match(/supportedModes\s*:\s*\[([^\]]*)\]/)?.[1];
  const parsedModes = modes
    ? [...modes.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1])
    : undefined;
  return {
    type: pick('type'),
    label: pick('label'),
    category: pick('category'),
    ...(parsedModes ? { supportedModes: parsedModes } : {}),
  };
}

/** 扫描插件目录（plugin.* 与 component.list 共用） */
export async function scanPlugins(): Promise<PluginScan> {
  const dir = config.pluginDir;
  const { file: manifestFile, list: manifest } = await readManifest(dir);
  if (!fs.existsSync(dir)) return { dir, manifestFile, manifest, entries: [] };

  const all = await fsp.readdir(dir);
  const sources = all.filter((f) => f.endsWith('.js'));
  const backups = all.filter((f) => /\.js\.bak\./.test(f));

  const entries: PluginEntry[] = [];
  for (const f of sources) {
    const full = path.join(dir, f);
    const st = await fsp.stat(full);
    const source = await fsp.readFile(full, 'utf8');
    const sniffed = sniff(source);
    const hasRegister = /EditorKit\s*\.\s*register|window\s*\.\s*EditorKit/.test(source);
    const problems: string[] = [];
    if (!hasRegister) problems.push('没有调用 window.EditorKit.register（外部组件必须通过它注册）');
    if (!sniffed.type) problems.push('没有声明 type');
    else if (!sniffed.type.startsWith('live')) problems.push(`type「${sniffed.type}」未以 live 开头（编辑器会拒绝注册）`);
    if (!/render\s*[:(]/.test(source)) problems.push('没有 render 函数');

    entries.push({
      name: f.replace(/\.js$/, ''),
      file: full,
      bytes: st.size,
      mtime: Math.round(st.mtimeMs),
      inManifest: manifest.includes(f),
      hasRegister,
      ...sniffed,
      backups: backups.filter((b) => b.startsWith(f)).length,
      status: problems.length ? 'invalid' : 'ok',
      problems,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { dir, manifestFile, manifest, entries };
}

export async function pluginList(args: { includeInvalid?: boolean }): Promise<
  ToolResult<{
    dir: string;
    manifestFile: string | null;
    total: number;
    ok: number;
    invalid: number
    notInManifest: string[];
    plugins: PluginEntry[];
  }>
> {
  return runTool('plugin.list', args, async () => {
    const scan = await scanPlugins();
    const shown = args.includeInvalid === false ? scan.entries.filter((e) => e.status === 'ok') : scan.entries;
    return ok(
      {
        dir: scan.dir,
        manifestFile: scan.manifestFile,
        total: shown.length,
        ok: scan.entries.filter((e) => e.status === 'ok').length,
        invalid: scan.entries.filter((e) => e.status === 'invalid').length,
        notInManifest: scan.entries.filter((e) => !e.inManifest).map((e) => `${e.name}.js`),
        plugins: shown,
      },
      { changed: [] },
    );
  });
}
