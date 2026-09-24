/**
 * 职责：**把文件拖进编辑器窗口就导入**（用户 2026-09-24："导出的 html 没有地方导回打开"）。
 *
 *   · 只在拖进来的是**文件**（`dataTransfer.types` 含 `Files`）时接管 —— 组件拖拽用的是自定义 MIME，不受影响；
 *   · 捕获阶段就 `preventDefault`，挡掉浏览器默认行为（否则浏览器会直接打开那个文件、把编辑中的文档顶掉）；
 *   · 全窗给一层"松手导入"的提示，避免用户不知道松手会发生什么。
 *
 * 支持 `.html/.htm`（本工程导出的 HTML 带 `data-node-type`，能原样读回）与 `.json`（文档存档）。
 * 逻辑与菜单「文件 → 打开 HTML…／打开 JSON」共用 `utils/importDocument`。
 */
import { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { importFileIntoEditor } from '../../utils/importDocument';
import { notify } from './NoticeBar';

export function DropToImport() {
  const [over, setOver] = useState(false);

  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types;
      return types ? [...types].includes('Files') : false;
    };
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    const onLeave = (e: DragEvent): void => {
      // relatedTarget 为 null 才是真的离开窗口（在窗口内元素间移动时也会触发 dragleave）
      if (e.relatedTarget == null) setOver(false);
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      void importFileIntoEditor(file)
        .then((r) => notify({ kind: r.ok ? 'ok' : 'warn', title: r.summary, detail: r.detail }))
        .catch((err: unknown) => notify({ kind: 'warn', title: `导入失败：${String((err as Error)?.message ?? err)}` }));
    };
    // capture：比画布自己的 drop 处理更早，能挡住浏览器默认行为，又不碰组件拖拽
    window.addEventListener('dragover', onOver, { capture: true });
    window.addEventListener('dragenter', onOver, { capture: true });
    window.addEventListener('dragleave', onLeave, { capture: true });
    window.addEventListener('drop', onDrop, { capture: true });
    return () => {
      window.removeEventListener('dragover', onOver, { capture: true });
      window.removeEventListener('dragenter', onOver, { capture: true });
      window.removeEventListener('dragleave', onLeave, { capture: true });
      window.removeEventListener('drop', onDrop, { capture: true });
    };
  }, []);

  if (!over) return null;
  return (
    <div
      data-drop-import="1"
      className="no-print pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-primary/10"
    >
      <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-primary bg-white/95 px-4 py-3 text-[13px] text-gray-700 shadow-lg">
        <FileUp className="h-5 w-5 text-primary" />
        <span>
          松手导入到编辑器：<b>.html</b>（本工程导出的 HTML 可原样读回）或 <b>.json</b>（文档存档）
        </span>
      </div>
    </div>
  );
}
