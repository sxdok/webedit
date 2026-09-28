/**
 * 职责：**导出真正的 Word `.docx`**（B15，OOXML + 自带最小 ZIP writer，不引第三方依赖）。
 *
 * 为什么不是"HTML 改后缀"：`.doc`（HTML 版式）在 Word 里是"网页文档"，页边距/纸张/分页/编号
 * 都不是 Word 的对象模型；`.docx` 是 OOXML 包（一堆 XML 打进 ZIP），Word 打开后是**真正的文档**，
 * 能继续用 Word 的样式、分页、列表编号。
 *
 * 本文件包含：
 *   ① ZIP 打包（**只用 STORE，不压缩**：docx 允许，Word/WPS/python-docx 都能打开）；
 *   ② 组件树 → `word/document.xml` 的映射（标题/正文/列表/引用/代码/表格/分隔线/分页/页边距/字体）；
 *   ③ 最小 `[Content_Types].xml` / `_rels` / `styles.xml` / `numbering.xml`。
 *
 * 已知取舍（如实写在 README「十四」B15）：**图片不内嵌**（需要 media 关系与二进制部件），
 * 导出成一段「[图片：alt]」占位；跨页续表、单元格合并等按表格原样输出，不做 Word 级重排。
 */
import { getForest } from '../../store/treeUtils';
import { parseColWidths, parseRowHeight, parseRowHeights, parseTableData } from '../../registry/components/common/tableKit';
import { asNumber, asString } from '../id';
import { mmToPx } from '../units';
import { normalizeBreaks } from '../pageBreak';
import type { ComponentNode, EditorDocument, EditorMode } from '../../registry/types';

