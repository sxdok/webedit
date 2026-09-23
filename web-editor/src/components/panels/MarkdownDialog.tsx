/**
 * 职责：**Markdown 源码视图**（B10，只读）。
 *
 * 打开时把当前文档翻译成 Markdown（`utils/markdown.ts`），提供：
 *   · 只读预览（等宽字体，带行号）；
 *   · 一键复制 / 下载 `.md`；
 *   · 行数 / 字符数统计。
 * 不写回文档 —— Markdown → 文档的反向导入不在范围内（见 README「十四」B10）。
 */
import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { buildDocMarkdown } from '../../utils/markdown';
import { downloadText } from '../../utils/download';
import { useEditorStore } from '../../store/editorStore';
import { Modal } from '../ui/Modal';

export function MarkdownDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const doc = useEditorStore((s) => s.doc);
  const [copied, setCopied] = useState(false);
  const md = useMemo(() => (open ? buildDocMarkdown(doc) : ''), [open, doc]);
  const lines = useMemo(() => (md ? md.replace(/\n$/, '').split('\n') : []), [md]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      downloadText(`${doc.title || 'document'}.md`, md, 'text/markdown');
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal open={open} title="Markdown 源码" onClose={onClose} width={860}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-md-copy="1"
          onClick={() => void copy()}
          className="flex h-7 items-center gap-1 rounded bg-primary px-2.5 text-xs text-white hover:bg-primary-hover"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '已复制' : '复制 Markdown'}
        </button>
        <button
          type="button"
          data-md-download="1"
          onClick={() => downloadText(`${doc.title || 'document'}.md`, md, 'text/markdown')}
          className="flex h-7 items-center gap-1 rounded border border-line px-2 text-xs text-gray-700 hover:bg-gray-50"
        >
          <Download className="h-3.5 w-3.5" /> 下载 .md
        </button>
        <span data-md-stats="1" className="ml-auto text-2xs text-gray-400">
          {lines.length} 行 · {md.length} 字符 · 由组件树实时生成
        </span>
      </div>

      <div
        data-md-source="1"
        className="thin-scroll max-h-[62vh] overflow-auto rounded border border-line bg-gray-50"
      >
        <pre className="m-0 flex text-[11.5px] leading-5">
          <span className="select-none border-r border-line bg-gray-100 px-2 py-2 text-right text-gray-400">
            {lines.map((_, i) => `${i + 1}\n`).join('')}
          </span>
          <code className="block whitespace-pre-wrap break-words px-2 py-2 font-mono text-gray-800">{md}</code>
        </pre>
      </div>
    </Modal>
  );
}
