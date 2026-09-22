/**
 * 职责：文档模式的插入位置指示线（2px 蓝色水平线）+ Web 模式的容器高亮框。
 */
export function InsertIndicator({ top, left, width }: { top: number; left: number; width: number }) {
  return (
    <div
      className="no-print pointer-events-none absolute z-30"
      style={{ top, left, width, height: 2, background: '#1677ff', boxShadow: '0 0 0 2px rgba(22,119,255,.18)' }}
    >
      <span
        className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full"
        style={{ background: '#1677ff' }}
      />
    </div>
  );
}

export function ContainerHighlight({
  rect,
}: {
  rect: { x: number; y: number; w: number; h: number } | null;
}) {
  if (!rect) return null;
  return (
    <div
      className="no-print pointer-events-none absolute z-30 rounded"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        outline: '2px dashed #1677ff',
        outlineOffset: 2,
        background: 'rgba(22,119,255,.06)',
      }}
    />
  );
}
