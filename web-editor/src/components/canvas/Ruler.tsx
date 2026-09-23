/**
 * 职责：画布标尺（可开关）。文档模式刻度单位 mm，Web 模式单位 px。
 * 只负责刻度绘制，不参与命中测试。
 */
import { useMemo } from 'react';
import type { EditorMode } from '../../registry/types';
import { mmToPx } from '../../utils/units';

export function Ruler({
  mode,
  /** 内容长度（px，未乘 zoom） */ length,
  /** 当前缩放 */ zoom,
  orientation,
  thickness = 18,
}: {
  mode: EditorMode;
  length: number;
  zoom: number;
  orientation: 'horizontal' | 'vertical';
  thickness?: number;
}) {
  const ticks = useMemo(() => {
    // 文档模式每 10mm 一大格、每 5mm 一小格；Web 模式每 100px 一大格、每 50px 一小格
    const major = mode === 'document' ? mmToPx(10) : 100;
    const minor = major / 2;
    const unit = mode === 'document' ? 'mm' : '';
    const out: { pos: number; label: string | null }[] = [];
    const total = length;
    for (let p = 0, i = 0; p <= total; p += minor, i++) {
      const isMajor = i % 2 === 0;
      out.push({
        pos: p,
        label: isMajor ? `${Math.round(mode === 'document' ? p / mmToPx(1) : p)}${unit}` : null,
      });
    }
    return out;
  }, [mode, length]);

  const scaled = (p: number) => p * zoom;

  if (orientation === 'horizontal') {
    return (
      <div
        data-ruler="h"
        className="ruler-bg relative select-none overflow-hidden border-b border-line"
        style={{ height: thickness, width: '100%' }}
      >
        {ticks.map((t, i) => (
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
        ))}
      </div>
    );
  }

  return (
    <div
      data-ruler="v"
      /* ★高度必须撑满容器：刻度都是绝对定位的，没有 height 时 auto = 0（纵向标尺会量到 0 高） */
      className="ruler-bg relative select-none overflow-hidden border-r border-line"
      style={{ width: thickness, height: '100%' }}
    >
      {ticks.map((t, i) => (
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
      ))}
    </div>
  );
}
