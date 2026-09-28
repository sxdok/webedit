/**
 * 职责：`imageRows` 属性控件 —— **图片组件唯一的图片输入方式：一行一张图**（2026-09-23 用户要求）。
 *
 * 交互（按用户 2026-09-24 给的排版）：
 *   `图片1  ◌  ▩ |地址| |图题| + -`
 *   · 行首写 **图片1 / 图片2 / …**；
 *   · **◌ = 旋转按钮**（`RotateCw`）：点一下这张图 +90°（0→90→180→270→0 循环），
 *     角度不为 0 时右边跟一个可点的角度小标（点一下归零）；
 *   · **▩ = 选图片文件**（`ImagePlus`，读成 data:URL 填进该行地址）；
 *   · 之后是**地址 / 图题**两个输入框；
 *   · **＋ 只在第 1 行**（在它下面加一张），**− 只在行数 > 1 时出现**（没有加过行就不显示 −，用户明确要求）。
 *
 * 数据形态：`props.images` 仍是多行文本（每行 `地址` 或 `地址 | 图题`），**旋转另存 `props.imageRotations`**
 * （一行一个角度，与行号一一对齐）—— 不动 `images` 的格式，MCP / HTML 导入 / 老文档都不受影响。
 *
 * 老文档兼容：老的单图写法是 `props.src` + `props.caption`（没有 `images`）。这种节点
 * 在面板里**当作第 1 行显示**（不会看着像"图丢了"），一旦在这里编辑就迁移成 `images`
 * 并清掉 `src`/`caption`（同一张图，只是换了存放位置）。
 */
import { Plus, Minus, ImagePlus, RotateCw } from 'lucide-react';
import { pickImageDataUrl } from './pickImageFile';
import type { ControlProps } from './index';

/** 这张图集最多几张（用户 2026-09-23：文档里最多同时 5 张） */
export const IMAGE_ROWS_MAX = 5;

interface Row {
  src: string;
  caption: string;
  /** 顺时针角度（0/90/180/270…） */
  rot: number;
}

/** 角度归一化到 0…359 */
function normRot(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? ((Math.round(v) % 360) + 360) % 360 : 0;
}

/** `props.imageRotations`（一行一个）→ 角度数组 */
export function parseRotations(raw: unknown): number[] {
  const text = String(raw ?? '');
  if (text === '') return [];
  return text.split(/\r?\n/).map((l) => normRot(Number.parseFloat(l.trim())));
}

/** 角度数组 → `props.imageRotations`（与行数对齐；全 0 时写空串，保持 JSON 干净） */
function joinRotations(rots: number[]): string {
  const list = rots.map(normRot);
  return list.every((r) => r === 0) ? '' : list.join('\n');
}

/**
 * `props.images` 文本 ↔ 行数组（与 image.tsx 的 parseImageLines 同一口径）。
 *
 * ★★两个坑（用户 2026-09-23 报的两个 bug 都出在这里）：
 *
 * 1) **行数只能由换行符决定，不能"trim 一下再看空不空"**。
 *    `parseRows` 与 `joinRows` 必须**严格互逆**：全空的多行拼出来是 `'\n\n'`，
 *    如果解析时先 `trim()` 判空、直接回落到"一行"，那这串文本就被压成 1 行 ——
 *    表现就是「没填地址时点 ＋ 加不出占位行」和「删掉上面一行后下面的行全没了」
 *    （下面的占位行全被压成一行）。所以：**只有真正的空串 `''`** 才算"一行空行"。
 *
 * 2) **图题的尾部空白要留着**，否则打字时吃空格：值是从 props 往返的（每次输入 → 写
 *    props → 再解析回来当 value），把图题 `trim()` 掉的话，用户输 "图 1-1" 刚敲完空格
 *    就被吃掉（那一下空格正好在末尾）；只去掉"|"后面的前导空白（那是 MCP 写
 *    `地址 | 图题` 的排版空格，不该进图题）。
 */
export function parseRows(raw: unknown): { src: string; caption: string }[] {
  const text = String(raw ?? '');
  if (text === '') return [{ src: '', caption: '' }];
  return text.split(/\r?\n/).map((line) => {
    const i = line.indexOf('|');
    if (i < 0) return { src: line.trim(), caption: '' };
    return { src: line.slice(0, i).trim(), caption: line.slice(i + 1).replace(/^\s+/, '') };
  });
}

