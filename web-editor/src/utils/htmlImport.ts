/**
 * 职责：**HTML → 编辑器文档**（B13，`?load=<url|路径>` 用）。
 *
 * 定位：把"已有的一份 HTML"读回编辑器继续编辑。**面向本工程导出的 HTML**（也兼容常见的
 * 结构化 HTML：h1-h6 / p / ul / ol / table / figure+img / blockquote / pre / hr）。
 *
 * 映射规则：
 *   · 认得结构标签就走**专门映射**（标题、段落、列表、清单、引用、代码、表格、图片、分隔线）；
 *   · `[data-node-type]`（本工程导出物带的标记）优先：直接按组件类型建节点，
 *     再把能从 DOM 里读回来的属性覆盖上去（src/alt/caption/level/text/items/data…）；
 *   · 其余容器（div/section/article/main）**只递归子节点**（结构铺平，不硬造容器）；
 *   · 读不出来的东西不假装读出来：计入 `warnings`，在日志里报。
 */
import { getComponent } from '../registry';
import { parseTableHtml } from '../registry/components/common/tableHtml';
import { createInitialDocument } from '../store/editorStore';
import { createNode } from '../store/treeUtils';
import { asString } from './id';
import type { ComponentNode, EditorDocument, EditorMode } from '../registry/types';

export interface ImportStats {
  /** 顶层节点数 */
  top: number;
  /** 全部节点数（含子节点） */
  total: number;
  /** 用 `data-node-type` 精确识别的节点数 */
  typed: number;
  /** 按标签猜出来的节点数 */
  guessed: number;
  /** 跳过的元素（脚本/样式/空段落…） */
  skipped: number;
  /** 识别成「目录」组件的个数（原先是文字列表） */
  tocFound: number;
  /** 内嵌 `data:` 资源（图片 base64）个数 —— 这些是**真的带进来了** */
  inlineAssets: number;
  /** 指向外部地址（http/相对路径）的资源个数 —— 相对路径要看 HTML 自身的位置能否解析 */
  remoteAssets: number;
}

export interface HtmlImportResult {
  title: string;
  mode: EditorMode;
  components: ComponentNode[];
  stats: ImportStats;
  warnings: string[];
}

/** 标签 → 组件类型（专门映射的那一批） */
const TAG_MAP: Record<string, string> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  p: 'paragraph',
  blockquote: 'quote',
  pre: 'code',
  hr: 'divider',
  img: 'image',
  figure: 'image',
  ul: 'bullets',
  ol: 'list',
  table: 'table',
};

const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'title', 'head', 'noscript', 'template', 'svg', 'button']);
/** 只递归、自己不成节点的容器 */
const FLOW_TAGS = new Set(['div', 'section', 'article', 'main', 'body', 'header', 'footer', 'aside', 'span', 'figure-inner']);

/** 资源地址：`data:` 原样保留；相对路径按 HTML 自身地址解析成绝对 URL（`?load=` 走 http 时能直接显示） */
let baseHref: string | null = null;
function resolveSrc(src: string): string {
  const s = src.trim();
  if (!s || s.startsWith('data:') || /^[a-z][\w+.-]*:/i.test(s)) return s;
  if (!baseHref) return s;
  try {
    return new URL(s, baseHref).href;
  } catch {
    return s;
  }
}

