/**
 * 控件：image —— 图片地址 + 选择本地文件 + **缩略图**（规格 §5）。
 * 本地文件读成 data:URL 写入；有值时显示 40×28 缩略图。
 */
import { ImagePlus } from 'lucide-react';
import { asString } from '../../utils/id';
import { inputCls, smallBtnCls } from './controlStyles';
import type { ControlProps } from './index';

export function ImageControl({ value, onChange, item }: ControlProps) {
  const src = asString(value);
  return (
    <>
      {src && (
        <img
          src={src}
          alt=""
          data-image-thumb="1"
          className="h-7 w-10 shrink-0 rounded-md border border-line object-cover"
        />
      )}
      <input
        className={inputCls}
        placeholder={item.placeholder ?? '图片地址或 data:URL'}
        value={src}
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
    </>
  );
}
