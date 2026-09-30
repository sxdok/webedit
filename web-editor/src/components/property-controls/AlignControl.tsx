/**
 * 控件：align —— 左/中/右/两端对齐（4 个图标按钮，单选高亮）。
 */
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react';
import { asString } from '../../utils/id';
import { smallBtnCls } from './controlStyles';
import type { ControlProps } from './index';

const OPTS: [string, typeof AlignLeft][] = [
  ['left', AlignLeft],
  ['center', AlignCenter],
  ['right', AlignRight],
  ['justify', AlignJustify],
];

export function AlignControl({ value, onChange }: ControlProps) {
  const cur = asString(value, 'left');
  return (
    <>
      {OPTS.map(([v, Icon]) => (
        <button
          key={v}
          type="button"
          data-align={v}
          /* 气泡写中文（原来直接把内部 key 当提示，与 TableCellsControl 的「水平对齐：左」口径不一致） */
          data-tip-text={({ left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' } as Record<string, string>)[v] ?? v}
          onClick={() => onChange(v)}
          className={`${smallBtnCls} ${cur === v ? 'border-primary bg-primary/10 text-primary' : ''}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </>
  );
}
