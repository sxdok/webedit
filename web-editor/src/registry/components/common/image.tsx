/**
 * 组件：图片（image）—— **单图 / 多图同一个组件**（2026-09-23 用户要求）。
 *
 * 为什么合并：以前"并排双图"是另一个组件（`imagePair`），要三图、四图就没辙了。
 * 现在「图片」组件自带**图集**能力：填「多图（每行一张）」+「列数」，2/3/4 张并排都靠属性调，
 * 每张还能各带一条图题。`imagePair` 仍保留（老文档要能打开），但它渲染的就是本文件的同一个图集实现，
 * 并已从左侧组件面板隐藏（新组件请用「图片」）。
 *
 * 数据形态：
 *   · 单图：`props.src` + `props.caption`（老样子，完全兼容）；
 *   · 多图：`props.images`（多行文本，每行 `地址` 或 `地址 | 图题`；地址里的 `|` 会被当成图题分隔符，
 *     data:URL / 路径里不会有 `|`）+ `props.columns`（列数）+ `props.gap`（间距）。
 */
import { ImageIcon } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, RenderContext } from '../../types';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';

/** 多图：每行 `地址` 或 `地址 | 图题`；空行忽略 */
export function parseImageLines(raw: unknown): { src: string; caption: string }[] {
  return String(raw ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((line) => {
      const i = line.indexOf('|');
      if (i < 0) return { src: line.trim(), caption: '' };
      return { src: line.slice(0, i).trim(), caption: line.slice(i + 1).trim() };
    })
    .filter((it) => it.src !== '');
}

export interface ImageItem {
  src: string;
  caption: string;
}

/** 图集渲染（image 的多图模式与 imagePair 共用） */
export function renderImageGallery(
  items: ImageItem[],
  opts: {
    ctx: RenderContext;
    columns: number;
    gap: number;
    widthPct?: number;
    /** 单图模式的 mm 宽度（文档模式）与 px 宽度（Web 模式） */
    singleWidthMm: number;
    singleWidthPx: number;
    heightAuto: boolean;
    height: number;
    radius: number;
    borderWidth: number;
    borderColor: string;
    captionSize: number;
    captionColor: string;
    align: 'left' | 'center' | 'right';
    autoLabel?: string;
    groupCaption?: string;
    alt?: string;
  },
): React.ReactNode {
  const { ctx } = opts;
  const border = opts.borderWidth ? `${opts.borderWidth}px solid ${opts.borderColor}` : undefined;
  const capStyle: React.CSSProperties = {
    fontSize: ctx.mode === 'document' ? ctx.ptToPx(opts.captionSize) : opts.captionSize,
    color: opts.captionColor,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 1.4,
  };
  const placeholder = (label: string, w?: number, h = 110): React.ReactNode => (
    <div
      style={{ width: w ?? '100%', height: h, borderRadius: opts.radius, border: '1px dashed #d1d5db' }}
      className="flex flex-col items-center justify-center gap-1 bg-gray-50 text-2xs text-gray-400"
    >
      <ImageIcon className="h-4 w-4" />
      {label}
    </div>
  );

  /* ── 单图 ── */
  if (items.length <= 1) {
    const one = items[0];
    const w = ctx.mode === 'document' ? ctx.mmToPx(opts.singleWidthMm) : opts.singleWidthPx;
    const box: React.CSSProperties = { display: 'block', width: w, borderRadius: opts.radius, border };
    const capText = [opts.autoLabel, one?.caption || opts.groupCaption].filter(Boolean).join('  ');
    const alignMap = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;
    return (
      <figure
        data-width-box="1"
        style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: alignMap[opts.align] }}
      >
        {one?.src ? (
          <img
            src={one.src}
            alt={one.caption || opts.alt || ''}
            style={{ ...box, height: opts.heightAuto ? 'auto' : opts.height }}
          />
        ) : (
          placeholder('点击上传图片（在右侧属性面板选择本地文件或填地址）', w, opts.heightAuto ? 140 : opts.height)
        )}
        {capText && (
          <figcaption data-figure-caption="1" data-auto-label={opts.autoLabel || undefined} style={{ ...capStyle, textAlign: opts.align }}>
            {capText}
          </figcaption>
        )}
      </figure>
    );
  }

  /* ── 多图（网格）── */
  const cols = Math.min(Math.max(1, Math.round(opts.columns)), 5);
  return (
    <div data-width-box="1" style={{ width: `${opts.widthPct ?? 100}%`, boxSizing: 'border-box' }}>
      <div
        data-image-gallery="1"
        data-gallery-columns={cols}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: opts.gap }}
      >
        {items.map((it, i) => (
          <figure key={i} style={{ margin: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {it.src ? (
              <img
                src={it.src}
                alt={it.caption || ''}
                style={{
                  width: '100%',
                  display: 'block',
                  borderRadius: opts.radius,
                  border,
                  height: opts.heightAuto ? 'auto' : opts.height,
                  objectFit: 'contain',
                }}
              />
            ) : (
              placeholder(`图 ${i + 1}`, undefined, opts.heightAuto ? 110 : opts.height)
            )}
            {it.caption && (
              <figcaption data-gallery-caption={i + 1} style={capStyle}>
                {it.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {(opts.autoLabel || opts.groupCaption) && (
        <div data-figure-caption="1" data-auto-label={opts.autoLabel || undefined} style={capStyle}>
          {[opts.autoLabel, opts.groupCaption].filter(Boolean).join('  ')}
        </div>
      )}
    </div>
  );
}

function ImageBody(props: ComponentProps, ctx: RenderContext) {
  const gallery = parseImageLines(props.images);
  const single: ImageItem[] = [{ src: asString(props.src), caption: asString(props.caption) }];
  const items = gallery.length ? gallery : single;
  return renderImageGallery(items, {
    ctx,
    columns: asNumber(props.columns, 2),
    gap: asNumber(props.gap, 10),
    widthPct: asNumber(props.galleryWidth, 100),
    singleWidthMm: asNumber(props.width, 84),
    singleWidthPx: asNumber(props.width, 320),
    heightAuto: asBool(props.heightAuto, true),
    height: asNumber(props.height, 200),
    radius: asNumber(props.borderRadius, 0),
    borderWidth: asNumber(props.borderWidth, 0),
    borderColor: asString(props.borderColor, '#e5e7eb'),
    captionSize: asNumber(props.captionSize, 10.5),
    captionColor: asString(props.captionColor, '#6b7280'),
    align: asEnum(props.align, ['left', 'center', 'right'] as const, 'center'),
    autoLabel: asString(ctx.autoLabel),
    groupCaption: gallery.length ? asString(props.caption) : '',
    alt: asString(props.alt),
  });
}

export const imageComponent: ComponentDefinition = {
  type: 'image',
  label: '图片（支持多图）',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: ImageIcon,
  description: '单图或**图集**：填「多图」+「列数」即可 2/3/4 张并排，每张各带图题；支持宽度/圆角/边框',
  defaultFrame: { x: 60, y: 160, w: 320, h: 160 },
  defaultProps: {
    src: '',
    images: '',
    columns: 2,
    gap: 10,
    galleryWidth: 100,
    alt: '',
    width: 84,
    heightAuto: true,
    height: 200,
    align: 'center',
    borderRadius: 0,
    borderWidth: 0,
    borderColor: '#e5e7eb',
    caption: '',
    captionSize: 10.5,
    captionColor: '#6b7280',
  },
  propSchema: [
    { key: 'src', label: '图片（单图）', control: 'image', group: '内容', defaultValue: '', placeholder: '图片地址或 data:URL' },
    {
      key: 'images',
      label: '多图（一行一张：地址 + 图题；＋加行 / −减行，最多 5 张）',
      control: 'imageRows',
      group: '内容',
      defaultValue: '',
    },
    { key: 'columns', label: '列数（多图时生效，最多 5 列）', control: 'number', group: '尺寸', defaultValue: 2, min: 1, max: 5 },
    { key: 'gap', label: '图间距 px（多图）', control: 'number', group: '尺寸', defaultValue: 10, min: 0, max: 80 },
    { key: 'galleryWidth', label: '整体宽度 %（多图）', control: 'slider', group: '尺寸', defaultValue: 100, min: 20, max: 100, step: 5 },
    { key: 'width', label: '宽度（单图；文档模式按 mm）', control: 'unit', group: '尺寸', defaultValue: 84, unit: 'mm', min: 5, max: 400 },
    { key: 'heightAuto', label: '高度自适应', control: 'switch', group: '尺寸', defaultValue: true },
    { key: 'height', label: '高度', control: 'number', group: '尺寸', defaultValue: 200, min: 20, max: 1200, visibleWhen: (p) => p.heightAuto === false },
    { key: 'align', label: '对齐（单图）', control: 'align', group: '排版', defaultValue: 'center' },
    { key: 'caption', label: '图题（单图；多图时作为整组图题）', control: 'text', group: '内容', defaultValue: '' },
    { key: 'captionSize', label: '图题字号', control: 'unit', group: '排版', defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    { key: 'captionColor', label: '图题颜色', control: 'color', group: '排版', defaultValue: '#6b7280' },
    { key: 'borderRadius', label: '圆角', control: 'number', group: '外观', defaultValue: 0, min: 0, max: 80 },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: '外观', defaultValue: 0, min: 0, max: 20 },
    { key: 'borderColor', label: '边框色', control: 'color', group: '外观', defaultValue: '#e5e7eb' },
  ],
  render: (props, ctx) => ImageBody(props, ctx),
};
