/**
 * 职责：**表格 HTML ↔ 组件数据** 的互转（表格组件的「HTML 源码」入口用）。
 *
 * 为什么单独一个纯模块：解析/序列化是**纯函数**（只依赖 DOM 的 DOMParser），
 * 自检可以直接调它做往返断言，不必去点界面。
 *
 * 对应关系（"用 HTML 代码写表格"）：
 *   `<tr>` / `<td>` / `<th>`      → 行 / 格（`props.data` 的文本行与 `|` 分列）
 *   `colspan` / `rowspan`          → 合并区（范围键 `B2:C3` + `merged: true`，被覆盖格不渲染）
 *   `<td bgcolor>` / `style="background(-color)"` → 单元格底色
 *   `style="color"` / `style="text-align"` / `style="vertical-align"` / `<b>|<strong>` → 文字色/水平/垂直/加粗
 *   `<br>`                         → 格内换行（存成 `\n`）
 *   首行是 `<th>`                  → `headerRow: true`
 */
import { a1, a1Key, parseCellStyles, parseTableData, serializeTableData, type CellStyle } from './tableKit';

export interface ParsedTable {
  /** 解析出的 `props.data` 文本（可直接写进组件） */
  data: string;
  headerRow: boolean;
  cellStyles: Record<string, CellStyle>;
  rows: number;
  cols: number;
}

/** 任意 CSS 颜色 → `#rrggbb`（DOMParser 会把 style 颜色规范化成 rgb(...)） */
function toHex(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return '';
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) {
    const h = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }
  return ''; // 命名色等拿不到 hex 就忽略（不猜）
}

/** 单元格文字：`<br>` → 换行；其余标签取文本；行首尾空白去掉、行内连续空白压成一个空格（与 HTML 一致） */
function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (clone.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n+$/, '');
}

/** pt/mm/px → pt 数值（只认 pt 与 px，其它忽略） */
function fontSizePt(raw: string): number | null {
  const m = raw.trim().match(/^([\d.]+)(pt|px)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2].toLowerCase() === 'px' ? Math.round(n * 0.75 * 2) / 2 : n;
}

/**
 * HTML → 表格数据。接受整段 `<table>…</table>`，也接受裸的 `<tr>…</tr>` 片段。
 * 解析不出任何行时返回 null（调用方据此提示"没找到表格"）。
 */
export function parseTableHtml(html: string): ParsedTable | null {
  const src = String(html ?? '').trim();
  if (!src) return null;
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const table = doc.querySelector('table');
  const trs = [...(table ?? doc).querySelectorAll('tr')];
  if (!trs.length) return null;

  const grid: string[][] = [];
  const styles: Record<string, CellStyle> = {};
  const covered = new Set<string>();
  let headerRow = false;

  trs.forEach((tr, r) => {
    if (r === 0 && tr.querySelector('th')) headerRow = true;
    const row = (grid[r] ??= []);
    let c = 0;
    for (const cell of [...tr.children]) {
      if (!/^(TD|TH)$/i.test(cell.tagName)) continue;
      while (covered.has(`${r},${c}`)) c += 1; // 被上面的 rowSpan 占掉的列跳过
      const colSpan = Math.max(1, Number((cell as HTMLTableCellElement).colSpan || 1));
      const rowSpan = Math.max(1, Number((cell as HTMLTableCellElement).rowSpan || 1));
      const el = cell as HTMLElement;
      row[c] = cellText(cell);

      const st: CellStyle = {};
      const bg = toHex(el.getAttribute('bgcolor') ?? '') || toHex(el.style.backgroundColor);
      if (bg) st.background = bg;
      const fg = toHex(el.getAttribute('color') ?? '') || toHex(el.style.color);
      if (fg) st.color = fg;
      const align = (el.style.textAlign || el.getAttribute('align') || '').toLowerCase();
      if (/^(left|center|right|justify)$/.test(align)) st.align = align as CellStyle['align'];
      const va = (el.style.verticalAlign || el.getAttribute('valign') || '').toLowerCase();
      if (/^(top|middle|bottom)$/.test(va)) st.valign = va as CellStyle['valign'];
      if (el.querySelector('b,strong') || /^(bold|[6-9]00)$/.test(el.style.fontWeight)) st.fontWeight = 700;
      const pt = fontSizePt(el.style.fontSize ?? '');
      if (pt) st.fontSize = pt;

      // 合并：锚点写范围键（与画布上"合并单元格"写的是同一种键）
      if (colSpan > 1 || rowSpan > 1) {
        const key = a1Key(r, c, r + rowSpan - 1, c + colSpan - 1);
        styles[key] = { ...(styles[key] ?? {}), merged: true };
        for (let rr = r; rr < r + rowSpan; rr += 1) {
          for (let cc = c; cc < c + colSpan; cc += 1) if (rr !== r || cc !== c) covered.add(`${rr},${cc}`);
        }
      }
      const own = a1(r, c);
      if (Object.keys(st).length) styles[own] = { ...(styles[own] ?? {}), ...st };
      c += colSpan;
    }
  });

  const cols = Math.max(1, ...grid.map((r) => r.length));
  grid.forEach((r) => {
    while (r.length < cols) r.push('');
  });
  return { data: serializeTableData(grid), headerRow, cellStyles: styles, rows: grid.length, cols };
}