/* ══════════════ ① ZIP（STORE） ══════════════ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** 打一个 STORE 模式的 ZIP（本地头 + 中央目录 + EOCD；文件名带 UTF-8 标志位） */
export function zipStore(entries: ZipEntry[], now = new Date()): Uint8Array {
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = utf8(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    chunks.push(local, e.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + size;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, eocd]) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/* ══════════════ ② XML 片段 ══════════════ */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** 组件里的富文本 html → 纯文本（保留 <br> 断行） */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** 取一个组件"要写进 Word 的文字"（与 Markdown 导出同一套取法，保持两种导出观感一致） */
function textOf(node: ComponentNode): string {
  const p = node.props as Record<string, unknown>;
  for (const k of ['text', 'html', 'content', 'title', 'caption', 'label', 'value', 'desc', 'items', 'data']) {
    const v = p[k];
    const s =
      typeof v === 'string'
        ? k === 'html'
          ? stripHtml(v)
          : v
        : Array.isArray(v)
          ? v.map((x) => asString((x as Record<string, unknown>)?.text)).filter(Boolean).join('\n')
          : '';
    if (s.trim()) return s;
  }
  return '';
}

interface RunOpts {
  bold?: boolean;
  sizePt?: number;
  font?: string;
  mono?: boolean;
}

function run(text: string, opts: RunOpts = {}): string {
  const font = opts.mono ? 'Consolas' : (opts.font ?? '宋体');
  const sz = Math.round((opts.sizePt ?? 10.5) * 2); // 半磅
  const parts = text.split('\n');
  const rPr =
    `<w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}"/>` +
    (opts.bold ? '<w:b/>' : '') +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return parts
    .map((t, i) => `<w:r>${rPr}${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`)
    .join('');
}

/** 段落：可选样式 / 对齐 / 缩进 / 列表编号 */
function para(
  text: string,
  opts: RunOpts & { style?: string; align?: string; indentFirst?: boolean; numId?: number; spacingAfter?: number } = {},
): string {
  const pPr: string[] = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.numId) pPr.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${opts.numId}"/></w:numPr>`);
  if (opts.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
  const ind = [opts.indentFirst ? 'w:firstLine="480"' : '', opts.numId ? 'w:left="420" w:hanging="420"' : '']
    .filter(Boolean)
    .join(' ');
  if (ind) pPr.push(`<w:ind ${ind}/>`);
  if (opts.spacingAfter != null) pPr.push(`<w:spacing w:after="${opts.spacingAfter}"/>`);
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${run(text, opts)}</w:p>`;
}

/** 表格：全框线 + 表头加粗；列宽按 `colWidths`（百分比）换算成 pct 单元格宽 */
function tableXml(node: ComponentNode, font: string): string {
  const rows = parseTableData(node.props.data);
  if (!rows.length) return '';
  const width = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
  const headerRow = node.props.headerRow !== false;
  const headerBg = asString(node.props.headerBackground, '#e8f1f9');
  const pcts = parseColWidths(node.props.colWidths);
  const rowH = parseRowHeight(node.props.rowHeight);
  const rowHeights = parseRowHeights(node.props.rowHeights);
  const border = asString(node.props.borderColor, '#c9d6e2');

  const cellW = (c: number): string => {
    const pct = Number(String(pcts[c] ?? '').replace('%', ''));
    return Number.isFinite(pct) && pct > 0
      ? `<w:tcW w:w="${Math.round(pct * 50)}" w:type="pct"/>` // pct 单位：50 = 100%
      : `<w:tcW w:w="${Math.round(5000 / width)}" w:type="pct"/>`;
  };

  const body = rows
    .map((r, ri) => {
      const head = headerRow && ri === 0;
      const cells = Array.from({ length: width }, (_, c) => {
        const txt = r[c] ?? '';
        const shd = head ? `<w:shd w:val="clear" w:color="auto" w:fill="${esc(headerBg.replace('#', ''))}"/>` : '';
        return (
          `<w:tc><w:tcPr>${cellW(c)}${shd}<w:vAlign w:val="center"/></w:tcPr>` +
          para(txt, { bold: head, sizePt: asNumber(node.props.fontSize, 10.5), font }) +
          '</w:tc>'
        );
      }).join('');
      // 行高：按行覆盖优先（拖行边界写的就是它），否则用整表默认
      const perRow = parseRowHeight((rowHeights as Record<string, unknown>)[String(ri + 1)]);
      const hMm = Number(String(perRow ?? rowH ?? '').replace('mm', ''));
      const h = Number.isFinite(hMm) && hMm > 0 ? `<w:trPr><w:trHeight w:val="${Math.round(hMm * 56.7)}"/></w:trPr>` : '';
      return `<w:tr>${h}${cells}</w:tr>`;
    })
    .join('');

  const borders =
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${esc(border.replace('#', ''))}"/>`)
      .join('')}</w:tblBorders>`;

  const caption = asString(node.props.caption);
  const capPara = caption ? para(caption, { bold: true, sizePt: asNumber(node.props.captionSize, 10.5), font }) : '';
  // 表格后面必须有一个段落，否则 Word 认为文档结构不完整
  return `${capPara}<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}</w:tblPr><w:tblGrid>${Array.from(
    { length: width },
    () => '<w:gridCol w:w="1000"/>',
  ).join('')}</w:tblGrid>${body}</w:tbl>${para('')}`;
}

/* ══════════════ ③ 组件树 → document.xml ══════════════ */

const LIST_TYPES = new Set(['bullets', 'checkList']);
const ORDERED_TYPES = new Set(['list']);

function blocksOf(node: ComponentNode, pageFont: string, out: string[], warn: string[]): void {
  // ★组件自己选了字体就优先（文档模式下所有组件都有「字体」属性，空 = 跟随页面默认字体）
  const font = asString(node.props.fontFamily) || pageFont;
  const text = textOf(node);
  switch (node.type) {
    case 'heading':
    case 'slideTitle': {
      const level = Math.min(Math.max(asNumber(node.props.level, 2), 1), 4);
      out.push(para(text, { style: `Heading${level}`, sizePt: level === 1 ? 18 : level === 2 ? 15 : 12.5, bold: true, font }));
      break;
    }
    case 'paragraph':
    case 'lead':
    case 'footnote':
    case 'abstract':
      out.push(para(text, { sizePt: 10.5, font, indentFirst: true }));
      break;
    case 'quote':
    case 'quoteSlide':
      out.push(para(text, { sizePt: 10.5, font, style: 'Quote' }));
      break;
    case 'code':
      text.split('\n').forEach((l) => out.push(para(l, { sizePt: 9.5, mono: true })));
      break;
    case 'keywords':
      out.push(para(`关键词：${text.replace(/\n/g, '、')}`, { bold: true, sizePt: 10.5, font }));
      break;
    case 'table':
    case 'threeLineTable':
    case 'paramTable':
    case 'detailTable':
    case 'checkTable':
      out.push(tableXml(node, font));
      break;
    case 'image':
    case 'imagePair': {
      const alt = asString(node.props.alt) || asString(node.props.caption) || '图片';
      out.push(para(`[图片：${alt}]`, { sizePt: 10.5, font }));
      warn.push(`图片未内嵌（${alt}）—— .docx 里是占位文字`);
      break;
    }
    case 'divider':
      out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>');
      break;
    case 'pageBreak':
      out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      break;
    case 'spacer':
      out.push(para(''));
      break;
    default: {
      const isBullet = node.type === 'bullets' || LIST_TYPES.has(node.type);
      const isOrdered = ORDERED_TYPES.has(node.type) || node.props.ordered === true;
      const isCheck = node.type === 'checkList';
      if (isBullet || isOrdered || isCheck) {
        text
          .split('\n')
          .map((l) => l.replace(/^\s*[•·▪◦\-–—*]\s*/, '').replace(/^\d+[.、)]\s*/, '').trim())
          .filter(Boolean)
          .forEach((l) => {
            if (isCheck) out.push(para(`☐ ${l}`, { sizePt: 10.5, font }));
            else out.push(para(l, { sizePt: 10.5, font, numId: isOrdered ? 2 : 1 }));
          });
      } else if (text) {
        out.push(para(text, { sizePt: 10.5, font }));
      }
      break;
    }
  }
  for (const child of node.children ?? []) blocksOf(child, font, out, warn);
}

export interface DocxResult {
  bytes: Uint8Array;
  /** 段落/表格块数（自检与提示用） */
  blocks: number;
  warnings: string[];
}

/** 文档 → `.docx` 字节 */
export function buildDocx(doc: EditorDocument, topNodes?: ComponentNode[]): DocxResult {
  const mode: EditorMode = doc.mode;
  const page = doc.document.page;
  // ★B2：Word 打开也会因为"末尾/连续分页符"多一张白纸 → 与 HTML/打印共用同一份规范化
  const nodes = normalizeBreaks(topNodes ?? getForest(doc));
  const font = page.defaultFont || '宋体';
  const warnings: string[] = [];
  const blocks: string[] = [];
  for (const n of nodes) blocksOf(n, font, blocks, warnings);

  // 纸张与页边距（mm → twips：1mm = 56.6929 twips）
  const mm = (v: number): number => Math.round(v * 56.6929);
  const sizeW = mm(mode === 'document' ? page.width : doc.web.canvas.width / mmToPx(1));
  const sizeH = mm(mode === 'document' ? page.height : doc.web.canvas.height / mmToPx(1));
  const mar = {
    top: mm(page.margin.top),
    right: mm(page.margin.right),
    bottom: mm(page.margin.bottom),
    left: mm(page.margin.left),
  };
  const sectPr =
    `<w:sectPr><w:pgSz w:w="${sizeW}" w:h="${sizeH}"${page.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${mar.top}" w:right="${mar.right}" w:bottom="${mar.bottom}" w:left="${mar.left}" w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr>`;

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="${W}"><w:body>${blocks.join('')}${sectPr}</w:body></w:document>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}"/>` +
    `<w:sz w:val="${Math.round(page.defaultFontSize * 2)}"/><w:szCs w:val="${Math.round(page.defaultFontSize * 2)}"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:line="${Math.round(page.lineHeight * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    [1, 2, 3, 4]
      .map(
        (l) =>
          `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/>` +
          `<w:pPr><w:keepNext/><w:spacing w:before="${240 - l * 30}" w:after="${120 - l * 20}"/><w:outlineLvl w:val="${l - 1}"/></w:pPr>` +
          `<w:rPr><w:b/><w:sz w:val="${(l === 1 ? 18 : l === 2 ? 15 : 12.5) * 2}"/></w:rPr></w:style>`,
      )
      .join('') +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="420"/></w:pPr>` +
    `<w:rPr><w:i/><w:color w:val="3D4653"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>` +
    `</w:styles>`;

  const bullet = (id: number, fmt: string, lvlText: string): string =>
    `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0">` +
    `<w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${lvlText}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr></w:lvl></w:abstractNum>`;
  const numberingXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${W}">` +
    bullet(0, 'bullet', '\u2022') +
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0">' +
    '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
    '<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    '</w:numbering>';

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
    `</Relationships>`;

  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(doc.title || '未命名文档')}</dc:title><dc:creator>可视化编辑器</dc:creator>` +
    `<cp:lastModifiedBy>可视化编辑器</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>` +
    `</cp:coreProperties>`;

  const app =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>可视化编辑器（web-editor）</Application><Company></Company></Properties>`;

  const bytes = zipStore([
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rels) },
    { name: 'docProps/core.xml', data: utf8(core) },
    { name: 'docProps/app.xml', data: utf8(app) },
    { name: 'word/document.xml', data: utf8(documentXml) },
    { name: 'word/_rels/document.xml.rels', data: utf8(docRels) },
    { name: 'word/styles.xml', data: utf8(stylesXml) },
    { name: 'word/numbering.xml', data: utf8(numberingXml) },
  ]);

  return { bytes, blocks: blocks.length, warnings };
}

/** 生成 `.docx` 并触发下载 */
export function downloadDocx(doc: EditorDocument, topNodes?: ComponentNode[], filename?: string): DocxResult {
  const r = buildDocx(doc, topNodes);
  const blob = new Blob([r.bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `${doc.title || 'export'}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return r;
}

/** 自检/诊断用：读 ZIP **中央目录**里的部件名（顺带验证 ZIP 结构本身是否自洽） */
export function docxParts(bytes: Uint8Array): string[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out: string[] = [];
  const dec = new TextDecoder('utf-8');
  for (let i = 0; i < count; i += 1) {
    if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    out.push(dec.decode(bytes.subarray(off + 46, off + 46 + nameLen)));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 供自检断言：这段字节是不是一个 ZIP（PK\x03\x04） */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
