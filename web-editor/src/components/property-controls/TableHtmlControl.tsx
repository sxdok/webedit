/**
 * 控件：tableHtml —— 表格的 **HTML 源码入口**（粘贴 `<table>` 即可导入；也能把当前表格导出成 HTML）。
 *
 * 规格：和其它控件一样只出现在属性面板里，行/气泡由 `PropertyRow` 负责；这里只有控件本体。
 * 写回的是**组件自己的数据**（`data` + `cellStyles` + `headerRow`），不是把 HTML 存下来 ——
 * 所以导入后照样能用「表格」「单元格」两组属性继续改。
 */
import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { findNode, getForest } from '../../store/treeUtils';
import { parseTableHtml, serializeTableHtml } from '../../registry/components/common/tableHtml';
import { btnCls } from './controlStyles';
import type { ControlProps } from './index';

export function TableHtmlControl({ nodeId }: ControlProps) {
  const doc = useEditorStore((s) => s.doc);
  const updateProps = useEditorStore((s) => s.updateProps);
  const node = nodeId ? findNode(getForest(doc), nodeId) : null;
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  const doImport = () => {
    const parsed = parseTableHtml(text);
    if (!nodeId || !parsed) {
      setMsg('没找到 <table>/<tr> —— 粘一段表格 HTML 再试');
      return;
    }
    updateProps(nodeId, {
      data: parsed.data,
      cellStyles: parsed.cellStyles,
      headerRow: parsed.headerRow,
    });
    setMsg(`已导入 ${parsed.rows} 行 × ${parsed.cols} 列${parsed.headerRow ? '（首行作表头）' : ''}`);
  };

  const doExport = () => {
    const html = serializeTableHtml((node?.props ?? {}) as Record<string, unknown>);
    if (!html) {
      setMsg('这张表还没有数据');
      return;
    }
    setText(html);
    setMsg('已生成 HTML：可复制到别处，或改完再点「导入」');
  };

  return (
    <div className="space-y-1" data-table-html="1">
      <textarea
        data-table-html-text="1"
        rows={4}
        value={text}
        placeholder={'<table>\n  <tr><th>项目</th><th>取值</th></tr>\n  <tr><td>纸张</td><td>A4</td></tr>\n</table>'}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[62px] w-full resize-y rounded border border-line bg-white px-1 py-0.5 font-mono text-[11px] leading-4 outline-none focus:border-primary"
      />
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" data-table-html-import="1" className={btnCls} onClick={doImport}>
          导入 HTML
        </button>
        <button type="button" data-table-html-export="1" className={btnCls} onClick={doExport}>
          生成 HTML
        </button>
        <button
          type="button"
          data-table-html-copy="1"
          className={btnCls}
          disabled={!text.trim()}
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setMsg('已复制 HTML 到剪贴板');
          }}
        >
          复制
        </button>
        <button type="button" data-table-html-clear="1" className={btnCls} disabled={!text} onClick={() => { setText(''); setMsg(''); }}>
          清空
        </button>
        {msg && <span className="min-w-0 flex-1 truncate text-2xs text-gray-500">{msg}</span>}
      </div>
    </div>
  );
}
