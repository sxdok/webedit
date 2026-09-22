/**
 * 职责：单位换算与数值格式化。文档模式按 96 DPI（1mm = 3.779528px；1pt = 96/72 px）。
 */

export const MM_TO_PX = 96 / 25.4; // 3.779527559...
export const PT_TO_PX = 96 / 72; // 1.333333...

export function mmToPx(mm: number): number {
  return mm * MM_TO_PX;
}

export function pxToMm(px: number): number {
  return px / MM_TO_PX;
}

export function ptToPx(pt: number): number {
  return pt * PT_TO_PX;
}

export function pxToPt(px: number): number {
  return px / PT_TO_PX;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** 带单位的数值格式化：mm/px 保留 1 位，pt 保留 1 位，% 保留 0 位 */
export function formatUnit(value: number, unit: 'mm' | 'px' | 'pt' | '%'): string {
  const digits = unit === '%' ? 0 : 1;
  return `${round(value, digits)}${unit}`;
}

/**
 * 解析带单位的输入（"12mm" / "12" / "50%"）→ 数值 + 单位。
 * 无法识别单位时按 fallbackUnit 处理。
 */
export function parseUnit(
  input: string,
  fallbackUnit: 'mm' | 'px' | 'pt' | '%' = 'px',
): { value: number; unit: 'mm' | 'px' | 'pt' | '%' } {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(mm|px|pt|%)?\s*$/i.exec(input);
  if (!m) return { value: 0, unit: fallbackUnit };
  const unit = (m[2]?.toLowerCase() as 'mm' | 'px' | 'pt' | '%' | undefined) ?? fallbackUnit;
  return { value: Number(m[1]), unit };
}

/** 把带单位的长度换算成 px（% 需要外部提供 reference 参考长度） */
export function lengthToPx(
  value: number,
  unit: 'mm' | 'px' | 'pt' | '%',
  reference = 0,
): number {
  switch (unit) {
    case 'mm':
      return mmToPx(value);
    case 'pt':
      return ptToPx(value);
    case '%':
      return (reference * value) / 100;
    case 'px':
    default:
      return value;
  }
}
