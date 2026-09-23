/**
 * 组件：图片（image）。未设置 src 时渲染虚线占位（图标 + "点击上传图片"）。
 * 两种模式都支持。
 */
import { ImageIcon } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, RenderContext } from '../../types';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';

function ImageBody(props: ComponentProps, ctx: RenderContext) {
  const src = asString(props.src);
  const width = asNumber(props.width, 320);
  const align = asEnum(props.align, ['left', 'center', 'right'] as const, 'center');
  const radius = asNumber(props.borderRadius, 0);
  const bw = asNumber(props.borderWidth, 0);
  const bc = asString(props.borderColor, '#e5e7eb');
  const w = ctx.mode === 'document' ? ctx.mmToPx(asNumber(props.width, 84)) : width;
  const caption = asString(props.caption);
  // 图表按章编号（B11）：开了「视图 → 图表按章编号」时，图题前面带上「图 X-Y」；
  // 没写图题也补一行编号（Word 里"插入题注"就是这个效果）
  const autoLabel = asString(ctx.autoLabel);
  const capText = [autoLabel, caption].filter(Boolean).join('  ');

  const box: React.CSSProperties = {
    display: 'block',
    width: w,
    borderRadius: radius,
    border: bw ? `${bw}px solid ${bc}` : undefined,
  };

  const content = src ? (
    <img src={src} alt={asString(props.alt, '')} style={{ ...box, height: asBool(props.heightAuto, true) ? 'auto' : asNumber(props.height, 200) }} />
  ) : (
    <div
      style={{ ...box, height: 140 }}
      className="flex flex-col items-center justify-center gap-1 border-dashed bg-gray-50 text-2xs text-gray-400"
    >
      <ImageIcon className="h-5 w-5" />
      点击上传图片（在右侧属性面板选择本地文件或填地址）
    </div>
  );

  // ★textAlign 只能对齐行内内容，块级图片（figure 的块级子元素）不会跟着动 →
  //   改用 flex 对齐，图片与图题一起对齐（用户反馈：只有文字位置变了、图片没动）
  const alignMap = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;
  return (
    <figure
      data-width-box="1"
      style={{
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: alignMap[align],
      }}
    >
      {content}
      {capText && (
        <figcaption data-figure-caption="1" data-auto-label={autoLabel || undefined} style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          {capText}
        </figcaption>
      )}
    </figure>
  );
}

export const imageComponent: ComponentDefinition = {
  type: 'image',
  label: '图片',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: ImageIcon,
  description: '支持 %/mm/px 宽度、圆角、边框、图题；未设 src 时显示占位',
  defaultFrame: { x: 60, y: 160, w: 320, h: 160 },
  defaultProps: {
    src: '',
    alt: '',
    width: 84,
    heightAuto: true,
    height: 200,
    align: 'center',
    borderRadius: 0,
    borderWidth: 0,
    borderColor: '#e5e7eb',
    caption: '',
  },
  propSchema: [
    { key: 'src', label: '图片', control: 'image', group: '内容', defaultValue: '', placeholder: '图片地址或 data:URL' },
    { key: 'alt', label: '替代文字', control: 'text', group: '内容', defaultValue: '' },
    { key: 'caption', label: '图题', control: 'text', group: '内容', defaultValue: '' },
    { key: 'width', label: '宽度（文档模式按 mm）', control: 'unit', group: '尺寸', defaultValue: 84, unit: 'mm', min: 5, max: 400 },
    { key: 'heightAuto', label: '高度自适应', control: 'switch', group: '尺寸', defaultValue: true },
    { key: 'height', label: '高度', control: 'number', group: '尺寸', defaultValue: 200, min: 20, max: 1200, visibleWhen: (p) => p.heightAuto === false },
    { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'center' },
    { key: 'borderRadius', label: '圆角', control: 'number', group: '外观', defaultValue: 0, min: 0, max: 80 },
    { key: 'borderWidth', label: '边框宽', control: 'number', group: '外观', defaultValue: 0, min: 0, max: 20 },
    { key: 'borderColor', label: '边框色', control: 'color', group: '外观', defaultValue: '#e5e7eb' },
  ],
  render: (props, ctx) => ImageBody(props, ctx),
};
