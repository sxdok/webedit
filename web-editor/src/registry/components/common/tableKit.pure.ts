/**
 * 表格数据模型的**规范实现**（唯一手写来源）—— 编辑器与 MCP 共用同一份。
 *
 * ★本文件是 **P1④「表格内核同源」**的载体：
 *   · 编辑器侧 `tableKit.tsx` 只做 `export * from './tableKit.pure'`（React 渲染等专属实现留在那边）；
 *   · MCP 侧 `editor-mcp/src/engine/tableKit.ts` 由 `tools/sync-contracts.mjs` **原样复制**本文件生成 —— 
 *     手写两份的时代结束，机械护栏是 `sync-contracts --check`，语义护栏是 65 例一致性测试。
 *
 * ★必须保持**零依赖**（不 import 任何东西）：它要同时编译进浏览器包与 Node 的 MCP。
 *
 * 语义（与编辑器完全一致，改这里等于同时改两端）：
 *   · `data` 文本：一行一条记录，格与格用 `|` 分列；`\|` = 格内竖线、`\n` = 格内换行、`\\` = 反斜杠；
 *   · 单元格格式：Excel **A1 记法** 的键（`B2` / 合并区 `B2:C3`），旧数据 `"行,列"` 读取时兼容；
 *   · 合并：范围键本身即"已合并"，被覆盖的格子不渲染；
 *   · 插入/删除行列要**同步平移**格式键与列宽。
 */


export interface CellStyle {
  background?: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  fontWeight?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  valign?: 'top' | 'middle' | 'bottom';
  padding?: number;
  border?: { top?: number; right?: number; bottom?: number; left?: number; color?: string };
  merged?: boolean;
}

/** 单元格文本 → 文本视图里的写法（转义 `\`、`|`、换行） */
export function escapeCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '\\n');
}

/** 一行按**未转义**的 `|` 分列并还原转义 */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      const nx = line[i + 1];
      if (nx === '|') {
        cur += '|';
        i += 1;
        continue;
      }
      if (nx === '\\') {
        cur += '\\';
        i += 1;
        continue;
      }
      if (nx === 'n') {
        cur += '\n';
        i += 1;
        continue;
      }
    }
    if (ch === '|') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseTableData(raw: unknown): string[][] {
  if (Array.isArray(raw)) {
    return (raw as unknown[][]).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []));
  }
  const text = String(raw ?? '');
  if (!text) return [];
  let lines = text.split('\n');
  if (text.endsWith('\n')) lines = lines.slice(0, -1);
  if (lines.every((l) => l.trim() === '')) return [];
  return lines.map(splitRow);
}

export function serializeTableData(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCell).join(' | ')).join('\n');
}

