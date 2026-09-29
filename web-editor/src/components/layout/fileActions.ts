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
import { desktopApi } from '../../utils/desktopChrome';
import { refreshRecents, rememberLocalName } from '../../utils/recents';

const S = (): ReturnType<typeof useEditorStore.getState> => useEditorStore.getState();
const fileBase = (fallback: string): string => S().doc.title || fallback;

/**
 * 「保存」= 保存为**可独立打开的 HTML 文件**（决策 #12 / Q3：复用已有导出通路，不新造实现）。
 * 它同时是只读态的自救路径：导出 HTML 是免费的。
 * 桌面版走**真实另存为对话框**（能记住路径 → 进「最近打开」）；浏览器版仍是下载。
 */
export function saveAsHtmlFile(): string {
  const name = `${fileBase('export')}.html`;
  const text = S().exportHTML();
  const d = desktopApi();
  if (d) {
    void d
      .saveText({ suggestedName: name, text })
      .then((r) => {
        if (r?.ok) {
          log.info('file', '另存为 HTML', { path: r.path, bytes: text.length });
          void refreshRecents();
        } else if (!r?.canceled) {
          log.warn('file', `另存为失败：${r?.error ?? '未知'}`);
        }
      })
      .catch((e: unknown) => log.warn('file', `另存为异常：${e instanceof Error ? e.message : String(e)}`));
    return `正在另存为 HTML 文件：${name}\n（桌面版会弹保存对话框；保存后会进入「文件 → 最近打开」）`;
  }
  downloadText(name, text, 'text/html');
  rememberLocalName(name);
  log.info('file', '保存为 HTML 文件', { name, bytes: text.length });
  return `已保存为 HTML 文件：${name}\n（可在浏览器直接打开；这是免费通路，只读态也能用）`;
}

/** 「导出 JSON…」= 可再编辑的工程文件（含组件树与页面/画布设置） */
export function exportJsonFile(): string {
  const name = `${fileBase('document')}.json`;
  const text = S().exportJSON();
  const d = desktopApi();
  if (d) {
    void d
      .saveText({ suggestedName: name, text })
      .then((r) => {
        if (r?.ok) {
          log.info('file', '导出 JSON', { path: r.path, bytes: text.length });
          void refreshRecents();
        } else if (!r?.canceled) {
          log.warn('file', `导出失败：${r?.error ?? '未知'}`);
        }
      })
      .catch((e: unknown) => log.warn('file', `导出异常：${e instanceof Error ? e.message : String(e)}`));
    return `正在导出工程文件：${name}\n（桌面版会弹保存对话框；保存后会进入「文件 → 最近打开」）`;
  }
  downloadText(name, text, 'application/json');
  rememberLocalName(name);
  log.info('file', '导出 JSON', { name, bytes: text.length });
  return `已导出工程文件：${name}\n（「文件 → 打开…」可再编辑；也可拖回窗口）`;
}

/** 「打开…」= 把 .editor.json 载入编辑器（与拖拽、?load= 共用 utils/importDocument） */
export async function openJsonFile(): Promise<string | null> {
  const d = desktopApi();
  // 桌面版走主进程弹框：这样才知道**路径**，才能记进「最近打开」并重开
  if (d) {
    const picked = await d.pickAndRead();
    if (!picked?.ok) {
      if (picked?.canceled) return null;
      return `打开失败：${picked?.error ?? '未知错误'}`;
    }
    const r = (await import('../../utils/importDocument')).importJsonIntoEditor(picked.text ?? '', picked.name ?? '（本地文件）');
    void refreshRecents();
    log.info('file', '打开工程文件', { path: picked.path, summary: r.summary });
    return `${r.summary}\n\n${r.detail}\n\n（已记入「文件 → 最近打开」：${picked.name ?? ''}）`;
  }
  const text = await pickTextFile('.json,application/json');
  if (text == null) return null; // 用户取消
  const r = (await import('../../utils/importDocument')).importJsonIntoEditor(text, '（本地文件）');
  log.info('file', '打开工程文件', { summary: r.summary });
  return `${r.summary}\n\n${r.detail}`;
}

/** 打开一条「最近打开」记录：桌面版能真重开；浏览器版只说清做不到 */
export async function openRecentFile(entry: { path: string; title: string; kind?: 'file' | 'name' }): Promise<string> {
  const d = desktopApi();
  if (!d) {
    return `浏览器里无法重开本地文件：\n${entry.title}\n\n请用「文件 → 打开…」再选一次（网页拿不到文件路径，这是浏览器的安全限制，不是本编辑器的问题）。`;
  }
  const r = await d.openRecent(entry.path);
  if (!r?.ok) {
    void refreshRecents(); // 打不开的条目主进程会顺手摘掉 → 刷新清单
    return `打不开这条记录：\n${r?.error ?? entry.path}`;
  }
  const imported = (await import('../../utils/importDocument')).importJsonIntoEditor(r.text ?? '', r.name ?? entry.title);
  void refreshRecents();
  return `${imported.summary}\n\n${imported.detail}`;
}
