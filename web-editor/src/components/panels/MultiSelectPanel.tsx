/**
 * 职责：**多选状态面板**（规格 §2 / §13）：选中多个组件时只展示"可批量修改"的属性。
 *   · 位置与尺寸：x / y / w / h（**一次性作用到所有选中项**）
 *   · 对齐：左/水平居中/右/顶/垂直居中/底（Web 模式）
 *   · 层级：置顶/上移/下移/置底
 *   · 删除
 * 位置与尺寸的输入框显示**第一个选中项**的值；留空/未改就不动其它项。
 */
import { useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import { selectPrimarySelected, useEditorStore } from '../../store/editorStore';
import { PropertyDrawer } from './PropertyDrawer';
import { PropertyRow } from './PropertyRow';
import { numCls, smallBtnCls } from '../property-controls/controlStyles';
import type { PropSchemaItem } from '../../registry/types';

const FRAME_ITEMS: PropSchemaItem[] = (['x', 'y', 'w', 'h'] as const).map((k) => ({
  key: k,
  label: `位置/尺寸 ${k.toUpperCase()}（px）`,
  control: 'number',
  group: '位置与尺寸',
  defaultValue: 0,
}));

export function MultiSelectPanel() {
  const doc = useEditorStore((s) => s.doc);
  const node = useEditorStore(selectPrimarySelected);
  const updateFrame = useEditorStore((s) => s.updateFrame);
  const removeComponent = useEditorStore((s) => s.removeComponent);
  const [open, setOpen] = useState<Record<string, boolean>>({ 位置与尺寸: true, 对齐: true, 层级: true });
  const ids = doc.selectedIds;
  const canvas = doc.web.canvas;
  const each = (fn: (id: string) => void) => ids.forEach(fn);

  return (
    <div className="px-2.5 py-1.5" data-multi-select="1">
      <div className="mb-2 rounded border border-line bg-primary/5 px-2 py-1 text-2xs text-primary">
        已选中 <b>{ids.length}</b> 个组件 —— 这里只显示可**批量修改**的属性
      </div>

      <PropertyDrawer name="位置与尺寸" open={open['位置与尺寸'] !== false} onToggle={() => setOpen((s) => ({ ...s, 位置与尺寸: s['位置与尺寸'] === false }))} hint="一次性作用到所有选中的组件（Web 模式）。">
        {FRAME_ITEMS.map((item) => (
          <PropertyRow key={item.key} item={item} value={node?.frame?.[item.key as 'x' | 'y' | 'w' | 'h'] ?? 0}>
            <input
              type="number"
              data-frame={item.key}
              className={numCls}
              value={node?.frame?.[item.key as 'x' | 'y' | 'w' | 'h'] ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) each((id) => updateFrame(id, { [item.key]: v }));
              }}
            />
          </PropertyRow>
        ))}
      </PropertyDrawer>

      <PropertyDrawer name="对齐" open={open['对齐'] !== false} onToggle={() => setOpen((s) => ({ ...s, 对齐: s['对齐'] === false }))} hint="按画布边界批量对齐（Web 模式）。">
        <div className="flex flex-wrap gap-1 px-1">
          {(
            [
              ['左', AlignStartVertical, { x: 0 }],
              ['水平居中', AlignCenterVertical, { x: Math.round((canvas.width - 240) / 2) }],
              ['右', AlignEndVertical, { x: canvas.width - 240 }],
              ['顶', AlignStartHorizontal, { y: 0 }],
              ['垂直居中', AlignCenterHorizontal, { y: Math.round((canvas.height - 40) / 2) }],
              ['底', AlignEndHorizontal, { y: canvas.height - 40 }],
            ] as const
          ).map(([label, Icon, patch]) => (
            <button
              key={label}
              type="button"
              data-tip-text={label}
              className={smallBtnCls}
              onClick={() => each((id) => updateFrame(id, patch))}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </PropertyDrawer>

      <PropertyDrawer name="层级" open={open['层级'] !== false} onToggle={() => setOpen((s) => ({ ...s, 层级: s['层级'] === false }))}>
        <div className="flex flex-wrap gap-1 px-1">
          <button type="button" data-tip-text="置顶" className={smallBtnCls} onClick={() => each((id) => useEditorStore.getState().bringToFront(id))}>
            <ArrowUpToLine className="h-3.5 w-3.5" />
          </button>
          <button type="button" data-tip-text="上移一层" className={smallBtnCls} onClick={() => each((id) => useEditorStore.getState().bringForward(id))}>
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" data-tip-text="下移一层" className={smallBtnCls} onClick={() => each((id) => useEditorStore.getState().sendBackward(id))}>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" data-tip-text="置底" className={smallBtnCls} onClick={() => each((id) => useEditorStore.getState().sendToBack(id))}>
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-tip-text="删除选中的组件"
            className={`${smallBtnCls} border-red-200 text-red-500 hover:border-red-400`}
            onClick={() => each((id) => removeComponent(id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </PropertyDrawer>
    </div>
  );
}
