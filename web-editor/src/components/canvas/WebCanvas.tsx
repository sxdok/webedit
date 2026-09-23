/**
 * 职责：Web 模式画布——设备尺寸画布 + 网格 + 安全区 + 绝对定位元素（NodeView），
 *       并承载阶段三交互：拖动移动、8 向缩放/旋转手柄、吸附辅助线、框选、容器落点高亮。
 */
import { useMemo } from 'react';
import type { ComponentNode, Frame, RenderContext, WebCanvasConfig } from '../../registry/types';
import { getForest } from '../../store/treeUtils';
import { useEditorStore } from '../../store/editorStore';
import { NodeView } from './NodeView';
import { GridOverlay } from './GridOverlay';
import { GuideLines } from './GuideLines';
import { ContainerHighlight } from './InsertIndicator';
import { SelectionBox } from './SelectionBox';
import { TableOverlay } from './TableOverlay';
import { useTableCellSelect } from './useTableCellSelect';
import type { CanvasInteractionApi } from './useCanvasInteraction';

/** 计算节点在画布坐标系里的绝对框（容器内子元素要累加父级偏移） */
export function absoluteFrame(forest: ComponentNode[], id: string): Frame | null {
  const chain: ComponentNode[] = [];
  const walk = (list: ComponentNode[], trail: ComponentNode[]): boolean => {
    for (const n of list) {
      const next = [...trail, n];
      if (n.id === id) {
        chain.push(...next);
        return true;
      }
      if (n.children?.length && walk(n.children, next)) return true;
    }
    return false;
  };
  if (!walk(forest, [])) return null;
  let x = 0;
  let y = 0;
  let frame: Frame | null = null;
  for (const n of chain) {
    if (!n.frame) continue;
    x += n.frame.x;
    y += n.frame.y;
    frame = n.frame;
  }
  if (!frame) return null;
  const base: Frame = frame;
  return { ...base, x, y };
}

export function WebCanvas({
  nodes,
  ctx,
  canvas,
  ui,
  zoom,
  selectedIds,
  hoveredId,
  showChrome,
  onSelect,
  onHover,
  onPointerMove,
  canvasRef,
  it,
}: {
  nodes: ComponentNode[];
  ctx: RenderContext;
  canvas: WebCanvasConfig;
  ui: { showGrid: boolean };
  zoom: number;
  selectedIds: string[];
  hoveredId: string | null;
  showChrome: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onHover: (id: string | null) => void;
  onPointerMove: (x: number, y: number) => void;
  canvasRef: React.RefObject<HTMLDivElement>;
  it: CanvasInteractionApi;
}) {
  const doc = useEditorStore((s) => s.doc);
  const forest = useMemo(() => getForest(doc), [doc]);
  /* 表格单元格：Excel 式点选 / Shift 扩展 / 拖选一片（捕获阶段，先于 NodeView 的选中处理） */
  const onCellPointerDownCapture = useTableCellSelect(onSelect);

  const primaryId = selectedIds[0];
  const primaryFrame = primaryId ? absoluteFrame(forest, primaryId) : null;
  const primaryType = primaryId
    ? (() => {
        const find = (list: ComponentNode[]): ComponentNode | null => {
          for (const n of list) {
            if (n.id === primaryId) return n;
            const c = n.children ? find(n.children) : null;
            if (c) return c;
          }
          return null;
        };
        return find(forest)?.type ?? '';
      })()
    : '';

  const overRect = it.overContainerId ? absoluteFrame(forest, it.overContainerId) : null;

  return (
    <div className="canvas-stack flex flex-col">
      <div
        ref={canvasRef}
        data-device="1"
        data-last="1"
        className="canvas-shadow relative shrink-0 overflow-hidden"
        style={{ width: canvas.width, height: Math.max(40, canvas.height - 1), background: canvas.background }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPointerMove(Math.round((e.clientX - r.left) / zoom), Math.round((e.clientY - r.top) / zoom));
        }}
        onPointerDown={(e) => {
          // 只在空白处起框选（点在元素上由 NodeView 处理）
          if (e.target === e.currentTarget) it.onCanvasPointerDown(e);
        }}
        onPointerDownCapture={onCellPointerDownCapture}
        onDragOver={it.onDragOver}
        onDrop={it.onDrop}
      >
        {ui.showGrid && <GridOverlay size={canvas.gridSize} width={canvas.width} height={canvas.height} />}

        {canvas.safeArea && (
          <div
            className="no-print pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-dashed border-emerald-400/60"
            style={{ height: 44 }}
          >
            <span className="absolute left-2 top-1 text-[10px] text-emerald-500">安全区 top 44px</span>
          </div>
        )}

        {nodes.filter((n) => !n.hidden).map((n) => (
          <NodeView
            key={n.id}
            node={n}
            ctx={ctx}
            mode="web"
            selectedIds={selectedIds}
            hoveredId={hoveredId}
            showChrome={showChrome}
            onSelect={onSelect}
            onHover={onHover}
            onNodePointerDown={it.onNodePointerDown}
          />
        ))}

        {nodes.length === 0 && (
          <p className="no-print pointer-events-none absolute inset-0 flex items-center justify-center text-2xs text-gray-300">
            从左侧组件面板拖拽或双击组件，放到这块画布上
          </p>
        )}

        {/* 容器落点高亮 */}
        <ContainerHighlight rect={overRect} />

        {/* 吸附辅助线 */}
        <GuideLines vertical={it.guides.v} horizontal={it.guides.h} width={canvas.width} height={canvas.height} />

        {/* 框选矩形 */}
        {it.marquee && (
          <div
            className="no-print pointer-events-none absolute z-30"
            style={{
              left: it.marquee.x,
              top: it.marquee.y,
              width: it.marquee.w,
              height: it.marquee.h,
              border: '1px solid #1677ff',
              background: 'rgba(22,119,255,.08)',
            }}
          />
        )}

        {/* 选中框 + 手柄（仅主选中元素） */}
        {showChrome && primaryId && primaryFrame && (
          <SelectionBox
            nodeId={primaryId}
            nodeType={primaryType}
            frame={primaryFrame}
            mode="web"
            showHandles={!it.draggingId}
            onHandleDown={(e, dir) => it.onHandlePointerDown(e, dir, primaryId)}
          />
        )}

        {/* 表格覆盖层：单元格选框 + 列宽拖拽手柄（编辑态，no-print） */}
        <TableOverlay nodeId={showChrome ? primaryId ?? null : null} zoom={zoom} />
      </div>

      <div className="no-print py-2 text-center text-2xs text-gray-400">
        设备 {canvas.device} · {canvas.width}×{canvas.height}px · 拖动移动 / 手柄缩放 · 拖到容器上可嵌套
      </div>
    </div>
  );
}
