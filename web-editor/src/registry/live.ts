/**
 * 职责：**运行时组件加载（热加载）**——让"新增/修改组件"不再需要重新构建。
 *
 * 机制：
 *   · 编辑器启动（或点「重载外部组件」）时，先问服务端要组件清单 /__components，
 *     再对每个文件做带时间戳的动态 import()（绕开浏览器缓存），文件里调用 window.EditorKit.register() 完成注册。
 *   · 文件放在 public/组件/*.js：Vite dev 直接当静态资源伺服，构建后会被复制进 dist/组件/，
 *     所以开发态与静态托管态都能热加载同一份文件。
 *   · EditorKit 暴露 React / 通用属性片段（fontProps、boxProps…）/ 样式助手 / 取值守卫 / 图标解析 / 注册函数，
 *     外部组件文件因此**不需要任何构建步骤**，也就没有 TS 类型负担。
 *   · 每个文件的加载结果（成功 / 失败原因）都会写进日志，便于定位。
 */
import React from 'react';
import {
  AlignLeft,
  AlertTriangle,
  Asterisk,
  BadgeCheck,
  BarChart3,
  Box,
  CalendarDays,
  CircleCheckBig,
  Code2,
  Columns2,
  Columns3,
  CreditCard,
  FileText,
  GitCommitHorizontal,
  Hash,
  Heading,
  Image as ImageIcon,
  Info,
  LayoutDashboard,
  List,
  ListOrdered,
  Megaphone,
  Minus,
  MousePointerClick,
  MoveVertical,
  PanelTop,
  PenLine,
  Presentation,
  Quote,
  ShieldCheck,
  SquareDashed,
  Stamp,
  Star,
  Table,
  TextCursorInput,
  Type,
  Users,
  Workflow,
} from 'lucide-react';
import type { ComponentDefinition, ComponentIcon, PropSchemaItem } from './types';
import { registerComponent, unregisterComponent } from './index';
import { log } from '../utils/logger';
import {
  alignOf,
  boxProps,
  boxStyle,
  defaultFrameOf,
  defaultsOf,
  edgeCss,
  fontProps,
  lines,
  rows,
  spacingCss,
  typographyStyle,
} from './components/shared';
import { asBool, asEnum, asNumber, asString } from '../utils/id';
import { mmToPx, ptToPx } from '../utils/units';
import {
  escapeCell,
  parseCellStyles,
  parseColWidths,
  parseTableData,
  renderTable,
  serializeTableData,
  tableSchema,
} from './components/common/tableKit';

const LIVE_DIR = '/组件';
const MANIFEST_URL = '/__components';
const MANIFEST_FILE = `${LIVE_DIR}/_manifest.json`;

/** 外部组件可用的图标白名单（显式导入 → 可被 tree-shaking，不会把整个图标库打进包） */
const ICONS: Record<string, ComponentIcon> = {
  Type, Heading, AlignLeft, Image: ImageIcon, Table, Minus, List, ListOrdered, FileText,
  Quote, Code2, Columns2, Columns3, Hash, CalendarDays, PanelTop, PenLine,
  MoveVertical, Asterisk, Stamp, Presentation, LayoutDashboard, GitCommitHorizontal,
  Workflow, Users, CircleCheckBig, BarChart3, Megaphone, Info, AlertTriangle,
  BadgeCheck, Star, Box, CreditCard, MousePointerClick, TextCursorInput, ShieldCheck,
};

function iconByName(name?: string): ComponentIcon {
  const hit = name ? ICONS[name] : undefined;
  if (hit) return hit;
  if (name) log.warn('live', `图标名 "${name}" 不在白名单，已退回默认图标`);
  return SquareDashed;
}

export interface EditorKit {
  React: typeof import('react');
  /**
   * React 的 **jsx runtime**（规格 §7.2/§7.3 里外部插件用的 `const { jsx } = EditorKit.reactJsxRuntime`）。
   * ★注意：这里给的是**经典签名** `jsx(type, props, ...children)`（即 createElement），
   *   不是 React 自动运行时的 `jsx(type, config, maybeKey)` —— 规格 §7.3 的示例就是按经典签名写的
   *   （`jsx('div', {style}, child)`）。若用自动运行时的签名，children 会被当成 key 丢掉。
   */
  reactJsxRuntime: { jsx: typeof import('react').createElement; jsxs: typeof import('react').createElement; Fragment: typeof import('react').Fragment };
  /** 老写法别名（有些外部组件写成 EditorKit.react） */
  react: typeof import('react');
  /** 注册一个外部组件（重复 type 会覆盖，便于热重载） */
  register: (def: ComponentDefinition) => void;
  /** 通用属性片段（与内置组件同一套词汇，保证属性面板行为一致） */
  fontProps: typeof fontProps;
  boxProps: typeof boxProps;
  defaultsOf: typeof defaultsOf;
  defaultFrameOf: typeof defaultFrameOf;
  boxStyle: typeof boxStyle;
  typographyStyle: typeof typographyStyle;
  alignOf: typeof alignOf;
  spacingCss: typeof spacingCss;
  edgeCss: typeof edgeCss;
  lines: typeof lines;
  rows: typeof rows;
  asString: typeof asString;
  asNumber: typeof asNumber;
  asBool: typeof asBool;
  asEnum: typeof asEnum;
  mmToPx: typeof mmToPx;
  ptToPx: typeof ptToPx;
  icon: (name?: string) => ComponentIcon;
  /**
   * **表格内核**（规格"表格与预设共用一份实现"）：外部表格组件用它渲染 + 拿属性 schema，
   * 就自动获得与内置表格完全一致的单元格逻辑（点选/拖选一格、`\|` 与 `\n` 转义、A1 格式键、
   * 行/列数量增删平移格式）——不需要自己再写一套 `<table>`。
   */
  renderTable: typeof renderTable;
  tableSchema: typeof tableSchema;
  parseTableData: typeof parseTableData;
  serializeTableData: typeof serializeTableData;
  escapeCell: typeof escapeCell;
  parseCellStyles: typeof parseCellStyles;
  parseColWidths: typeof parseColWidths;
}

