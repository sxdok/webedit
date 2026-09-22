/**
 * 职责：编辑器的全部类型定义与常量（页面/设备预设、节点树、属性 Schema、组件定义、渲染上下文）。
 * 约定：组件业务属性统一用 Record<string, unknown>，取值时经 utils/value.ts 的类型守卫转换，
 *       不滥用 any（§12 实现约束）。
 */
import type { ComponentType, ReactNode } from 'react';

/* ══════════════ 一、模式与页面配置 ══════════════ */

export type EditorMode = 'document' | 'web';

/** 纸张尺寸，单位 mm。渲染按 96 DPI 换算：1mm = 3.779528px */
export const PAGE_SIZES = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  Custom: { width: 210, height: 297 },
} as const;
export type PageSizeKey = keyof typeof PAGE_SIZES;

/** Web 画布设备预设，单位 px */
export const DEVICE_PRESETS = {
  Desktop: { width: 1440, height: 900 },
  Laptop: { width: 1280, height: 800 },
  Tablet: { width: 768, height: 1024 },
  Mobile: { width: 375, height: 812 },
  Custom: { width: 1200, height: 800 },
} as const;
export type DeviceKey = keyof typeof DEVICE_PRESETS;

export interface PageMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 页眉/页脚区域配置（**页面级设置**，不是组件）：左/中/右三段文字 + 样式。
 *  支持变量：{page} 当前页、{total} 总页数、{date} 当天日期 */
export interface PageBandConfig {
  left: string;
  center: string;
  right: string;
  /** pt */
  fontSize: number;
  color: string;
  showBorder: boolean;
  /** mm —— 页眉=距纸张上边缘、页脚=距纸张下边缘（像 Word 的"页眉顶端距离/页脚底端距离"） */
  offset: number;
}

export interface DocumentPageConfig {
  size: PageSizeKey;
  /** mm */ width: number;
  /** mm */ height: number;
  orientation: 'portrait' | 'landscape';
  /** mm */ margin: PageMargin;
  background: string;
  defaultFont: string;
  /** pt */ defaultFontSize: number;
  lineHeight: number;
  showHeader: boolean;
  showFooter: boolean;
  /** 页眉区域（页面属性） */
  header: PageBandConfig;
  /** 页脚区域（页面属性） */
  footer: PageBandConfig;
  /** 三段式页码（封面无页码 → 目录罗马数字 → 正文阿拉伯数字），对齐 A4 编辑器 #selftest 的"三段式页码" */
  numbering: PageNumberingConfig;
}

/* ══════════════ 三段式页码 ══════════════ */

export interface PageNumberingConfig {
  /** 首页（封面）不显示页码 */
  hideFirstPage: boolean;
  /** 封面之后、按罗马数字编号的页数（目录节） */
  frontMatterPages: number;
  /** 正文节从第几页开始计数 */
  bodyStartPage: number;
}

/** 读取页码分节配置（兼容旧文档：老数据没有这个字段） */
export function pageNumbering(page: DocumentPageConfig): PageNumberingConfig {
  const raw = (page as unknown as Record<string, unknown>).numbering as Partial<PageNumberingConfig> | undefined;
  return { hideFirstPage: false, frontMatterPages: 0, bodyStartPage: 1, ...(raw ?? {}) };
}

const ROMAN_TABLE: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRoman(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  let v = Math.floor(n);
  let out = '';
  for (const [num, sym] of ROMAN_TABLE) {
    while (v >= num) {
      out += sym;
      v -= num;
    }
  }
  return out;
}

/**
 * 物理第 index 页（1 基）应显示的页码文字。返回空串表示该页不显示页码。
 * 规则（与 Word 的分节编号一致）：
 *   ① hideFirstPage 时第 1 页（封面）不显示；
 *   ② 封面之后 frontMatterPages 页用罗马数字（I、II…）；
 *   ③ 其余为正文，从 bodyStartPage 开始按阿拉伯数字连续编号。
 */
export function pageLabel(index: number, cfg: PageNumberingConfig): string {
  const front = Math.max(0, Math.floor(cfg.frontMatterPages || 0));
  const coverOffset = cfg.hideFirstPage ? 1 : 0;
  if (cfg.hideFirstPage && index <= 1) return '';
  const bodyStartIndex = 1 + coverOffset + front;
  if (index >= bodyStartIndex) {
    const start = Math.max(1, Math.floor(cfg.bodyStartPage || 1));
    return String(index - bodyStartIndex + start);
  }
  return toRoman(index - coverOffset);
}

/** 读取页眉/页脚配置（兼容旧文档：老数据没有这两个字段） */
export function pageBand(page: DocumentPageConfig, which: 'header' | 'footer'): PageBandConfig {
  const fallback: PageBandConfig = {
    left: '',
    center: which === 'footer' ? '第 {page} 页 / 共 {total} 页' : '',
    right: '',
    fontSize: 10.5,
    color: '#5b6472',
    showBorder: true,
    offset: 12.7,
  };
  const raw = (page as unknown as Record<string, unknown>)[which] as Partial<PageBandConfig> | undefined;
  return raw ? { ...fallback, ...raw } : fallback;
}

/** 页眉/页脚变量替换（page 可以是数字，也可以是分节计算后的页码文字，如罗马数字） */
export function fillBandTokens(text: string, page: number | string, total: number | string): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return text
    .replace(/\{page\}/g, String(page))
    .replace(/\{total\}/g, String(total))
    .replace(/\{date\}/g, date);
}

export interface WebCanvasConfig {
  device: DeviceKey;
  /** px */ width: number;
  /** px */ height: number;
  background: string;
  showGrid: boolean;
  /** px，默认 8 */ gridSize: number;
  snapToGrid: boolean;
  /** 移动端安全区 */ safeArea: boolean;
}

