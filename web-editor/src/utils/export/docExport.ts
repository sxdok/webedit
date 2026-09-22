/**
 * 职责：把当前模式的内容序列化成**静态交付物**——导出 HTML 与导出 Word(.doc)。
 *
 * 做法：直接复用组件注册表的 `render()`，用 `renderToStaticMarkup` 把 React 树渲染成静态 HTML 字符串。
 *   · 组件本身用的是内联样式，所以导出物与画布所见一致，不依赖编辑器运行时；
 *   · 少数组件里用到的 Tailwind 工具类由 `utilCss()` 按需补一份最小 CSS（导出物不引 Tailwind）；
 *   · 文档模式：内容以"流"输出，分页交给浏览器/Word（`@page` 用文档页边距 + 分页避免切断块）；
 *   · Web 模式：HTML 导出为"设备尺寸容器 + 绝对定位子元素"的忠实快照；Word 不支持绝对定位，
 *     因此 Word 导出按流输出（在文档里说明这一限制）。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getComponent } from '../../registry';
import {
  pageBand,
  type ComponentNode,
  type EditorDocument,
  type EditorMode,
  type PageBandConfig,
  type RenderContext,
} from '../../registry/types';
import { mmToPx, ptToPx } from '../units';
import { asNumber, asString } from '../id';

/** 组件内用到的 Tailwind 工具类 → 等价 CSS（导出物自包含，不依赖 Tailwind） */
const UTIL: Record<string, string> = {
  flex: 'display:flex',
  'flex-col': 'flex-direction:column',
  'items-center': 'align-items:center',
  'justify-center': 'justify-content:center',
  'gap-1': 'gap:4px',
  border: 'border:1px solid #e5e7eb',
  'border-dashed': 'border-style:dashed',
  'border-gray-300': 'border-color:#d1d5db',
  'bg-gray-50': 'background:#f9fafb',
  'text-2xs': 'font-size:10px',
  'text-center': 'text-align:center',
  'text-gray-400': 'color:#9ca3af',
  'text-gray-500': 'color:#6b7280',
  rounded: 'border-radius:4px',
  'h-5': 'height:20px',
  'w-5': 'width:20px',
};

function utilCss(html: string): string {
  const found = new Set<string>();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach((c) => {
      if (UTIL[c]) found.add(c);
    });
  }
  return [...found].map((c) => `.${c}{${UTIL[c]}}`).join('\n');
}

function renderNode(n: ComponentNode, ctx: RenderContext, mode: EditorMode): React.ReactNode {
  const def = getComponent(n.type);
  if (!def || n.hidden) return null;
  const inner = def.render(n.props, ctx);
  const kids = def.isContainer ? (n.children ?? []).map((c) => renderNode(c, ctx, mode)) : null;
  const content =
    def.isContainer && React.isValidElement(inner)
      ? React.cloneElement(inner as React.ReactElement<{ children?: React.ReactNode }>, {}, kids)
      : inner;

  const mt = asNumber(n.props.marginTop, 0);
  const mb = asNumber(n.props.marginBottom, 0);
  const style: React.CSSProperties =
    mode === 'document'
      ? { marginTop: mt ? mmToPx(mt) : undefined, marginBottom: mb ? mmToPx(mb) : undefined }
      : n.frame
        ? {
            position: 'absolute',
            left: n.frame.x,
            top: n.frame.y,
            width: n.frame.w,
            height: n.frame.h,
            transform: n.frame.rotation ? `rotate(${n.frame.rotation}deg)` : undefined,
          }
        : {};
  return React.createElement('div', { key: n.id, style }, content);
}

/** 当前模式下、去掉编辑器外壳后的内容 HTML（不含 <html> 外壳） */
export function buildBodyHtml(
  doc: EditorDocument,
  mode: EditorMode = doc.mode,
  /** 当前模式的顶层节点（由 store 用 getForest(doc) 传入；不传则退回文档模式内容） */
  topNodes?: ComponentNode[],
): string {
  const ctx: RenderContext = {
    mode,
    page: doc.document.page,
    canvas: doc.web.canvas,
    isEditing: false,
    isSelected: false,
    mmToPx,
    ptToPx,
  };
  // ★顶层节点由调用方传入（store 用 getForest(doc) 取，与编辑器同源）。
  //   注意 doc.web.root 是"画布根容器节点"，不是顶层节点数组 —— 直接读它会把整块根容器当成一个组件。
  const nodes = topNodes ?? doc.document.components;
  const tree = React.createElement('div', null, ...nodes.map((n) => renderNode(n, ctx, mode)));
  return renderToStaticMarkup(tree);
}

