/**
 * 职责：`tableRowHeights` 控件 —— **按行行高**的查看与清除（B8 修正版）。
 *
 * 数据形态：`props.rowHeights = { "2": "12", "4": "9.5" }`（键是 **1 基行号**，含表头行时第 1 行是表头；
 * 值同 `rowHeight`：纯数字按 mm）。画布上拖某一条行边界只写这一行。
 *
 * 这里只做"看得见 + 能一条条删"：整表默认行高在「行高」属性里改，按行覆盖在这里列出来。
 */
import { Rows3, Trash2 } from 'lucide-react';
import { findNode, getForest } from '../../store/treeUtils';
import { useEditorStore } from '../../store/editorStore';
import { asString } from '../../utils/id';
import { parseTableData, parseRowHeights } from '../../registry/components/common/tableKit';
import { btnCls } from './controlStyles';
import type { ControlProps } from './index';

export function TableRowHeightsControl({ value, nodeId }: ControlProps) {
  const doc = useEditorStore((s) => s.doc);
  const updateProps = useEditorStore((s) => s.updateProps);
  const node = nodeId ? findNode(getForest(doc), nodeId) : null;
  const rows = parseTableData(node?.props.data);
  const map = parseRowHeights(value);
  const entries = Object.entries(map)
    .map(([k, v]) => ({ row: Number(k), css: v }))
    .sort((a, b) => a.row - b.row);

  if (!nodeId) return <div className="text-2xs text-gray-400">选中表格后可设行高</div>;

  const write = (next: Record<string, string>): void => updateProps(nodeId, { rowHeights: next });
  const sorted = (): Record<string, string> =>
    Object.fromEntries(entries.map((e) => [String(e.row), e.css.replace(/mm$/, '')]));

  if (!entries.length) {
    return (
      <div data-row-heights="1" className="flex items-center gap-1 text-2xs text-gray-400">
        <Rows3 className="h-3 w-3" />
        没有按行行高（画布上拖某一行边界即可单独调高那一行）
      </div>
    );
  }

  return (
    <div data-row-heights="1" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      {entries.map((e) => (
        <span
          key={e.row}
          data-row-height-item={e.row}
          className="flex items-center gap-0.5 rounded border border-line bg-white px-1 py-0.5 text-2xs text-gray-600"
          data-tip-text={`第 ${e.row} 行${e.row === 1 && node?.props.headerRow !== false ? '（表头行）' : ''}：${e.css}`}
        >
          第 {e.row} 行 · {e.css.replace(/mm$/, '')}mm
          <button
            type="button"
            data-row-height-clear={e.row}
            className="ml-0.5 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500"
            onClick={() => {
              const next = sorted();
              delete next[String(e.row)];
              write(next);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        data-row-heights-clear-all="1"
        className={`${btnCls} ml-auto shrink-0`}
        onClick={() => write({})}
      >
        全部清除
      </button>
      <span className="w-full text-2xs text-gray-400">
        整表默认行高在「行高」属性里；这里只列被单独改过的行（共 {entries.length} 行
        {rows.length ? ` / 全表 ${rows.length} 行` : ''}）
        {asString(node?.props.rowHeight) ? `；未列出的行用默认 ${asString(node?.props.rowHeight)}` : ''}
      </span>
    </div>
  );
}