/** 这个容器是不是"文档目录"：含 目录/目 录/contents 字样的小标题，且里面有 ul/ol */
function isTocContainer(el: Element): boolean {
  const heads = [...el.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const hasTocHead = heads.some((h) => /^\s*(目\s*录|contents|table of contents)\s*$/i.test((h.textContent ?? '').trim()));
  // 也认 `<nav class="toc">` / `id=toc` 这种显式写法
  const explicit = /(^|[\s_-])toc($|[\s_-])/i.test(`${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''}`);
  if (!hasTocHead && !explicit) return false;
  const list = el.querySelector('ol,ul');
  return !!list && list.querySelectorAll('li').length >= 2;
}

function text(el: Element): string {
  return (el.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

/** 多行文本（保留 <br> 造成的换行） */
function multiline(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (clone.textContent ?? '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();
}

/** 取最近一个可识别的祖先的 caption（figure > figcaption） */
function captionOf(el: Element): string {
  const cap = el.querySelector(':scope > figcaption, :scope > caption');
  return cap ? text(cap) : '';
}

/**
 * 列表项文字：去掉**渲染出来的**项目符号/序号。
 * （本工程导出的 `ul/ol` 里，项目符号是 li 内的文本，如 `•甲`；读回来时不能带上它）
 */
function cleanItem(s: string): string {
  return s
    .replace(/^[\s•·▪◦‣*\-–—]+/, '')
    .replace(/^\d+[.、)]\s*/, '')
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 段落是**富文本**（`props.html`）：只保留一小撮行内标签与安全的样式属性，其余标签拆掉但保留文字 */
const INLINE_OK = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'BR', 'SUB', 'SUP', 'CODE', 'MARK', 'SPAN', 'A']);
const STYLE_OK = /^(color|font-weight|font-style|text-decoration|font-size|font-family|background-color)$/;

function sanitizeInline(el: Element): string {
  const out: string[] = [];
  const walkNode = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      out.push(escapeHtml(n.textContent ?? ''));
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    const tag = e.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    if (!INLINE_OK.has(tag)) {
      [...e.childNodes].forEach(walkNode);
      return;
    }
    if (tag === 'BR') {
      out.push('<br>');
      return;
    }
    const attrs: string[] = [];
    const style = e.getAttribute('style') ?? '';
    const kept = style
      .split(';')
      .map((s) => s.trim())
      .filter((s) => STYLE_OK.test((s.split(':')[0] ?? '').trim().toLowerCase()));
    if (kept.length) attrs.push(`style="${escapeHtml(kept.join('; '))}"`);
    if (tag === 'A') {
      const href = e.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) attrs.push(`href="${escapeHtml(href)}"`);
    }
    const lower = tag.toLowerCase();
    out.push(`<${lower}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
    [...e.childNodes].forEach(walkNode);
    out.push(`</${lower}>`);
  };
  [...el.childNodes].forEach(walkNode);
  return out.join('');
}

function node(type: string, mode: EditorMode, props: Record<string, unknown>): ComponentNode | null {
  const def = getComponent(type);
  if (!def) return null;
  const n = createNode(def, mode);
  n.props = { ...n.props, ...props };
  return n;
}

/** 一个元素 → 若干节点（不递归子节点；由 walk 负责） */
function one(el: Element, mode: EditorMode, stats: ImportStats, warnings: string[]): ComponentNode[] {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) {
    stats.skipped += 1;
    return [];
  }

  // ① 导出物自带的标记优先
  const typed = el.getAttribute('data-node-type');
  const mapped = typed && getComponent(typed) ? typed : TAG_MAP[tag];

  if (mapped === 'table') {
    const tbl = tag === 'table' ? el : el.querySelector('table');
    const parsed = tbl ? parseTableHtml(tbl.outerHTML) : null;
    if (!parsed) return [];
    const t = node('table', mode, {
      data: parsed.data,
      headerRow: parsed.headerRow,
      cellStyles: parsed.cellStyles,
      caption: captionOf(tbl ?? el),
    });
    if (t) (typed ? (stats.typed += 1) : (stats.guessed += 1));
    return t ? [t] : [];
  }

  if (mapped === 'image') {
    // 兼容三种写法：裸 <img>、<figure><img>、导出物的 <div data-node-type="image"><figure>…
    const img = tag === 'img' ? el : el.querySelector('img');
    const src = resolveSrc(img?.getAttribute('src') ?? '');
    const n = node('image', mode, {
      src,
      alt: img?.getAttribute('alt') ?? '',
      caption: captionOf(el),
    });
    if (n) (typed ? (stats.typed += 1) : (stats.guessed += 1));
    if (src.startsWith('data:')) stats.inlineAssets += 1;
    else if (src) stats.remoteAssets += 1;
    return n ? [n] : [];
  }

  /**
   * ★目录：`<h3>目录</h3><ol>…</ol>` 这类是**文档目录**，不是"Word 列表"。
   *   （用户 2026-09-23 反馈："目录调用了 word 的列表，不是目录组件"）
   *   识别条件：容器里含"目录/目 录/contents"字样的标题，且有个 ul/ol 兄弟 —— 那就用 `toc` 组件，
   *   条目取 li 文本；条目里若带页码（如 `第一章 …… 1`）按 `标题|页码` 写进 `entries`。
   */
  if (isTocContainer(el)) {
    const list = el.querySelector('ol,ul');
    const items = [...(list?.querySelectorAll('li') ?? [])].map((li) => cleanItem(multiline(li))).filter(Boolean);
    if (items.length) {
      const entries = items
        .map((raw) => {
          const m = /^(.*?)[\s.·…]*?(\d+|[IVXLC]+)$/.exec(raw);
          return m ? `${m[1].trim()}|${m[2]}` : raw;
        })
        .join('\n');
      const titleEl = el.querySelector('h1,h2,h3,h4,h5,h6');
      const t = node('toc', mode, {
        entries,
        title: titleEl ? text(titleEl) : '目　录',
        showTitle: true,
        showPageNumbers: true,
      });
      if (t) {
        stats.guessed += 1;
        stats.tocFound += 1;
        return [t];
      }
    }
  }

  switch (mapped) {
    case 'heading': {
      // 导出物是 `<div data-node-type="heading"><h2>…</h2></div>`：层级与文字都从内层 h* 取
      const inner = tag.startsWith('h') ? el : el.querySelector('h1,h2,h3,h4,h5,h6');
      const rawLevel = tag.startsWith('h') ? Number(tag.slice(1)) : Number(inner?.tagName.slice(1) ?? el.getAttribute('data-level') ?? 2);
      const body = text(inner ?? el);
      if (!body) {
        stats.skipped += 1;
        return [];
      }
      const n = node('heading', mode, { level: Number.isFinite(rawLevel) ? rawLevel : 2, text: body });
      if (n) (typed ? (stats.typed += 1) : (stats.guessed += 1));
      return n ? [n] : [];
    }
    case 'paragraph':
    case 'quote': {
      const body = multiline(el);
      if (!body) {
        stats.skipped += 1;
        return [];
      }
      // 段落组件用富文本 `html`（不是 text）：把行内内容消毒后放进去，粗体/颜色能留住
      const useHtml = getComponent(mapped)?.propSchema.some((p) => p.key === 'html') ?? false;
      const n = useHtml
        ? node(mapped, mode, { html: sanitizeInline(el) || escapeHtml(body), rich: true })
        : node(mapped, mode, { text: body });
      if (n) (typed ? (stats.typed += 1) : (stats.guessed += 1));
      return n ? [n] : [];
    }
    case 'code': {
      const code = el.querySelector('code') ?? el;
      const cls = code.getAttribute('class') ?? '';
      const lang = /language-([\w-]+)/.exec(cls)?.[1] ?? '';
      const n = node('code', mode, { text: multiline(code), lang });
      if (n) (typed ? (stats.typed += 1) : (stats.guessed += 1));
      return n ? [n] : [];
    }
    case 'divider':
      if (typed) stats.typed += 1;
      else stats.guessed += 1;
      return [node('divider', mode, {})].filter(Boolean) as ComponentNode[];
    case 'bullets':
    case 'list': {
      const scope = el.matches('ul,ol') ? ':scope > li' : 'li';
      const items = [...el.querySelectorAll(scope)].map((li) => cleanItem(multiline(li))).filter(Boolean);
      if (!items.length) {
        stats.skipped += 1;
        return [];
      }
      const n = node(mapped, mode, { items: items.join('\n'), ordered: mapped === 'list' });
      if (n) (typed ? (stats.typed += 1) : (stats.guessed += 1));
      return n ? [n] : [];
    }
    default:
      break;
  }

  // ② 未知 `data-node-type`：按组件建节点，props 用默认值（读不回来的就留默认）
  if (typed && getComponent(typed)) {
    const def = getComponent(typed)!;
    const guess: Record<string, unknown> = {};
    const t = text(el);
    if (def.propSchema.some((p) => p.key === 'text') && t) guess.text = t;
    else if (def.propSchema.some((p) => p.key === 'items')) {
      const items = [...el.querySelectorAll('li')].map((li) => cleanItem(text(li))).filter(Boolean);
      if (items.length) guess.items = items.join('\n');
    }
    const n = node(typed, mode, guess);
    stats.typed += 1;
    return n ? [n] : [];
  }

  // ③ 普通容器：不建节点，交给上层继续往下走
  if (FLOW_TAGS.has(tag) || tag === 'li' || tag === 'td' || tag === 'th' || tag === 'tr' || tag === 'tbody' || tag === 'thead') {
    return [];
  }

  const leftover = text(el);
  if (leftover) warnings.push(`未识别的元素 <${tag}>：文字「${leftover.slice(0, 20)}」已忽略`);
  stats.skipped += 1;
  return [];
}

function walk(el: Element, mode: EditorMode, stats: ImportStats, warnings: string[], out: ComponentNode[]): void {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) {
    stats.skipped += 1;
    return;
  }
  const own = one(el, mode, stats, warnings);
  if (own.length) {
    out.push(...own);
    // 容器类（分栏/卡片/Web 容器…）：把子元素继续往下导成**子节点**，结构不丢
    const first = own[0];
    if (getComponent(first.type)?.isContainer) {
      const kids: ComponentNode[] = [];
      for (const child of [...el.children]) walk(child, mode, stats, warnings, kids);
      first.children = kids;
    }
    return;
  }
  for (const child of [...el.children]) walk(child, mode, stats, warnings, out);
}

/** 把整篇 HTML（字符串）导入成编辑器文档 */
export function importHtml(html: string, opts: { mode?: EditorMode; baseUrl?: string } = {}): HtmlImportResult {
  const warnings: string[] = [];
  const stats: ImportStats = {
    top: 0,
    total: 0,
    typed: 0,
    guessed: 0,
    skipped: 0,
    tocFound: 0,
    inlineAssets: 0,
    remoteAssets: 0,
  };
  // 相对图片路径要有个基准：优先调用方给的（`?load=` / 「从 URL 载入」的真实地址）
  baseHref = opts.baseUrl ?? null;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 模式判断：导出物有 @page …mm（文档模式）；Web 模式导出的是固定 px 画布容器
  const styleText = [...doc.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  const pxCanvas = /position:\s*relative;\s*width:\s*\d+px;\s*height:\s*\d+px/i.test(html);
  const resolved: EditorMode = opts.mode ?? (pxCanvas && !/@page\s*\{[^}]*mm/i.test(styleText) ? 'web' : 'document');

  const root = doc.body ?? doc.documentElement;
  const components: ComponentNode[] = [];
  for (const child of [...root.children]) walk(child, resolved, stats, warnings, components);

  stats.top = components.length;
  const count = (list: ComponentNode[]): number =>
    list.reduce((n, x) => n + 1 + (x.children?.length ? count(x.children) : 0), 0);
  stats.total = count(components);
  if (stats.remoteAssets && !baseHref) {
    warnings.push(
      `${stats.remoteAssets} 张图片用的是相对路径/外链，而这次导入没有"来源地址"（本地文件导入时会这样）—— 需要在图片属性里重新选文件或填完整地址`,
    );
  }

  return {
    title: asString(doc.title) || '导入的 HTML',
    mode: resolved,
    components,
    stats,
    warnings,
  };
}

/**
 * 导入结果 → 可载入的 `EditorDocument`（`?load=` 与「文件 → 打开 HTML」共用）。
 * 文档模式内容放 `document.components`；Web 模式放 `web.root.children`（都是编辑器里的真源）。
 */
export function importHtmlToDocument(html: string, opts: { mode?: EditorMode; title?: string; baseUrl?: string } = {}): {
  doc: EditorDocument;
  result: HtmlImportResult;
} {
  const result = importHtml(html, opts);
  const doc = createInitialDocument();
  doc.mode = result.mode;
  doc.title = opts.title ?? result.title;
  if (result.mode === 'document') {
    doc.document.components = result.components;
  } else {
    doc.web.root.children = result.components;
  }
  return { doc, result };
}
