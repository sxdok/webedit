/**
 * 职责：**文件级动作的单一来源**（菜单项与快捷键都调这里）。
 *
 * 为什么单独成模块（M-10 / §7.4 断言"菜单标注的快捷键必须真能触发"）：
 *   「保存为 HTML 文件」「导出 JSON…」「打开…」这三件事此前只长在 `MenuBar` 的菜单项里，
 *   于是快捷键（Ctrl+S / Ctrl+Shift+S / Ctrl+O）**无法复用**——菜单标了 `Ctrl+S`，
 *   按下却什么也不发生，正是"说了假话"的一类。抽到这里后，两条入口共用同一实现。
 *
 * 返回值统一是"给人看的结果文案"（菜单拿它弹提示框；快捷键路径拿它写日志/兜底提示）。
 */
import { downloadText, pickTextFile } from '../../utils/download';
import { log } from '../../utils/logger';
import { useEditorStore } from '../../store/editorStore';

const S = (): ReturnType<typeof useEditorStore.getState> => useEditorStore.getState();
const fileBase = (fallback: string): string => S().doc.title || fallback;

/**
 * 「保存」= 保存为**可独立打开的 HTML 文件**（决策 #12 / Q3：复用已有导出通路，不新造实现）。
 * 它同时是只读态的自救路径：导出 HTML 是免费的。
 */
export function saveAsHtmlFile(): string {
  const name = `${fileBase('export')}.html`;
  downloadText(name, S().exportHTML(), 'text/html');
  log.info('file', '保存为 HTML 文件', { name, bytes: S().exportHTML().length });
  return `已保存为 HTML 文件：${name}\n（可在浏览器直接打开；这是免费通路，只读态也能用）`;
}

/** 「导出 JSON…」= 可再编辑的工程文件（含组件树与页面/画布设置） */
export function exportJsonFile(): string {
  const name = `${fileBase('document')}.json`;
  const text = S().exportJSON();
  downloadText(name, text, 'application/json');
  log.info('file', '导出 JSON', { name, bytes: text.length });
  return `已导出工程文件：${name}\n（「文件 → 打开…」可再编辑；也可拖回窗口）`;
}

/** 「打开…」= 把 .editor.json 载入编辑器（与拖拽、?load= 共用 utils/importDocument） */
export async function openJsonFile(): Promise<string | null> {
  const text = await pickTextFile('.json,application/json');
  if (text == null) return null; // 用户取消
  const r = (await import('../../utils/importDocument')).importJsonIntoEditor(text, '（本地文件）');
  log.info('file', '打开工程文件', { summary: r.summary });
  return `${r.summary}\n\n${r.detail}`;
}

/** 打印（桌面版的「导出 PDF」由 P4.5-E2 的 printToPDF 通道接管；网页版就是浏览器打印 → 另存为 PDF） */
export function printDocument(): string {
  window.print();
  return '已打开打印对话框（可另存为 PDF）。';
}
