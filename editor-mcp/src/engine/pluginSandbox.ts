/**
 * 插件沙箱：**静态校验 + 沙箱执行**（规格 §5.12 的 `plugin.validate` / `plugin.dryRun`）。
 *
 * 为什么要沙箱：外部插件是"浏览器里执行的普通 JS"，AI 写完必须能**在不打开编辑器**的情况下
 * 验证它到底注册了什么、渲染出来长什么样 —— 这是插件迭代最关键的一环。
 *
 * 安全边界（规格 §10）：
 *   · 用 `node:vm` 跑，**只注入**白名单全局（window.EditorKit 的 mock、console、Object/Math/JSON 等由 vm 自带）；
 *   · 不给 `require` / `process` / `fs` / `fetch`；
 *   · 3 秒超时（死循环会被掐断并返回 PLUGIN_DRYRUN_FAILED，MCP Server 不会崩）；
 *   · 语法检查直接用 V8 的 `vm.Script` 解析（等价于规格里说的 acorn，但零依赖）。
 *
 * 输出：`validatePlugin()` 给契约问题清单；`dryRunPlugin()` 给出渲染后的 HTML 字符串。
 */
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export interface PluginProblem {
  level: 'error' | 'warn';
  code: 'PLUGIN_SYNTAX_ERROR' | 'PLUGIN_CONTRACT_ERROR' | 'PLUGIN_TYPE_PREFIX' | 'PLUGIN_DEPS' | 'PLUGIN_WARN';
  message: string;
}

export interface ValidateResult {
  ok: boolean;
  bytes: number;
  syntaxOk: boolean;
  callsRegister: boolean;
  /** 从源码静态嗅探出来的字段（不执行） */
  sniffed: { type?: string; label?: string; category?: string; supportedModes?: string[] };
  problems: PluginProblem[];
}

