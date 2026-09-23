/**
 * 职责：**组件包（插件包）的导入 / 导出**（B14）。
 *
 * 包格式（JSON，纯文本、可读可 diff）：
 * ```json
 * { "format": "editor-plugin-package", "version": 1, "exportedAt": "…",
 *   "plugins": [ { "name": "liveKpiCard.js", "code": "…源码…" } ] }
 * ```
 *
 * 三条路径：
 *   ① **导出**：`buildPluginPackage()` 把 `public/组件/*.js` 全部源码收进一个包（下载）。
 *   ② **导入（落盘）**：`installPluginPackage()` 逐个 POST `/__savePlugin`，由启动器写回组件目录 →
 *      刷新后仍然在（这是"真的导入"）。
 *   ③ **导入（退化）**：启动器没有该接口（例如静态托管）时，用 `registerPluginSource()` 在**本次会话**
 *      注册，并如实告诉用户"没有写盘、刷新会丢"。
 *
 * 安全：文件名只允许 `xxx.js`（字母/数字/下划线/短横/中文，不含路径分隔符、不以 `_` 开头），
 * 内容必须是文本；不合法的一律拒收（`validatePluginPackage`）。
 */
import { collectPluginSources, registerPluginSource, type PluginSource } from '../registry/live';
import { log } from './logger';

export interface PluginPackage {
  format: 'editor-plugin-package';
  version: number;
  exportedAt: string;
  plugins: PluginSource[];
}

export const PACKAGE_FORMAT = 'editor-plugin-package';

/** 组件文件名合法性：`名字.js`，不含路径分隔符、不以 `_` 开头（`_manifest.json` 之类是内部文件） */
export function validPluginName(name: unknown): boolean {
  const s = String(name ?? '').trim();
  if (!/^[\w\u4e00-\u9fa5-]+\.js$/.test(s)) return false;
  if (s.startsWith('_')) return false;
  return !s.includes('/') && !s.includes('\\') && !s.includes('..');
}

/** 导出：读全部外部组件源码 → 组件包对象 */
export async function buildPluginPackage(): Promise<{ pkg: PluginPackage; errors: { name: string; error: string }[] }> {
  const { plugins, errors } = await collectPluginSources();
  const pkg: PluginPackage = {
    format: PACKAGE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    plugins,
  };
  log.info('pluginPackage', '组件包已生成', { 组件数: plugins.length, 失败: errors.length });
  return { pkg, errors };
}

export interface PackageCheck {
  ok: boolean;
  plugins: PluginSource[];
  /** 拒收原因（逐条，便于在对话框里原样展示） */
  errors: string[];
}

/** 校验一个组件包（导入前必过；不合法就整包拒收，不做"部分导入"） */
export function validatePluginPackage(input: unknown): PackageCheck {
  const errors: string[] = [];
  const obj = input as Partial<PluginPackage> | null;
  if (!obj || typeof obj !== 'object') return { ok: false, plugins: [], errors: ['不是一个 JSON 对象'] };
  if (obj.format !== PACKAGE_FORMAT) errors.push(`format 不是 ${PACKAGE_FORMAT}`);
  if (!Array.isArray(obj.plugins) || obj.plugins.length === 0) errors.push('plugins 为空');
  const plugins: PluginSource[] = [];
  for (const raw of Array.isArray(obj.plugins) ? obj.plugins : []) {
    const name = String((raw as PluginSource)?.name ?? '');
    const code = String((raw as PluginSource)?.code ?? '');
    if (!validPluginName(name)) {
      errors.push(`文件名不合法：${name || '(空)'}`);
      continue;
    }
    if (!code.trim()) {
      errors.push(`${name} 的 code 为空`);
      continue;
    }
    plugins.push({ name, code, url: (raw as PluginSource)?.url ?? '' });
  }
  return { ok: errors.length === 0 && plugins.length > 0, plugins, errors };
}

export interface InstallResult {
  /** 已写回组件目录的文件（启动器接口可用时） */
  saved: string[];
  /** 只在本次会话注册的文件（没有写盘接口时） */
  runtime: string[];
  failed: { name: string; error: string }[];
  /** 是否走了"写盘"路径 */
  persisted: boolean;
}

/** 导入：优先写回组件目录；没有接口就退化成"本次会话注册"（并如实报告） */
export async function installPluginPackage(pkg: PluginPackage): Promise<InstallResult> {
  const check = validatePluginPackage(pkg);
  if (!check.ok) {
    log.error('pluginPackage', '组件包校验未通过，整包拒收', { 原因: check.errors });
    return { saved: [], runtime: [], failed: check.plugins.map((p) => ({ name: p.name, error: '包校验未通过' })), persisted: false };
  }

  const saved: string[] = [];
  const runtime: string[] = [];
  const failed: { name: string; error: string }[] = [];
  let persisted = true;

  for (const p of check.plugins) {
    let wrote = false;
    try {
      const res = await fetch('/__savePlugin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: p.name, text: p.code }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        saved.push(p.name);
        wrote = true;
      } else {
        persisted = false;
        log.warn('pluginPackage', `写盘失败（${p.name}）：${json.error ?? res.status}；改为会话内注册`);
      }
    } catch (e) {
      persisted = false;
      log.warn('pluginPackage', `没有 /__savePlugin 接口（${e instanceof Error ? e.message : String(e)}）；改为会话内注册`);
    }
    if (wrote) continue;
    try {
      await registerPluginSource(p.code, p.name);
      runtime.push(p.name);
    } catch (e) {
      failed.push({ name: p.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  log.info('pluginPackage', '组件包导入完成', { 写盘: saved.length, 会话内: runtime.length, 失败: failed.length, persisted });
  return { saved, runtime, failed, persisted };
}

/** 导出文件名：`组件包-YYYYMMDD-HHmm.json` */
export function packageFileName(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `组件包-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}
