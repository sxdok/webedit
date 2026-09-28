/**
 * PDF 空白页回归用的**固定样张**（ARCHITECTURE §7.5 E2-补 第 6 条的"固定样张"）。
 *
 * 为什么样张要写成代码而不是散落的 JSON 文件：
 *   · 每张样张都针对一个**已知根因**（B2 末尾/连续分页符、B3 跨页长表、B4 末块边距…），
 *     写成代码就能把"它想验什么"一起留在旁边；改的时候也看得见 diff；
 *   · 期望值不是"页数必须等于 3"这种脆断言（字号/字体差异都会让它红），而是**关系断言**：
 *       - 所有样张：**空白页 = 0**（这是本批修法的核心承诺）；
 *       - 末尾/连续分页符样张：页数必须与**不含该分页符的同内容样张相同**（B2 的回归护栏）；
 *       - 长表/多页样张：页数 > 1（证明它真的跨页了，否则"空白页 0"没有意义）；
 *       - 单页样张：页数 === 1（反向确认没有凭空多页）。
 *
 * 节点属性形状取自真实文档（`editor-mcp/workspace/*.editor.json`），不是猜的。
 */

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
  showHeader: false,
  showFooter: false,
  header: { left: '', center: '', right: '', fontSize: 10.5 },
  footer: { left: '', center: '', right: '', fontSize: 10.5 },
};

const COMMON = { marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 };

function heading(id, text, level = 1) {
  return {
    id,
    type: 'heading',
    props: { ...COMMON, marginTop: 12, marginBottom: 8, text, level, align: 'left', color: '#1f2329', fontSize: 18, fontWeight: 600 },
  };
}

function paragraph(id, html) {
  return {
    id,
    type: 'paragraph',
    props: { ...COMMON, html, align: 'left', fontSize: 12, lineHeight: 1.5, letterSpacing: 0, color: '#1f2329', firstLineIndent: 2, rich: true },
  };
}

function table(id, rows, caption = '') {
  const data = rows.map((r) => r.join(' | ')).join('\n');
  return {
    id,
    type: 'table',
    props: { ...COMMON, data, headerRow: true, headerCol: false, caption, captionAlign: 'left', captionSize: 10.5, variant: 'normal', width: 100 },
  };
}

function pageBreak(id) {
  return { id, type: 'pageBreak', props: { ...COMMON, label: '分页符', showLabel: false } };
}

/** 一个 1×1 透明 PNG（内嵌，不依赖网络） */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function image(id) {
  return {
    id,
    type: 'image',
    props: { ...COMMON, src: TINY_PNG, alt: '样张图片', caption: '末页图', width: 40, align: 'center' },
  };
}

/** 一段够长的正文（保证真能占到版面，而不是一两行就没了） */
const LOREM =
  '本段用于占位以验证跨页行为：可视化编辑器的排版源是流，分页交给浏览器完成；' +
  '导出 PDF 时由 Chromium 依据 @page 的纸张与页边距计算分页点，末块的下边距、表格的跨页策略、' +
  '以及分页符的规范化都会影响"到底几页"和"有没有空白页"。';

function doc(title, components) {
  return {
    id: `pdf-sample-${title}`,
    title,
    mode: 'document',
    document: { page: { ...A4 }, components },
    web: {
      canvas: { device: 'Desktop', width: 1440, height: 900, background: '#ffffff' },
      root: { id: 'webroot', type: 'container', props: {}, children: [] },
    },
    selectedIds: [],
  };
}

/** 多页内容（用于"末尾/连续分页符"两个变体的**同一份底稿**） */
function multiPageComponents() {
  const nodes = [heading('h1', 'PDF 样张 · 多页正文')];
  for (let i = 1; i <= 8; i += 1) nodes.push(paragraph(`p${i}`, `第 ${i} 段。${LOREM}`));
  nodes.push(table('t1', Array.from({ length: 24 }, (_, i) => [`行 ${i + 1}`, `内容 ${i + 1} —— 覆盖跨页重复表头与不拆行`]), '跨页长表（24 行）'));
  nodes.push(paragraph('p9', `末尾段。${LOREM}`));
  return nodes;
}

/**
 * @returns {{name: string, title: string, doc: object, checks: string[]}[]}
 *   checks 里的标记由检查脚本解释：
 *     'no-blank'      → 空白页必须为 0
 *     'multi-page'    → 页数必须 > 1（证明真跨页）
 *     'single-page'   → 页数必须 === 1
 */
export function buildPdfSamples() {
  const base = multiPageComponents();
  return [
    {
      name: 'multi-page',
      title: 'PDF样张·多页',
      doc: doc('PDF样张·多页', base),
      checks: ['no-blank', 'multi-page'],
    },
    {
      // B2①：末尾分页符 → 页数必须与上一张**相同**
      name: 'trailing-break',
      title: 'PDF样张·末尾分页符',
      doc: doc('PDF样张·末尾分页符', [...multiPageComponents(), pageBreak('pb1')]),
      checks: ['no-blank', 'same-as:multi-page'],
    },
    {
      // B2②：**连续**两个分页符 → 也只能算一次换页
      name: 'double-break',
      title: 'PDF样张·连续分页符',
      doc: doc('PDF样张·连续分页符', [...multiPageComponents(), pageBreak('pb1'), pageBreak('pb2')]),
      checks: ['no-blank', 'same-as:multi-page'],
    },
    {
      // B3：表格比一页还高 → 不许"整表跳到下一页"留下一整页空白
      name: 'long-table',
      title: 'PDF样张·超长表格',
      doc: doc('PDF样张·超长表格', [
        heading('h1', 'PDF 样张 · 超长表格'),
        paragraph('p1', `表前说明。${LOREM}`),
        table('t1', Array.from({ length: 60 }, (_, i) => [`行 ${i + 1}`, `超长表格第 ${i + 1} 行 —— 这行文字用来撑开高度`]), '超长表格（60 行）'),
        paragraph('p2', `表后说明。${LOREM}`),
      ]),
      checks: ['no-blank', 'multi-page'],
    },
    {
      // B4/反向：刚好一页的内容**不能**多出一页
      name: 'fits-one-page',
      title: 'PDF样张·单页',
      doc: doc('PDF样张·单页', [heading('h1', 'PDF 样张 · 单页'), paragraph('p1', `就一段。${LOREM}`)]),
      checks: ['no-blank', 'single-page'],
    },
    {
      // ⑤ 末页只有一张图（图片是"绘图对象"，能顺带验证空白页判定不是只看文字）
      name: 'image-last-page',
      title: 'PDF样张·末页图片',
      doc: doc('PDF样张·末页图片', [
        heading('h1', 'PDF 样张 · 末页图片'),
        ...Array.from({ length: 6 }, (_, i) => paragraph(`p${i + 1}`, `占位段 ${i + 1}。${LOREM}`)),
        image('img1'),
      ]),
      checks: ['no-blank'],
    },
  ];
}
