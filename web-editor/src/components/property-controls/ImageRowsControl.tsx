/**
 * 职责：`imageRows` 属性控件 —— **图片组件唯一的图片输入方式：一行一张图**（2026-09-23 用户要求）。
 *
 * 交互（用户 2026-09-24 给的排版 + 2026-09-30 的六条优化）：
 *   `图片1  ◌  ▩ |地址| |图题|        − ＋`
 *   · 行首写 **图片1 / 图片2 / …**；
 *   · **◌ = 旋转按钮**（`RotateCw`）：点一下这张图 +90°（0→90→180→270→0 循环），
 *     角度不为 0 时右边跟一个可点的角度小标（点一下归零）；
 *   · **▩ = 选图片文件**（`ImagePlus`）：**支持多选** —— 一次选 N 张会自动填进各行
 *     （先填空行，不够就按需补新行，到 `IMAGE_ROWS_MAX` 为止）；
 *   · 之后是**地址 / 图题**两个输入框；有文件名时下面显示**图片名称**（截断），悬停出气泡显示完整名称；
 *   · **＋ 只在第 1 行**（在末尾加一张），**− 排在 ＋ 前面**、且始终占着自己的位置（行数 1 时不可见但占位），
 *     所以**连点 ＋ 时 ＋ 的位置不会动**；
 *   · 连续快速点 ＋ 每次都会加一行（写操作走 `rowsRef`，不依赖上一次渲染的闭包，避免丢点击）。
 *
 * 数据形态：`props.images` 仍是多行文本（每行 `地址` 或 `地址 | 图题`）；
 * 每行附加信息各用一个**按行对齐**的多行字段，**不动 `images` 的格式**（MCP / HTML 导入 / 老文档都不受影响）：
 *   · `props.imageRotations`：一行一个角度；
 *   · `props.imageNames`：一行一个文件名（2026-09-30 新增，面板显示 + 气泡用）。
 *
 * 老文档兼容：老的单图写法是 `props.src` + `props.caption`（没有 `images`）。这种节点
 * 在面板里**当作第 1 行显示**（不会看着像"图丢了"），一旦在这里编辑就迁移成 `images`
 * 并清掉 `src`/`caption`（同一张图，只是换了存放位置）。
 */
import { useRef } from 'react';
import { Plus, Minus, ImagePlus, RotateCw } from 'lucide-react';
import { pickImages } from './pickImageFile';
import type { ControlProps } from './index';

/** 这张图集最多几张（用户 2026-09-23：文档里最多同时 5 张） */
export const IMAGE_ROWS_MAX = 5;

