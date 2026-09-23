/**
 * 职责：`imageRows` 属性控件 —— **图片组件唯一的图片输入方式：一行一张图**（2026-09-23 用户要求）。
 *
 * 交互（按用户原话）：
 *   · **默认就是一行图片**（没有"单图/多图"两个字段了，图片组件只有一个图片入口）；
 *   · 每行行首写 **图片1 / 图片2 / …**；行尾三个图标：**🖼 选本地文件**（读成 data:URL 填进该行地址）、
 *     **＋** 在这行下面再加一行、**−** 删掉这一行（只剩一行时 − 禁用，不会删空）；
 *   · **最多 5 张**：到 5 行后 ＋ 变灰并提示。
 *
 * 数据形态**不变**：仍是 `props.images` 的多行文本（每行 `地址` 或 `地址 | 图题`），
 * 只是把"手写多行文本"换成"一行一个输入框"。这样 MCP、HTML 导入、老文档都不受影响。
 *
 * 老文档兼容：老的单图写法是 `props.src` + `props.caption`（没有 `images`）。这种节点
 * 在面板里**当作第 1 行显示**（不会看着像"图丢了"），一旦在这里编辑就迁移成 `images`
 * 并清掉 `src`/`caption`（同一张图，只是换了存放位置）。
 */
import { Plus, Minus, ImagePlus } from 'lucide-react';
import { pickImageDataUrl } from './pickImageFile';
import type { ControlProps } from './index';

/** 这张图集最多几张（用户 2026-09-23：文档里最多同时 5 张） */
export const IMAGE_ROWS_MAX = 5;

interface Row {
  src: string;
  caption: string;
}

/** `props.images` 文本 ↔ 行数组（与 image.tsx 的 parseImageLines 同一口径）
 *  ★**空行要保留**：刚点 ＋ 加出来的行就是空的，过滤掉它控件会立刻收回去（点 ＋ 看着没反应）。 */
export function parseRows(raw: unknown): Row[] {
  const text = String(raw ?? '');
  if (text.trim() === '') return [{ src: '', caption: '' }];
  return text.split(/\r?\n/).map((line) => {
    const i = line.indexOf('|');
    return i < 0 ? { src: line.trim(), caption: '' } : { src: line.slice(0, i).trim(), caption: line.slice(i + 1).trim() };
  });
}

export function joinRows(rows: Row[]): string {
  // ★空行也要保留：这是"行编辑器"，刚点 ＋ 加出来的就是空行 ——
  //   过滤掉的话数据没变化，控件会立刻把新行收回去（点 ＋ 看着没反应）。
  //   渲染端（image.tsx 的 parseImageLines）本来就会忽略空行，所以保留是安全的。
  return rows.map((r) => (r.caption ? `${r.src} | ${r.caption}` : r.src)).join('\n');
}

export function ImageRowsControl({ value, onChange, allProps, onPatch }: ControlProps) {
  const stored = parseRows(value);
  /** 老字段（单图）里的那张图 —— 只在 `images` 一张都没有时兜底显示 */
  const legacySrc = String(allProps?.src ?? '');
  const legacy = !stored.some((r) => r.src !== '') && legacySrc !== '';
  const rows: Row[] = legacy ? [{ src: legacySrc, caption: String(allProps?.caption ?? '') }] : stored;

  const write = (next: Row[]): void => {
    // 编辑老节点 = 顺手迁移到 images（清掉 src/caption），免得同一张图存两份、以后又对不上
    if (legacy && onPatch) onPatch({ images: joinRows(next), src: '', caption: '' });
    else onChange(joinRows(next));
  };

  const patch = (i: number, p: Partial<Row>): void => write(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const addAfter = (i: number): void => {
    if (rows.length >= IMAGE_ROWS_MAX) return;
    const next = [...rows];
    next.splice(i + 1, 0, { src: '', caption: '' });
    write(next);
  };
  const removeAt = (i: number): void => {
    if (rows.length <= 1) return;
    write(rows.filter((_, idx) => idx !== i));
  };

  const inputCls =
    'h-7 w-full min-w-0 rounded border border-line bg-white px-1.5 text-[12px] outline-none focus:border-primary';

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5" data-image-rows="1" data-image-rows-count={rows.length}>
      {rows.map((r, i) => (
        <div
          key={i}
          data-image-row={i + 1}
          className={`flex min-w-0 items-start gap-1 py-1 ${i > 0 ? 'border-t border-line/60' : ''}`}
        >
          <span data-image-row-name={i + 1} className="w-9 shrink-0 pt-2 text-2xs leading-none text-gray-400">
            图片{i + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <input
              data-image-row-src={i + 1}
              value={r.src}
              onChange={(e) => patch(i, { src: e.target.value })}
              placeholder={i === 0 ? '图片地址或 data:URL' : '图片地址'}
              className={inputCls}
            />
            <input
              data-image-row-caption={i + 1}
              value={r.caption}
              onChange={(e) => patch(i, { caption: e.target.value })}
              placeholder="图题（可留空）"
              className={inputCls}
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
            <button
              type="button"
              data-image-row-file={i + 1}
              title="选这张图的本地文件（转 data:URL 填进地址）"
              onClick={() => pickImageDataUrl((dataUrl) => patch(i, { src: dataUrl }))}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line text-gray-500 hover:border-primary hover:text-primary"
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-image-row-add={i + 1}
              disabled={rows.length >= IMAGE_ROWS_MAX}
              title={rows.length >= IMAGE_ROWS_MAX ? `最多 ${IMAGE_ROWS_MAX} 张` : '在这行下面加一张'}
              onClick={() => addAfter(i)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line text-gray-500 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-image-row-remove={i + 1}
              disabled={rows.length <= 1}
              title={rows.length <= 1 ? '至少留一张' : '删掉这一行'}
              onClick={() => removeAt(i)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line text-gray-500 hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
      <div className="pt-0.5 text-2xs text-gray-400">
        <span data-image-rows-hint="1">
          一行一张图（共 {rows.length} 张，最多 {IMAGE_ROWS_MAX} 张）；多张时用「列数」控制并排几列，空行不渲染
        </span>
      </div>
    </div>
  );
}
