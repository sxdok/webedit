/**
 * 职责：把当前模式的内容导出为**独立的 React/TSX 组件源码**（阶段五最后一项）。
 *
 * 生成原则（尽量可移植、不依赖本编辑器运行时）：
 *   · 常用组件 → 语义化标签（h1..h4 / p / img / table / ul / button / input / hr …）；
 *   · 布局类属性 → Tailwind 任意值类：`absolute left-[120px] w-[200px]`、`grid grid-cols-4 gap-[12px]`、
 *     `bg-[#fff] rounded-[8px] p-[12px] mt-[8px]` 等；
 *   · 其余样式（字体/行高/字距/阴影/对齐）→ `style={{}}` 内联兜底，保证外观不丢；
 *   · 文本统一用 `{'...'}` 字符串字面量输出，避免 JSX 里的花括号/尖括号转义坑；
 *   · 容器组件递归生成 children；`items` 这类"每行一条"的列表属性统一生成 `<ul><li>`。
 */
import type { ComponentNode, ComponentProps, EditorDocument, EditorMode } from '../../registry/types';
import { asBool, asNumber, asString } from '../id';
import { getComponent } from '../../registry';

/** 类型 → 语义化标签 */
const TAGS: Record<string, string> = {
  heading: 'h2',
  paragraph: 'p',
  richtext: 'div',
  image: 'figure',
  table: 'table',
  list: 'ul',
  divider: 'hr',
  button: 'button',
  input: 'input',
  container: 'div',
  card: 'article',
  quote: 'blockquote',
  code: 'pre',
  columns: 'div',
  pageNumber: 'div',
  date: 'div',
  signature: 'div',
  spacer: 'div',
  footnote: 'div',
  stamp: 'div',
  slideTitle: 'section',
  bullets: 'ul',
  kpiCards: 'div',
  timeline: 'ul',
  process: 'ol',
  compare: 'div',
  team: 'div',
  quoteSlide: 'blockquote',
  endSlide: 'section',
  chartBar: 'figure',
};

/** 文本类属性 → 按优先级取第一个作为元素文本 */
const TEXT_KEYS = ['text', 'html', 'title', 'label', 'caption', 'placeholder', 'center', 'subtitle'];

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\\n/g, '\\n');
}

/** 文本 → JSX 字符串字面量（统一 `{'...'}`，避免转义坑） */
function textLiteral(s: string): string {
  return `{'${esc(s)}'}`;
}

function cls(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 通用布局类：绝对定位 / 宽高 / 盒模型 / 对齐 */
function layoutClasses(node: ComponentNode, mode: EditorMode): string {
  const p = node.props;
  const out: string[] = [];
  if (mode === 'web' && node.frame) {
    out.push(`absolute left-[${node.frame.x}px] top-[${node.frame.y}px]`);
    if (node.frame.w) out.push(`w-[${node.frame.w}px]`);
    if (node.frame.h) out.push(`h-[${node.frame.h}px]`);
  }
  if (p.width != null) out.push(`w-[${asNumber(p.width, 100)}%]`);
  const bg = asString(p.background);
  if (bg && bg !== 'transparent') out.push(`bg-[${bg}]`);
  const bw = asNumber(p.borderWidth, 0);
  if (bw) out.push(`border-[${bw}px] border-[${asString(p.borderColor, '#e5e7eb')}]`);
  const br = asNumber(p.borderRadius, 0);
  if (br) out.push(`rounded-[${br}px]`);
  const pad = p.padding as { value?: number; unit?: string } | number | undefined;
  const padV = typeof pad === 'number' ? pad : asNumber(pad?.value, 0);
  if (padV) out.push(`p-[${padV}${typeof pad === 'number' ? 'px' : (pad?.unit ?? 'px')}]`);
  const mt = asNumber(p.marginTop, 0);
  if (mt) out.push(`mt-[${mt}mm]`);
  const mb = asNumber(p.marginBottom, 0);
  if (mb) out.push(`mb-[${mb}mm]`);
  if (asBool(p.shadow, false)) out.push('shadow');
  const align = asString(p.align);
  if (align === 'center') out.push('text-center');
  else if (align === 'right') out.push('text-right');
  else if (align === 'justify') out.push('text-justify');
  // 容器类组件的布局属性
  if (p.layout === 'grid') {
    out.push('grid');
    if (p.columns) out.push(`grid-cols-${asNumber(p.columns, 1)}`);
  } else if (p.layout === 'flex' || p.direction) {
    out.push('flex');
    if (p.direction === 'column') out.push('flex-col');
  }
  if (p.gap) out.push(`gap-[${asNumber(p.gap, 0)}px]`);
  return cls(...out);
}

/** 其余样式 → 内联 style（外观兜底） */
function styleObject(props: ComponentProps): string {
  const pairs: string[] = [];
  const push = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== '' && v !== 0) pairs.push(`${k}: '${v}'`);
  };
  push('fontFamily', asString(props.fontFamily) || undefined);
  const fs = asNumber(props.fontSize, 0);
  if (fs) push('fontSize', `${fs}pt`);
  const fw = asNumber(props.fontWeight, 0);
  if (fw && fw !== 400) push('fontWeight', fw);
  const lh = asNumber(props.lineHeight, 0);
  if (lh && lh !== 1.5) push('lineHeight', lh);
  const ls = asNumber(props.letterSpacing, 0);
  if (ls) push('letterSpacing', `${ls}px`);
  push('color', asString(props.color) || undefined);
  if (asString(props.align) === 'center') push('textAlign', 'center');
  else if (asString(props.align) === 'right') push('textAlign', 'right');
  push('height', props.height ? `${asNumber(props.height, 0)}px` : undefined);
  return pairs.length ? ` style={{ ${pairs.join(', ')} }}` : '';
}