/** 行数组 → `props.images` 文本。与 `parseRows` 严格互逆（空行要保留，行数就是张数）。 */
export function joinRows(rows: { src: string; caption: string }[]): string {
  // ★空行必须保留：这是"行编辑器"，刚点 ＋ 加出来的就是空行 ——
  //   过滤掉的话数据没变化，控件会立刻把新行收回去（点 ＋ 看着没反应）。
  //   渲染端（image.tsx 的 parseImageItems）本来就会忽略空行，所以保留是安全的。
  return rows.map((r) => (r.caption ? `${r.src} | ${r.caption}` : r.src)).join('\n');
}

export function ImageRowsControl({ value, onChange, allProps, onPatch }: ControlProps) {
  const stored = parseRows(value);
  const storedRot = parseRotations(allProps?.imageRotations);
  /** 老字段（单图）里的那张图 —— 只在 `images` 一张都没有时兜底显示 */
  const legacySrc = String(allProps?.src ?? '');
  const legacy = !stored.some((r) => r.src !== '') && legacySrc !== '';
  const rows: Row[] = (legacy ? [{ src: legacySrc, caption: String(allProps?.caption ?? '') }] : stored).map((r, i) => ({
    ...r,
    rot: storedRot[i] ?? 0,
  }));

  const write = (next: Row[]): void => {
    const images = joinRows(next);
    const imageRotations = joinRotations(next.map((r) => r.rot));
    // 编辑老节点 = 顺手迁移到 images（清掉 src/caption），免得同一张图存两份、以后又对不上
    if (onPatch) onPatch(legacy ? { images, imageRotations, src: '', caption: '' } : { images, imageRotations });
    else onChange(images);
  };

  const patch = (i: number, p: Partial<Row>): void => write(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  /**
   * ＋ 只有第 1 行那一个按钮 → **加到最后一行后面**（不是插在第 1 行后面）。
   * 用户 2026-09-24 的排版把 ＋ 画在第 1 行；若按"插在这行下面"实现，已经填好的第 2 行会被新空行顶下去
   * （自检里就是这么发现的：images 变成 `a.png / 空 / 空 / 空 / b.png`，b.png 那行的角度就对不上了）。
   */
  const appendRow = (): void => {
    if (rows.length >= IMAGE_ROWS_MAX) return;
    write([...rows, { src: '', caption: '', rot: 0 }]);
  };
  const removeAt = (i: number): void => {
    if (rows.length <= 1) return;
    write(rows.filter((_, idx) => idx !== i)); // 角度跟着行走（数组一起删）
  };

  const inputCls =
    'h-7 w-full min-w-0 rounded border border-line bg-white px-1.5 text-[12px] outline-none focus:border-primary';
  const iconBtn =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line text-gray-500 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40';

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
          {/* ◌ 旋转 + ▩ 选图：按用户 2026-09-24 给的排版，两个图标紧跟在行首文字后面 */}
          <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
            <button
              type="button"
              data-image-row-rotate={i + 1}
              data-image-row-rot={r.rot}
              data-tip-text={`旋转这张图 90°（当前 ${r.rot}°；点 4 下回到 0°）`}
              onClick={() => patch(i, { rot: normRot(r.rot + 90) })}
              className={iconBtn}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            {r.rot !== 0 && (
              <button
                type="button"
                data-image-row-angle={i + 1}
                data-tip-text={`当前 ${r.rot}°，点一下归零`}
                onClick={() => patch(i, { rot: 0 })}
                className="h-6 shrink-0 rounded border border-line px-1 text-[10px] tabular-nums text-gray-500 hover:border-primary hover:text-primary"
              >
                {r.rot}°
              </button>
            )}
            <button
              type="button"
              data-image-row-file={i + 1}
              data-tip-text="选这张图的本地文件（转 data:URL 填进地址）"
              onClick={() => pickImageDataUrl((dataUrl) => patch(i, { src: dataUrl }))}
              className={iconBtn}
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
          </div>
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
            {/* ＋ 只在第 1 行（用户排版）；− 只在"加过行"之后才出现（1 行时整个按钮不渲染） */}
            {i === 0 && (
              <button
                type="button"
                data-image-row-add={i + 1}
                disabled={rows.length >= IMAGE_ROWS_MAX}
                data-tip-text={rows.length >= IMAGE_ROWS_MAX ? `最多 ${IMAGE_ROWS_MAX} 张` : '加一张图（加在最后一行后面）'}
                onClick={appendRow}
                className={iconBtn}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            {rows.length > 1 && (
              <button
                type="button"
                data-image-row-remove={i + 1}
                data-tip-text="删掉这一行"
                onClick={() => removeAt(i)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line text-gray-500 hover:border-red-300 hover:text-red-500"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