export function colName(c: number): string {
  let n = Math.max(0, Math.floor(c));
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function a1(r: number, c: number): string {
  return `${colName(c)}${r + 1}`;
}

export function a1Key(r0: number, c0: number, r1: number, c1: number): string {
  return r0 === r1 && c0 === c1 ? a1(r0, c0) : `${a1(r0, c0)}:${a1(r1, c1)}`;
}

export interface A1Range {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** 解析 A1 键 / `B2:C3` / 旧版 `"行,列"` → 0 基范围 */
export function parseA1(key: string): A1Range | null {
  const legacy = key.match(/^(\d+),(\d+)$/);
  if (legacy) {
    const r = Number(legacy[1]);
    const c = Number(legacy[2]);
    return { r0: r, c0: c, r1: r, c1: c };
  }
  const one = (s: string): { r: number; c: number } | null => {
    const m = s.match(/^([A-Za-z]+)(\d+)$/);
    if (!m) return null;
    let c = 0;
    for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { r: Number(m[2]) - 1, c: c - 1 };
  };
  const parts = key.split(':');
  const a = one(parts[0] ?? '');
  const b = one(parts[1] ?? parts[0] ?? '');
  if (!a || !b) return null;
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
}

export function normalizeKey(key: string): string | null {
  const p = parseA1(key);
  return p ? a1Key(p.r0, p.c0, p.r1, p.c1) : null;
}

const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
const VALIGNS = ['top', 'middle', 'bottom'] as const;

export function parseCellStyles(raw: unknown): Record<string, CellStyle> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, CellStyle> = {};
  for (const [rawKey, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeKey(rawKey);
    if (!key || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const src = v as Record<string, unknown>;
    const st: CellStyle = {};
    const bg = String(src.background ?? '').trim();
    if (bg) st.background = bg;
    const color = String(src.color ?? '').trim();
    if (color) st.color = color;
    const fs = Number(src.fontSize);
    if (Number.isFinite(fs) && fs > 0) st.fontSize = fs;
    if (src.bold === true) st.bold = true;
    const fw = Number(src.fontWeight);
    if (Number.isFinite(fw) && fw >= 100) st.fontWeight = fw;
    const align = String(src.align ?? '');
    if ((ALIGNS as readonly string[]).includes(align)) st.align = align as CellStyle['align'];
    const va = String(src.valign ?? '');
    if ((VALIGNS as readonly string[]).includes(va)) st.valign = va as CellStyle['valign'];
    const pad = Number(src.padding);
    if (Number.isFinite(pad) && pad >= 0 && src.padding !== '' && src.padding != null) st.padding = pad;
    if (src.merged === true) st.merged = true;
    if (src.border && typeof src.border === 'object' && !Array.isArray(src.border)) {
      const b = src.border as Record<string, unknown>;
      const nb: NonNullable<CellStyle['border']> = {};
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const n = Number(b[side]);
        if (Number.isFinite(n) && n > 0) nb[side] = n;
      }
      const bc = String(b.color ?? '').trim();
      if (bc) nb.color = bc;
      if (Object.keys(nb).length) st.border = nb;
    }
    if (Object.keys(st).length) out[key] = st;
  }
  return out;
}

/** 取某格生效的样式键：自己有就用自己；否则落在某个合并区里就用该区的键 */
export function cellStyleKeyAt(styles: Record<string, CellStyle>, r: number, c: number): string | null {
  const own = a1(r, c);
  if (styles[own]) return own;
  for (const key of Object.keys(styles)) {
    const p = parseA1(key);
    if (!p) continue;
    if (r >= p.r0 && r <= p.r1 && c >= p.c0 && c <= p.c1) return key;
  }
  return null;
}

/** 插入/删除行列后平移格式键（与编辑器同一规则） */
export function shiftCellKeys(
  styles: Record<string, CellStyle>,
  axis: 'row' | 'col',
  at: number,
  count: number,
): Record<string, CellStyle> {
  const out: Record<string, CellStyle> = {};
  const map1 = (r: number, c: number): { r: number; c: number } | null => {
    const idx = axis === 'row' ? r : c;
    if (count < 0) {
      const del = -count;
      if (idx >= at && idx < at + del) return null;
      const ni = idx >= at + del ? idx - del : idx;
      return axis === 'row' ? { r: ni, c } : { r, c: ni };
    }
    const ni = idx >= at ? idx + count : idx;
    return axis === 'row' ? { r: ni, c } : { r, c: ni };
  };
  for (const [key, st] of Object.entries(styles)) {
    const p = parseA1(key);
    if (!p) continue;
    const a = map1(p.r0, p.c0);
    const b = map1(p.r1, p.c1);
    if (!a || !b) continue;
    out[a1Key(a.r, a.c, b.r, b.c)] = st;
  }
  return out;
}

/** 列宽：逗号/空白分隔；纯数字按百分比（"20,50,30" → 20%/50%/30%），也可写 `35mm`、`40%` */
export function parseColWidths(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((w) => (/^\d+(\.\d+)?$/.test(w) ? `${w}%` : w));
}

/** 把一个范围的格子展开成单格 A1 键 */
export function keysInRange(range: A1Range): string[] {
  const out: string[] = [];
  for (let r = range.r0; r <= range.r1; r += 1) for (let c = range.c0; c <= range.c1; c += 1) out.push(a1(r, c));
  return out;
}
