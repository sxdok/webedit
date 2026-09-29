/**
 * 职责：浏览器侧的文件下载 / 选择 / 剪贴板等小工具，供菜单与工具栏使用。
 */

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * 把文本产物写到**运行目录**（启动器的 `POST /__save`，只允许 docs/ 下）。
 * 没有该接口（file:// 或别的静态服务器）时返回 null，调用方应退回下载。
 */
export async function saveToRunDir(
  relPath: string,
  text: string,
): Promise<{ ok: boolean; file?: string; bytes?: number; error?: string } | null> {
  try {
    const res = await fetch('/__save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, text }),
    });
    const json = (await res.json()) as { ok: boolean; file?: string; bytes?: number; error?: string };
    return json;
  } catch {
    return null;
  }
}

/** 弹出系统选择框读取文本文件（返回 null 表示取消） */
export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => resolve(null);
      reader.readAsText(file, 'utf-8');
    };
    input.click();
  });
}
