/**
 * 控件：textarea —— 多行文本（规格 §5）。
 * 行为：整行式、最少 3 行、**自动增高**；Ctrl/Cmd+Enter 提交并失焦；Esc 还原。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { asString } from '../../utils/id';
import type { ControlProps } from './index';

const MIN_ROWS = 3;
const LINE = 20;

export function TextareaControl({ item, value, onChange }: ControlProps) {
  const [local, setLocal] = useState(() => asString(value));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setLocal(asString(value));
  }, [value]);

  // 自动增高：内容多高就多高（下限 3 行）
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(MIN_ROWS * LINE + 8, el.scrollHeight)}px`;
  }, [local]);

  return (
    <textarea
      ref={taRef}
      className="thin-scroll w-full rounded-md border border-line bg-white px-2 py-1 text-[13px] leading-5 text-gray-800 outline-none focus:border-primary"
      rows={MIN_ROWS}
      placeholder={item.placeholder}
      value={local}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setLocal(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        setLocal(asString(value));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
        if (e.key === 'Escape') {
          setLocal(asString(value));
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}
