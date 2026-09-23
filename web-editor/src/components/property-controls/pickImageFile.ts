/**
 * 共用小工具：**选一张本地图片 → data:URL**（`ImageControl` 与 `ImageRowsControl` 共用）。
 *
 * 单独成文件的原因：图片组件原来的"单图"字段有一个选文件按钮，改成"一行一张图"之后
 * 这个能力不能丢 —— 两个控件用同一份实现，避免行为不一致。
 */
export function pickImageDataUrl(onDone: (dataUrl: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => onDone(String(fr.result ?? ''));
    fr.readAsDataURL(f);
  };
  input.click();
}