interface Row {
  src: string;
  caption: string;
  /** 顺时针角度（0/90/180/270…） */
  rot: number;
  /** 文件名（选文件时记下；手工改地址会清掉，避免显示过期的名字） */
  name: string;
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

/** `props.imageNames`（一行一个）→ 名称数组（空行也算一个占位，保持与行号对齐） */
export function parseNames(raw: unknown): string[] {
  const text = String(raw ?? '');
  if (text === '') return [];
  return text.split(/\r?\n/).map((l) => l.trim());
}

/** 名称数组 → `props.imageNames`（全空时写空串） */
function joinNames(names: string[]): string {
  return names.every((n) => !n) ? '' : names.map((n) => n.replace(/\r?\n/g, ' ')).join('\n');
}

/**
 * `props.images` 文本 ↔ 行数组（与 image.tsx 的 parseImageLines 同一口径）。
 *
 * ★★两个坑（用户 2026-09-23 报的两个 bug 都出在这里）：
 *
 * 1) **行数只能由换行符决定，不能"trim 一下再看空不空"**。
 *    `parseRows` 与 `joinRows` 必须**严格互逆**：全空的多行拼出来是 `'\n\n'`，
 *    如果解析时先 `trim()` 判空、直接回落到"一行"，那这串文本就被压成 1 行 ——
 *    表现就是「没填地址时点 ＋ 加不出占位行」和「删掉上面一行后下面的行全没了」。
 *    所以：**只有真正的空串 `''`** 才算"一行空行"。
 *
 * 2) **图题的尾部空白要留着**，否则打字时吃空格：值是从 props 往返的（每次输入 → 写
 *    props → 再解析回来当 value），把图题 `trim()` 掉的话，用户输 "图 1-1" 刚敲完空格
 *    就被吃掉；只去掉"|"后面的前导空白（那是 MCP 写 `地址 | 图题` 的排版空格，不该进图题）。
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

/**
 * 把"一次多选到的图片"填进行里（纯函数，便于单测）：
 *   ① 先填**空行**（从上到下，不覆盖已经填好的）；
 *   ② 还有剩的就**按需补新行**，直到 `IMAGE_ROWS_MAX`；
 *   ③ 超出上限的直接丢弃（返回值里 `ignored` 告诉调用方丢了几张，面板据此提示）。
 * 用户要的语义："有几行就能选几张，自动填充到新加行"。
 */
export function fillRowsWithPicks(rows: Row[], picks: { name: string; dataUrl: string }[]): { rows: Row[]; ignored: number } {
  const next = rows.map((r) => ({ ...r }));
  let pi = 0;
  for (let i = 0; i < next.length && pi < picks.length; i += 1) {
    if (next[i].src) continue; // 已经填过的行不动
    next[i] = { ...next[i], src: picks[pi].dataUrl, name: picks[pi].name };
    pi += 1;
  }
  while (pi < picks.length && next.length < IMAGE_ROWS_MAX) {
    next.push({ src: picks[pi].dataUrl, caption: '', rot: 0, name: picks[pi].name });
    pi += 1;
  }
  return { rows: next, ignored: picks.length - pi };
}

export function ImageRowsControl({ value, onChange, allProps, onPatch }: ControlProps) {
  const stored = parseRows(value);
  const storedRot = parseRotations(allProps?.imageRotations);
  const storedNames = parseNames(allProps?.imageNames);
  /** 老字段（单图）里的那张图 —— 只在 `images` 一张都没有时兜底显示 */
  const legacySrc = String(allProps?.src ?? '');
  const legacy = !stored.some((r) => r.src !== '') && legacySrc !== '';
  const rows: Row[] = (legacy ? [{ src: legacySrc, caption: String(allProps?.caption ?? '') }] : stored).map((r, i) => ({
    ...r,
    rot: storedRot[i] ?? 0,
    name: storedNames[i] ?? '',
  }));
  /**
   * ★快速连点 ＋ 不丢点击：写操作以 `rowsRef` 为准，而不是本次渲染闭包里的 `rows`。
   * （同一 tick 内连点两次时，第二次若用旧闭包算 `rows.length`，就会覆盖掉第一次的结果。）
   */
  const rowsRef = useRef<Row[]>(rows);
  rowsRef.current = rows;

  const write = (next: Row[]): void => {
    rowsRef.current = next;
    const images = joinRows(next);
    const imageRotations = joinRotations(next.map((r) => r.rot));
    const imageNames = joinNames(next.map((r) => r.name));
    // 编辑老节点 = 顺手迁移到 images（清掉 src/caption），免得同一张图存两份、以后又对不上
    if (onPatch) onPatch(legacy ? { images, imageRotations, imageNames, src: '', caption: '' } : { images, imageRotations, imageNames });
    else onChange(images);
  };

  const patch = (i: number, p: Partial<Row>): void => write(rowsRef.current.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  /**
   * ＋ 只有第 1 行那一个按钮 → **加到最后一行后面**（不是插在第 1 行后面）。
   * 用户 2026-09-24 的排版把 ＋ 画在第 1 行；若按"插在这行下面"实现，已经填好的第 2 行会被新空行顶下去
   * （自检里就是这么发现的：images 变成 `a.png / 空 / 空 / 空 / b.png`，b.png 那行的角度就对不上了）。
   */
  const appendRow = (): void => {
    const cur = rowsRef.current;
    if (cur.length >= IMAGE_ROWS_MAX) return;
    write([...cur, { src: '', caption: '', rot: 0, name: '' }]);
  };
  const removeAt = (i: number): void => {
    const cur = rowsRef.current;
    if (cur.length <= 1) return;
    write(cur.filter((_, idx) => idx !== i)); // 角度/名称跟着行走（数组一起删）
  };
  /** ▩ 选图：**支持多选** → 依次填进空行/补新行 */
  const pickIntoRows = (): void => {
    pickImages((picks) => {
      if (picks.length === 0) return;
      const { rows: filled } = fillRowsWithPicks(rowsRef.current, picks);
      write(filled);
    });
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
              data-tip-text="选这张图的本地文件（**可多选**：一次选 N 张会自动填进各行）"
              onClick={pickIntoRows}
              className={iconBtn}
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/*
              ★2026-09-30 用户："红框的是名称、绿框的才是我想显示名称的地方，显示的东西太密集了"：
              选过文件的这一行，**地址框里直接显示图片名称**（data:URL 几十 KB，人看不了），
              悬停该框出气泡给**完整名称**；想手填地址就直接在框里输入（一输入就丢掉旧名称，见 onChange）。
              行下方不再单独占一行显示名称（原来那样把行撑高、也跟"图题"挤在一起）。
            */}
            <input
              data-image-row-src={i + 1}
              data-image-row-name-text={r.name ? i + 1 : undefined}
              data-tip-text={r.name || undefined}
              value={r.name || r.src}
              onChange={(e) => patch(i, { src: e.target.value, name: '' })}
              placeholder={i === 0 ? '图片地址或 data:URL（选过文件后这里显示名称）' : '图片地址'}
              className={`${inputCls} ${r.name ? 'text-gray-600' : ''}`}
            />
            <input
              data-image-row-caption={i + 1}
              value={r.caption}
              onChange={(e) => patch(i, { caption: e.target.value })}
              placeholder="图题（可留空）"
              className={inputCls}
            />
          </div>
          {/* ★操作按钮列：**固定宽度**（52px = 两个 24px + 间隙）→ 连点 ＋ 时位置不动；
             顺序是 **− 在 ＋ 前面**（用户 2026-09-30 要求）；行数 1 时 − 不渲染但**占位**（invisible）。
              第 2..n 行也放一个同宽空槽，保证各行右端对齐。 */}
          <div className="flex w-[52px] shrink-0 items-center justify-end gap-0.5 pt-0.5" data-image-row-actions={i + 1}>
            <button
              type="button"
              data-image-row-remove={i + 1}
              data-tip-text="删掉这一行"
              tabIndex={rows.length > 1 ? 0 : -1}
              onClick={() => removeAt(i)}
              className={`${iconBtn} hover:border-red-300 hover:text-red-500 ${rows.length > 1 ? '' : 'invisible'}`}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            {i === 0 ? (
              <button
                type="button"
                data-image-row-add={i + 1}
                disabled={rows.length >= IMAGE_ROWS_MAX}
                data-tip-text={rows.length >= IMAGE_ROWS_MAX ? `最多 ${IMAGE_ROWS_MAX} 张` : '加一张图（加在最后一行后面；可连点）'}
                onClick={appendRow}
                className={iconBtn}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            ) : (
              <span className="h-6 w-6 shrink-0" aria-hidden="true" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
