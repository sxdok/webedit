/**
 * 职责：属性控件集（由 PropSchemaItem.control 派发）。面板不写死任何组件的字段，
 *       新增控件类型只需在这里加一个 case。
 *
 * 排版：**紧凑列表**（两列）——左边一列固定宽度的属性名，右边是控件，一行一个属性。
 *   · 属性名太长时只显示"主名"（括号里的填写说明移到右侧当提示），全称放 title 悬停可见；
 *   · 多行/工具条/多维输入（textarea、richtext、spacing、edge、frame、children）改用
 *     "属性名在上、控件独占整行"的两行式，避免控件被挤窄。
 *   两种排法的行都带 data-prop-row / data-prop-label，自检会遍历全部组件检查溢出与折行。
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
  'h-7 w-full min-w-0 rounded border border-line bg-white px-2 text-[13px] text-gray-800 outline-none focus:border-primary';
const smallBtnCls =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-white text-gray-600 hover:border-primary hover:text-primary';

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

/** 需要独占整行宽度的控件（多行文本、工具条、多维输入） */
const WIDE_CONTROLS: ReadonlySet<string> = new Set(['textarea', 'richtext', 'spacing', 'edge', 'frame', 'children']);

/**
 * 把 schema 里的长标签拆成"主名 + 提示"：
 *   『数据（每行一条，用 | 分列）』→ short=数据、hint=每行一条，用 | 分列
 * 这样紧凑列表的左列只需要 ~4 个汉字宽，且信息不丢失（hint 显示在右侧 / 全称在 title）。
 */
export function splitLabel(label: string): { short: string; hint: string } {
  const m = label.match(/^([^（(]+)[（(]([^）)]*)[）)]\s*$/);
  if (m) return { short: m[1].trim(), hint: m[2].trim() };
  return { short: label.trim(), hint: '' };
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  const { short, hint } = splitLabel(label);
  if (wide) {
    return (
      <div className="mb-1.5" data-prop-row="1" data-prop-wide="1">
        <div className="mb-0.5 flex items-baseline gap-1 text-2xs" data-prop-label="1" title={label}>
          <span className="shrink-0 text-gray-500">{short}</span>
          {hint && <span className="truncate text-gray-400">{hint}</span>}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="mb-1 flex items-center gap-2" data-prop-row="1">
      <span className="w-16 shrink-0 truncate text-2xs text-gray-500" data-prop-label="1" title={label}>
        {short}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

function NotImplemented({ control }: { control: string }) {
  return (
    <div className="rounded border border-dashed border-line px-2 py-1 text-2xs text-gray-400">
      控件「{control}」未实现
    </div>
  );
}

export function PropertyControl({ item, value, onChange, nodeId }: ControlProps) {
  const wide = WIDE_CONTROLS.has(item.control);
  const field = (children: React.ReactNode) => (
    <Field label={item.label} wide={wide}>
      {children}
    </Field>
  );

  switch (item.control) {
    case 'text':
      return field(
        <input
          className={inputCls}
          placeholder={item.placeholder}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        />,
      );

    case 'textarea':
      return field(
        <textarea
          className="thin-scroll w-full rounded border border-line bg-white px-2 py-1 text-[13px] leading-5 text-gray-800 outline-none focus:border-primary"
          rows={3}
          placeholder={item.placeholder}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        />,
      );

    case 'number':
      return field(
        <input
          type="number"
          className={inputCls}
          min={item.min}
          max={item.max}
          step={item.step ?? 1}
          value={asNumber(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />,
      );

    case 'slider': {
      const v = asNumber(value, item.min ?? 0);
      return field(
        <>
          <input
            type="range"
            className="min-w-0 flex-1 accent-primary"
            min={item.min ?? 0}
            max={item.max ?? 100}
            step={item.step ?? 1}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="w-9 shrink-0 text-right text-2xs tabular-nums text-gray-500">
            {v}
            {item.unit ?? ''}
          </span>
        </>,
      );
    }

    case 'color':
      return field(
        <>
          <input
            type="color"
            className="h-7 w-8 shrink-0 cursor-pointer rounded border border-line bg-white p-0.5"
            value={asString(value, '#000000')}
            onChange={(e) => onChange(e.target.value)}
          />
          <input className={inputCls} value={asString(value)} onChange={(e) => onChange(e.target.value)} />
        </>,
      );

    case 'select':
      return field(
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
        </select>,
      );

    case 'switch':
      return field(
        <input
          type="checkbox"
          className="ml-auto h-4 w-4 accent-primary"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />,
      );

    case 'align': {
      const cur = asString(value, 'left');
      const opts: [string, typeof AlignLeft][] = [
        ['left', AlignLeft],
        ['center', AlignCenter],
        ['right', AlignRight],
        ['justify', AlignJustify],
      ];
      return field(
        <>
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
        </>,
      );
    }

    case 'unit':
      return field(
        <>
          <input
            type="number"
            className={inputCls}
            step={item.step ?? 1}
            value={asNumber(value)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="flex h-7 min-w-8 shrink-0 items-center justify-center rounded border border-line bg-gray-50 px-1 text-2xs text-gray-500">
            {item.unit ?? 'px'}
          </span>
        </>,
      );

    case 'font':
      return field(
        <select className={inputCls} value={asString(value, '宋体')} onChange={(e) => onChange(e.target.value)}>
          {['宋体', '黑体', '楷体', '仿宋', '微软雅黑', 'Times New Roman', 'Arial'].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>,
      );

    case 'edge': {
      const v = (value ?? {}) as Record<string, unknown>;
      const set = (k: string, n: number) => onChange({ ...v, [k]: n });
      return field(
        <div className="grid grid-cols-4 gap-1">
          {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
            <input
              key={k}
              type="number"
              title={k}
              className="h-7 w-full min-w-0 rounded border border-line bg-white px-1 text-center text-xs"
              value={asNumber(v[k])}
              onChange={(e) => set(k, Number(e.target.value))}
            />
          ))}
        </div>,
      );
    }

    case 'frame': {
      const v = (value ?? {}) as Record<string, unknown>;
      const set = (k: string, n: number) => onChange({ ...v, [k]: n });
      return field(
        <div className="grid grid-cols-4 gap-1">
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <label key={k} className="flex min-w-0 items-center gap-0.5">
              <span className="text-2xs uppercase text-gray-400">{k}</span>
              <input
                type="number"
                className="h-7 w-full min-w-0 rounded border border-line bg-white px-1 text-center text-xs"
                value={asNumber(v[k])}
                onChange={(e) => set(k, Number(e.target.value))}
              />
            </label>
          ))}
        </div>,
      );
    }

    case 'image':
      return field(
        <>
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
        </>,
      );

    case 'richtext':
      return field(<RichTextControl item={item} value={value} onChange={onChange} nodeId={nodeId} />);

    case 'spacing':
      return field(<SpacingControl item={item} value={value} onChange={onChange} nodeId={nodeId} />);

    case 'children':
      return field(<ChildrenControl nodeId={nodeId} />);

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
