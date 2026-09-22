/**
 * 职责：未选中组件时的「画布属性」（Web 模式）：设备预设、宽高、背景、网格、吸附、安全区。
 * 只读写 store 的 web.canvas，不涉及具体组件。
 */
import { DEVICE_PRESETS, type DeviceKey } from '../../registry/types';
import { useEditorStore } from '../../store/editorStore';

const rowCls = 'mb-2 flex items-center gap-2';
const labelCls = 'w-20 shrink-0 text-2xs text-gray-500';
const inputCls =
  'h-7 w-full rounded border border-line bg-white px-2 text-[13px] outline-none focus:border-primary';

export function CanvasPropertyPanel() {
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  const setDevice = useEditorStore((s) => s.setDevice);
  const setCanvasSize = useEditorStore((s) => s.setCanvasSize);
  const setCanvasProp = useEditorStore((s) => s.setCanvasProp);
  const ui = useEditorStore((s) => s.ui);
  const toggleUI = useEditorStore((s) => s.toggleUI);

  return (
    <div className="px-3 py-2">
      <div className="mb-2 rounded bg-primary/5 px-2 py-1 text-2xs text-primary">
        未选中组件 —— 这里是画布属性
      </div>

      <div className={rowCls}>
        <span className={labelCls}>设备预设</span>
        <select
          className={inputCls}
          value={canvas.device}
          onChange={(e) => setDevice(e.target.value as DeviceKey)}
        >
          {(Object.keys(DEVICE_PRESETS) as DeviceKey[]).map((k) => (
            <option key={k} value={k}>
              {k}
              {k === 'Custom' ? '' : ` (${DEVICE_PRESETS[k].width}×${DEVICE_PRESETS[k].height})`}
            </option>
          ))}
        </select>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>画布宽高</span>
        <input
          type="number"
          className={inputCls}
          value={canvas.width}
          onChange={(e) => setCanvasSize(Number(e.target.value), canvas.height)}
        />
        <input
          type="number"
          className={inputCls}
          value={canvas.height}
          onChange={(e) => setCanvasSize(canvas.width, Number(e.target.value))}
        />
        <span className="text-2xs text-gray-400">px</span>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>画布背景</span>
        <input
          type="color"
          className="h-7 w-10 rounded border border-line bg-white p-0.5"
          value={canvas.background}
          onChange={(e) => setCanvasProp('background', e.target.value)}
        />
      </div>

      <label className="mb-1.5 flex items-center justify-between text-2xs text-gray-500">
        显示网格
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={ui.showGrid}
          onChange={() => {
            toggleUI('showGrid');
            setCanvasProp('showGrid', !ui.showGrid);
          }}
        />
      </label>

      <div className={rowCls}>
        <span className={labelCls}>网格尺寸</span>
        <input
          type="number"
          className={inputCls}
          value={canvas.gridSize}
          onChange={(e) => setCanvasProp('gridSize', Number(e.target.value))}
        />
        <span className="text-2xs text-gray-400">px</span>
      </div>

      <label className="mb-1.5 flex items-center justify-between text-2xs text-gray-500">
        吸附到网格
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={ui.snap}
          onChange={() => {
            toggleUI('snap');
            setCanvasProp('snapToGrid', !ui.snap);
          }}
        />
      </label>

      <label className="mb-1.5 flex items-center justify-between text-2xs text-gray-500">
        移动端安全区
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={canvas.safeArea}
          onChange={(e) => setCanvasProp('safeArea', e.target.checked)}
        />
      </label>

      <label className="flex items-center justify-between text-2xs text-gray-500">
        显示标尺
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={ui.showRuler}
          onChange={() => toggleUI('showRuler')}
        />
      </label>
    </div>
  );
}
