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

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
