/**
 * 职责：组件属性的**通用片段**与样式生成器。所有组件共用同一套属性词汇，
 *       避免每个组件各写一遍字号/边框/内边距：
 *   · typographyProps()  字体/字号/字重/行高/字距/颜色/对齐
 *   · boxProps()         背景/边框/圆角/阴影/内边距(spacing)/外边距(edge)
 *   · sizeProps()        宽度/高度/最大宽度
 *   · defaultsOf(...)    由 schema 直接推导 defaultProps，保证两者不会不一致
 *   · typographyStyle()/boxStyle()/spacingCss()  把属性翻译成 CSS
 */
import type { ComponentProps, PropSchemaItem, RenderContext } from '../types';
import { asBool, asEnum, asNumber, asString } from '../../utils/id';

export const GROUP = {
  /** ★表格专用：整张表的属性（含默认格式） */
  whole: '表格',
  /** ★表格专用：只作用于画布上选中的单元格 */
  cell: '单元格',
  content: '内容',
  typography: '排版',
  appearance: '外观',
  size: '尺寸',
  layout: '布局',
  advanced: '高级',
} as const;

const ALIGNS = ['left', 'center', 'right', 'justify'] as const;

/* ══════════════ 属性片段 ══════════════ */

export function fontFamilyProp(): PropSchemaItem {
  return { key: 'fontFamily', label: '字体', control: 'font', group: GROUP.typography, defaultValue: '宋体' };
}

export function fontSizeProp(defaultValue = 12, max = 72): PropSchemaItem {
  return { key: 'fontSize', label: '字号', control: 'unit', group: GROUP.typography, defaultValue, unit: 'pt', min: 6, max };
}

export function fontWeightProp(defaultValue = 400): PropSchemaItem {
  return { key: 'fontWeight', label: '字重', control: 'slider', group: GROUP.typography, defaultValue, min: 300, max: 900, step: 100 };
}

export function lineHeightProp(defaultValue = 1.5): PropSchemaItem {
  return { key: 'lineHeight', label: '行距', control: 'slider', group: GROUP.typography, defaultValue, min: 1, max: 3, step: 0.1 };
}

export function letterSpacingProp(): PropSchemaItem {
  return { key: 'letterSpacing', label: '字距', control: 'number', group: GROUP.typography, defaultValue: 0, min: -3, max: 12, step: 0.5 };
}

export function colorProp(defaultValue = '#1f2329'): PropSchemaItem {
  return { key: 'color', label: '文字颜色', control: 'color', group: GROUP.typography, defaultValue };
}

export function alignProp(defaultValue = 'left'): PropSchemaItem {
  return { key: 'align', label: '对齐', control: 'align', group: GROUP.typography, defaultValue };
}

/** 字体相关（不含颜色/对齐） */
export function fontProps(fontSize = 12): PropSchemaItem[] {
  return [fontFamilyProp(), fontSizeProp(fontSize), fontWeightProp(), lineHeightProp(), letterSpacingProp()];
}

export function backgroundProp(defaultValue = 'transparent'): PropSchemaItem {
  return { key: 'background', label: '背景', control: 'color', group: GROUP.appearance, defaultValue };
}

export function borderProps(): PropSchemaItem[] {
  return [
    { key: 'borderWidth', label: '边框宽', control: 'number', group: GROUP.appearance, defaultValue: 0, min: 0, max: 12 },
    { key: 'borderColor', label: '边框色', control: 'color', group: GROUP.appearance, defaultValue: '#e5e7eb' },
    { key: 'borderRadius', label: '圆角', control: 'number', group: GROUP.appearance, defaultValue: 0, min: 0, max: 80 },
  ];
}

export function shadowProp(): PropSchemaItem {
  return { key: 'shadow', label: '阴影', control: 'switch', group: GROUP.appearance, defaultValue: false };
}

export function paddingProp(defaultValue = 0): PropSchemaItem {
  return { key: 'padding', label: '内边距', control: 'spacing', group: GROUP.size, defaultValue: { value: defaultValue, unit: 'px' } };
}

