/**
 * 职责：**导出 PDF**（E2 / 决策 #16）——桌面版真产出文件，浏览器版退回打印对话框。
 *
 * 实现要点（为什么这么做，见 ARCHITECTURE §7.5 E2 与 B1/B5）：
 *   · 主进程用**隐藏窗口加载「导出 HTML」**再 `printToPDF`，所以 **PDF 的版式 ≡ 导出 HTML 的版式**：
 *     纸张尺寸与页边距都来自同一份 `@page`，不依赖主窗口那套"分页画布 + 自带 padding"的模型；
 *   · `preferCSSPageSize: true` + `printBackground: true` 由主进程设置（见 apps/desktop/main.js）；
 *   · 浏览器里拿不到"写文件"的能力 → 明确说清"已打开打印对话框，请选另存为 PDF"，不假装成功。
 *
 * 单一来源：菜单「文件 → 导出 → 导出 PDF（免费）」与 MCP 的 `export.pdf`（Live）都调这里。
 */
import { desktopApi } from '../desktopChrome';
import { log } from '../logger';
import { useEditorStore } from '../../store/editorStore';
import { refreshRecents } from '../recents';

export interface PdfExportResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  canceled?: boolean;
  error?: string;
}

/** 导出 PDF：桌面版落地成文件并返回路径；浏览器版打开打印对话框并如实说明 */
export async function exportPdf(opts: { path?: string } = {}): Promise<PdfExportResult> {
  const d = desktopApi();
  const S = useEditorStore.getState();
  const suggestedName = `${S.doc.title || 'export'}.pdf`;

  if (!d) {
    window.print();
    return { ok: false, error: '浏览器里无法直接写 PDF 文件：已打开打印对话框，请选「另存为 PDF」（要一条命令产出 PDF 文件请用桌面版）' };
  }
  try {
    const r = await d.exportPdf({ html: S.exportHTML(), suggestedName, path: opts.path });
    if (r?.ok) {
      log.info('export', '导出 PDF', { path: r.path, bytes: r.bytes ?? 0 });
      void refreshRecents();
      return { ok: true, path: r.path, bytes: r.bytes };
    }
    if (r?.canceled) return { ok: false, canceled: true };
    log.warn('export', `导出 PDF 失败：${r?.error ?? '未知'}`);
    return { ok: false, error: r?.error ?? '未知错误' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('export', `导出 PDF 异常：${msg}`);
    return { ok: false, error: msg };
  }
}
