/**
 * 职责：cells 属性控件 —— **Excel 式单元格格式**（规格 §8.3）。
 *
 * 分工：
 *   · **选中了哪些单元格** = 编辑器态（store.ui.tableCells，键是 "行,列"），**不写进文档、不进导出、打印不显示**；
 *   · **单元格格式** = 文档数据（props.cellStyles），键用 **Excel A1 记法**（`B2` / 合并区 `B2:C3`），
 *     会导出、会打印；旧版 `"行,列"` 键读进来会自动换算。
 *
 * 交互：画布上点选/拖选 → 这里改哪一项**立刻作用到选中的格子**（Excel 逻辑，无"应用"按钮）；
 * 未覆盖的项沿用「表格」组的默认值。范围选择写入的是**多个单格键**；合并才写**范围键**。
 */
import { useEffect, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDownToLine, ArrowRightToLine, Combine, Paintbrush, Split, Trash2 } from 'lucide-react';
import { findNode, getForest } from '../../store/treeUtils';
import { useEditorStore } from '../../store/editorStore';
import { asNumber, asString } from '../../utils/id';
import {
  a1,
  a1Key,
  cellStyleKeyAt,
  parseA1,
  parseCellStyles,
  parseTableData,
  serializeTableData,
  setCellText,
  type CellStyle,
} from '../../registry/components/common/tableKit';
import { Tooltip } from '../ui/Tooltip';
import { btnCls } from './controlStyles';
import type { ControlProps } from './index';

type Sel = { r0: number; c0: number; r1: number; c1: number };

function selRange(cells: string[]): Sel | null {
  const pts = cells
    .map((k) => k.split(',').map((n) => Number(n)))
    .filter((p) => p.length === 2 && p.every((n) => Number.isFinite(n)));
  if (!pts.length) return null;
  return {
    r0: Math.min(...pts.map((p) => p[0])),
    r1: Math.max(...pts.map((p) => p[0])),
    c0: Math.min(...pts.map((p) => p[1])),
    c1: Math.max(...pts.map((p) => p[1])),
  };
}

/** 范围 → Excel 记法：B2 / B2:C3 */
function rangeLabel(s: Sel): string {
  return a1Key(s.r0, s.c0, s.r1, s.c1);
}