export function marginProp(): PropSchemaItem {
  return {
    key: 'margin',
    label: '外边距(上右下左)',
    control: 'edge',
    group: GROUP.size,
    defaultValue: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

export function widthProp(defaultValue = 100, unit: 'number' | 'slider' = 'slider'): PropSchemaItem {
  return unit === 'slider'
    ? { key: 'width', label: '宽度 %', control: 'slider', group: GROUP.size, defaultValue, min: 10, max: 100, step: 5 }
    : { key: 'width', label: '宽度', control: 'unit', group: GROUP.size, defaultValue, unit: 'px', min: 8, max: 2000 };
}

export function heightProp(defaultValue = 0): PropSchemaItem {
  return { key: 'height', label: '高度（0=自适应）', control: 'number', group: GROUP.size, defaultValue, min: 0, max: 2000 };
}

/** 外观 + 尺寸的常用组合 */
export function boxProps(): PropSchemaItem[] {
  return [backgroundProp(), ...borderProps(), shadowProp(), paddingProp(), marginProp()];
}

/* ══════════════ 由 schema 推导默认值 ══════════════ */

/** 默认位置尺寸（Web 模式放置用） */
export function defaultFrameOf(w: number, h: number, x = 40, y = 40): { x: number; y: number; w: number; h: number } {
  return { x, y, w, h };
}

export function defaultsOf(items: PropSchemaItem[], extra: ComponentProps = {}): ComponentProps {
  const out: ComponentProps = {};
  items.forEach((i) => {
    out[i.key] = typeof i.defaultValue === 'object' && i.defaultValue !== null
      ? structuredClone(i.defaultValue)
      : i.defaultValue;
  });
  return { ...out, ...extra };
}

/* ══════════════ 样式生成 ══════════════ */

export function spacingCss(v: unknown, fallback = 0, scale = 1): string {
  if (typeof v === 'number') return `${v * scale}px`;
  const o = (v ?? {}) as Record<string, unknown>;
  const value = asNumber(o.value, fallback) * scale;
  const unit = asString(o.unit, 'px');
  return `${value}${unit}`;
}

export function edgeCss(v: unknown, scale = 1): string | undefined {
  const o = (v ?? {}) as Record<string, unknown>;
  const t = asNumber(o.top, 0) * scale;
  const r = asNumber(o.right, 0) * scale;
  const b = asNumber(o.bottom, 0) * scale;
  const l = asNumber(o.left, 0) * scale;
  if (!t && !r && !b && !l) return undefined;
  return `${t}px ${r}px ${b}px ${l}px`;
}

export function typographyStyle(
  props: ComponentProps,
  ctx: RenderContext,
  defaults: { fontSize?: number; weight?: number; lineHeight?: number } = {},
): React.CSSProperties {
  const size = asNumber(props.fontSize, defaults.fontSize ?? 12);
  return {
    fontFamily: asString(props.fontFamily) || undefined,
    fontSize: ctx.mode === 'document' ? ctx.ptToPx(size) : size,
    fontWeight: asNumber(props.fontWeight, defaults.weight ?? 400),
    lineHeight: asNumber(props.lineHeight, defaults.lineHeight ?? 1.5),
    letterSpacing: asNumber(props.letterSpacing, 0) || undefined,
    color: asString(props.color) || undefined,
    textAlign: alignOf(props.align),
  };
}

export function alignOf(v: unknown): React.CSSProperties['textAlign'] {
  return asEnum(v, ALIGNS, 'left');
}

export function boxStyle(props: ComponentProps): React.CSSProperties {
  const bw = asNumber(props.borderWidth, 0);
  const bg = asString(props.background);
  return {
    background: bg && bg !== 'transparent' ? bg : undefined,
    border: bw ? `${bw}px solid ${asString(props.borderColor, '#e5e7eb')}` : undefined,
    borderRadius: asNumber(props.borderRadius, 0) || undefined,
    boxShadow: asBool(props.shadow, false) ? '0 2px 10px rgba(0,0,0,.08)' : undefined,
    padding: spacingCss(props.padding, 0),
    margin: edgeCss(props.margin),
    boxSizing: 'border-box',
    width: props.width != null ? `${asNumber(props.width, 100)}%` : undefined,
  };
}

/** "每行一项" → 数组（支持可选的 | 分列） */
export function lines(v: unknown): string[] {
  return String(v ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export function rows(v: unknown): string[][] {
  return lines(v).map((l) => l.split('|').map((c) => c.trim()));
}
