/**
 * 职责：把「环境 + 注册表 + store 快照 + 日志尾部」汇总成一份可粘贴的诊断报告，
 *       供出问题时快速定位（菜单 帮助 → 诊断信息，或 ?diag=1）。
 */
import { getAllComponents, getComponentsByMode } from '../registry';
import { useEditorStore } from '../store/editorStore';
import { flatten, getForest } from '../store/treeUtils';
import { DEVICE_PRESETS, PAGE_SIZES } from '../registry/types';
import { log } from './logger';

export interface DiagnosticSnapshot {
  env: Record<string, string | number>;
  editor: Record<string, string | number | boolean>;
  registry: Record<string, string | number>;
  tree: Record<string, string | number>;
  /** 日志尾部（最近 N 条） */
  logs: string;
}

export function snapshot(): DiagnosticSnapshot {
  const s = useEditorStore.getState();
  const forest = getForest(s.doc);
  const flat = flatten(forest);
  const vp = typeof window !== 'undefined' ? window : undefined;

  const env = {
    时间: new Date().toISOString(),
    地址: typeof location !== 'undefined' ? location.href : '-',
    浏览器: typeof navigator !== 'undefined' ? navigator.userAgent : '-',
    视口: vp ? `${vp.innerWidth}×${vp.innerHeight} @${vp.devicePixelRatio}x` : '-',
    语言: typeof navigator !== 'undefined' ? navigator.language : '-',
    在线: typeof navigator !== 'undefined' ? String(navigator.onLine) : '-',
  };

  const editor = {
    模式: s.doc.mode,
    文档标题: s.doc.title,
    缩放: s.zoom,
    纸张: `${s.doc.document.page.size} ${s.doc.document.page.width}×${s.doc.document.page.height}mm ${s.doc.document.page.orientation}`,
    设备: `${s.doc.web.canvas.device} ${s.doc.web.canvas.width}×${s.doc.web.canvas.height}px`,
    文档模式组件: s.doc.document.components.length,
    Web顶层组件: s.doc.web.root.children?.length ?? 0,
    选中数: s.doc.selectedIds.length,
    历史past: s.history.past.length,
    历史future: s.history.future.length,
    剪贴板: s.clipboard ? '有' : '无',
    面板: `左${s.ui.leftCollapsed ? '收' : '开'} 右${s.ui.rightCollapsed ? '收' : '开'} 树${s.ui.showTree ? '开' : '关'}`,
    预览模式: s.ui.preview,
  };

  const all = getAllComponents();
  const registry = {
    组件总数: all.length,
    文档模式可用: getComponentsByMode('document').length,
    Web模式可用: getComponentsByMode('web').length,
    容器组件: all.filter((d) => d.isContainer).length,
    声明纸张预设: Object.keys(PAGE_SIZES).length,
    声明设备预设: Object.keys(DEVICE_PRESETS).length,
  };

  const byType: Record<string, number> = {};
  flat.forEach((f) => {
    byType[f.node.type] = (byType[f.node.type] ?? 0) + 1;
  });

  const tree = {
    当前模式节点数: flat.length,
    最大嵌套深度: flat.reduce((m, f) => Math.max(m, f.depth), 0),
    各类型数量: Object.entries(byType)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ') || '（空）',
  };

  return { env, editor, registry, tree, logs: log.dump() };
}

function table(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => `  ${k.padEnd(12, ' ')}: ${String(v)}`)
    .join('\n');
}

/** 生成完整诊断报告文本（可直接复制给别人） */
export function buildDiagnosticReport(): string {
  const s = snapshot();
  const r = log.remoteInfo();
  return [
    '================ 可视化编辑器 诊断报告 ================',
    '【运行环境】',
    table(s.env),
    '',
    '【日志落盘】',
    table({
      落盘状态: r.enabled ? '启用（写入运行目录）' : r.failed ? '写入失败，已退回浏览器本地存储' : '未启用（非启动器托管）',
      日志目录: r.dir || '—',
      今日文件: r.file || '—',
      待写行数: String(r.pending),
      兜底存储: `localStorage['visual-editor-log-v1']（尾部 ${200} 条）`,
    }),
    '',
    '【编辑器状态】',
    table(s.editor),
    '',
    '【组件注册表】',
    table(s.registry),
    '',
    '【当前模式结构】',
    table(s.tree),
    '',
    '【日志（尾部）】',
    s.logs,
    '================ 报告结束 ================',
  ].join('\n');
}

/** 把诊断报告保存到运行目录（启动器的 logs/）；没有接口时退回下载 */
export async function saveDiagnosticReportToRunDir(): Promise<{ ok: boolean; file?: string; bytes?: number }> {
  const text = buildDiagnosticReport();
  const r = await log.saveReport('diagnostic', text);
  if (r?.ok) {
    log.info('diagnostics', '诊断报告已写入运行目录', { file: r.file, bytes: r.bytes });
    return { ok: true, file: r.file, bytes: r.bytes };
  }
  await copyDiagnosticReport();
  return { ok: false };
}

/** 一键复制报告；失败时退回下载 */
export async function copyDiagnosticReport(): Promise<'copied' | 'downloaded'> {
  const text = buildDiagnosticReport();
  try {
    await navigator.clipboard.writeText(text);
    log.info('diagnostics', '诊断报告已复制到剪贴板', { chars: text.length });
    return 'copied';
  } catch {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `editor-diagnostic-${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    log.warn('diagnostics', '剪贴板不可用，已改为下载报告文件');
    return 'downloaded';
  }
}
