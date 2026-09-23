/**
 * 职责：**新建文档对话框**（文件 → 新建 / Ctrl+N）—— 像 PS 的「新建」那样：
 *   第 1 步选**模式**（文档模式 / Web 模式），第 2 步按模式填**参数**，最后「创建」。
 *
 *   · 文档模式参数：标题、纸张（A4/A3/A5/Letter/Legal/自定义）、宽高（mm）、方向、页边距（mm）
 *   · Web 模式参数：标题、设备（Desktop/Laptop/Tablet/Mobile/自定义）、宽高（px）、画布底色
 *
 * 创建 = 用一份**全新文档**（两套模式内容都清空）替换当前文档，走 `importJSON` →
 * 因此是**一步历史**，Ctrl+Z 能撤销回来（比旧版 `window.confirm` 更安全）。
 */
import { useState } from 'react';
import { FileText, Monitor } from 'lucide-react';
import { DEVICE_PRESETS, PAGE_SIZES, type DeviceKey, type PageSizeKey } from '../../registry/types';
import { createInitialDocument, useEditorStore } from '../../store/editorStore';
import { Modal } from '../ui/Modal';

type Mode = 'document' | 'web';
type PaperKey = PageSizeKey | 'Custom';

const PAPER_KEYS: PaperKey[] = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Custom'];
const DEVICE_KEYS: DeviceKey[] = ['Desktop', 'Laptop', 'Tablet', 'Mobile', 'Custom'];

const inputCls = 'h-7 w-full min-w-0 rounded-md border border-line bg-white px-2 text-[13px] text-gray-800 outline-none focus:border-primary';
const labelCls = 'w-20 shrink-0 text-2xs text-gray-500';

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'flex items-center gap-2' : 'flex items-center gap-2'}>
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

