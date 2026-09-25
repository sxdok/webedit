/**
 * 组件：图片（image）—— **一个组件、一个图片入口：一行一张图**（2026-09-23 用户要求）。
 *
 * 面板形态：属性面板里**只有**一个"图片"字段，默认就是 1 行（行首写「图片1」，行尾一个 ＋）；
 * 点 ＋ 在下面加一行（图片2、图片3…），新行行尾的 − 删掉那一行；最多 5 行。
 * 没有独立的"单图/多图"字段了（`src`/`caption` 仅作为老文档的兜底，见下）。
 *
 * 为什么合并：以前"并排双图"是另一个组件（`imagePair`），要三图、四图就没辙了。
 * 现在「图片」组件自带**图集**能力：填几行 + 「列数」，2/3/4 张并排都靠属性调，每张还能各带一条图题。
 * `imagePair` 仍保留（老文档要能打开），但它渲染的就是本文件的同一个图集实现，
 * 并已从左侧组件面板隐藏（新组件请用「图片」）。
 *
 * 数据形态：
 *   · 图集：`props.images`（多行文本，每行 `地址` 或 `地址 | 图题`；地址里的 `|` 会被当成图题分隔符，
 *     data:URL / 路径里不会有 `|`）+ `props.columns`（列数）+ `props.gap`（间距）；
 *   · 老的单图写法 `props.src` + `props.caption` 仍然照常渲染（老文档不受影响），
 *     面板里会把它当作第 1 行显示，编辑后迁移进 `images`。
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
  /** 这张图的旋转角度（0/90/180/270…，顺时针；用户 2026-09-24：每行图片单独可旋转） */
  rot?: number;
}

/**
 * `props.imageRotations`（一行一个角度，与 `images` 的行**一一对齐**）→ 角度数组。
 * 空串/缺行 = 0；非法值也当 0。归一化到 0…359。
 */
export function parseImageRotations(raw: unknown): number[] {
  const text = String(raw ?? '');
  if (text === '') return [];
  return text.split(/\r?\n/).map((l) => {
    const n = Number.parseFloat(l.trim());
    return Number.isFinite(n) ? ((Math.round(n) % 360) + 360) % 360 : 0;
  });
}

/**
 * `images` + `imageRotations` → 真正要渲染的图（**按行对齐后再丢掉空行**）。
 * ★顺序不能反：`imageRotations` 是按"面板里的行号"存的，必须先在**行**上配对，再和 `images` 一起丢掉空行，
 *   否则中间空一行就会把后面所有图的角度错位一格。
 */
export function parseImageItems(images: unknown, rotations: unknown): ImageItem[] {
  const rots = parseImageRotations(rotations);
  const out: ImageItem[] = [];
  String(images ?? '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const l = line.trim();
      if (l === '') return;
      const j = l.indexOf('|');
      const src = (j < 0 ? l : l.slice(0, j)).trim();
      if (src === '') return;
      out.push({ src, caption: j < 0 ? '' : l.slice(j + 1).trim(), rot: rots[i] ?? 0 });
    });
  return out;
}

/** 归一化角度（0…359） */
function normRot(rot: number | undefined): number {
  const n = Number(rot ?? 0);
  return Number.isFinite(n) ? ((Math.round(n) % 360) + 360) % 360 : 0;
}

/**
 * 旋转的 CSS：0° 什么都不做；90°/270° 额外把图片框变成**正方形**（`object-fit: contain`）——
 * 正方形绕中心转 90° 还是它自己，所以旋转后的图仍然落在原来的格子里，不会顶出去压到邻居；
 * 好处是**不需要知道图片的原始宽高比**（导出物是静态 HTML，拿不到 naturalWidth）。
 */
