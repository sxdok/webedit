/**
 * 职责：画布交互（阶段三）——统一处理两种模式的指针操作：
 *   Web 模式：拖动移动（多选一起动）、8 向缩放、旋转、网格+元素吸附（出辅助线）、框选、拖入容器
 *   文档模式：拖动排序（出插入指示线）、面板拖入按落点插入到指定序号
 * 只在这里碰 pointer 事件与几何计算；视觉部分由 SelectionBox / GuideLines / InsertIndicator 渲染。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Frame } from '../../registry/types';
import { getComponent } from '../../registry';
import { useEditorStore } from '../../store/editorStore';
import { findNode, getForest } from '../../store/treeUtils';
import type { HandleDir } from './ResizeHandles';
import { DRAG_MIME } from '../panels/ComponentPanel';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type InteractionMode = 'idle' | 'move' | 'resize' | 'rotate' | 'marquee' | 'reorder';

interface MoveStart {
  pointerId: number;
  ox: number;
  oy: number;
  frames: Map<string, Frame>;
  primaryId: string;
  moved: boolean;
}

interface ResizeStart {
  pointerId: number;
  dir: HandleDir;
  ox: number;
  oy: number;
  frame: Frame;
  center: { x: number; y: number };
  startAngle: number;
}

const SNAP_PX = 6;
const MIN_SIZE = 8;
const DRAG_THRESHOLD = 4;

export interface CanvasInteractionOptions {
  mode: 'document' | 'web';
  zoom: number;
  canvas: { width: number; height: number; gridSize: number };
  snap: boolean;
  /** 画布根元素（纸张 / 设备画布），用于坐标换算与命中测试 */
  canvasRef: React.RefObject<HTMLDivElement>;
}

