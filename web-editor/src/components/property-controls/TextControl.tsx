/**
 * 控件：text —— 单行文本（规格 §5）。
 * 行为：Enter 提交并失焦；失焦提交；**输入过程实时写入 store**（验收要求"100ms 内画布实时更新"，
 * 所以不做"只在提交时写"；历史由 store 的 300ms 防抖合并成一条）。
 */
import { useEffect, useRef, useState } from 'react';
import { asString } from '../../utils/id';
import { inputCls } from './controlStyles';
import type { ControlProps } from './index';

export function TextControl({ item, value, onChange }: ControlProps) {
  const [local, setLocal] = useState(() => asString(value));
  const focused = useRef(false);

  // 外部值变化（撤销/切换选中）时同步，但不打断正在输入
  useEffect(() => {
    if (!focused.current) setLocal(asString(value));
  }, [value]);

  return (
    <input
      className={inputCls}
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
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setLocal(asString(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
