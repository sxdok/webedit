/**
 * 职责：属性控件集（由 PropSchemaItem.control 派发）。面板不写死任何组件的字段，
 *       新增控件类型只需在这里加一个 case。
 * 已实现：text / textarea / number / slider / color / select / switch / align / unit / font / edge / frame / image
 * 待阶段二：richtext（富文本工具条）、spacing（内外边距联动）、children（容器子项）
 */
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ImagePlus, Link2 } from 'lucide-react';
import type { PropSchemaItem } from '../../registry/types';
import { asNumber, asString } from '../../utils/id';
import { RichTextControl } from './RichTextControl';
import { SpacingControl } from './SpacingControl';
import { ChildrenControl } from './ChildrenControl';

export interface ControlProps {
  item: PropSchemaItem;
  value: unknown;
  onChange: (value: unknown) => void;
  /** children 控件需要知道自己在编辑哪个容器节点 */
  nodeId?: string;
}

const inputCls =
  'h-7 w-full rounded border border-line bg-white px-2 text-[13px] text-gray-800 outline-none focus:border-primary';
const smallBtnCls =
  'flex h-7 w-7 items-center justify-center rounded border border-line bg-white text-gray-600 hover:border-primary hover:text-primary';

/** 已实现的控件类型（自检用它核对：组件 schema 里不允许出现未实现的 control） */
export const IMPLEMENTED_CONTROLS: ReadonlySet<string> = new Set([
  'text',
  'textarea',
  'richtext',
  'number',
  'slider',
  'color',
  'select',
  'switch',
  'align',
  'font',
  'spacing',
  'edge',
  'image',
  'unit',
  'frame',
  'children',
]);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block">
      <span className="mb-0.5 block text-2xs text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function NotImplemented({ control }: { control: string }) {
  return (
    <div className="rounded border border-dashed border-line px-2 py-1 text-2xs text-gray-400">
      控件「{control}」在阶段二实现
    </div>
  );
}

export function PropertyControl({ item, value, onChange, nodeId }: ControlProps) {
  switch (item.control) {
    case 'text':
      return (
        <Field label={item.label}>
          <div className="flex items-center gap-1">
            <input
              className={inputCls}
              placeholder={item.placeholder}
              value={asString(value)}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </Field>
      );

    case 'textarea':
      return (
        <Field label={item.label}>
          <textarea
            className="thin-scroll w-full rounded border border-line bg-white px-2 py-1 text-[13px] leading-5 text-gray-800 outline-none focus:border-primary"
            rows={3}
            placeholder={item.placeholder}
            value={asString(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );

    case 'number':
      return (
        <Field label={item.label}>
          <input
            type="number"
            className={inputCls}
            min={item.min}
            max={item.max}
            step={item.step ?? 1}
            value={asNumber(value)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </Field>
      );

    case 'slider': {
      const v = asNumber(value, item.min ?? 0);
      return (
        <Field label={`${item.label}（${v}${item.unit ?? ''}）`}>
          <input
            type="range"
            className="w-full accent-primary"
            min={item.min ?? 0}
            max={item.max ?? 100}
            step={item.step ?? 1}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </Field>
      );
    }

    case 'color':
      return (
        <Field label={item.label}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-7 w-10 cursor-pointer rounded border border-line bg-white p-0.5"
              value={asString(value, '#000000')}
              onChange={(e) => onChange(e.target.value)}
            />
            <input
              className={inputCls}
              value={asString(value)}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </Field>
      );

    case 'select':
      return (
        <Field label={item.label}>
          <select
            className={inputCls}
            value={String(value ?? '')}
            onChange={(e) => {
              const raw = e.target.value;
              const opt = item.options?.find((o) => String(o.value) === raw);
              onChange(opt ? opt.value : raw);
            }}
          >
            {(item.options ?? []).map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      );

    case 'switch':
      return (
        <label className="mb-1.5 flex items-center justify-between">
          <span className="text-2xs text-gray-500">{item.label}</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
      );

    case 'align': {
      const cur = asString(value, 'left');
      const opts: [string, typeof AlignLeft][] = [
        ['left', AlignLeft],
        ['center', AlignCenter],
        ['right', AlignRight],
        ['justify', AlignJustify],
      ];
      return (
        <Field label={item.label}>
          <div className="flex gap-1">
            {opts.map(([v, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange(v)}
                className={`${smallBtnCls} ${cur === v ? 'border-primary bg-primary/10 text-primary' : ''}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </Field>
      );
    }

    case 'unit':
      return (
        <Field label={item.label}>
          <div className="flex gap-1">
            <input
              type="number"
              className={inputCls}
              step={item.step ?? 1}
              value={asNumber(value)}
              onChange={(e) => onChange(Number(e.target.value))}
            />
            <span className="flex h-7 min-w-9 items-center justify-center rounded border border-line bg-gray-50 px-1 text-2xs text-gray-500">
              {item.unit ?? 'px'}
            </span>
          </div>
        </Field>
      );

    case 'font':
      return (
        <Field label={item.label}>
          <select
            className={inputCls}
            value={asString(value, '宋体')}
            onChange={(e) => onChange(e.target.value)}
          >
            {['宋体', '黑体', '楷体', '仿宋', '微软雅黑', 'Times New Roman', 'Arial'].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
      );

    case 'edge': {
      const v = (value ?? {}) as Record<string, unknown>;
      const set = (k: string, n: number) => onChange({ ...v, [k]: n });
      return (
        <Field label={item.label}>
          <div className="grid grid-cols-4 gap-1">
            {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
              <input
                key={k}
                type="number"
                title={k}
                className="h-7 w-full rounded border border-line bg-white px-1 text-center text-xs"
                value={asNumber(v[k])}
                onChange={(e) => set(k, Number(e.target.value))}
              />
            ))}
          </div>
        </Field>
      );
    }

    case 'frame': {
      const v = (value ?? {}) as Record<string, unknown>;
      const set = (k: string, n: number) => onChange({ ...v, [k]: n });
      return (
        <Field label={item.label}>
          <div className="grid grid-cols-2 gap-1">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <span className="w-3 text-2xs uppercase text-gray-400">{k}</span>
                <input
                  type="number"
                  className="h-7 w-full rounded border border-line bg-white px-1 text-center text-xs"
                  value={asNumber(v[k])}
                  onChange={(e) => set(k, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        </Field>
      );
    }

    case 'image':
      return (
        <Field label={item.label}>
          <div className="flex items-center gap-1">
            <input
              className={inputCls}
              placeholder="图片地址或 data:URL"
              value={asString(value)}
              onChange={(e) => onChange(e.target.value)}
            />
            <button
              type="button"
              className={smallBtnCls}
              title="选择本地图片（转 data:URL）"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = () => {
                  const f = input.files?.[0];
                  if (!f) return;
                  const fr = new FileReader();
                  fr.onload = () => onChange(String(fr.result ?? ''));
                  fr.readAsDataURL(f);
                };
                input.click();
              }}
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
          </div>
        </Field>
      );

    case 'richtext':
      return <RichTextControl item={item} value={value} onChange={onChange} nodeId={nodeId} />;

    case 'spacing':
      return <SpacingControl item={item} value={value} onChange={onChange} nodeId={nodeId} />;

    case 'children':
      return <ChildrenControl nodeId={nodeId} />;

    default:
      return <NotImplemented control={item.control} />;
  }
}

/** 只读展示一行（属性面板底部用） */
export function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-2xs text-gray-500">
      <Link2 className="h-3 w-3 text-gray-300" />
      <span>{label}</span>
      <span className="ml-auto truncate font-mono text-gray-600">{value}</span>
    </div>
  );
}
