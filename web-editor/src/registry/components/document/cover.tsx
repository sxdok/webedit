/**
 * 组件：封面（cover）
 * 来自 A4 编辑器的「封面（含分节）」「封面副标题」「封面色线」三个组件（合并为一个可配的封面版式）。
 * 说明：A4 里"封面（含分节）"还负责"封面页不显示页码"的分节语义——本工程尚未实现三段式分节页码
 * （见 README「未做项」），所以这里只提供封面**版式**，页码分节需要页面属性配合。
 */
import { PanelTop } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf } from '../shared';
import { asBool, asNumber, asString } from '../../../utils/id';

function CoverBody(props: ComponentProps, ctx: RenderContext) {
  const mm = (v: number) => (ctx.mode === 'document' ? ctx.mmToPx(v) : v * 3);
  const pt = (v: number) => (ctx.mode === 'document' ? ctx.ptToPx(v) : v * 1.34);
  const accent = asString(props.accent, '#1d4e79');
  const line = asBool(props.showLine, true);
  const title = asString(props.title, '文档标题');
  return (
    <section
      style={{
        minHeight: mm(asNumber(props.minHeight, 200)),
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        boxSizing: 'border-box',
        padding: `${mm(10)}px 0`,
      }}
    >
      {line && <div style={{ width: '42%', height: 3, background: accent, marginBottom: mm(10) }} />}
      <h1
        style={{
          margin: 0,
          fontSize: pt(asNumber(props.titleSize, 26)),
          fontWeight: 700,
          letterSpacing: asNumber(props.letterSpacing, 2),
          color: asString(props.titleColor, '#12263f'),
          lineHeight: 1.4,
        }}
      >
        {title}
      </h1>
      {asString(props.subtitle) && (
        <div style={{ marginTop: mm(6), fontSize: pt(asNumber(props.subtitleSize, 15)), color: '#3f5570', letterSpacing: 1 }}>
          {asString(props.subtitle)}
        </div>
      )}
      {line && <div style={{ width: '42%', height: 1, background: accent, opacity: 0.5, marginTop: mm(10) }} />}
      <div style={{ marginTop: mm(22), fontSize: pt(12), color: '#5b6472', lineHeight: 2 }}>
        {asString(props.org) && <div>{asString(props.org)}</div>}
        {asString(props.date) && <div>{asString(props.date)}</div>}
      </div>
    </section>
  );
}

const propSchema: PropSchemaItem[] = [
  { key: 'title', label: '主标题', control: 'text', group: GROUP.content, defaultValue: '文档标题' },
  { key: 'subtitle', label: '副标题', control: 'text', group: GROUP.content, defaultValue: '' },
  { key: 'org', label: '单位 / 作者', control: 'text', group: GROUP.content, defaultValue: '' },
  { key: 'date', label: '日期', control: 'text', group: GROUP.content, defaultValue: '' },
  { key: 'titleSize', label: '主标题字号', control: 'unit', group: GROUP.typography, defaultValue: 26, unit: 'pt', min: 12, max: 60 },
  { key: 'subtitleSize', label: '副标题字号', control: 'unit', group: GROUP.typography, defaultValue: 15, unit: 'pt', min: 8, max: 40 },
  { key: 'letterSpacing', label: '标题字距', control: 'number', group: GROUP.typography, defaultValue: 2, min: 0, max: 12, step: 0.5 },
  { key: 'titleColor', label: '标题颜色', control: 'color', group: GROUP.typography, defaultValue: '#12263f' },
  { key: 'accent', label: '色线颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1d4e79' },
  { key: 'showLine', label: '显示色线', control: 'switch', group: GROUP.appearance, defaultValue: true },
  { key: 'minHeight', label: '封面高度（文档模式 mm）', control: 'unit', group: GROUP.size, defaultValue: 200, unit: 'mm', min: 40, max: 280 },
];

export const coverComponent: ComponentDefinition = {
  type: 'cover',
  label: '封面',
  category: '文档专用',
  supportedModes: ['document', 'web'],
  icon: PanelTop,
  description: '封面版式：主标题 / 副标题 / 单位 / 日期 + 色线（分节页码尚未实现）',
  defaultFrame: { x: 40, y: 40, w: 600, h: 400 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => CoverBody(props, ctx),
};
