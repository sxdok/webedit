/**
 * 组件：要点列表（bullets，PPT 常用）——每行一条，**行首缩进表示层级（子要点）**。
 *
 * 级别口径（一个级别 = 2 个半角空格 / 1 个 Tab / 1 个全角空格，最深 3 级）见 `indentedLines()`。
 * 子要点会：① 缩进一级；② 换一个更"轻"的符号（• → ○ → ▪；编号则 1. → 1.1 → 1.1.1）。
 *
 * ★2026-09-23 修 bug：原来这里用的是 `lines()`，而它每行都 `trim()` —— 行首空格全被吃掉，
 *   级别恒为 0，**子要点从来没生效过**（用户反馈：「bul_xxx 组件的子要点没有实现」）。
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
  indentedLines,
  letterSpacingProp,
  lineHeightProp,
  marginProp,
} from '../shared';

const schema: PropSchemaItem[] = [
  {
    key: 'items',
    label: '要点（每行一条；行首 2 空格 / Tab / 全角空格 = 子要点）',
    control: 'textarea',
    group: '内容',
    defaultValue: '第一条要点\n第二条要点\n  子要点一（行首 2 空格）\n  子要点二\n    更下一级\n第三条要点',
  },
  { key: 'ordered', label: '使用编号', control: 'switch', group: '内容', defaultValue: false },
  {
    key: 'marker',
    label: '项目符号',
    control: 'select',
    group: '内容',
    defaultValue: 'dot',
    options: [
      { label: '圆点 •（子级 ○）', value: 'dot' },
      { label: '方形 ▪（子级 ▫）', value: 'square' },
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

/** 每一级的符号（第 1 级用属性里选的那个，往下越来越"轻"） */
const MARKS: Record<string, string[]> = {
  dot: ['•', '○', '▪'],
  square: ['▪', '▫', '•'],
  check: ['✓', '✓', '✓'],
  dash: ['–', '—', '·'],
};

/** 每级的缩进步长（em，跟着字号走） */
const INDENT_EM = 1.2;

export const bulletsComponent: ComponentDefinition = {
  type: 'bullets',
  label: '要点列表',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: ListOrdered,
  description: 'PPT 要点列表：圆点/方形/对勾/短横；行首缩进（2 空格 / Tab / 全角空格）分级，子要点换符号并缩进',
  defaultFrame: { x: 60, y: 100, w: 560, h: 200 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 18)) : asNumber(props.fontSize, 18);
    const ordered = asBool(props.ordered, false);
    const marks = MARKS[asEnum(props.marker, ['dot', 'square', 'check', 'dash'] as const, 'dot')];
    const accent = asString(props.accent, '#1677ff');
    const items = indentedLines(props.items);
    /** 分级编号（1. / 1.1 / 1.1.1）：进了下一级就把更深的计数清零 */
    const counters = [0, 0, 0];
    const numberOf = (level: number): string => {
      const nums = counters.slice(0, level + 1).map((n) => (n === 0 ? 1 : n));
      return `${nums.join('.')}.`;
    };
    return (
      <ul
        data-bullets="1"
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
        {items.map((it, i) => {
          const level = it.level;
          counters[level] += 1;
          for (let l = level + 1; l < counters.length; l += 1) counters[l] = 0;
          return (
            <li
              key={i}
              data-bullet-level={level}
              style={{ display: 'flex', gap: 8, marginLeft: level * INDENT_EM * size, marginBottom: 6 }}
            >
              <span
                data-bullet-marker={level}
                style={{ color: accent, flex: 'none', fontWeight: level === 0 ? 700 : 400, opacity: level === 0 ? 1 : 0.85 }}
              >
                {ordered ? numberOf(level) : (marks[level] ?? marks[marks.length - 1])}
              </span>
              <span>{it.text.replace(/^[-*•·]\s*/, '')}</span>
            </li>
          );
        })}
      </ul>
    );
  },
};
