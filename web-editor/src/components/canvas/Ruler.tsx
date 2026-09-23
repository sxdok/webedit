/**
 * 职责：画布标尺（可开关）。文档模式刻度单位 mm，Web 模式单位 px。
 * 只负责刻度绘制，不参与命中测试。
 *
 * ★2026-09-24 两处修正（用户反馈"滚轮缩放后比例尺变形、26 页后数字很拥挤"）：
 *
 *  1. **文档模式的纵向标尺按「页」分段，每页从 0 开始**（`spans`）：
 *     以前是"整个文档一根连续标尺"（26 页 → 数字一路数到 7000+mm），
 *     现在每页 0…页高（A4 = 0…297mm），页与页之间留空，数字不会越数越长。
 *  2. **步长随缩放自适应**：标签太密就自动放大到 20/50/100mm（Web 模式 200/500/1000px），
 *     保证"带字刻度"之间至少 `LABEL_MIN_PX` 像素 —— 缩放后不再糊成一片。
 */
import { useMemo } from 'react';
import type { EditorMode } from '../../registry/types';
import { mmToPx } from '../../utils/units';

/** 相邻"带字刻度"之间至少留这么多 px（否则数字会挤在一起） */
const LABEL_MIN_PX = 34;
/** 相邻小刻度之间至少留这么多 px（否则刻度线会糊成一条） */
const TICK_MIN_PX = 7;

/** 一"段"标尺（文档模式下 = 一页）：`start` 是段起点（px，未乘 zoom），`length` 是段长 */
export interface RulerSpan {
  start: number;
  length: number;
}

/** 候选大格步长（未缩放 px）：文档模式按 mm，Web 模式按 px */
function candidates(mode: EditorMode): number[] {
  return mode === 'document' ? [10, 20, 50, 100, 200, 500].map((mm) => mmToPx(mm)) : [50, 100, 200, 500, 1000, 2000];
}

/** 按当前缩放选一个"数字不会挤"的大格步长 */
export function pickMajorStep(mode: EditorMode, zoom: number): number {
  const list = candidates(mode);
  const ok = list.find((c) => c * zoom >= LABEL_MIN_PX);
  if (ok != null) return ok;
  return list[list.length - 1];
}

export function Ruler({
  mode,
  /** 内容长度（px，未乘 zoom）；无 `spans` 时按"一整根"画 */
  length,
  /** 文档模式传每一页的区间（未乘 zoom）；空数组 = 不按页分段 */
  spans,
  /** 当前缩放 */
  zoom,
  orientation,
  thickness = 18,
}: {
  mode: EditorMode;
  length: number;
  spans?: RulerSpan[];
  zoom: number;
  orientation: 'horizontal' | 'vertical';
  thickness?: number;
}) {
  const ticks = useMemo(() => {
    const major = pickMajorStep(mode, zoom);
    const minor = major / 2;
    const unit = mode === 'document' ? 'mm' : '';
    /** 段的列表：有 spans 就逐页画（每页从 0 开始），否则整根一根 */
    const segs: RulerSpan[] = spans && spans.length > 0 ? spans : [{ start: 0, length }];
    const out: { pos: number; label: string | null }[] = [];
    for (const seg of segs) {
      if (seg.length <= 0) continue;
      const n = Math.floor((seg.length + 0.5) / minor);
      for (let i = 0; i <= n; i += 1) {
        const local = i * minor;
        const isMajor = i % 2 === 0;
        // 文档模式按**页内**位置读数（每页从 0 开始），Web 模式按整根内容读数
        const readFrom = spans && spans.length > 0 ? local : seg.start + local;
        out.push({
          pos: seg.start + local,
          label: isMajor
            ? `${Math.round(mode === 'document' ? readFrom / mmToPx(1) : readFrom)}${unit}`
            : null,
        });
      }
    }
    return out;
    // spans 是每次测量新建的数组，用长度 + 首尾值代替引用比较，避免无谓重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, length, zoom, spans?.length, spans?.[0]?.start, spans?.[0]?.length, spans?.[spans.length - 1]?.length]);

  /** 小刻度线太密就干脆不画（只剩带字的），避免"糊成一条" */
  const majorStep = pickMajorStep(mode, zoom);
  const drawMinor = (majorStep / 2) * zoom >= TICK_MIN_PX;

  const scaled = (p: number) => p * zoom;

  if (orientation === 'horizontal') {
    return (
      <div
        data-ruler="h"
        data-ruler-major={Math.round(mode === 'document' ? majorStep / mmToPx(1) : majorStep)}
        className="ruler-bg relative select-none overflow-hidden border-b border-line"
        style={{ height: thickness, width: '100%' }}
      >
        {ticks.map((t, i) =>
          t.label || drawMinor ? (
            <div key={i} className="absolute top-0" style={{ left: scaled(t.pos) }}>
              <div
                className={t.label ? 'w-px bg-gray-400' : 'w-px bg-gray-300'}
                style={{ height: t.label ? 8 : 4 }}
              />
              {t.label && (
                <span className="absolute left-0.5 top-1 whitespace-nowrap text-[9px] leading-none text-gray-400">
                  {t.label}
                </span>
              )}
            </div>
          ) : null,
        )}
      </div>
    );
  }

  return (
    <div
      data-ruler="v"
      data-ruler-major={Math.round(mode === 'document' ? majorStep / mmToPx(1) : majorStep)}
      /* ★高度必须撑满容器：刻度都是绝对定位的，没有 height 时 auto = 0（纵向标尺会量到 0 高） */
      className="ruler-bg relative select-none overflow-hidden border-r border-line"
      style={{ width: thickness, height: '100%' }}
    >
      {ticks.map((t, i) =>
        t.label || drawMinor ? (
          <div key={i} className="absolute left-0" style={{ top: scaled(t.pos) }}>
            <div
              className={t.label ? 'h-px bg-gray-400' : 'h-px bg-gray-300'}
              style={{ width: t.label ? 8 : 4 }}
            />
            {t.label && (
              <span
                className="absolute left-1 top-0.5 whitespace-nowrap text-[9px] leading-none text-gray-400"
                style={{ writingMode: 'vertical-rl' }}
              >
                {t.label}
              </span>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}
