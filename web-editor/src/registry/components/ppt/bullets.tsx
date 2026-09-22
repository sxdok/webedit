/**
 * 组件：要点列表（bullets，PPT 常用）——每行一条，支持编号/符号、层级缩进（前缀 2 空格表示下一级）。
 */
import { ListOrdered } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asEnum, asNumber, asString } from '../../../utils/id';
import {
  alignOf,
  defaultsOf,
  fontFamilyProp,
  fontSizeProp,
  fontWeightProp,
  letterSpacingProp,
  lineHeightProp,
  lines,
  marginProp,
} from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'items', label: '要点（每行一条）', control: 'textarea', group: '内容', defaultValue: '第一条要点\n第二条要点\n  子要点（行首两空格）\n第三条要点' },
  { key: 'ordered', label: '使用编号', control: 'switch', group: '内容', defaultValue: false },
  {
    key: 'marker',
    label: '项目符号',
    control: 'select',
    group: '内容',
    defaultValue: 'dot',
    options: [
      { label: '圆点 •', value: 'dot' },
      { label: '方形 ▪', value: 'square' },
      { label: '对勾 ✓', value: 'check' },
      { label: '短横 –', value: 'dash' },
    ],
  },
  fontFamilyProp(),
  fontSizeProp(18),
  fontWeightProp(),
  lineHeightProp(1.6),
  letterSpacingProp(),
  { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#1f2329' },
  { key: 'accent', label: '符号颜色', control: 'color', group: '外观', defaultValue: '#1677ff' },
  { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'left' },
  marginProp(),
];

const MARKS: Record<string, string> = { dot: '•', square: '▪', check: '✓', dash: '–' };

export const bulletsComponent: ComponentDefinition = {
  type: 'bullets',
  label: '要点列表',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: ListOrdered,
  description: 'PPT 要点列表：圆点/方形/对勾/短横，行首两空格表示下一级',
  defaultFrame: { x: 60, y: 100, w: 560, h: 200 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 18)) : asNumber(props.fontSize, 18);
    const ordered = asBool(props.ordered, false);
    const mark = MARKS[asEnum(props.marker, ['dot', 'square', 'check', 'dash'] as const, 'dot')];
    const accent = asString(props.accent, '#1677ff');
    let counter = 0;
    return (
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          textAlign: alignOf(props.align),
          fontFamily: asString(props.fontFamily) || undefined,
          fontSize: size,
          fontWeight: asNumber(props.fontWeight, 400),
          lineHeight: asNumber(props.lineHeight, 1.6),
          letterSpacing: asNumber(props.letterSpacing, 0) || undefined,
          color: asString(props.color) || '#1f2329',
        }}
      >
        {lines(props.items).map((raw, i) => {
          const depth = Math.max(0, (raw.length - raw.trimStart().length) / 2);
          const text = raw.trim();
          if (!text) return null;
          counter += 1;
          return (
            <li key={i} style={{ display: 'flex', gap: 8, marginLeft: depth * 20, marginBottom: 6 }}>
              <span style={{ color: accent, flex: 'none', fontWeight: 700 }}>
                {ordered ? `${counter}.` : mark}
              </span>
              <span>{text.replace(/^[-*•]\s*/, '')}</span>
            </li>
          );
        })}
      </ul>
    );
  },
};