/** 导出 HTML：自包含、可直接双击打开/打印 */
export function buildExportHtml(doc: EditorDocument, topNodes?: ComponentNode[]): string {
  const mode = doc.mode;
  const page = doc.document.page;
  const canvas = doc.web.canvas;
  const body = buildBodyHtml(doc, mode, topNodes);
  const size = mode === 'document' ? `${page.width}mm ${page.height}mm` : `${canvas.width}px ${canvas.height}px`;
  const margin =
    mode === 'document'
      ? `${page.margin.top}mm ${page.margin.right}mm ${page.margin.bottom}mm ${page.margin.left}mm`
      : '0';
  const canvasWrap =
    mode === 'web'
      ? `<div style="position:relative;width:${canvas.width}px;height:${canvas.height}px;background:${canvas.background}">${body}</div>`
      : body;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(asString(doc.title, '未命名文档'))}</title>
<style>
  @page { size: ${size}; margin: ${margin}; }
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: ${mode === 'document' ? `${page.margin.top}mm ${page.margin.right}mm ${page.margin.bottom}mm ${page.margin.left}mm` : '0 auto'};
    font-family: ${escapeHtml(page.defaultFont)}, serif;
    font-size: ${page.defaultFontSize}pt;
    line-height: ${page.lineHeight};
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  img, svg { max-width: 100%; }
  table { border-collapse: collapse; }
  /* 分页：整块不被切断 */
  body > div > div, table, tr, figure, blockquote { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
${utilCss(body)}
</style>
</head>
<body>
${canvasWrap}
</body>
</html>
`;
}

/** 导出 Word：Word 可直接打开的 .doc（HTML 版式，Word 会按 @page 段落设置排版） */
export function buildWordDoc(doc: EditorDocument, topNodes?: ComponentNode[]): string {
  const page = doc.document.page;
  // Word 对绝对定位支持很差：Web 模式也按"流"输出（保持可编辑的段落/表格）
  const body = buildBodyHtml(doc, 'document', topNodes);
  // 页眉/页脚是页面属性 → 导出成 Word 真正的页眉/页脚（会按页重复）
  const headCfg = pageBand(page, 'header');
  const footCfg = pageBand(page, 'footer');
  const headUsed = page.showHeader && !!(headCfg.left || headCfg.center || headCfg.right);
  const footUsed = page.showFooter && !!(footCfg.left || footCfg.center || footCfg.right);
  const bandElements = (headUsed ? wordBandElement('header', headCfg) : '') + (footUsed ? wordBandElement('footer', footCfg) : '');
  const bandRefs = `${headUsed ? 'mso-header: header1;' : ''}${footUsed ? 'mso-footer: footer1;' : ''}`;
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(asString(doc.title, '未命名文档'))}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
  @page WordSection1 { size: ${page.width}mm ${page.height}mm; margin: ${page.margin.top}mm ${page.margin.right}mm ${page.margin.bottom}mm ${page.margin.left}mm; ${bandRefs} mso-header-margin: ${headCfg.offset}mm; mso-footer-margin: ${footCfg.offset}mm; }
  div.WordSection1 { page: WordSection1; }
  body { font-family: "宋体", SimSun, serif; font-size: ${page.defaultFontSize}pt; line-height: ${page.lineHeight}; color: #000; }
  table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  td, th { vertical-align: top; }
  img { max-width: 100%; }
${utilCss(body)}
</style>
</head>
<body>
<div class="WordSection1">
${body}
${bandElements}
</div>
</body>
</html>
`;
}

/** 页眉/页脚文字里的变量 → Word 域代码（PAGE / NUMPAGES / DATE），Word 打开后是活域 */
function bandToWordHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\{page\}/g, "<span style='mso-field-code:PAGE'>1</span>")
    .replace(/\{total\}/g, "<span style='mso-field-code:NUMPAGES'>1</span>")
    .replace(/\{date\}/g, "<span style='mso-field-code:DATE'>2026-01-01</span>");
}

/** Word 的页眉/页脚元素（mso-element:header / footer），由 @page 的 mso-header/mso-footer 引用 */
function wordBandElement(which: 'header' | 'footer', cfg: PageBandConfig): string {
  const cls = which === 'header' ? 'MsoHeader' : 'MsoFooter';
  const parts = [cfg.left, cfg.center, cfg.right]
    .map((t) => bandToWordHtml(t))
    .filter((t) => t !== '');
  return `<div style='mso-element:${which}' id=${which}1>
<p class=${cls} style='margin:0;font-size:${cfg.fontSize}pt;color:${cfg.color}'>${parts.join('&nbsp;&nbsp;&nbsp;&nbsp;')}</p>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
