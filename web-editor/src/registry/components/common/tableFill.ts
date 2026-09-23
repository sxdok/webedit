/**
 * 职责：**表格填充柄的序列推算**（B16）—— 像 Excel 那样拖选区右下角，往一个方向"续"出内容。
 *
 * 规则（只做可预期的几种，不硬猜复杂模式）：
 *   · **单格源**：纯数字 → 依次 +1、+2…；日期（`YYYY-MM-DD` / `YYYY/MM/DD`）→ 依次 +1 天、+2 天…；
 *     其它（文字）→ 原样重复。
 *   · **多格源（同一条线上）**：
 *     - 全是数字且**差分恒定** → 按等差数列继续（1,3,5 → 7,9…）；
 *     - 全是数字但差分不恒定 → 按源值**循环**（1,2,9 → 1,2,9…，Excel 也是这样）；
 *     - 其它 → 按源值循环。
 *   · 2 维源块：向下填充时**逐列**各推各的（Excel 行为）；向右填充时**逐行**。
 *
 * 返回值是"要写进目标位置的二维块"（不含源块本身），由调用方用 `writeCellBlock` 写回并记一次历史。
 */

/** 像不像数字（允许前后空格、正负号、小数） */
function num(v: string): number | null {
  const s = v.trim();
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** 像不像日期（只认 `YYYY-MM-DD` / `YYYY/MM/DD`；返回毫秒数） */
function dateMs(v: string): number | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

function fmtDate(ms: number, sep: string, pad: boolean): string {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(pad ? 2 : 1, '0');
  const dd = String(d.getUTCDate()).padStart(pad ? 2 : 1, '0');
  return `${d.getUTCFullYear()}${sep}${mm}${sep}${dd}`;
}

/** 保留源里的小数位（"1.50" → 继续按 2 位小数续） */
function fmtNum(n: number, sample: string): string {
  const m = /^-?\d+\.(\d+)$/.exec(sample.trim());
  if (!m) return String(n);
  return n.toFixed(m[1].length);
}

/** 一条线（一行或一列）的源值 → 继续 count 个值 */
export function continueSeries(line: string[], count: number): string[] {
  if (count <= 0 || line.length === 0) return [];
  const out: string[] = [];

  // ① 单格源
  if (line.length === 1) {
    const v = line[0];
    const n = num(v);
    if (n != null) {
      for (let i = 1; i <= count; i += 1) out.push(fmtNum(n + i, v));
      return out;
    }
    const t = dateMs(v);
    if (t != null) {
      const sep = v.includes('/') ? '/' : '-';
      const pad = /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(v.trim());
      for (let i = 1; i <= count; i += 1) out.push(fmtDate(t + i * 86400000, sep, pad));
      return out;
    }
    for (let i = 0; i < count; i += 1) out.push(v);
    return out;
  }

  // ② 多格源：全是数字 && 差分恒定 → 等差数列
  const nums = line.map(num);
  if (nums.every((x) => x != null)) {
    const diffs: number[] = [];
    for (let i = 1; i < nums.length; i += 1) diffs.push((nums[i] as number) - (nums[i - 1] as number));
    const step = diffs[0];
    if (diffs.every((d) => Math.abs(d - step) < 1e-9)) {
      const last = nums[nums.length - 1] as number;
      const sample = line[line.length - 1];
      for (let i = 1; i <= count; i += 1) out.push(fmtNum(last + step * i, sample));
      return out;
    }
  }

  // ③ 其它：按源循环
  for (let i = 0; i < count; i += 1) out.push(line[i % line.length]);
  return out;
}

/**
 * 拖填充柄要写进目标位置的块。
 * `source` 是源块（0 基、含表头行与否由调用方决定），`count` 是往某个方向续多少行/列。
 */
export function fillSeries(source: string[][], count: number, axis: 'down' | 'right'): string[][] {
  if (count <= 0 || source.length === 0) return [];
  if (axis === 'down') {
    const cols = Math.max(...source.map((r) => r.length), 1);
    const out: string[][] = [];
    for (let c = 0; c < cols; c += 1) {
      const col = source.map((r) => r[c] ?? '');
      const next = continueSeries(col, count);
      next.forEach((v, i) => {
        out[i] = out[i] ?? [];
        out[i][c] = v;
      });
    }
    return out.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''));
  }
  return source.map((row) => continueSeries(row, count));
}
