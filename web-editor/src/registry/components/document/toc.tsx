/**
 * 组件：目录（toc）
 * 来自 A4 编辑器的「目录（含分节）」——本工程里目录条目与页码是**填写/手填**的
 * （没有与标题自动联动、也没有罗马数字分节），点线引导点用 flex + 点状下边框实现。
 */
import { ListOrdered } from 'lucide-react';
import type { ComponentDefinition, ComponentProps, PropSchemaItem, RenderContext } from '../../types';
import { GROUP, defaultsOf, rows } from '../shared';
import { asBool, asNumber, asString } from '../../../utils/id';

function TocBody(props: ComponentProps, ctx: RenderContext) {
  const pt = (v: number) => (ctx.mode === 'document' ? ctx.ptToPx(v) : v * 1.34);
  const entries = rows(props.entries);
  const showPage = asBool(props.showPageNumbers, true);
  const list = entries.length ? entries : [['第一章 概述', '1'], ['第二章 方案', '3']];
  return (
    <nav style={{ width: '100%', boxSizing: 'border-box' }}>
      {asBool(props.showTitle, true) && (
        <div
          style={{
            textAlign: 'center',
            fontSize: pt(asNumber(props.titleSize, 16)),
            fontWeight: 700,
            letterSpacing: asNumber(props.letterSpacing, 4),
            marginBottom: asNumber(props.gap, 12),
            color: asString(props.color, '#1f2329'),
          }}
        >
          {asString(props.title, '目　录')}
        </div>
      )}
      {list.map((r, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            fontSize: pt(asNumber(props.fontSize, 12)),
            lineHeight: asNumber(props.lineHeight, 2),
            color: asString(props.color, '#1f2329'),
            paddingLeft: i > 0 && /^\s/.test(r[0] ?? '') ? 24 : 0,
          }}
        >
          <span style={{ whiteSpace: 'nowrap' }}>{r[0] ?? ''}</span>
          <span
            style={{
              flex: 1,
              borderBottom: '1px dotted #9aa4b2',
              margin: '0 6px',
              transform: 'translateY(-4px)',
              minWidth: 12,
            }}
          />
          {showPage && <span style={{ whiteSpace: 'nowrap' }}>{r[1] ?? ''}</span>}
        </div>
      ))}
    </nav>
  );
}

const propSchema: PropSchemaItem[] = [
  { key: 'title', label: '标题', control: 'text', group: GROUP.content, defaultValue: '目　录' },
  { key: 'showTitle', label: '显示标题', control: 'switch', group: GROUP.content, defaultValue: true },
  {
    key: 'entries',
    label: '条目（每行一条，用 | 接页码）',
    control: 'textarea',
    group: GROUP.content,
    defaultValue: '第一章 概述 | 1\n第二章 方案 | 3',
    placeholder: '第一章 概述 | 1',
  },
  { key: 'showPageNumbers', label: '显示页码', control: 'switch', group: GROUP.content, defaultValue: true },
  { key: 'fontSize', label: '条目字号', control: 'unit', group: GROUP.typography, defaultValue: 12, unit: 'pt', min: 6, max: 24 },
  { key: 'titleSize', label: '标题字号', control: 'unit', group: GROUP.typography, defaultValue: 16, unit: 'pt', min: 8, max: 36 },
  { key: 'lineHeight', label: '行距', control: 'slider', group: GROUP.typography, defaultValue: 2, min: 1, max: 3, step: 0.1 },
  { key: 'letterSpacing', label: '标题字距', control: 'number', group: GROUP.typography, defaultValue: 4, min: 0, max: 12, step: 0.5 },
  { key: 'gap', label: '标题与条目间距', control: 'number', group: GROUP.size, defaultValue: 12, min: 0, max: 60 },
  { key: 'color', label: '文字颜色', control: 'color', group: GROUP.appearance, defaultValue: '#1f2329' },
];

export const tocComponent: ComponentDefinition = {
  type: 'toc',
  label: '目录',
  category: '文档专用',
  supportedModes: ['document', 'web'],
  icon: ListOrdered,
  description: '带点线引导的目录；条目与页码为填写式（未与标题自动联动）',
  defaultFrame: { x: 40, y: 80, w: 600, h: 300 },
  propSchema,
  defaultProps: defaultsOf(propSchema),
  render: (props, ctx) => TocBody(props, ctx),
};
