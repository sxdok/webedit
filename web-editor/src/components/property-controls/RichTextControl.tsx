/**
 * 职责：富文本属性控件（richtext）。contenteditable + document.execCommand 的轻量方案
 * （§12 明确不引入 Slate / ProseMirror），工具栏提供加粗/斜体/下划线/删除线/列表/对齐/链接/颜色/清除格式。
 * 输入用 300ms 防抖上报，避免每敲一个字就写一次 store。
 */
import { useEffect, useRef } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from 'lucide-react';
import type { ControlProps } from './index';
import { asString } from '../../utils/id';

const BTN = 'flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-100 hover:text-primary';

export function RichTextControl({ item, value, onChange }: ControlProps) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const html = asString(value);

  // 外部值变化（切换选中组件、撤销重做）时同步到编辑区，但不打断正在输入的光标
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.innerHTML !== html) el.innerHTML = html;
  }, [html]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const push = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(ref.current?.innerHTML ?? ''), 300);
  };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    // 轻量富文本：规格允许使用 execCommand
    document.execCommand(cmd, false, arg);
    push();
  };

  return (
    <div className="mb-1.5">
      <span className="mb-0.5 block text-2xs text-gray-500">{item.label}</span>
      <div className="overflow-hidden rounded border border-line bg-white">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-gray-50 px-1 py-0.5">
          <button type="button" className={BTN} title="加粗" onClick={() => exec('bold')}>
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={BTN} title="斜体" onClick={() => exec('italic')}>
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={BTN} title="下划线" onClick={() => exec('underline')}>
            <Underline className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={BTN} title="删除线" onClick={() => exec('strikeThrough')}>
            <Strikethrough className="h-3.5 w-3.5" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button type="button" className={BTN} title="项目符号" onClick={() => exec('insertUnorderedList')}>
            <List className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={BTN} title="编号列表" onClick={() => exec('insertOrderedList')}>
            <ListOrdered className="h-3.5 w-3.5" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button type="button" className={BTN} title="左对齐" onClick={() => exec('justifyLeft')}>
            <AlignLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={BTN} title="居中" onClick={() => exec('justifyCenter')}>
            <AlignCenter className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={BTN} title="右对齐" onClick={() => exec('justifyRight')}>
            <AlignRight className="h-3.5 w-3.5" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button
            type="button"
            className={BTN}
            title="插入链接"
            onClick={() => {
              const url = window.prompt('链接地址', 'https://');
              if (url) exec('createLink', url);
            }}
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </button>
          <input
            type="color"
            title="文字颜色"
            className="h-6 w-6 cursor-pointer rounded border border-line bg-white p-0"
            onChange={(e) => exec('foreColor', e.target.value)}
          />
          <button type="button" className={BTN} title="清除格式" onClick={() => exec('removeFormat')}>
            <RemoveFormatting className="h-3.5 w-3.5" />
          </button>
        </div>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={push}
          onBlur={() => onChange(ref.current?.innerHTML ?? '')}
          className="thin-scroll min-h-[64px] px-2 py-1 text-[13px] leading-5 outline-none"
          data-placeholder={item.placeholder ?? '在此输入富文本…'}
        />
      </div>
      <span className="mt-0.5 block text-2xs text-gray-400">
        富文本：支持加粗/斜体/列表/对齐/链接/颜色，写入 HTML
      </span>
    </div>
  );
}