export interface CanvasInteractionApi {
  mode: InteractionMode;
  guides: { v: number[]; h: number[] };
  marquee: Rect | null;
  dropIndex: number | null;
  overContainerId: string | null;
  draggingId: string | null;
  onNodePointerDown: (e: ReactPointerEvent, nodeId: string) => void;
  onHandlePointerDown: (e: ReactPointerEvent, dir: HandleDir, nodeId: string) => void;
  onCanvasPointerDown: (e: ReactPointerEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function useCanvasInteraction(opts: CanvasInteractionOptions): CanvasInteractionApi {
  const { mode, zoom, canvas, snap, canvasRef } = opts;
  const [interaction, setInteraction] = useState<InteractionMode>('idle');
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [overContainerId, setOverContainerId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const lastResizeId = useRef<string | null>(null);
  const moveRef = useRef<MoveStart | null>(null);
  const resizeRef = useRef<ResizeStart | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const reorderRef = useRef<{ id: string; startY: number; active: boolean } | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  /** 客户端坐标 → 画布内坐标（px，未缩放坐标系） */
  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const el = canvasRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
    },
    [canvasRef, zoom],
  );

  /** 文档流里的插入序号：按各块中点比较指针 Y */
  const indexAtY = useCallback((clientY: number): number => {
    const el = canvasRef.current;
    if (!el) return 0;
    // ★跨页续表（data-node-split）不算独立块，否则一个表格会被当两块、落点序号会算错
    const blocks = [...el.querySelectorAll<HTMLElement>('[data-node-id]')].filter(
      (b) =>
        !b.closest('[data-measure]') &&
        !b.parentElement?.closest('[data-node-id]') &&
        !b.hasAttribute('data-node-split'),
    );
    let index = 0;
    blocks.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      if (clientY > r.top + r.height / 2) index = i + 1;
    });
    return index;
  }, [canvasRef]);

  /** 命中测试：某坐标落在哪个容器的内容区里（用于拖入容器） */
  const containerAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      if (!el) return null;
      const host = el.closest('[data-node-id]') as HTMLElement | null;
      if (!host) return null;
      const id = host.getAttribute('data-node-id');
      if (!id || id === draggingId) return null;
      const node = findNode(getForest(useEditorStore.getState().doc), id);
      if (!node) return null;
      return getComponent(node.type)?.isContainer ? id : null;
    },
    [draggingId],
  );

  /* ══════════ 吸附计算 ══════════ */

  const computeSnap = useCallback(
    (
      candidate: Frame,
      skipIds: Set<string>,
    ): { dx: number; dy: number; v: number[]; h: number[] } => {
      let dx = 0;
      let dy = 0;
      const v: number[] = [];
      const h: number[] = [];
      if (!snap) return { dx, dy, v, h };

      const state = useEditorStore.getState();
      const forest = getForest(state.doc);
      const targets: { x: number[]; y: number[] } = { x: [], y: [] };
      // 画布：左/中/右、上/中/下
      targets.x.push(0, canvas.width / 2, canvas.width);
      targets.y.push(0, canvas.height / 2, canvas.height);
      // 其它顶层元素：边缘与中心
      forest.forEach((n) => {
        if (skipIds.has(n.id) || !n.frame) return;
        const f = n.frame;
        targets.x.push(f.x, f.x + f.w / 2, f.x + f.w);
        targets.y.push(f.y, f.y + f.h / 2, f.y + f.h);
      });

      // 只在移动时做元素吸附；缩放时按尺寸吸附
      const selfX = [candidate.x, candidate.x + candidate.w / 2, candidate.x + candidate.w];
      const selfY = [candidate.y, candidate.y + candidate.h / 2, candidate.y + candidate.h];

      /** 在候选线里挑最近的一条（返回偏移与线位置） */
      const pick = (selfs: number[], lines: number[]): { delta: number; line: number } | null => {
        let bestDelta = 0;
        let bestLine = 0;
        let bestAbs = SNAP_PX + 1;
        selfs.forEach((sx) => {
          lines.forEach((tx) => {
            const d = tx - sx;
            const abs = Math.abs(d);
            if (abs <= SNAP_PX && abs < bestAbs) {
              bestAbs = abs;
              bestDelta = d;
              bestLine = tx;
            }
          });
        });
        return bestAbs <= SNAP_PX ? { delta: bestDelta, line: bestLine } : null;
      };

      const hitX = pick(selfX, targets.x);
      const hitY = pick(selfY, targets.y);
      if (hitX) {
        dx = hitX.delta;
        v.push(hitX.line);
      }
      if (hitY) {
        dy = hitY.delta;
        h.push(hitY.line);
      }
      // 未吸附到元素时退回网格吸附
      if (!hitX && canvas.gridSize > 0) dx = Math.round(candidate.x / canvas.gridSize) * canvas.gridSize - candidate.x;
      if (!hitY && canvas.gridSize > 0) dy = Math.round(candidate.y / canvas.gridSize) * canvas.gridSize - candidate.y;
      return { dx, dy, v, h };
    },
    [snap, canvas.width, canvas.height, canvas.gridSize],
  );

  /* ══════════ 移动（Web 模式） ══════════ */

  const endInteraction = useCallback(() => {
    moveRef.current = null;
    resizeRef.current = null;
    marqueeStart.current = null;
    reorderRef.current = null;
    setInteraction('idle');
    setGuides({ v: [], h: [] });
    setMarquee(null);
    setDropIndex(null);
    setDraggingId(null);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const store = useEditorStore.getState();
      const forest = getForest(store.doc);

      /* 框选 */
      if (marqueeStart.current) {
        const a = marqueeStart.current;
        const b = toCanvas(e.clientX, e.clientY);
        const rect: Rect = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.abs(b.x - a.x),
          h: Math.abs(b.y - a.y),
        };
        setMarquee(rect);
        const hit = forest
          .filter((n) => n.frame)
          .filter((n) => {
            const f = n.frame as Frame;
            return !(f.x > rect.x + rect.w || f.x + f.w < rect.x || f.y > rect.y + rect.h || f.y + f.h < rect.y);
          })
          .map((n) => n.id);
        store.selectComponent(hit);
        return;
      }

      /* 文档模式拖动排序 */
      if (reorderRef.current) {
        const r = reorderRef.current;
        if (!r.active && Math.abs(e.clientY - r.startY) > DRAG_THRESHOLD) {
          r.active = true;
          setInteraction('reorder');
          setDraggingId(r.id);
        }
        if (r.active) {
          const idx = indexAtY(e.clientY);
          dropIndexRef.current = idx;
          setDropIndex(idx);
        }
        return;
      }

      /* 缩放 */
      if (resizeRef.current && resizeRef.current.dir !== 'rotate') {
        const s = resizeRef.current;
        const p = toCanvas(e.clientX, e.clientY);
        const dx = p.x - s.ox;
        const dy = p.y - s.oy;
        let { x, y, w, h } = s.frame;
        const right = s.frame.x + s.frame.w;
        const bottom = s.frame.y + s.frame.h;
        if (s.dir.includes('e')) w = Math.max(MIN_SIZE, s.frame.w + dx);
        if (s.dir.includes('s')) h = Math.max(MIN_SIZE, s.frame.h + dy);
        if (s.dir.includes('w')) {
          x = Math.min(right - MIN_SIZE, s.frame.x + dx);
          w = right - x;
        }
        if (s.dir.includes('n')) {
          y = Math.min(bottom - MIN_SIZE, s.frame.y + dy);
          h = bottom - y;
        }
        if (snap && canvas.gridSize > 0) {
          w = Math.round(w / canvas.gridSize) * canvas.gridSize;
          h = Math.round(h / canvas.gridSize) * canvas.gridSize;
          if (s.dir.includes('w')) x = right - w;
          if (s.dir.includes('n')) y = bottom - h;
        }
        const rid = lastResizeId.current;
        if (rid) store.updateFrame(rid, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
        return;
      }

      /* 旋转 */
      if (resizeRef.current && resizeRef.current.dir === 'rotate') {
        const s = resizeRef.current;
        const p = toCanvas(e.clientX, e.clientY);
        const ang = (Math.atan2(p.y - s.center.y, p.x - s.center.x) * 180) / Math.PI + 90;
        const next = e.shiftKey ? Math.round(ang / 15) * 15 : Math.round(ang);
        if (lastResizeId.current) store.updateFrame(lastResizeId.current, { rotation: next });
        return;
      }

      /* 移动 */
      if (moveRef.current) {
        const s = moveRef.current;
        if (!s.moved && Math.abs(e.clientY - s.oy) < DRAG_THRESHOLD && Math.abs(e.clientX - s.ox) < DRAG_THRESHOLD) return;
        s.moved = true;
        setInteraction('move');
        setDraggingId(s.primaryId);
        const p = toCanvas(e.clientX, e.clientY);
        const dxRaw = p.x - s.ox;
        const dyRaw = p.y - s.oy;
        const primary = s.frames.get(s.primaryId);
        if (!primary) return;
        const candidate: Frame = { ...primary, x: primary.x + dxRaw, y: primary.y + dyRaw };
        const skip = new Set(s.frames.keys());
        const { dx, dy, v, h } = computeSnap(candidate, skip);
        setGuides({ v, h });
        s.frames.forEach((f, id) => {
          store.updateFrame(id, { x: Math.round(f.x + dxRaw + dx), y: Math.round(f.y + dyRaw + dy) });
        });
      }
    },
    [canvas.gridSize, computeSnap, indexAtY, snap, toCanvas],
  );

  /* ══════════ 起手 ══════════ */

  const onNodePointerDown = useCallback(
    (e: ReactPointerEvent, nodeId: string) => {
      if (e.button !== 0) return;
      // 手柄自身的 pointerdown 由 onHandlePointerDown 处理
      if ((e.target as HTMLElement).dataset.handle) return;
      const store = useEditorStore.getState();

      if (mode === 'document') {
        if (!store.doc.selectedIds.includes(nodeId)) store.selectComponent([nodeId]);
        reorderRef.current = { id: nodeId, startY: e.clientY, active: false };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        return;
      }

      const ids = store.doc.selectedIds.includes(nodeId) ? store.doc.selectedIds : [nodeId];
      if (!store.doc.selectedIds.includes(nodeId)) store.selectComponent([nodeId]);
      const forest = getForest(store.doc);
      const frames = new Map<string, Frame>();
      ids.forEach((id) => {
        const n = findNode(forest, id);
        if (n?.frame) frames.set(id, { ...n.frame });
      });
      if (!frames.size) return;
      const p = toCanvas(e.clientX, e.clientY);
      moveRef.current = { pointerId: e.pointerId, ox: p.x, oy: p.y, frames, primaryId: nodeId, moved: false };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [mode, onPointerMove, toCanvas],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent, dir: HandleDir, nodeId: string) => {
      e.stopPropagation();
      const store = useEditorStore.getState();
      const node = findNode(getForest(store.doc), nodeId);
      if (!node?.frame) return;
      const p = toCanvas(e.clientX, e.clientY);
      const c = { x: node.frame.x + node.frame.w / 2, y: node.frame.y + node.frame.h / 2 };
      const startAngle = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
      resizeRef.current = { pointerId: e.pointerId, dir, ox: p.x, oy: p.y, frame: { ...node.frame }, center: c, startAngle };
      lastResizeId.current = nodeId;
      setInteraction(dir === 'rotate' ? 'rotate' : 'resize');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [onPointerMove, toCanvas],
  );

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      const store = useEditorStore.getState();
      store.selectComponent([]);
      const p = toCanvas(e.clientX, e.clientY);
      marqueeStart.current = { x: p.x, y: p.y };
      setInteraction('marquee');
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [onPointerMove, toCanvas],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const store = useEditorStore.getState();
      if (reorderRef.current) {
        const r = reorderRef.current;
        const idx = dropIndexRef.current;
        if (r.active && idx != null) store.moveComponent(r.id, null, idx);
      }
      if (moveRef.current) {
        const s = moveRef.current;
        if (s.moved) {
          // Web 模式：拖到容器上方 → 落入容器（成为子元素）
          const target = containerAt(e.clientX, e.clientY);
          if (target && !s.frames.has(target)) store.reparentComponent(s.primaryId, target);
        }
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      endInteraction();
    },
    [containerAt, endInteraction, onPointerMove],
  );

  /* ══════════ 面板拖入 ══════════ */

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (mode === 'document') {
        const idx = indexAtY(e.clientY);
        dropIndexRef.current = idx;
        setDropIndex(idx);
      } else {
        setOverContainerId(containerAt(e.clientX, e.clientY));
      }
    },
    [containerAt, indexAtY, mode],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const type = e.dataTransfer.getData(DRAG_MIME);
      if (!type) return;
      e.preventDefault();
      const store = useEditorStore.getState();
      if (mode === 'document') {
        store.addComponent(type, null, dropIndexRef.current ?? undefined);
      } else {
        const p = toCanvas(e.clientX, e.clientY);
        const parentId = overContainerId;
        const id = store.addComponent(type, parentId);
        if (id && !parentId) {
          // 顶层：把落点作为位置（对齐网格）
          const g = canvas.gridSize || 1;
          store.updateFrame(id, { x: Math.max(0, Math.round(p.x / g) * g), y: Math.max(0, Math.round(p.y / g) * g) });
        }
      }
      endInteraction();
    },
    [canvas.gridSize, endInteraction, mode, overContainerId, toCanvas],
  );

  // 拖拽结束（面板 dragend / 鼠标离开）时清掉临时态
  useEffect(() => {
    const clear = () => {
      dropIndexRef.current = null;
      setDropIndex(null);
      setOverContainerId(null);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  return {
    mode: interaction,
    guides,
    marquee,
    dropIndex,
    overContainerId,
    draggingId,
    onNodePointerDown,
    onHandlePointerDown,
    onCanvasPointerDown,
    onDragOver,
    onDrop,
  };
}
