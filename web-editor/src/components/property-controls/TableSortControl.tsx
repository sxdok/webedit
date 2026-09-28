/**
 * 职责：`tableSort` 控件（B12）—— **按列排序**表格。
 *
 * 排序是**渲染期**行为（不重写 `props.data`，见 `tableKit.sortRows`）：控件只改两个属性 ——
 *   · `sortBy`：按第几列排（0 基；-1 = 不排序）；
 *   · `sortDir`：`asc` / `desc`。
 * 这样随时能换列、换方向、清掉，文档里的原始行序一直保留（单元格格式会跟着行走）。
 *
 * 列名用 Excel 记法（A/B/C…）显示，并顺带把该列的表头文字写在括号里，便于挑列。
 */
import { ArrowDownAZ, ArrowUpAZ, X } from 'lucide-react';
import { findNode, getForest } from '../../store/treeUtils';
import { useEditorStore } from '../../store/editorStore';
import { asNumber, asString } from '../../utils/id';
import { a1, parseTableData } from '../../registry/components/common/tableKit';
import { Tooltip } from '../ui/Tooltip';
import { btnCls } from './controlStyles';
import type { ControlProps } from './index';

export function TableSortControl({ value, nodeId, onChange }: ControlProps) {
  const doc = useEditorStore((s) => s.doc);
  const updateProps = useEditorStore((s) => s.updateProps);
  const node = nodeId ? findNode(getForest(doc), nodeId) : null;
  const rows = parseTableData(node?.props.data);
  const headerRow = node?.props.headerRow !== false;
  const cols = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
  const by = Math.round(asNumber(value, -1));
  const dir = asString(node?.props.sortDir, 'asc') === 'desc' ? 'desc' : 'asc';
  const head = rows[0] ?? [];

  if (!nodeId) {
    return <div className="text-2xs text-gray-400">选中表格后可排序</div>;
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" data-table-sort="1">
      <select
        data-table-sort-col="1"
        value={by}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 min-w-0 max-w-[150px] flex-1 rounded border border-line bg-white px-1 text-2xs"
        data-tip-text="选择排序依据的列（A/B/C…）"
      >
        <option value={-1}>不排序</option>
        {Array.from({ length: cols }, (_, i) => {
          const label = headerRow ? asString(head[i]) : '';
          return (
            <option key={i} value={i}>
              {a1(0, i).replace(/\d+/g, '')}
              {label ? `：${label.slice(0, 8)}` : ''}
            </option>
          );
        })}
      </select>
      <Tooltip
        side="right"
        content={{ name: '升序 / 降序', detail: ['按所选列排序；表格开了「首行为表头」时表头行不参与排序。', '排的是**渲染顺序**，`props.data` 里原始行序不变（单元格格式跟着行走）。'] }}
      >
        <button
          type="button"
          data-table-sort-dir={dir}
          disabled={by < 0}
          onClick={() => updateProps(nodeId, { sortDir: dir === 'asc' ? 'desc' : 'asc' })}
          className={`${btnCls} disabled:opacity-40`}
          data-tip-text={dir === 'asc' ? '当前升序，点击改降序' : '当前降序，点击改升序'}
        >
          {dir === 'asc' ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />}
          {dir === 'asc' ? '升序' : '降序'}
        </button>
      </Tooltip>
      <button
        type="button"
        data-table-sort-clear="1"
        disabled={by < 0}
        onClick={() => onChange(-1)}
        className={`${btnCls} disabled:opacity-40`}
        data-tip-text="清除排序（恢复原始行序）"
      >
        <X className="h-3 w-3" />
        清除
      </button>
    </div>
  );
}
