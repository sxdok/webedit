/**
 * 职责：cells 属性控件 —— **Excel 式的单元格格式**。
 *
 * 分工（这条很关键）：
 *   · **选中了哪些单元格** = 编辑器态，存在 store.ui.tableCells 里，**不写进文档、不进导出、打印不显示**；
 *   · **单元格格式** = 文档数据，写进表格的 cellStyles 属性（`{ "行,列": { 覆盖项 } }`），会导出、会打印。
 *
 * 交互与 Excel 一致：在画布上点选单元格（可拖选一片）→ 直接点这里的格式按钮，
 * **立刻作用到选中的格子上**（不需要"应用"按钮）；没被覆盖的项继续沿用「表格」组的默认值。
 * （「列宽自适应」属整表操作，已移到同组的「行 / 列数量与增删」控件里，本控件只管单元格。）
 */
import { AlignCenter, AlignLeft, AlignRight, Bold, Paintbrush, Trash2 } from 'lucide-react';
import { findNode, getForest } from '../../store/treeUtils';
import { useEditorStore } from '../../store/editorStore';
import { asNumber, asString } from '../../utils/id';
import { parseCellStyles, type CellStyle } from '../../registry/components/common/tableKit';
import type { ControlProps } from './index';

/** "行,列" → 人话（行列都从 0 起，含表头时第 0 行是表头行） */
function cellLabel(key: string): string {
  const [r, c] = key.split(',').map((n) => Number(n));
  return `第 ${r + 1} 行第 ${c + 1} 列`;
}

const btn = 'flex h-6 items-center justify-center rounded border border-line px-1.5 text-2xs hover:border-primary hover:text-primary disabled:opacity-40';

