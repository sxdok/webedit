/**
 * 职责：**把外部文件导入编辑器** —— 菜单（文件 →「打开 HTML…」/「打开 JSON…」）与
 * "把文件拖进窗口"两条入口共用同一份逻辑，避免两处各写一遍、行为漂移。
 *
 * 支持两种：
 *   · `.html` / `.htm` → 走 `htmlImport`（本工程导出的 HTML 带 `data-node-type`，能**原样读回**）；
 *   · `.json`（编辑器导出的文档 JSON）→ 走 `importJSON`。
 */
import { log } from './logger';
import { useEditorStore } from '../store/editorStore';

export type ImportKind = 'html' | 'json' | 'unknown';

/** 按文件名/类型判断该怎么导 */
export function importKindOf(name: string, mime = ''): ImportKind {
  const n = name.toLowerCase();
  if (/\.html?$/.test(n) || mime.includes('html')) return 'html';
  if (/\.json$/.test(n) || mime.includes('json')) return 'json';
  return 'unknown';
}

export interface ImportOutcome {
  ok: boolean;
  kind: ImportKind;
  title: string;
  /** 人类可读的一行结果（提示条直接用） */
  summary: string;
  detail: string;
}

/** HTML 文本 → 文档（`?load=` 与菜单、拖拽都走它） */
export async function importHtmlIntoEditor(html: string, src: string, baseUrl?: string): Promise<ImportOutcome> {
  const m = await import('./htmlImport');
  const { doc, result } = m.importHtmlToDocument(html, {
    title: src.split(/[\\/]/).pop()?.replace(/\.html?$/i, ''),
    baseUrl,
  });
  useEditorStore.getState().loadDocument(doc);
  log.info('load', 'HTML 已载入编辑器', { 来源: src, 模式: result.mode, 节点: result.stats });
  const detail =
    `文档标题：${doc.title}\n` +
    `识别模式：${result.mode === 'document' ? '文档模式' : 'Web 模式'}\n` +
    `顶层组件 ${result.stats.top} 个 / 含子节点共 ${result.stats.total} 个\n` +
    `（按 data-node-type 精确识别 ${result.stats.typed} 个、按标签识别 ${result.stats.guessed} 个、跳过 ${result.stats.skipped} 个）` +
    (result.warnings.length ? `\n\n提示：\n${result.warnings.slice(0, 8).map((w) => `· ${w}`).join('\n')}` : '');
  return {
    ok: true,
    kind: 'html',
    title: doc.title,
    summary: `已载入 HTML：顶层 ${result.stats.top} 个 / 共 ${result.stats.total} 个组件${result.warnings.length ? `（${result.warnings.length} 条提示）` : ''}`,
    detail,
  };
}

/** 文档 JSON → 文档（「文件 → 打开 JSON」与拖拽共用） */
export function importJsonIntoEditor(text: string, src: string): ImportOutcome {
  // 先自己判一次形状，好把「不是 JSON」「是 JSON 但不是编辑器文档」两种失败分开说清楚 ——
  // 光看 store.importJSON 的 false 分不出是哪一种，用户也就不知道该改什么。
  let bad = '';
  try {
    const probe = JSON.parse(text) as unknown;
    if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
      bad = `顶层不是对象（是 ${Array.isArray(probe) ? '数组' : typeof probe}）`;
    } else {
      const keys = Object.keys(probe as Record<string, unknown>);
      const missing = ['document', 'web'].filter((k) => !keys.includes(k));
      if (missing.length) bad = `缺少 ${missing.join(' 和 ')} 字段（实际顶层字段：${keys.slice(0, 8).join('、') || '无'}）`;
    }
  } catch (e) {
    bad = `不是合法 JSON：${e instanceof Error ? e.message : String(e)}`;
  }
  const ok = bad === '' && useEditorStore.getState().importJSON(text);
  const doc = useEditorStore.getState().doc;
  const nodes = doc.document.components.length + (doc.web.root.children?.length ?? 0);
  log.info('load', '文档 JSON 已载入编辑器', { 来源: src, ok, 顶层节点: nodes, 问题: bad });
  return {
    ok,
    kind: 'json',
    title: doc.title,
    summary: ok ? `已载入文档 JSON：顶层 ${nodes} 个节点 · ${doc.title}` : `打开失败：${bad || '结构不合法'}`,
    detail: ok
      ? `文档标题：${doc.title}\n顶层节点：${nodes} 个\n模式：${doc.mode === 'document' ? '文档模式' : 'Web 模式'}`
      : `${src}\n\n要打开的是编辑器「文件 → 保存（导出 JSON）」产出的文档（顶层含 document 与 web 两个字段）。`,
  };
}

/** 一个 File（拖进来的）→ 导入 */
export async function importFileIntoEditor(file: File): Promise<ImportOutcome> {
  const kind = importKindOf(file.name, file.type);
  if (kind === 'unknown') {
    return {
      ok: false,
      kind,
      title: file.name,
      summary: `不认识的文件：${file.name}（支持 .html / .htm / .json）`,
      detail: '把编辑器导出的 HTML 或 JSON 拖进来即可读回。',
    };
  }
  const text = await file.text();
  if (kind === 'html') return importHtmlIntoEditor(text, file.name);
  return importJsonIntoEditor(text, file.name);
}
