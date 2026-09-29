/**
 * 职责：ID 生成与组件属性取值守卫（避免 any 滥用，属性读取一律走这里）。
 */

/** 短 ID：优先 crypto.randomUUID，退化到时间戳 + 随机串 */
export function createId(prefix = 'n'): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${uuid}`;
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

export function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** 二维数组（表格 data / 标签页 items 等） */
export function asMatrix(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  return v.map((row) => (Array.isArray(row) ? row.map((c) => asString(c)) : []));
}

/** 取 props 里的枚举值（不在候选里则回退默认） */
export function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = asString(v);
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}