/** 静态校验：语法 + 契约（不执行代码） */
export function validatePluginSource(source: string): ValidateResult {
  const problems: PluginProblem[] = [];
  const bytes = Buffer.byteLength(source, 'utf8');

  // ① 语法：V8 解析（不执行）
  let syntaxOk = true;
  try {
    new vm.Script(source, { filename: 'plugin.js' });
  } catch (e) {
    syntaxOk = false;
    problems.push({ level: 'error', code: 'PLUGIN_SYNTAX_ERROR', message: String((e as Error)?.message ?? e) });
  }

  // ② 契约：必须通过 window.EditorKit.register 注册
  const callsRegister = /EditorKit\s*\.\s*register\s*\(/.test(source);
  if (!callsRegister) {
    problems.push({
      level: 'error',
      code: 'PLUGIN_CONTRACT_ERROR',
      message: '没有调用 window.EditorKit.register(def) —— 外部组件必须用它注册（否则编辑器永远看不到）',
    });
  }

  // ③ 必需字段（静态嗅探）
  const pick = (key: string): string | undefined => source.match(new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`))?.[1];
  const type = pick('type');
  const label = pick('label');
  const category = pick('category');
  const modesRaw = source.match(/supportedModes\s*:\s*\[([^\]]*)\]/)?.[1];
  const supportedModes = modesRaw ? [...modesRaw.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]) : undefined;
  if (!type) problems.push({ level: 'error', code: 'PLUGIN_CONTRACT_ERROR', message: '缺少 type（编辑器靠它做组件标识）' });
  if (!label) problems.push({ level: 'error', code: 'PLUGIN_CONTRACT_ERROR', message: '缺少 label（左侧面板显示名）' });
  if (!category) problems.push({ level: 'error', code: 'PLUGIN_CONTRACT_ERROR', message: '缺少 category（左侧分组：Word 常用/Excel 表格/PPT 专用/通用/布局分页/Web 控件/Web 容器）' });
  if (!supportedModes?.length) problems.push({ level: 'error', code: 'PLUGIN_CONTRACT_ERROR', message: '缺少 supportedModes（如 [\'document\', \'web\']）' });
  if (!/render\s*[:(]/.test(source)) problems.push({ level: 'error', code: 'PLUGIN_CONTRACT_ERROR', message: '缺少 render 函数' });
  if (!/propSchema\s*:/.test(source)) problems.push({ level: 'warn', code: 'PLUGIN_WARN', message: '没有 propSchema —— 组件会没有任何可调属性' });

  // ④ type 必须 live 前缀（编辑器侧已强制，这里提前拦住，省得写完才发现注册被拒）
  if (type && !type.startsWith('live')) {
    problems.push({
      level: 'error',
      code: 'PLUGIN_TYPE_PREFIX',
      message: `type「${type}」未以 live 开头 —— 编辑器会拒绝注册（避免外部组件顶掉内置组件）`,
    });
  }

  // ⑤ 不该有的依赖（沙箱里没有 require/import/fs/fetch）
  for (const bad of ['require(', 'process.', 'fs.', 'fetch(', 'import ']) {
    if (source.includes(bad)) {
      problems.push({
        level: 'error',
        code: 'PLUGIN_DEPS',
        message: `源码里出现「${bad}」—— 外部插件在浏览器里直接执行，没有 require/process/fs/fetch，也不能用 import`,
      });
    }
  }

  // ⑥ 编辑器真实的 EditorKit 只暴露 React，没有 reactJsxRuntime（规格示例里的 jsx 用法跑不通）
  if (/EditorKit\s*\.\s*reactJsxRuntime/.test(source)) {
    problems.push({
      level: 'error',
      code: 'PLUGIN_CONTRACT_ERROR',
      message:
        '编辑器当前的 window.EditorKit **没有 reactJsxRuntime**（只有 React）—— 请改用 React.createElement；' +
        '按规格 §7.3 示例写的 `const { jsx } = window.EditorKit.reactJsxRuntime` 在编辑器里会拿到 undefined',
    });
  }

  return {
    ok: problems.filter((p) => p.level === 'error').length === 0,
    bytes,
    syntaxOk,
    callsRegister,
    sniffed: { type, label, category, ...(supportedModes ? { supportedModes } : {}) },
    problems,
  };
}

/* ══════════════ 沙箱执行 ══════════════ */

export interface DryRunResult {
  ok: boolean;
  /** 渲染出的静态 HTML（React SSR） */
  html?: string;
  /** 注册进来的定义摘要（不含函数） */
  def?: { type?: string; label?: string; category?: string; supportedModes?: string[]; propKeys: string[]; hasRender: boolean };
  logs: string[];
  error?: { code: 'PLUGIN_SYNTAX_ERROR' | 'PLUGIN_DRYRUN_FAILED' | 'PLUGIN_CONTRACT_ERROR'; message: string };
  durationMs: number;
}

/** 收集 console 输出（也进 plugin.logs 的环形缓冲） */
export interface LogSink {
  push(line: string): void;
}

function makeConsole(logs: string[], sink?: LogSink): Console {
  const fmt = (a: unknown[]): string =>
    a
      .map((x) => {
        if (typeof x === 'string') return x;
        try {
          return JSON.stringify(x);
        } catch {
          return String(x);
        }
      })
      .join(' ');
  const emit = (level: string) => (...a: unknown[]) => {
    const line = `[plugin:${level}] ${fmt(a)}`;
    logs.push(line);
    sink?.push(line);
  };
  return {
    log: emit('log'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    debug: emit('debug'),
  } as unknown as Console;
}

/**
 * 在沙箱里执行插件源码：mock `window.EditorKit`，拿到 def，再用给定 props 调 render 并 SSR 成 HTML。
 * 死循环/抛错都被 catch 住，最长 3 秒（规格 §10）。
 */
export function dryRunPlugin(source: string, props?: Record<string, unknown>, sink?: LogSink): DryRunResult {
  const started = Date.now();
  const logs: string[] = [];

  // 语法先过一遍，避免把语法错误当成"运行时错误"
  const syntax = validatePluginSource(source);
  if (!syntax.syntaxOk) {
    return {
      ok: false,
      logs,
      error: { code: 'PLUGIN_SYNTAX_ERROR', message: syntax.problems.find((p) => p.code === 'PLUGIN_SYNTAX_ERROR')?.message ?? '语法错误' },
      durationMs: Date.now() - started,
    };
  }

  let captured: unknown = null;
  const EditorKit = {
    version: '1.0.0',
    /**
     * ★忠实照编辑器的 EditorKit（`web-editor/src/registry/live.ts`）：
     *   它只暴露 `React`（真实插件都用 `React.createElement`），**没有 `reactJsxRuntime`** ——
     *   规格 §7.2/§7.3 里写的 `const { jsx } = EditorKit.reactJsxRuntime` 与实现不一致。
     *   沙箱**不**替编辑器补这个口子：否则 dryRun 会通过、到编辑器里却报 undefined（验证就成了骗人）。
     *   `plugin.validate` 会把"用了 reactJsxRuntime"当错误报出来，并告诉对方改用 React.createElement。
     */
    React,
    register: (def: unknown) => {
      captured = def;
    },
    defaultsOf: (schema: { key: string; defaultValue?: unknown }[]) =>
      Object.fromEntries((schema ?? []).map((s) => [s.key, s.defaultValue])),
    defaultFrameOf: (schema: { key: string; defaultValue?: unknown }[]) =>
      Object.fromEntries((schema ?? []).map((s) => [s.key, s.defaultValue])),
    icon: () => () => null,
    boxStyle: () => ({}),
    typographyStyle: () => ({}),
    alignOf: () => 'left',
    spacingCss: () => '0px',
    edgeCss: () => '0px',
    lines: (v: unknown) => String(v ?? '').split('\n').filter(Boolean),
    rows: (v: unknown) => String(v ?? '').split('\n').filter(Boolean).map((l) => l.split('|').map((s) => s.trim())),
    asString: (v: unknown, d = '') => (typeof v === 'string' ? v : d),
    asNumber: (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d),
    asBool: (v: unknown, d = false) => (typeof v === 'boolean' ? v : d),
    asEnum: <T,>(v: unknown, allowed: readonly T[], d: T) => (allowed.includes(v as T) ? (v as T) : d),
    mmToPx: (mm: number) => mm * 3.779527559,
    ptToPx: (pt: number) => (pt * 96) / 72,
  };

  const sandbox: Record<string, unknown> = {
    window: { EditorKit },
    EditorKit,
    console: makeConsole(logs, sink),
    setTimeout,
    clearTimeout,
    React,
  };
  // 只给这些全局；require / process / fs / fetch 一律不注入（规格 §10）
  const context = vm.createContext(sandbox);

  try {
    new vm.Script(source, { filename: 'plugin.js' }).runInContext(context, { timeout: 3000 });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const isTimeout = /Script execution timed out/i.test(msg);
    return {
      ok: false,
      logs,
      error: {
        code: 'PLUGIN_DRYRUN_FAILED',
        message: isTimeout ? '执行超时（3 秒）—— 检查是否有死循环' : msg,
      },
      durationMs: Date.now() - started,
    };
  }

  if (!captured || typeof captured !== 'object') {
    return {
      ok: false,
      logs,
      error: { code: 'PLUGIN_CONTRACT_ERROR', message: '插件执行了，但没有通过 EditorKit.register 注册任何定义' },
      durationMs: Date.now() - started,
    };
  }

  const def = captured as {
    type?: string;
    label?: string;
    category?: string;
    supportedModes?: string[];
    defaultProps?: Record<string, unknown>;
    propSchema?: { key: string; defaultValue?: unknown }[];
    render?: (p: Record<string, unknown>, ctx: unknown) => unknown;
  };
  const propKeys = (def.propSchema ?? []).map((s) => s.key);
  const summary = {
    type: def.type,
    label: def.label,
    category: def.category,
    supportedModes: def.supportedModes,
    propKeys,
    hasRender: typeof def.render === 'function',
  };

  if (typeof def.render !== 'function') {
    return { ok: false, def: summary, logs, error: { code: 'PLUGIN_CONTRACT_ERROR', message: 'def.render 不是函数' }, durationMs: Date.now() - started };
  }

  const merged = { ...(def.defaultProps ?? {}), ...(props ?? {}) };
  const ctx = {
    mode: 'document',
    isEditing: false,
    isSelected: false,
    mmToPx: (mm: number) => mm * 3.779527559,
    ptToPx: (pt: number) => (pt * 96) / 72,
    page: { defaultFont: '宋体', defaultFontSize: 12, lineHeight: 1.5 },
  };

  try {
    const element = def.render(merged, ctx) as React.ReactElement;
    const html = renderToStaticMarkup(element as React.ReactElement<unknown>);
    return { ok: true, def: summary, html, logs, durationMs: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      def: summary,
      logs,
      error: { code: 'PLUGIN_DRYRUN_FAILED', message: `render 抛错：${String((e as Error)?.message ?? e)}` },
      durationMs: Date.now() - started,
    };
  }
}

/* ══════════════ 环形日志缓冲（plugin.logs） ══════════════ */

const RING_CAP = 500;
const ring: { t: number; name: string; line: string }[] = [];

export function pushPluginLog(name: string, line: string): void {
  ring.push({ t: Date.now(), name, line });
  while (ring.length > RING_CAP) ring.shift();
}

/** 取日志（可按插件名与时间过滤） */
export function pluginLogs(name?: string, sinceMs?: number): { t: number; name: string; line: string }[] {
  return ring.filter((r) => (!name || r.name === name) && (!sinceMs || r.t >= sinceMs));
}