function rotateStyle(rot: number | undefined): React.CSSProperties {
  const r = normRot(rot);
  if (!r) return {};
  return {
    transform: `rotate(${r}deg)`,
    transformOrigin: 'center center',
    ...(r % 180 !== 0 ? { aspectRatio: '1 / 1', height: 'auto' } : {}),
  };
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
        data-image-rot={normRot(one?.rot) || undefined}
        style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: alignMap[opts.align] }}
      >
        {one?.src ? (
          <img
            src={one.src}
            alt={one.caption || opts.alt || ''}
            style={{ ...box, height: opts.heightAuto ? 'auto' : opts.height, ...rotateStyle(one.rot) }}
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
          <figure
            key={i}
            data-image-rot={normRot(it.rot) || undefined}
            style={{ margin: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}
          >
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
                  ...rotateStyle(it.rot),
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
  const gallery = parseImageItems(props.images, props.imageRotations);
  const single: ImageItem[] = [
    { src: asString(props.src), caption: asString(props.caption), rot: parseImageRotations(props.imageRotations)[0] ?? 0 },
  ];
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
  label: '图片',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: ImageIcon,
  description: '一行一张图（默认 1 行，＋ 加行 / − 减行，最多 5 张）；每行可单独旋转（◌）、可带图题；多张时用「列数」并排',
  defaultFrame: { x: 60, y: 160, w: 320, h: 160 },
  defaultProps: {
    /** 图片内容（一行一张）—— 面板唯一入口 */
    images: '',
    /** 每行图片的旋转角度（一行一个，与 images 的行一一对齐；由面板里每行的 ◌ 按钮写） */
    imageRotations: '',
    /** ↓ 老字段：只作老文档/老 MCP 调用的兜底，面板不再显示；`caption` 在多张时是"整组图题" */
    src: '',
    caption: '',
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
    captionSize: 10.5,
    captionColor: '#6b7280',
  },
  propSchema: [
    /* 2026-09-23 用户要求：**只留这一个图片入口**（一行一张图，＋ 加行 / − 减行）。
       原来的「图片（单图）」+「多图」两个字段、以及单独的「图题（单图）」都去掉了 ——
       老文档里的 `src`/`caption` 仍在渲染端兜底，并在面板里当作第 1 行显示（见 ImageRowsControl）。 */
    {
      key: 'images',
      label: '图片（一行一张，最多 5 张；＋ 加行 / − 减行）',
      control: 'imageRows',
      group: '内容',
      defaultValue: '',
    },
    { key: 'columns', label: '列数（多张时生效，最多 5 列）', control: 'number', group: '尺寸', defaultValue: 2, min: 1, max: 5 },
    { key: 'gap', label: '图间距 px（多张）', control: 'number', group: '尺寸', defaultValue: 10, min: 0, max: 80 },
    { key: 'galleryWidth', label: '整体宽度 %（多张）', control: 'slider', group: '尺寸', defaultValue: 100, min: 20, max: 100, step: 5 },
    { key: 'width', label: '宽度（单张；文档模式按 mm）', control: 'unit', group: '尺寸', defaultValue: 84, unit: 'mm', min: 5, max: 400 },
    { key: 'heightAuto', label: '高度自适应', control: 'switch', group: '尺寸', defaultValue: true },
    { key: 'height', label: '高度', control: 'number', group: '尺寸', defaultValue: 200, min: 20, max: 1200, visibleWhen: (p) => p.heightAuto === false },
    { key: 'align', label: '对齐（单张）', control: 'align', group: '排版', defaultValue: 'center' },
    { key: 'captionSize', label: '图题字号', control: 'unit', group: '排版', defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
    { key: 'captionColor', label: '图题颜色', control: 'color', group: '排版', defaultValue: '#6b7280' },
    {
      key: 'caption',
      label: '整组图题（多张时作为整组的总图题）',
      control: 'text',
      group: '排版',
      defaultValue: '',
      visibleWhen: (p) => parseImageLines(p.images).length > 1,
    },
    { key: 'borderRadius', label: '圆角', control: 'number', group: '外观', defaultValue: 0, min: 0, max: 80 },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: '外观', defaultValue: 0, min: 0, max: 20 },
    { key: 'borderColor', label: '边框色', control: 'color', group: '外观', defaultValue: '#e5e7eb' },
  ],
  render: (props, ctx) => ImageBody(props, ctx),
};
