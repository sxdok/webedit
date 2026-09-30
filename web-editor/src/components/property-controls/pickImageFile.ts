/**
 * 共用小工具：**选本地图片 → data:URL**（`ImageControl` 与 `ImageRowsControl` 共用）。
 *
 * 单独成文件的原因：图片组件原来的"单图"字段有一个选文件按钮，改成"一行一张图"之后
 * 这个能力不能丢 —— 两个控件用同一份实现，避免行为不一致。
 *
 * 2026-09-30 新增**多选**版本：图片行编辑器要支持"一次选多张、自动填进各行"
 * （用户要求："支持多选图片，有几行就能选几张，自动填充到新加行"）。
 * 两个函数都会把**文件名**一起回传（面板要显示图片名称，悬停气泡显示完整名称）。
 */

export interface PickedImage {
  /** 文件名（含扩展名）：面板显示 + 悬停气泡 */
  name: string;
  /** data:URL */
  dataUrl: string;
}

/** 选**一张**图片（老调用方用；只回 dataUrl） */
export function pickImageDataUrl(onDone: (dataUrl: string) => void): void {
  pickImages((picks) => {
    const first = picks[0];
    if (first) onDone(first.dataUrl);
  }, false);
}

/**
 * 选**一至多张**图片。
 * @param onDone 按用户选择的顺序回传；取消时回传空数组
 * @param multiple 是否允许多选（默认 true）
 */
export function pickImages(onDone: (picks: PickedImage[]) => void, multiple = true): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (multiple) input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length === 0) {
      onDone([]);
      return;
    }
    /* FileReader 是异步的 → 用 Promise.all 保住**用户选择的顺序**（否则填行顺序会乱） */
    void Promise.all(
      files.map(
        (f) =>
          new Promise<PickedImage>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve({ name: f.name, dataUrl: String(fr.result ?? '') });
            fr.onerror = () => resolve({ name: f.name, dataUrl: '' });
            fr.readAsDataURL(f);
          }),
      ),
    ).then(onDone);
  };
  input.click();
}
