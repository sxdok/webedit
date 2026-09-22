/**
 * 组件：并排双图（imagePair）
 * 来自 A4 编辑器的「并排双图 fig2」：多张图片并排（默认 2 张），每张下方各带一条图题。
 * 图片地址与图题都按"每行一条"填写，行数不一致时缺的图题留空。
 */
import { Columns2 } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf, lines } from '../shared';
import { asNumber, asString } from '../../../utils/id';

function ImagePairBody(props: ComponentProps, ctx: RenderContext) {
  const srcs = lines(props.srcs);
  const caps = lines(props.caps);
  const gap = asNumber(props.gap, 12);
  const width = asNumber(props.width, 100);
  const capSize = asNumber(props.captionSize, 10.5);
  const pics = srcs.length ? srcs : ['', ''];

  return (
    <div style={{ display: 'flex', gap, width: `${width}%`, alignItems: 'flex-start', boxSizing: 'border-box' }}>
      {pics.map((src, i) => (
        <figure key={i} style={{ flex: 1, margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {src ? (
            <img src={src} alt={caps[i] ?? ''} style={{ width: '100%', display: 'block' }} />
          ) : (
            <div
              style={{ width: '100%', height: 110 }}
              className="flex items-center justify-center border border-dashed border-gray-300 bg-gray-50 text-2xs text-gray-400"
            >
              图 {i + 1}（在右侧属性面板填地址）
            </div>
          )}
          {caps[i] && (
            <figcaption
              style={{
                marginTop: 4,
                fontSize: ctx.mode === 'document' ? ctx.ptToPx(capSize) : capSize,
                color: asString(props.captionColor, '#5b6472'),
              }}
            >
              {caps[i]}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
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
  label: '并排双图',
  category: '通用',
  supportedModes: ['document', 'web'],
  icon: Columns2,
  description: '多张图片并排（默认两张），每张下方各带图题',
  defaultFrame: { x: 40, y: 200, w: 560, h: 200 },
  propSchema,
  defaultProps: defaultsOf(propSchema, { srcs: '\n' }),
  render: (props, ctx) => ImagePairBody(props, ctx),
};
