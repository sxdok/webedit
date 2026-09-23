/**
 * 控件：image —— 图片地址 + 选择本地文件 + **缩略图**（规格 §5）。
 * 本地文件读成 data:URL 写入；有值时显示 40×28 缩略图。
 *
 * ★2026-09-23：图片组件的图片输入已改成 `imageRows`（一行一张图），本控件仍是
 * 已实现控件（外部插件/MCP 的 schema 里可以用它），选文件逻辑与行编辑器共用 `pickImageDataUrl`。
 */
import { ImagePlus } from 'lucide-react';
import { asString } from '../../utils/id';
import { inputCls, smallBtnCls } from './controlStyles';
import { pickImageDataUrl } from './pickImageFile';
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
        onClick={() => pickImageDataUrl((dataUrl) => onChange(dataUrl))}
      >
        <ImagePlus className="h-3.5 w-3.5" />
      </button>
    </>
  );
}
