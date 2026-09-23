/**
 * 职责：文档模式下**按 mm 改宽度**的拖拽手柄（B7）。
 *
 * 为什么单独一层：文档模式是"流式排版"，组件没有 `frame`（那是 Web 模式的绝对定位盒子），
 * 所以改宽度只能改**组件自己的宽度属性**（如 `image.props.width`，单位 mm）。
 * 这层覆盖在每个纸张内部（纸张是 position:relative），跟随选中节点画一个右手柄：
 *   · 只对**定义里有 `width`（unit=mm）属性**的组件出柄（图片、图表、代码块…）；
 *   · 被拖的宽度盒子优先取节点内带 `data-width-box="1"` 的元素（图片的 figure），
 *     没有就退回节点本身 —— 这样手柄贴的是"看得见的那个框"，而不是整列宽度；
 *   · 全程用"布局 px"算：屏幕位移 ÷ zoom = 布局位移，再 ÷ mmToPx(1) = mm。
 */
import { useEffect, useRef, useState } from 'react';
import { getComponent } from '../../registry';
import { findNode, getForest } from '../../store/treeUtils';
import { useEditorStore } from '../../store/editorStore';
import { asNumber } from '../../utils/id';
import { mmToPx } from '../../utils/units';
import type { PropSchemaItem } from '../../registry/types';

interface Box {
  right: number;
  centerY: number;
  height: number;
  width: number;
}

const EMPTY: Box & { key: string } = { key: '', right: 0, centerY: 0, height: 0, width: 0 };

/** 该组件是否支持"拖宽度"：定义里要有 unit=mm 的 width 属性 */
export function mmWidthItem(type: string): PropSchemaItem | null {
  const def = getComponent(type);
  const item = def?.propSchema.find((it) => it.key === 'width' && it.control === 'unit' && (it.unit ?? 'px') === 'mm');
  return item ?? null;
}

function measure(host: HTMLElement, nodeId: string, zoom: number): Box & { key: string } {
  const paper = host.parentElement;
  if (!paper) return EMPTY;
  const nodeHost = paper.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
  if (!nodeHost) return EMPTY;
  const boxEl = nodeHost.querySelector<HTMLElement>('[data-width-box="1"]') ?? nodeHost;
  const z = zoom || 1;
  const paperRect = paper.getBoundingClientRect();
  const r = boxEl.getBoundingClientRect();
  return {
    key: `${nodeId}#${Math.round(z * 100)}#${Math.round(r.right)}#${Math.round(r.top)}#${Math.round(r.height)}`,
    right: (r.right - paperRect.left) / z,
    centerY: (r.top - paperRect.top) / z + r.height / z / 2,
    height: r.height / z,
    width: r.width / z,
  };
}

export function WidthOverlay({ nodeId, zoom }: { nodeId: string | null; zoom: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const doc = useEditorStore((s) => s.doc);
  const updateProps = useEditorStore((s) => s.updateProps);
  const [box, setBox] = useState<Box & { key: string }>(EMPTY);
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState<number | null>(null);

  const node = nodeId ? findNode(getForest(doc), nodeId) : null;
  const item = node ? mmWidthItem(node.type) : null;
  const enabled = !!nodeId && !!node && !!item;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !nodeId || !enabled) {
      setBox((p) => (p.key ? EMPTY : p));
      return;
    }
    const next = measure(host, nodeId, zoom);
    setBox((prev) => (prev.key === next.key ? prev : next));
  });

  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nodeId || !node || !item) return;
    const startW = asNumber(node.props.width, asNumber(item.defaultValue, 84));
    const min = asNumber(item.min, 1);
    const max = asNumber(item.max, 2000);
    const startX = e.clientX;
    setDragging(true);
    setLive(startW);

    const onMove = (ev: PointerEvent) => {
      const dMm = (ev.clientX - startX) / (zoom || 1) / mmToPx(1);
      const next = Math.min(Math.max(Math.round((startW + dMm) * 10) / 10, min), max);
      setLive(next);
      updateProps(nodeId, { width: next });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cleanupRef.current = null;
      setDragging(false);
      setLive(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cleanupRef.current = onUp;
  };

  return (
    <div ref={hostRef} data-width-overlay="1" className="no-print pointer-events-none absolute inset-0 z-20">
      {enabled && box.key && (
        <>
          <div
            data-width-handle="1"
            data-width-node={nodeId}
            title="拖动改宽度（文档模式按 mm）"
            onPointerDown={startDrag}
            className="pointer-events-auto absolute"
            style={{
              left: box.right - 3,
              top: box.centerY - 12,
              width: 6,
              height: 24,
              borderRadius: 2,
              border: '1.5px solid #1677ff',
              background: dragging ? '#1677ff' : '#fff',
              cursor: 'ew-resize',
            }}
          />
          <div
            className="pointer-events-none absolute"
            style={{ left: box.right, top: box.centerY - box.height / 2, width: 1, height: box.height, background: 'rgba(22,119,255,.45)' }}
          />
          {live != null && (
            <span
              data-width-badge="1"
              className="pointer-events-none absolute rounded bg-primary px-1 text-2xs text-white"
              style={{ left: box.right + 6, top: box.centerY - 8 }}
            >
              {live} mm
            </span>
          )}
        </>
      )}
    </div>
  );
}