/** 记录来自外部文件的组件类型，便于重载时精确卸载 */
const liveTypes = new Set<string>();

export function getLiveTypes(): string[] {
  return [...liveTypes];
}

function installKit(React: typeof import('react')): void {
  const kit: EditorKit = {
    React,
    // 规格 §7.3 的写法：`const { jsx } = window.EditorKit.reactJsxRuntime`
    // 这里给经典签名（= createElement），children 走可变参数，不会被当成 key 丢掉
    reactJsxRuntime: { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment },
    react: React,
    register: (def) => {
      if (!def || typeof def !== 'object' || !def.type || typeof def.render !== 'function') {
        log.error('live', '组件定义不合法（需要 type 与 render 函数）', { keys: Object.keys(def ?? {}) });
        return;
      }
      /**
       * ★外部组件 type 必须 `live` 开头（规格 §7.2 / 验收 5）。
       *   下面那句 unregisterComponent(def.type) 是"允许覆盖同名"用的 —— 不设前缀，
       *   一个外部 .js 就能把内置组件（比如 table）顶掉，而且没有任何提示。
       */
      if (!def.type.startsWith('live')) {
        log.error('live', `外部组件 type 必须以 live 开头（已拒绝注册）：${def.type}`, { label: def.label });
        return;
      }
      // 允许覆盖同名：先卸载再注册，这样"改完重载"能生效
      unregisterComponent(def.type);
      const normalized: ComponentDefinition = {
        ...def,
        icon: typeof def.icon === 'function' ? def.icon : iconByName(typeof def.icon === 'string' ? def.icon : undefined),
        propSchema: (def.propSchema ?? []) as PropSchemaItem[],
      };
      registerComponent(normalized);
      liveTypes.add(def.type);
      log.info('live', `已注册外部组件：${def.type}`, { label: def.label, modes: def.supportedModes });
    },
    fontProps,
    boxProps,
    defaultsOf,
    defaultFrameOf,
    boxStyle,
    typographyStyle,
    alignOf,
    spacingCss,
    edgeCss,
    lines,
    rows,
    asString,
    asNumber,
    asBool,
    asEnum,
    mmToPx,
    ptToPx,
    icon: (name?: string) => iconByName(name),
    renderTable,
    tableSchema,
    parseTableData,
    serializeTableData,
    escapeCell,
    parseCellStyles,
    parseColWidths,
  };
  (window as unknown as { EditorKit?: EditorKit }).EditorKit = kit;
}

/** 目录清单：优先 /__components（dev 中间件与启动器都提供），退化到静态 _manifest.json */
async function fetchFileList(): Promise<{ files: string[]; source: string }> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (res.ok) {
      const json = (await res.json()) as { files?: string[] };
      if (Array.isArray(json.files)) return { files: json.files, source: MANIFEST_URL };
    }
  } catch {
    /* 落到静态清单 */
  }
  try {
    const res = await fetch(MANIFEST_FILE, { cache: 'no-store' });
    if (res.ok) {
      const json = (await res.json()) as { files?: string[] };
      if (Array.isArray(json.files)) return { files: json.files, source: MANIFEST_FILE };
    }
  } catch {
    /* 没有外部组件 */
  }
  return { files: [], source: '无' };
}

export interface LiveLoadResult {
  source: string;
  total: number;
  ok: number;
  failed: string[];
}

/** 加载（或重载）外部组件目录。reload=true 时先卸载上次加载的类型 */
export async function loadRuntimeComponents(reload = false): Promise<LiveLoadResult> {
  installKit(React);

  if (reload) {
    liveTypes.forEach((t) => unregisterComponent(t));
    liveTypes.clear();
  }

  const { files, source } = await fetchFileList();
  const failed: string[] = [];
  const stamp = Date.now();
  let ok = 0;

  for (const file of files) {
    const url = `${LIVE_DIR}/${encodeURIComponent(file)}?t=${stamp}`;
    try {
      await import(/* @vite-ignore */ url);
      ok += 1;
    } catch (e) {
      failed.push(file);
      log.error('live', `外部组件加载失败：${file}`, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  log.info('live', '外部组件目录加载完成', { source, total: files.length, ok, failed });
  return { source, total: files.length, ok, failed };
}