export function TableCellsControl({ value, onChange, nodeId }: ControlProps) {
  const sel = useEditorStore((s) => s.ui.tableCells);
  const forest = useEditorStore((s) => s.doc);
  const updateProps = useEditorStore((s) => s.updateProps);

  const node = nodeId ? findNode(getForest(forest), nodeId) : null;
  const tableProps = node?.props ?? {};
  const styles = parseCellStyles(value);
  // 兼容旧数据：早期只有"按格填背景"（cellFills）
  const legacy = (tableProps.cellFills && typeof tableProps.cellFills === 'object' ? tableProps.cellFills : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(legacy)) {
    const c = String(v ?? '').trim();
    if (/^\d+,\d+$/.test(k) && c && !styles[k]?.background) styles[k] = { ...(styles[k] ?? {}), background: c };
  }

  const cells = sel && sel.nodeId === nodeId ? sel.cells : [];
  // 控件显示值：取第一个选中格的覆盖值；没有覆盖就显示表格级默认（与 Excel 一致）
  const first: CellStyle = cells.length ? (styles[cells[0]] ?? {}) : {};
  const alignValue = first.align ?? (asString(tableProps.cellAlign, 'left') as CellStyle['align']);
  const fontSizeValue = first.fontSize ?? asNumber(tableProps.fontSize, 10.5);
  const paddingValue = first.padding ?? asNumber(tableProps.cellPadding, 6);
  const bgValue = first.background ?? '#fff2cc';
  const colorValue = first.color ?? '#1f2329';
  const filled = Object.keys(styles).length;

  /** 把格式变更写进选中的每一个格（空值 = 删掉这一项覆盖，回落到表格默认）
   *  ★基线从 store **实时读**，不用 render 时的闭包：连续快速点两下（加粗→居中）时，
   *    第二次点击时组件还没重渲染，用旧闭包会把第一次的改动覆盖掉。 */
  const apply = (patch: CellStyle & { __clear?: boolean }) => {
    if (!cells.length || !nodeId) return;
    const live = useEditorStore.getState();
    const liveNode = findNode(getForest(live.doc), nodeId);
    const base: Record<string, CellStyle> = parseCellStyles(liveNode?.props.cellStyles);
    const next: Record<string, CellStyle> = { ...base };
    for (const k of cells) {
      if (patch.__clear) {
        delete next[k];
        continue;
      }
      const merged: Record<string, unknown> = { ...(next[k] ?? {}), ...patch };
      for (const [kk, vv] of Object.entries(merged)) {
        if (vv === undefined || vv === null || vv === '') delete merged[kk];
      }
      if (Object.keys(merged).length) next[k] = merged as CellStyle;
      else delete next[k];
    }
    onChange(next);
    // 旧键清掉，避免两份数据并存
    if (liveNode?.props.cellFills) updateProps(nodeId, { cellFills: null });
  };

  const disabled = !cells.length;

  return (
    <div className="space-y-1" data-cell-format="1">
      <div className="text-2xs text-gray-500">
        {cells.length ? (
          <>
            已选 <span className="text-primary">{cells.length}</span> 个：
            {cells.slice(0, 3).map(cellLabel).join('、')}
            {cells.length > 3 ? ' …' : ''}
          </>
        ) : (
          <span className="text-gray-400">在画布上点表格单元格即可选中（Shift 多选）</span>
        )}
      </div>

      {/* 单元格格式：改哪一项就立刻作用到选中的格（Excel 逻辑） */}
      <div className="flex items-center gap-1">
        <span className="w-6 shrink-0 text-2xs text-gray-400" title="单元格底色">
          底色
        </span>
        <input
          type="color"
          data-cell-bg="1"
          disabled={disabled}
          className="h-6 w-7 shrink-0 cursor-pointer rounded border border-line bg-white p-0.5 disabled:opacity-40"
          value={bgValue}
          onChange={(e) => apply({ background: e.target.value })}
        />
        <span className="ml-1 w-6 shrink-0 text-2xs text-gray-400" title="单元格文字颜色">
          字色
        </span>
        <input
          type="color"
          data-cell-fg="1"
          disabled={disabled}
          className="h-6 w-7 shrink-0 cursor-pointer rounded border border-line bg-white p-0.5 disabled:opacity-40"
          value={colorValue}
          onChange={(e) => apply({ color: e.target.value })}
        />
        <span className="ml-1 shrink-0 text-2xs text-gray-400">字号</span>
        <input
          type="number"
          data-cell-size="1"
          disabled={disabled}
          step={0.5}
          min={6}
          max={36}
          className="h-6 w-12 shrink-0 rounded border border-line bg-white px-1 text-center text-xs disabled:opacity-40"
          value={fontSizeValue}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) apply({ fontSize: v });
          }}
        />
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          data-cell-bold="1"
          disabled={disabled}
          className={`${btn} w-7 ${first.bold ? 'border-primary bg-primary/10 text-primary' : ''}`}
          title="加粗（仅选中格）"
          onClick={() => apply({ bold: first.bold ? undefined : true })}
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([v, Icon]) => (
          <button
            key={v}
            type="button"
            data-cell-align={v}
            disabled={disabled}
            className={`${btn} w-7 ${alignValue === v ? 'border-primary bg-primary/10 text-primary' : ''}`}
            title={`对齐：${v}`}
            onClick={() => apply({ align: v })}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <span className="ml-1 shrink-0 text-2xs text-gray-400">内边距</span>
        <input
          type="number"
          data-cell-pad="1"
          disabled={disabled}
          min={0}
          max={24}
          className="h-6 w-10 shrink-0 rounded border border-line bg-white px-1 text-center text-xs disabled:opacity-40"
          value={paddingValue}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) apply({ padding: v });
          }}
        />
      </div>

      <div className="flex items-center gap-1">
        <button type="button" data-cell-clear="1" disabled={disabled} className={btn} onClick={() => apply({ __clear: true })}>
          <Trash2 className="mr-0.5 h-3 w-3" />
          清除选中格式
        </button>
        <button type="button" disabled={!filled} className={btn} onClick={() => onChange({})}>
          <Paintbrush className="mr-0.5 h-3 w-3" />
          清空全部
        </button>
        <span className="shrink-0 text-2xs text-gray-400">{filled} 格有覆盖</span>
      </div>
    </div>
  );
}