export function NewDocDialog() {
  const open = useEditorStore((s) => s.ui.newDocOpen);
  const setOpen = useEditorStore((s) => s.setNewDocOpen);
  const importJSON = useEditorStore((s) => s.importJSON);

  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode>('document');
  const [title, setTitle] = useState('');
  const [paper, setPaper] = useState<PaperKey>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 210, h: 297 });
  const [margin, setMargin] = useState<{ top: number; right: number; bottom: number; left: number }>({
    top: 25.4,
    right: 31.7,
    bottom: 25.4,
    left: 31.7,
  });
  const [device, setDevice] = useState<DeviceKey>('Desktop');
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({
    w: DEVICE_PRESETS.Desktop.width,
    h: DEVICE_PRESETS.Desktop.height,
  });
  const [background, setBackground] = useState('#ffffff');

  const close = () => {
    setOpen(false);
    setStep(1);
  };

  /** 选模式 → 顺便把该模式的默认尺寸带出来（PS 也是先选类型再带默认值） */
  const pickMode = (m: Mode) => {
    setMode(m);
    if (m === 'document') {
      const p = PAGE_SIZES.A4;
      setPaper('A4');
      setOrientation('portrait');
      setSize({ w: p.width, h: p.height });
    } else {
      setDevice('Desktop');
      setCanvasSize({ w: DEVICE_PRESETS.Desktop.width, h: DEVICE_PRESETS.Desktop.height });
    }
    setStep(2);
  };

  const pickPaper = (k: PaperKey) => {
    setPaper(k);
    if (k !== 'Custom') {
      const p = PAGE_SIZES[k];
      setSize({ w: p.width, h: p.height });
    }
  };
  const pickDevice = (k: DeviceKey) => {
    setDevice(k);
    if (k !== 'Custom') setCanvasSize({ w: DEVICE_PRESETS[k].width, h: DEVICE_PRESETS[k].height });
  };

  /** 文档模式：横向时宽高互换（与设置面板里 setPageSize 的口径一致） */
  const pageW = orientation === 'landscape' ? size.h : size.w;
  const pageH = orientation === 'landscape' ? size.w : size.h;

  const create = () => {
    const base = createInitialDocument();
    const doc = {
      ...base,
      title: title.trim() || (mode === 'document' ? '未命名文档' : '未命名画布'),
      mode,
      document: {
        ...base.document,
        page: {
          ...base.document.page,
          ...(mode === 'document'
            ? { size: paper, width: pageW, height: pageH, orientation, margin: { ...margin } }
            : {}),
        },
      },
      web: {
        ...base.web,
        canvas:
          mode === 'web'
            ? { ...base.web.canvas, device, width: Math.max(40, canvasSize.w), height: Math.max(40, canvasSize.h), background }
            : base.web.canvas,
      },
      selectedIds: [],
    };
    if (!importJSON(JSON.stringify(doc))) {
      window.alert('新建失败：文档结构不合法');
      return;
    }
    close();
  };

  return (
    <Modal open={open} title="新建文档" onClose={close} width={640}>
      <div data-new-doc="1" data-new-doc-step={step}>
        {/* ── 第 1 步：选模式 ── */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-2xs text-gray-500">先选模式，下一步再填参数（和 PS 的新建一样）。</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                data-new-doc-mode="document"
                onClick={() => pickMode('document')}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left hover:border-primary hover:bg-primary/5 ${
                  mode === 'document' ? 'border-primary bg-primary/5' : 'border-line'
                }`}
              >
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-[13px] font-semibold text-gray-800">文档模式</span>
                <span className="text-2xs leading-5 text-gray-500">A4 等纸张 + 文档流，自动分页、可导出 Word</span>
              </button>
              <button
                type="button"
                data-new-doc-mode="web"
                onClick={() => pickMode('web')}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left hover:border-primary hover:bg-primary/5 ${
                  mode === 'web' ? 'border-primary bg-primary/5' : 'border-line'
                }`}
              >
                <Monitor className="h-5 w-5 text-emerald-600" />
                <span className="text-[13px] font-semibold text-gray-800">Web 模式</span>
                <span className="text-2xs leading-5 text-gray-500">设备画布 + 绝对定位 + 容器嵌套，可导出 React</span>
              </button>
            </div>
          </div>
        )}

        {/* ── 第 2 步：填参数 ── */}
        {step === 2 && (
          <div className="space-y-3" data-new-doc-params={mode}>
            <div className="flex items-center gap-2">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-2xs text-gray-600">
                {mode === 'document' ? '文档模式' : 'Web 模式'}
              </span>
              <button type="button" className="text-2xs text-primary hover:underline" onClick={() => setStep(1)}>
                重选模式
              </button>
            </div>

            <Field label="标题">
              <input
                data-new-doc-title="1"
                className={inputCls}
                value={title}
                placeholder={mode === 'document' ? '未命名文档' : '未命名画布'}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>

            {mode === 'document' ? (
              <>
                <Field label="纸张">
                  <select data-new-doc-paper="1" className={inputCls} value={paper} onChange={(e) => pickPaper(e.target.value as PaperKey)}>
                    {PAPER_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k === 'Custom' ? '自定义' : `${k}（${PAGE_SIZES[k as PageSizeKey].width}×${PAGE_SIZES[k as PageSizeKey].height}mm）`}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Field label="宽 mm">
                    <input
                      data-new-doc-w="1"
                      type="number"
                      min={20}
                      className={inputCls}
                      value={size.w}
                      onChange={(e) => {
                        setPaper('Custom');
                        setSize((s) => ({ ...s, w: Number(e.target.value) || 0 }));
                      }}
                    />
                  </Field>
                  <Field label="高 mm">
                    <input
                      data-new-doc-h="1"
                      type="number"
                      min={20}
                      className={inputCls}
                      value={size.h}
                      onChange={(e) => {
                        setPaper('Custom');
                        setSize((s) => ({ ...s, h: Number(e.target.value) || 0 }));
                      }}
                    />
                  </Field>
                  <Field label="方向">
                    <select
                      data-new-doc-orientation="1"
                      className={inputCls}
                      value={orientation}
                      onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
                    >
                      <option value="portrait">纵向</option>
                      <option value="landscape">横向</option>
                    </select>
                  </Field>
                  <div className="flex items-center gap-2 text-2xs text-gray-400">
                    成品尺寸 {pageW}×{pageH}mm
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
                    <Field key={k} label={{ top: '上', right: '右', bottom: '下', left: '左' }[k]}>
                      <input
                        data-new-doc-margin={k}
                        type="number"
                        min={0}
                        step={0.1}
                        className={inputCls}
                        value={margin[k]}
                        onChange={(e) => setMargin((m) => ({ ...m, [k]: Number(e.target.value) || 0 }))}
                      />
                    </Field>
                  ))}
                </div>
                <p className="text-2xs text-gray-400">页边距单位 mm（上下 25.4 / 左右 31.7 是 Word 默认）。</p>
              </>
            ) : (
              <>
                <Field label="设备">
                  <select data-new-doc-device="1" className={inputCls} value={device} onChange={(e) => pickDevice(e.target.value as DeviceKey)}>
                    {DEVICE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k === 'Custom' ? '自定义' : `${k}（${DEVICE_PRESETS[k].width}×${DEVICE_PRESETS[k].height}px）`}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Field label="宽 px">
                    <input
                      data-new-doc-w="1"
                      type="number"
                      min={40}
                      className={inputCls}
                      value={canvasSize.w}
                      onChange={(e) => {
                        setDevice('Custom');
                        setCanvasSize((s) => ({ ...s, w: Number(e.target.value) || 0 }));
                      }}
                    />
                  </Field>
                  <Field label="高 px">
                    <input
                      data-new-doc-h="1"
                      type="number"
                      min={40}
                      className={inputCls}
                      value={canvasSize.h}
                      onChange={(e) => {
                        setDevice('Custom');
                        setCanvasSize((s) => ({ ...s, h: Number(e.target.value) || 0 }));
                      }}
                    />
                  </Field>
                  <Field label="底色">
                    <input
                      data-new-doc-bg="1"
                      type="color"
                      className="h-7 w-full cursor-pointer rounded-md border border-line bg-white p-0.5"
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                    />
                  </Field>
                </div>
              </>
            )}

            <p className="rounded bg-amber-50 px-2 py-1.5 text-2xs leading-5 text-amber-700">
              新建会替换当前文档（两套模式的内容都会重置）。这是**一步历史**，按 Ctrl+Z 可以撤销回来。
            </p>
          </div>
        )}

        {/* ── 底部按钮 ── */}
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          {step === 2 && (
            <button type="button" className="h-7 rounded-md border border-line px-2.5 text-2xs" onClick={() => setStep(1)}>
              ← 上一步
            </button>
          )}
          <button type="button" className="ml-auto h-7 rounded-md border border-line px-2.5 text-2xs" onClick={close}>
            取消
          </button>
          {step === 2 && (
            <button
              type="button"
              data-new-doc-create="1"
              className="h-7 rounded-md bg-primary px-3 text-2xs text-white hover:opacity-90"
              onClick={create}
            >
              {mode === 'document' ? '创建文档' : '创建画布'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
