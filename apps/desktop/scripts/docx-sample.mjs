/**
 * E1 的**固定样张**（Word 语义完整性）：1–6 级标题 + 内嵌图片 + 带 `{page}`/`{total}` 域的页眉页脚。
 *
 * 为什么样张要自己生成一张 PNG：验收要求"**用 Word 打开能看到图片**"，所以图必须是**有内容的**图
 * （1×1 透明像素在 PDF 里可能连绘图对象都算不上，验不出东西）。这里用 zlib 现造一张纯色 PNG。
 *
 * 页脚写「第 {page} 页 / 共 {total} 页」并让内容跨两页：如果域是真的，两页会分别显示
 * 「第 1 页 / 共 2 页」「第 2 页 / 共 2 页」；如果只是写死的文字，两页会一模一样 —— 这就能验出真假。
 */
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 造一张 `size × size` 的纯色 PNG（RGB） */
function solidPng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const raw = [];
  for (let y = 0; y < size; y += 1) {
    raw.push(Buffer.from([0])); // filter: none
    const row = Buffer.alloc(size * 3);
    for (let x = 0; x < size; x += 1) {
      row[x * 3] = r;
      row[x * 3 + 1] = g;
      row[x * 3 + 2] = b;
    }
    raw.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const COMMON = { marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 };
const A4 = {
  size: 'A4',
  width: 210,
  height: 297,
  orientation: 'portrait',
  margin: { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 },
  background: '#ffffff',
  defaultFont: '宋体',
  defaultFontSize: 12,
  lineHeight: 1.5,
  showHeader: true,
  header: { left: 'E1 页眉自检', center: '', right: '{date}', fontSize: 10.5, color: '#666666', showBorder: true, offset: 12 },
  showFooter: true,
  footer: {
    left: '可视化编辑器',
    center: '',
    right: '第 {page} 页 / 共 {total} 页',
    fontSize: 10.5,
    color: '#666666',
    showBorder: false,
    offset: 12,
  },
  numbering: { hideFirstPage: false, frontMatterPages: 0, bodyRestart: false, bodyStartPage: 1 },
};

const heading = (id, text, level) => ({
  id,
  type: 'heading',
  props: { ...COMMON, marginTop: 10, marginBottom: 6, text, level, align: 'left', color: '#1f2329', fontSize: 16, fontWeight: 600 },
});

const paragraph = (id, html) => ({
  id,
  type: 'paragraph',
  props: { ...COMMON, html, align: 'left', fontSize: 12, lineHeight: 1.5, letterSpacing: 0, color: '#1f2329', firstLineIndent: 2, rich: true },
});

const FILLER = '这一段用来把内容推到第二页：Word 里页脚显示的是**域**（第 X 页 / 共 N 页），只有真跨页才能验出第二页的页码会跟着变。';

export function buildDocxSample() {
  const components = [];
  for (let l = 1; l <= 6; l += 1) {
    components.push(heading(`h${l}`, `${l} 级标题（Heading${l}）`, l));
    components.push(paragraph(`p${l}`, `这是 ${l} 级标题下的正文。${FILLER}`));
  }
  components.push({
    id: 'img1',
    type: 'image',
    props: {
      ...COMMON,
      src: `data:image/png;base64,${solidPng(64, [220, 38, 38]).toString('base64')}`,
      alt: '红色方块（E1 内嵌自检）',
      caption: '图 1　E1 内嵌图片自检',
      width: 40,
      align: 'center',
    },
  });
  for (let i = 0; i < 4; i += 1) components.push(paragraph(`pf${i}`, `补充段落 ${i + 1}。${FILLER}`));

  return {
    id: 'docx-sample-e1',
    title: 'E1 样张·Word 语义',
    mode: 'document',
    document: { page: { ...A4 }, components },
    web: { canvas: { device: 'Desktop', width: 1440, height: 900, background: '#ffffff' }, root: { id: 'webroot', type: 'container', props: {}, children: [] } },
    selectedIds: [],
  };
}
