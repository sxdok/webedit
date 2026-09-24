/**
 * 职责：把当前模式的内容序列化成**静态交付物**——导出 HTML。
 * （Word 交付走 `utils/export/docx.ts` 的真 `.docx`；`2026-09-23` 起不再导出 `.doc` 版式。）
 *
 * 做法：直接复用组件注册表的 `render()`，用 `renderToStaticMarkup` 把 React 树渲染成静态 HTML 字符串。
 *   · 组件本身用的是内联样式，所以导出物与画布所见一致，不依赖编辑器运行时；
 *   · 少数组件里用到的 Tailwind 工具类由 `utilCss()` 按需补一份最小 CSS（导出物不引 Tailwind）；
 *   · 文档模式：内容以"流"输出，分页交给浏览器（`@page` 用文档页边距 + 分页避免切断块）；
 *   · Web 模式：HTML 导出为"设备尺寸容器 + 绝对定位子元素"的忠实快照。
 *   · 每个顶层块都带 `data-node-type`（自描述，也让 `?load=` / 「打开 HTML」能原样读回）。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getComponent } from '../../registry';
import {
  type ComponentNode,
  type EditorDocument,
  type EditorMode,
  type RenderContext,
} from '../../registry/types';
import { mmToPx, ptToPx } from '../units';
import { asNumber, asString } from '../id';
import { fontStack } from '../fonts';

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
  const ml = asNumber(n.props.marginLeft, 0);
  const mr = asNumber(n.props.marginRight, 0);
  // ★组件自己选了字体就带上（文档模式所有组件都有这个属性）；空 = 跟随页面默认字体（外层已设）
  const fontFamily = asString(n.props.fontFamily, '');
  const style: React.CSSProperties =
    mode === 'document'
      ? {
          marginTop: mt ? mmToPx(mt) : undefined,
          marginBottom: mb ? mmToPx(mb) : undefined,
          // 左右边距（2026-09-23 新增）：与画布一致，导出物也按 mm 生效
          marginLeft: ml ? mmToPx(ml) : undefined,
          marginRight: mr ? mmToPx(mr) : undefined,
          fontFamily: fontFamily ? fontStack(fontFamily) : undefined,
        }
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
  // ★导出物带上 `data-node-type`：① 便于外部工具/人看懂结构；
  //   ② 让「?load=」能把本工程导出的 HTML **原样读回**编辑器（见 utils/htmlImport.ts）。
  return React.createElement('div', { key: n.id, style, 'data-node-type': n.type }, content);
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

/* 2026-09-23 用户要求：**移除导出 .doc**（HTML 版式的 Word，Word 打开是「网页文档」，纸张/分页不是 Word 对象模型）。
   现在只保留真 .docx（见 utils/export/docx.ts）。原来的 buildWordDoc / bandToWordHtml / wordBandElement 一并删除，避免死代码。 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
