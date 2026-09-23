/**
 * 组件注册表域 Tool：component.*（规格 §5.6）。
 *
 * 阶段一只实现 `component.list`。**数据来源要说清楚**（很重要，否则会误导客户端）：
 *   ① Live Bridge（阶段二/八接入）：编辑器是注册表的唯一真源，48 个内置组件只有它知道；
 *   ② 工作区里的 `component-catalog.json`：编辑器「帮助 → 导出组件与属性说明清单」之外的结构化目录
 *      （阶段四会补一个导出按钮；现在若存在就直接读）；
 *   ③ 插件目录里的外部组件（始终可读）。
 * 三者都没有时**不编造**：返回空列表 + note 说明缺什么，让客户端知道该开编辑器或先导出目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { ok, runTool, type ToolResult } from '../errors.js';
import { defaultPage, defaultCanvas } from '../bridge/headless.js';
import { scanPlugins } from './plugin.js';

export const componentListSchema = {
  mode: z.enum(['document', 'web', 'ppt']).optional().describe('只看支持该模式的组件'),
  category: z.string().optional().describe('只看某分类，如「Excel 表格」'),
  keyword: z.string().optional().describe('按 type / label 模糊匹配'),
};

export interface ComponentMeta {
  type: string;
  label: string;
  category: string;
  supportedModes: string[];
  source: 'builtin' | 'external' | 'catalog';
  description?: string;
}

interface CatalogFile {
  generatedAt?: string;
  components?: ComponentMeta[];
}

/** 读工作区里的结构化组件目录（若编辑器导出过） */
function readCatalog(): { file: string; components: ComponentMeta[] } | null {
  const file = path.join(config.workspace, 'component-catalog.json');
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CatalogFile | ComponentMeta[];
    const components = Array.isArray(parsed) ? parsed : (parsed.components ?? []);
    if (!components.length) return null;
    return { file, components: components.map((c) => ({ ...c, source: 'catalog' as const })) };
  } catch {
    return null;
  }
}

export async function componentList(args: {
  mode?: 'document' | 'web' | 'ppt';
  category?: string;
  keyword?: string;
}): Promise<ToolResult<{ total: number; components: ComponentMeta[]; sources: string[]; note?: string }>> {
  return runTool('component.list', args, async () => {
    const sources: string[] = [];
    let list: ComponentMeta[] = [];

    const catalog = readCatalog();
    if (catalog) {
      list = catalog.components;
      sources.push(`catalog:${path.basename(catalog.file)}`);
    }

    // 外部组件：插件目录永远可读（能力与插件域一致）
    const plugins = await scanPlugins();
    const external: ComponentMeta[] = plugins.entries
      .filter((p) => p.type)
      .map((p) => ({
        type: p.type as string,
        label: p.label ?? p.name,
        category: p.category ?? '外部组件',
        supportedModes: p.supportedModes ?? ['document', 'web'],
        source: 'external' as const,
      }));
    if (external.length) {
      list = [...list, ...external];
      sources.push(`plugins:${path.basename(config.pluginDir)}`);
    }

    const kw = args.keyword?.trim().toLowerCase();
    const filtered = list.filter((c) => {
      if (args.category && c.category !== args.category) return false;
      if (args.mode && !c.supportedModes.includes(args.mode)) return false;
      if (kw && !c.type.toLowerCase().includes(kw) && !c.label.toLowerCase().includes(kw)) return false;
      return true;
    });

    const hasBuiltin = sources.some((s) => s.startsWith('catalog')) ;
    const note = hasBuiltin
      ? undefined
      : '未拿到**内置组件目录**：请①在编辑器里开启 MCP 桥接（阶段二/八接入），或②把 component-catalog.json 放到工作区。' +
        '在此之前 component.list 只返回插件目录里的外部组件（不编造内置清单）。';

    return ok(
      { total: filtered.length, components: filtered, sources, ...(note ? { note } : {}) },
      // ★只拿到外部组件也算"降级"：客户端据此知道自己没看到全部组件
      { degraded: !hasBuiltin },
    );
  });
}

/** 供其它域复用的默认值（阶段一只有页面/画布两组，阶段三扩展为完整 defaults） */
export function componentDefaults(type: string): Record<string, unknown> | null {
  if (type === 'page') return defaultPage();
  if (type === 'canvas') return defaultCanvas();
  return null;
}