/** 每行一条的列表属性 → <ul><li> */
function listItems(props: ComponentProps): string[] {
  const raw = asString(props.items);
  if (!raw) return [];
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

let counter = 0;

function renderNode(node: ComponentNode, mode: EditorMode, depth: number): string {
  const pad = '  '.repeat(depth);
  const def = getComponent(node.type);
  const tag = TAGS[node.type] ?? 'div';
  const cn = layoutClasses(node, mode);
  const st = styleObject(node.props);
  const attrs = `${cn ? ` className="${cn}"` : ''}${st}`;

  // 每行一条的列表
  const items = listItems(node.props);
  if (items.length && !def?.isContainer) {
    counter += 1;
    const lis = items
      .map((t, i) => `${pad}    <li key={${i}}>${textLiteral(t)}</li>`)
      .join('\n');
    return `${pad}<${tag}${attrs}>\n${lis}\n${pad}</${tag}>{/* ${node.type} */}`;
  }

  // 文本类内容
  let inner = '';
  for (const k of TEXT_KEYS) {
    const v = asString(node.props[k]);
    if (v) {
      inner = textLiteral(v);
      break;
    }
  }
  if (node.type === 'divider') return `${pad}<hr${attrs} />`;
  if (node.type === 'input') {
    const ph = asString(node.props.placeholder);
    return `${pad}<input${attrs} placeholder=${ph ? textLiteral(ph) : "''"} readOnly />`;
  }

  if (def?.isContainer) {
    counter += 1;
    const kids = (node.children ?? []).map((c) => renderNode(c, mode, depth + 1)).join('\n');
    return `${pad}<${tag}${attrs}>\n${inner ? `${pad}  ${inner}\n` : ''}${kids}\n${pad}</${tag}>`;
  }
  return `${pad}<${tag}${attrs}>${inner}</${tag}>`;
}

/** 生成可独立使用的 TSX 组件源码 */
export function buildReactComponent(doc: EditorDocument, topNodes?: ComponentNode[]): string {
  counter = 0;
  const mode = doc.mode;
  const page = doc.document.page;
  const canvas = doc.web.canvas;
  // ★顶层节点由 store 传入（getForest(doc)）；doc.web.root 是"画布根容器节点"而非顶层数组
  const list = topNodes ?? doc.document.components;
  const body = list
    .filter((n) => !n.hidden)
    .map((n) => renderNode(n, mode, 3))
    .join('\n');

  const wrapper =
    mode === 'document'
      ? `      <div className="mx-auto bg-white px-[31.7mm] py-[25.4mm]" style={{ width: '${page.width}mm', minHeight: '${page.height}mm', fontFamily: '${page.defaultFont}', fontSize: '${page.defaultFontSize}pt', lineHeight: ${page.lineHeight} }}>`
      : `      <div className="relative bg-[${canvas.background}]" style={{ width: '${canvas.width}px', height: '${canvas.height}px' }}>`;

  return `/**
 * 由可视化编辑器导出的 React 组件（自动生成，请勿手改）
 * 来源文档：${asString(doc.title, '未命名文档')}
 * 模式：${mode === 'document' ? '文档模式' : 'Web 模式'}
 * 依赖：仅 Tailwind CSS（无其它运行时依赖）
 * 说明：布局用 Tailwind 类表达（绝对定位/宽高/间距等），字体、颜色等用内联样式兜底，保证外观一致。
 */

export function ExportedDocument() {
  return (
${wrapper}
${body}
      </div>
  );
}

export default ExportedDocument;
`;
}
