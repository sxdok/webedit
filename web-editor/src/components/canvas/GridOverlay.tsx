/**
 * 职责：Web 模式画布的网格覆盖层（纯视觉，不参与命中测试）。
 */
export function GridOverlay({ size, width, height }: { size: number; width: number; height: number }) {
  if (size <= 0) return null;
  const minor = `rgba(22,119,255,.10) 1px, transparent 1px`;
  const major = `rgba(22,119,255,.22) 1px, transparent 1px`;
  return (
    <div
      className="no-print pointer-events-none absolute inset-0 z-0"
      style={{
        backgroundImage: `linear-gradient(to right, ${minor}), linear-gradient(to bottom, ${minor})`,
        backgroundSize: `${size}px ${size}px, ${size}px ${size}px`,
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to right, ${major}), linear-gradient(to bottom, ${major})`,
          backgroundSize: `${size * 8}px ${size * 8}px, ${size * 8}px ${size * 8}px`,
          width,
          height,
        }}
      />
    </div>
  );
}
