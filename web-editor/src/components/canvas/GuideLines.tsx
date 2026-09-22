/**
 * 职责：Web 模式画布的对齐辅助线（拖动/缩放时显示元素边缘、中心线与画布中线的吸附位置）。
 * 只画线，不做计算（计算在 useCanvasInteraction）。
 */
export function GuideLines({
  vertical,
  horizontal,
  width,
  height,
}: {
  /** 竖线 x 坐标（px，画布坐标系） */ vertical: number[];
  /** 横线 y 坐标（px，画布坐标系） */ horizontal: number[];
  width: number;
  height: number;
}) {
  if (!vertical.length && !horizontal.length) return null;
  return (
    <div className="no-print pointer-events-none absolute inset-0 z-30">
      {vertical.map((x) => (
        <div
          key={`v${x}`}
          className="absolute top-0"
          style={{ left: x, width: 1, height, background: '#ff4d4f' }}
        />
      ))}
      {horizontal.map((y) => (
        <div
          key={`h${y}`}
          className="absolute left-0"
          style={{ top: y, height: 1, width, background: '#ff4d4f' }}
        />
      ))}
    </div>
  );
}
