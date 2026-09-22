/**
 * 职责：缩放换算——把「适应宽度 / 适应页面」换算成 zoom 值。
 * 通过 #canvas-viewport 的实际可用尺寸计算，画布区尺寸变化后再次调用即可。
 */
import { DEVICE_PRESETS, PAGE_SIZES, type EditorMode } from '../../registry/types';
import { mmToPx } from '../../utils/units';

export interface ContentSize {
  /** 内容自身的 px 尺寸（未乘 zoom） */
  width: number;
  height: number;
}

export function contentSizeOf(
  mode: EditorMode,
  page: { width: number; height: number },
  canvas: { width: number; height: number },
): ContentSize {
  return mode === 'document'
    ? { width: mmToPx(page.width), height: mmToPx(page.height) }
    : { width: canvas.width, height: canvas.height };
}

/** 画布可视区尺寸（#canvas-viewport 的内尺寸，扣除内边距） */
export function viewportSize(): { width: number; height: number } {
  const el = document.getElementById('canvas-viewport');
  if (!el) return { width: 1200, height: 800 };
  const style = getComputedStyle(el);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  return {
    width: Math.max(80, el.clientWidth - padX),
    height: Math.max(80, el.clientHeight - padY),
  };
}

export function fitZoom(
  mode: EditorMode,
  page: { width: number; height: number },
  canvas: { width: number; height: number },
  kind: 'width' | 'page',
): number {
  const { width, height } = contentSizeOf(mode, page, canvas);
  const vp = viewportSize();
  const scale = kind === 'width' ? vp.width / width : Math.min(vp.width / width, vp.height / height);
  return Math.max(0.1, Math.min(4, Math.round(scale * 100) / 100));
}

/** 纸张/设备的显示名（状态栏用） */
export function sizeLabel(
  mode: EditorMode,
  page: { size: string; width: number; height: number; orientation: string },
  canvas: { device: string; width: number; height: number },
): string {
  if (mode === 'document') {
    const base = PAGE_SIZES[page.size as keyof typeof PAGE_SIZES];
    const name = base ? page.size : '自定义';
    return `${name} ${page.width}×${page.height}mm ${page.orientation === 'portrait' ? '纵向' : '横向'}`;
  }
  const preset = DEVICE_PRESETS[canvas.device as keyof typeof DEVICE_PRESETS];
  const name = preset ? canvas.device : '自定义';
  return `${name} ${canvas.width}×${canvas.height}px`;
}
