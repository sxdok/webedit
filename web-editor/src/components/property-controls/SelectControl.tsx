/**
 * 控件：select / font —— 下拉选择（规格 §5）。
 * select：选项来自 schema.options；原生 `<select>` 自带首字母跳转与键盘操作。
 * font：**本机可用字体**清单（`utils/fonts.ts`：探测 / 系统枚举），选项用对应字体渲染（预览），
 *       并且支持"跟随页面默认字体"（空值）；旁边一个 ⟳ 可以主动读系统字体清单（会弹一次授权框）。
 */
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { asString } from '../../utils/id';
import { fontList, refreshSystemFonts, systemFontApiAvailable, type FontList } from '../../utils/fonts';
import { inputCls } from './controlStyles';
import type { ControlProps } from './index';

export function SelectControl({ item, value, onChange }: ControlProps) {
  return (
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
  );
}

export function FontControl({ value, onChange }: ControlProps) {
  const cur = asString(value, '');
  const [list, setList] = useState<FontList>(() => fontList());
  const [busy, setBusy] = useState(false);
  /** 清单是懒读的：首帧可能是缓存的探测结果，挂载后再刷一次（探测很便宜，且不弹权限） */
  useEffect(() => {
    setList(fontList());
  }, []);

  const groups: [string, string[]][] = [
    ['中文', list.chinese],
    ['西文', list.latin],
    ['等宽', list.mono],
  ];
  const known = new Set([...list.chinese, ...list.latin, ...list.mono, '']);
  const readSystem = async (): Promise<void> => {
    setBusy(true);
    setList(await refreshSystemFonts(true));
    setBusy(false);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" data-font-control="1" data-font-source={list.source}>
      <select
        className={inputCls}
        style={{ fontFamily: cur ? `"${cur}", serif` : undefined }}
        value={cur}
        onChange={(e) => onChange(e.target.value)}
        data-tip-text={cur || '跟随页面默认字体'}
      >
        <option value="" style={{ fontFamily: 'inherit' }}>
          跟随页面默认
        </option>
        {groups.map(([label, fonts]) =>
          fonts.length ? (
            <optgroup key={label} label={`${label}（${fonts.length}）`}>
              {fonts.map((f) => (
                <option key={f} value={f} style={{ fontFamily: `"${f}", serif` }}>
                  {f}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
        {/* 当前值不在清单里（旧文档写死的字体、或这台机器没装）也要能保住，不能一渲染就被改掉 */}
        {cur && !known.has(cur) ? (
          <optgroup label="当前值">
            <option value={cur} style={{ fontFamily: `"${cur}", serif` }}>
              {cur}
            </option>
          </optgroup>
        ) : null}
      </select>
      <button
        type="button"
        data-font-refresh="1"
        data-tip-text={
          systemFontApiAvailable()
            ? '读系统字体清单（queryLocalFonts，会弹一次授权框）'
            : '本浏览器不支持读系统字体（Firefox/Safari），这里重新探测常用字体'
        }
        disabled={busy}
        onClick={() => void readSystem()}
        className="shrink-0 rounded border border-line p-0.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
