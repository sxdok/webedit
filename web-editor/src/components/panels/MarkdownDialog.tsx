/**
 * 职责：**Markdown 源码视图**（B10，只读）。
 *
 * 打开时把当前文档翻译成 Markdown（`utils/markdown.ts`），提供：
 *   · 只读预览（等宽字体，带行号）；
 *   · 一键复制 / 下载 `.md`；
 *   · 行数 / 字符数统计。
 * 不写回文档 —— Markdown → 文档的反向导入不在范围内（见 README「十四」B10）。
 *
 * ★E3（ARCHITECTURE §7.5）：**预期管理**。Markdown 是**有损**投影 —— 页在 Markdown 里根本不存在，
 *   所以 A4 纸张/页边距/页眉页脚/页码一定丢；组件样式、分栏、绝对定位也只剩近似。这里两处说清楚：
 *   ① 弹窗里常驻一句"有损 + 单向"说明（用户能看见内容的地方）；
 *   ② 导出/复制时弹**提示条**（"做过之后立刻看到"比文档里写一句有效）。
 */
import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { buildDocMarkdown } from '../../utils/markdown';
import { downloadText } from '../../utils/download';
import { useEditorStore } from '../../store/editorStore';
import { Modal } from '../ui/Modal';
import { notify } from '../layout/NoticeBar';

/** 有损提示的文案（对话框与提示条共用，避免两处说法不一致） */
const MD_LOSSY =
  'Markdown 是给下游工具 / 版本库看的**有损**投影：页在 Markdown 里不存在，A4 纸张、页边距、页眉页脚与页码都不会保留；组件样式/分栏/绝对定位只保留近似。要打印或交付排版请用「导出 PDF」或「导出 Word」。';

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
    notify({ kind: 'info', title: '已复制 Markdown（有损投影）', detail: MD_LOSSY });
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
          onClick={() => {
            downloadText(`${doc.title || 'document'}.md`, md, 'text/markdown');
            // 导出动作发生时提醒（提示条停留 1 秒后淡出、鼠标穿透，不挡编辑）
            notify({ kind: 'info', title: '已下载 .md（有损导出）', detail: MD_LOSSY });
          }}
          className="flex h-7 items-center gap-1 rounded border border-line px-2 text-xs text-gray-700 hover:bg-gray-50"
        >
          <Download className="h-3.5 w-3.5" /> 下载 .md
        </button>
        <span data-md-stats="1" className="ml-auto text-2xs text-gray-400">
          {lines.length} 行 · {md.length} 字符 · 由组件树实时生成
        </span>
      </div>

      {/* E3：常驻说明（单向 / 有损）——自检断言 `data-md-lossy` 存在且含关键词 */}
      <p
        data-md-lossy="1"
        className="m-0 mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-2xs leading-5 text-amber-900"
      >
        单向 / 有损：Markdown 由组件树<b>单向</b>导出，A4 纸张、页边距、页眉页脚与页码不会保留；
        <b>不支持</b> Markdown → 文档（反向导入）—— 要还原排版请用「导出 PDF / Word」或工程文件（.editor.json）。
      </p>

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