export function TableCellsControl({ value, nodeId }: ControlProps) {
  const doc = useEditorStore((s) => s.doc);
  const sel = useEditorStore((s) => s.ui.tableCells);
  const updateProps = useEditorStore((s) => s.updateProps);
  const node = nodeId ? findNode(getForest(doc), nodeId) : null;
  const styles = parseCellStyles(value);
  const range = sel && sel.nodeId === nodeId ? selRange(sel.cells) : null;

  // 显示值取"选中区左上角"那格的覆盖值；没有覆盖就显示表格级默认
  const probeKey = range ? cellStyleKeyAt(styles, range.r0, range.c0) : null;
  const first: CellStyle = (probeKey ? styles[probeKey] : undefined) ?? {};
  const tp = node?.props ?? {};
  const alignValue = first.align ?? (asString(tp.cellAlign, 'left') as CellStyle['align']);
  const valignValue = first.valign ?? 'middle';
  const weightValue = first.fontWeight ?? (first.bold ? 700 : 400);
  const fontSizeValue = first.fontSize ?? asNumber(tp.fontSize, 10.5);
  const paddingValue = first.padding ?? asNumber(tp.cellPadding, 6);
  const bgValue = first.background ?? '#fff2cc';
  const fgValue = first.color ?? '#1f2329';
  const border = first.border ?? {};
  const borderColor = border.color ?? '#c9d6e2';
  const filled = Object.keys(styles).length;

  /** 目标键集合：范围里每个格一个**单格 A1 键** */
  const keysOf = (s: Sel): string[] => {
    const out: string[] = [];
    for (let r = s.r0; r <= s.r1; r += 1) for (let c = s.c0; c <= s.c1; c += 1) out.push(a1(r, c));
    return out;
  };
  const rowKeys = (s: Sel): string[] => {
    const out: string[] = [];
    for (let c = 0; c <= s.c1; c += 1) out.push(a1(s.r0, c));
    return out;
  };
  const colKeys = (s: Sel): string[] => {
    const out: string[] = [];
    for (let r = 0; r <= s.r1; r += 1) out.push(a1(r, s.c0));
    return out;
  };

  /** 写入（基线从 store 实时读，避免连续点击时用旧闭包覆盖前一次改动） */
  const apply = (patch: CellStyle & { __clear?: boolean }, target?: string[]) => {
    if (!nodeId || !range) return;
    const live = useEditorStore.getState();
    const liveNode = findNode(getForest(live.doc), nodeId);
    const base = parseCellStyles(liveNode?.props.cellStyles);
    const next: Record<string, CellStyle> = { ...base };
    for (const k of target ?? keysOf(range)) {
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
    updateProps(nodeId, { cellStyles: next });
  };

  /** 合并选中区（写范围键）；拆分把范围里所有键去掉 */
  const merge = () => {
    if (!nodeId || !range) return;
    if (range.r0 === range.r1 && range.c0 === range.c1) return;
    const live = useEditorStore.getState();
    const liveNode = findNode(getForest(live.doc), nodeId);
    const next: Record<string, CellStyle> = { ...parseCellStyles(liveNode?.props.cellStyles) };
    for (const k of keysOf(range)) delete next[k];
    next[a1Key(range.r0, range.c0, range.r1, range.c1)] = { merged: true };
    updateProps(nodeId, { cellStyles: next });
  };
  const split = () => {
    if (!nodeId || !range) return;
    const live = useEditorStore.getState();
    const liveNode = findNode(getForest(live.doc), nodeId);
    const next: Record<string, CellStyle> = { ...parseCellStyles(liveNode?.props.cellStyles) };
    for (const k of Object.keys(next)) {
      const p = parseA1(k);
      if (!p) continue;
      if (p.r0 >= range.r0 && p.r1 <= range.r1 && p.c0 >= range.c0 && p.c1 <= range.c1) delete next[k];
    }
    updateProps(nodeId, { cellStyles: next });
  };

  const [showBorder, setShowBorder] = useState(false);
  const disabled = !range;

  /* ── 单元格内容：选**一格**时可以直接改这一格的文字 ──
     内容就是 props.data 里的一格（等于 HTML 表格一个 <td> 里的东西）。
     ★「数据」整块属性行已删除（用户 2026-09-23：表格内容以单元格内容为主）——
       改文字就是在这里逐格改；行/列不够用「行 / 列数量」组增删；整块换内容用「HTML 源码」导入。 */
  const rowsData = parseTableData(node?.props.data);
  const single = range && range.r0 === range.r1 && range.c0 === range.c1 ? range : null;
  const cellText = single ? (rowsData[single.r0]?.[single.c0] ?? '') : '';
  const [draft, setDraft] = useState(cellText);
  useEffect(() => {
    setDraft(cellText);
  }, [cellText, single?.r0, single?.c0]);

  /** 把这一格的文字写回 props.data（保持网格矩形；转义交给 serializeTableData） */
  const writeCellText = (text: string) => {
    if (!nodeId || !single) return;
    const live = useEditorStore.getState();
    const liveNode = findNode(getForest(live.doc), nodeId);
    const rows = parseTableData(liveNode?.props.data);
    updateProps(nodeId, { data: serializeTableData(setCellText(rows, single.r0, single.c0, text)) });
  };

  return (
    <div className="space-y-1.5" data-cell-format="1">
      {/* ① 内容：改选中那一格的文字（支持格内换行；“|”会被转义，不会拆列） */}
      <div className="flex items-start gap-1.5" data-cell-text-row="1">
        <Tooltip
          side="right"
          content={{
            name: '单元格内容',
            detail: [
              '选**一格**后在这里改它的文字 —— 相当于改 HTML 表格里某个 <td> 的内容。',
              '表格内容以单元格为主：整块「数据」属性已去掉，文字都在这里逐格改。',
              '回车就是**格内换行**（存成 \\n，渲染成多行，等于 HTML 的 <br>）。',
              '竖线 | 会被转义成 \\|，不会把这一格拆成两格。',
            ],
          }}
        >
          <span className="mt-1 w-9 shrink-0 cursor-help text-right text-2xs text-gray-400">内容</span>
        </Tooltip>
        <textarea
          data-cell-text="1"
          rows={2}
          disabled={!single}
          className="min-h-[38px] min-w-0 flex-1 resize-y rounded border border-line bg-white px-1.5 py-1 text-xs leading-4 disabled:bg-gray-50 disabled:text-gray-400"
          placeholder={single ? '' : '先在画布上只选一格'}
          value={single ? draft : ''}
          onChange={(e) => {
            setDraft(e.target.value);
            writeCellText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(cellText);
              writeCellText(cellText);
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
          }}
        />
      </div>

      {/* ② 选中范围 + 清除 */}
      <div className="flex items-center gap-1 text-2xs text-gray-500">
        {range ? (
          <>
            <span className="truncate">
              当前选中：<b className="font-mono text-primary">{rangeLabel(range)}</b>（
              {range.r1 - range.r0 + 1} 行 × {range.c1 - range.c0 + 1} 列）
            </span>
            <button type="button" data-cell-clear="1" className={`${btnCls} ml-auto shrink-0`} onClick={() => apply({ __clear: true })}>
              <Trash2 className="mr-0.5 h-3 w-3" />
              清除选中
            </button>
          </>
        ) : (
          <span className="text-gray-400">未选单元格 —— 在画布上点选（可拖选一片）后再改下面的格式</span>
        )}
      </div>

      {/* ③ 格式：一行一项、标签右对齐，控件按面板宽度自适应（不再是挤在一行的 flex-wrap） */}
      <div className="space-y-1 rounded-md border border-line/80 bg-gray-50/70 px-1.5 py-1.5" data-cell-format-box="1">
        <div className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-right text-2xs text-gray-400">填充</span>
          <input
            type="color"
            data-cell-bg="1"
            disabled={disabled}
            className="h-6 w-8 shrink-0 cursor-pointer rounded border border-line bg-white p-0.5 disabled:opacity-40"
            value={bgValue}
            onChange={(e) => apply({ background: e.target.value })}
          />
          <span className="w-9 shrink-0 text-right text-2xs text-gray-400">文字色</span>
          <input
            type="color"
            data-cell-fg="1"
            disabled={disabled}
            className="h-6 w-8 shrink-0 cursor-pointer rounded border border-line bg-white p-0.5 disabled:opacity-40"
            value={fgValue}
            onChange={(e) => apply({ color: e.target.value })}
          />
          <span className="w-7 shrink-0 text-right text-2xs text-gray-400">字号</span>
          <input
            type="number"
            data-cell-size="1"
            disabled={disabled}
            step={0.5}
            min={6}
            max={36}
            className="h-6 min-w-0 flex-1 rounded border border-line bg-white px-1 text-center text-xs disabled:opacity-40"
            value={fontSizeValue}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) apply({ fontSize: v });
            }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-right text-2xs text-gray-400">字重</span>
          <select
            data-cell-weight="1"
            disabled={disabled}
            className="h-6 min-w-0 flex-1 rounded border border-line bg-white px-1 text-2xs disabled:opacity-40"
            value={String(weightValue)}
            onChange={(e) => apply({ fontWeight: Number(e.target.value) })}
            data-tip-text="字重"
          >
            <option value="400">常规</option>
            <option value="600">中粗</option>
            <option value="700">加粗</option>
          </select>
          <span className="w-9 shrink-0 text-right text-2xs text-gray-400">内边距</span>
          <input
            type="number"
            data-cell-pad="1"
            disabled={disabled}
            min={0}
            max={24}
            className="h-6 w-12 shrink-0 rounded border border-line bg-white px-1 text-center text-xs disabled:opacity-40"
            value={paddingValue}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) apply({ padding: v });
            }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-right text-2xs text-gray-400">对齐</span>
          {(
            [
              ['left', AlignLeft],
              ['center', AlignCenter],
              ['right', AlignRight],
              ['justify', AlignJustify],
            ] as const
          ).map(([v, Icon]) => (
            <button
              key={v}
              type="button"
              data-cell-align={v}
              disabled={disabled}
              className={`${btnCls} ${alignValue === v ? 'border-primary bg-primary/10 text-primary' : ''} w-6 shrink-0 justify-center px-0`}
              data-tip-text={`水平对齐：${{ left: '左', center: '中', right: '右', justify: '两端' }[v]}`}
              onClick={() => apply({ align: v })}
            >
              <Icon className="h-3 w-3" />
            </button>
          ))}
          <span className="w-7 shrink-0 text-right text-2xs text-gray-400">垂直</span>
          <select
            data-cell-valign="1"
            disabled={disabled}
            className="h-6 min-w-0 flex-1 rounded border border-line bg-white px-1 text-2xs disabled:opacity-40"
            value={valignValue}
            onChange={(e) => apply({ valign: e.target.value as NonNullable<CellStyle['valign']> })}
          >
            <option value="top">顶部</option>
            <option value="middle">居中</option>
            <option value="bottom">底部</option>
          </select>
        </div>

        {/* 边框（折叠，避免占满面板）；展开后 4 个方向各一行，宽度不再是 8px 的窄格子 */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="w-9 shrink-0 text-right text-2xs text-gray-400">边框</span>
            <button type="button" className={`${btnCls} shrink-0`} onClick={() => setShowBorder((v) => !v)} data-tip-text="单元格边框（四边各自设宽度）">
              {showBorder ? '收起 ▲' : '展开 ▼'}
            </button>
            {showBorder && (
              <input
                type="color"
                data-cell-border-color="1"
                disabled={disabled}
                className="h-6 w-8 shrink-0 cursor-pointer rounded border border-line bg-white p-0.5"
                value={borderColor}
                onChange={(e) => apply({ border: { ...border, color: e.target.value } })}
                data-tip-text="边框颜色"
              />
            )}
          </div>
          {showBorder &&
            (['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side} className="flex items-center gap-1.5">
                <span className="w-9 shrink-0 text-right text-2xs text-gray-400">{{ top: '上', right: '右', bottom: '下', left: '左' }[side]}</span>
                <input
                  type="number"
                  data-cell-border={side}
                  disabled={disabled}
                  min={0}
                  max={6}
                  step={0.5}
                  className="h-6 min-w-0 flex-1 rounded border border-line bg-white px-1 text-center text-xs disabled:opacity-40"
                  value={border[side] ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) apply({ border: { ...border, [side]: v, color: borderColor } });
                  }}
                />
                <span className="shrink-0 text-2xs text-gray-400">px</span>
              </label>
            ))}
        </div>
      </div>

      {/* ④ 区域操作：合并/拆分 + 整行/整列，再一行放"清空全部"与覆盖计数 */}
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          data-cell-merge="1"
          className={`${btnCls} justify-center`}
          disabled={disabled || (range ? range.r0 === range.r1 && range.c0 === range.c1 : true)}
          data-tip-text="合并选中的单元格"
          onClick={merge}
        >
          <Combine className="mr-0.5 h-3 w-3" />
          合并单元格
        </button>
        <button type="button" data-cell-split="1" className={`${btnCls} justify-center`} disabled={disabled} data-tip-text="拆分（去掉合并与格式）" onClick={split}>
          <Split className="mr-0.5 h-3 w-3" />
          拆分
        </button>
        <button
          type="button"
          data-cell-apply-row="1"
          className={`${btnCls} justify-center`}
          disabled={disabled}
          data-tip-text="把左上角那格的格式复制到整行"
          onClick={() => apply({ ...first }, range ? rowKeys(range) : undefined)}
        >
          <ArrowRightToLine className="mr-0.5 h-3 w-3" />
          整行
        </button>
        <button
          type="button"
          data-cell-apply-col="1"
          className={`${btnCls} justify-center`}
          disabled={disabled}
          data-tip-text="把左上角那格的格式复制到整列"
          onClick={() => apply({ ...first }, range ? colKeys(range) : undefined)}
        >
          <ArrowDownToLine className="mr-0.5 h-3 w-3" />
          整列
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-cell-clear-all="1"
          disabled={!filled}
          className={btnCls}
          onClick={() => updateProps(nodeId ?? '', { cellStyles: {} })}
          data-tip-text="清空这张表上所有的单元格格式"
        >
          <Paintbrush className="mr-0.5 h-3 w-3" />
          清空全部格式
        </button>
        <span className="ml-auto shrink-0 text-2xs text-gray-400">{filled} 格有覆盖</span>
      </div>
    </div>
  );
}