/* ══════════════ 二、组件节点（统一树形结构） ══════════════ */

/** 组件业务属性。值类型不做静态约束，读取时用 utils/value.ts 守卫 */
export type ComponentProps = Record<string, unknown>;

export interface Frame {
  /** px */ x: number;
  /** px */ y: number;
  /** px */ w: number;
  /** px */ h: number;
  /** deg */ rotation?: number;
}

export interface ComponentNode {
  id: string;
  /** 注册表 key */ type: string;
  props: ComponentProps;
  /** Web 模式容器嵌套；文档模式容器（如分栏）也复用 */
  children?: ComponentNode[];
  /** Web 模式绝对定位框；文档模式可选用于浮动元素 */
  frame?: Frame;
  locked?: boolean;
  hidden?: boolean;
}

/* ══════════════ 三、编辑器文档 ══════════════ */

export interface EditorDocument {
  id: string;
  title: string;
  mode: EditorMode;
  /** 两套配置与内容独立保存，切换模式不丢数据 */
  document: {
    page: DocumentPageConfig;
    /** 文档流顺序数组 */
    components: ComponentNode[];
  };
  web: {
    canvas: WebCanvasConfig;
    /** 根容器，children 为所有顶层元素 */
    root: ComponentNode;
  };
  /** 支持多选 */
  selectedIds: string[];
}

/* ══════════════ 四、属性注册表 ══════════════ */

/**
 * 属性控件类型。语义约定（避免同类控件含义重叠）：
 *   text/textarea/richtext  文本：单行 / 多行 / 富文本（contenteditable + execCommand）
 *   number/slider/unit      数值：数字框 / 滑杆 / 数字+单位（mm|px|pt|%）
 *   color/select/switch     枚举与开关
 *   align/font              对齐按钮组 / 字体下拉
 *   edge                    四向边距各自独立：值形如 { top, right, bottom, left }（px）
 *   spacing                 单一间距 + 单位，联动应用于四边：值形如 { value, unit }
 *   image                   图片地址（可本地选图转 data:URL）
 *   frame                   位置尺寸 x/y/w/h（px），Web 模式绝对定位
 *   children                容器子项列表（增删/排序/进入选中）
 *   cells                   表格单元格：选中格子后填背景色（编辑器态选择 + 文档态颜色）
 */
export type PropControlType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'slider'
  | 'color'
  | 'select'
  | 'switch'
  | 'align'
  | 'font'
  | 'spacing'
  | 'edge'
  | 'image'
  | 'unit'
  | 'frame'
  | 'children'
  /** 表格单元格：点选单元格后按格填背景色（+ 列宽自适应） */
  | 'cells'
  /** 表格行/列数量（真正增删数据的行列） */
  | 'tableSize';

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface PropSchemaItem {
  key: string;
  label: string;
  control: PropControlType;
  /** 属性面板分组 */
  group: string;
  defaultValue: unknown;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: 'mm' | 'px' | 'pt' | '%';
  placeholder?: string;
  visibleWhen?: (props: ComponentProps, ctx: RenderContext) => boolean;
  disabledWhen?: (props: ComponentProps, ctx: RenderContext) => boolean;
}

export type ComponentIcon = ComponentType<{ className?: string }>;

export interface RenderContext {
  mode: EditorMode;
  /** 文档模式 */ page?: DocumentPageConfig;
  /** Web 模式 */ canvas?: WebCanvasConfig;
  isEditing: boolean;
  isSelected: boolean;
  mmToPx: (mm: number) => number;
  ptToPx: (pt: number) => number;
}

export interface ComponentDefinition {
  type: string;
  label: string;
  /** 左侧分组 */ category: string;
  /** 支持哪些模式 */ supportedModes: EditorMode[];
  icon: ComponentIcon;
  description?: string;
  /** 是否是容器（可嵌套子组件） */
  isContainer?: boolean;
  defaultProps: ComponentProps;
  /** Web 模式默认位置尺寸 */
  defaultFrame?: Partial<Frame>;
  propSchema: PropSchemaItem[];
  render: (props: ComponentProps, ctx: RenderContext) => ReactNode;
}

/** 左侧面板的分组顺序（未列出的分组排在最后，按字母序） */
export const CATEGORY_ORDER = [
  '通用',
  '文档专用',
  'Web 专用 / 基础控件',
  'Web 专用 / 布局容器',
  'Web 专用 / 展示组件',
] as const;

/* ══════════════ 默认值工厂 ══════════════ */

export function createDefaultPageConfig(): DocumentPageConfig {
  return {
    size: 'A4',
    width: PAGE_SIZES.A4.width,
    height: PAGE_SIZES.A4.height,
    orientation: 'portrait',
    margin: { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 },
    background: '#ffffff',
    defaultFont: '宋体',
    defaultFontSize: 12,
    lineHeight: 1.5,
    showHeader: false,
    showFooter: true,
    header: { left: '', center: '', right: '', fontSize: 10.5, color: '#5b6472', showBorder: true, offset: 12.7 },
    footer: {
      left: '',
      center: '第 {page} 页 / 共 {total} 页',
      right: '',
      fontSize: 10.5,
      color: '#5b6472',
      showBorder: true,
      offset: 12.7,
    },
    numbering: { hideFirstPage: false, frontMatterPages: 0, bodyStartPage: 1 },
  };
}

export function createDefaultCanvasConfig(): WebCanvasConfig {
  return {
    device: 'Desktop',
    width: DEVICE_PRESETS.Desktop.width,
    height: DEVICE_PRESETS.Desktop.height,
    background: '#ffffff',
    showGrid: false,
    gridSize: 8,
    snapToGrid: true,
    safeArea: false,
  };
}
