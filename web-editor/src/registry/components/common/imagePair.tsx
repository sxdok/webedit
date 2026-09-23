/**
 * 组件：并排双图（imagePair）—— **保留给老文档，已从左侧面板隐藏**。
 *
 * 2026-09-23 用户要求：多图不该是另一个组件，应该用「图片」组件调属性就能实现。
 * 所以「图片（image）」现在自带图集能力（`images` + `columns`，2/3/4 张都行），
 * 本组件退化为"它的 2 列预设"：渲染走同一个 `renderImageGallery`，
 * 数据仍是老的 `srcs` / `caps`（每行一张）→ 已存在的文档照常打开、照常编辑。
 *
 * `hidden: true` 只影响**左侧组件面板**（不再出现在新建流程里），注册表里仍在，
 * 因此旧文档、示例文档、MCP 组件清单都不受影响。
 */
import { Columns2 } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf, lines } from '../shared';
import { asNumber, asString } from '../../../utils/id';
import { renderImageGallery, type ImageItem } from './image';

function ImagePairBody(props: ComponentProps, ctx: RenderContext) {
  const srcs = lines(props.srcs);
  const caps = lines(props.caps);
  const items: ImageItem[] = (srcs.length ? srcs : ['', '']).map((src, i) => ({ src, caption: caps[i] ?? '' }));
  return renderImageGallery(items, {
    ctx,
    columns: Math.max(2, items.length),
    gap: asNumber(props.gap, 12),
    widthPct: asNumber(props.width, 100),
    singleWidthMm: 84,
    singleWidthPx: 320,
    heightAuto: true,
    height: 200,
    radius: 0,
    borderWidth: 0,
    borderColor: '#e5e7eb',
    captionSize: asNumber(props.captionSize, 10.5),
    captionColor: asString(props.captionColor, '#5b6472'),
    align: 'center',
    autoLabel: asString(ctx.autoLabel),
    groupCaption: asString(props.caption),
  });
}

const propSchema: PropSchemaItem[] = [
  { key: 'srcs', label: '图片地址（每行一张）', control: 'textarea', group: GROUP.content, defaultValue: '\n', placeholder: '/a.png\n/b.png' },
  { key: 'caps', label: '图题（每行一条，与图对应）', control: 'textarea', group: GROUP.content, defaultValue: '', placeholder: '图题一\n图题二' },
  { key: 'width', label: '整体宽度 %', control: 'slider', group: GROUP.size, defaultValue: 100, min: 20, max: 100, step: 5 },
  { key: 'gap', label: '图间距 px', control: 'number', group: GROUP.size, defaultValue: 12, min: 0, max: 80 },
  { key: 'captionSize', label: '图题字号', control: 'unit', group: GROUP.typography, defaultValue: 10.5, unit: 'pt', min: 6, max: 24 },
  { key: 'captionColor', label: '图题颜色', control: 'color', group: GROUP.appearance, defaultValue: '#5b6472' },
];

export const imagePairComponent: ComponentDefinition = {
  type: 'imagePair',
  label: '并排双图（旧，建议用「图片」的多图）',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: Columns2,
  description: '多张图片并排（老组件，保留兼容）；新文档请用「图片」组件填「多图」+「列数」',
  defaultFrame: { x: 40, y: 200, w: 560, h: 200 },
  propSchema,
  defaultProps: defaultsOf(propSchema, { srcs: '\n' }),
  render: (props, ctx) => ImagePairBody(props, ctx),
  /** 只在左侧面板隐藏（老文档仍能渲染与编辑） */
  hidden: true,
};