/** 表格数据 → HTML（可直接粘到别处；合并/底色/对齐/`<br>` 都会带上） */
export function serializeTableHtml(props: Record<string, unknown>): string {
  const rows = parseTableData(props.data);
  if (!rows.length) return '';
  const headerRow = props.headerRow !== false;
  const styles = parseCellStyles(props.cellStyles);
  const colCount = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));

  // 合并区：锚点 → {rs,cs}；被覆盖的格不输出
  const spans = new Map<string, { rs: number; cs: number }>();
  const covered = new Set<string>();
  for (const [key, st] of Object.entries(styles)) {
    void st;
    const m = key.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) continue;
    const col = (s: string) => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const r0 = Number(m[2]) - 1;
    const c0 = col(m[1]);
    const r1 = m[4] ? Number(m[4]) - 1 : r0;
    const c1 = m[3] ? col(m[3]) : c0;
    if (r1 > r0 || c1 > c0) {
      spans.set(`${r0},${c0}`, { rs: r1 - r0 + 1, cs: c1 - c0 + 1 });
      for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) if (r !== r0 || c !== c0) covered.add(`${r},${c}`);
    }
  }

  const cssOf = (r: number, c: number): string => {
    const own = styles[a1(r, c)];
    const st = own ?? {};
    const parts: string[] = [];
    if (st.background) parts.push(`background-color:${st.background}`);
    if (st.color) parts.push(`color:${st.color}`);
    if (st.align) parts.push(`text-align:${st.align}`);
    if (st.valign) parts.push(`vertical-align:${st.valign}`);
    if (st.fontWeight) parts.push(`font-weight:${st.fontWeight}`);
    if (st.fontSize) parts.push(`font-size:${st.fontSize}pt`);
    if (st.padding !== undefined) parts.push(`padding:${st.padding}px`);
    const b = st.border;
    if (b) {
      const bc = b.color ?? '#c9d6e2';
      const side = (n: number | undefined) => (n ? `${n}px solid ${bc}` : null);
      parts.push(`border:${[b.top, b.right, b.bottom, b.left].map(side).filter(Boolean).join(' ') || 'none'}`);
    }
    return parts.length ? ` style="${parts.join(';')}"` : '';
  };

  const cellHtml = (r: number, c: number, tag: 'th' | 'td'): string => {
    const text = (rows[r]?.[c] ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sp = spans.get(`${r},${c}`);
    const attr = `${sp && sp.cs > 1 ? ` colspan="${sp.cs}"` : ''}${sp && sp.rs > 1 ? ` rowspan="${sp.rs}"` : ''}`;
    return `<${tag}${attr}${cssOf(r, c)}>${text.replace(/\n/g, '<br>')}</${tag}>`;
  };
  const rowHtml = (r: number, tag: 'th' | 'td'): string => {
    const cells: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      if (covered.has(`${r},${c}`)) continue;
      cells.push(cellHtml(r, c, tag));
    }
    return `    <tr>${cells.join('')}</tr>`;
  };

  const out: string[] = ['<table>'];
  const bodyStart = headerRow ? 1 : 0;
  if (headerRow) out.push('  <thead>', rowHtml(0, 'th'), '  </thead>');
  out.push('  <tbody>');
  for (let r = bodyStart; r < rows.length; r += 1) out.push(rowHtml(r, 'td'));
  out.push('  </tbody>', '</table>');
  return out.join('\n');
}
