/**
 * 职责：**查找 / 替换**弹窗（M-9，编辑 → 查找/替换… / Ctrl+F）。
 *
 * 只做交互（输入、跳转、点按钮），命中与替换的逻辑全在 `utils/findReplace.ts`
 * （纯函数 → 自检可以直接验它，不必模拟打字）。
 *
 * 范围：文档的文本类属性（text/html/caption/title/label/列表项/表格 data）。
 * Markdown 源码视图由**同一份组件树**生成，所以这一处命中即两边都覆盖。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Replace, ReplaceAll } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { computeReplacements, findMatches, totalHits, type FindHit } from '../../utils/findReplace';
import { log } from '../../utils/logger';
import { Modal } from '../ui/Modal';

export function FindReplaceDialog() {
  const open = useEditorStore((s) => s.ui.findOpen === true);
  const doc = useEditorStore((s) => s.doc);
  const updateProps = useEditorStore((s) => s.updateProps);
  const selectComponent = useEditorStore((s) => s.selectComponent);
  const toggleUI = useEditorStore((s) => s.toggleUI);

  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // 打开就聚焦查找框（打开弹窗后还要再点一下才输入，是常见的小烦人）
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const hits: FindHit[] = useMemo(() => findMatches(doc, query, { caseSensitive }), [doc, query, caseSensitive]);
  const total = totalHits(hits);

  const goto = (delta: number): void => {
    if (!hits.length) return;
    const next = (cursor + delta + hits.length) % hits.length;
    setCursor(next);
    selectComponent([hits[next].nodeId]);
    log.info('find', `定位到第 ${next + 1}/${hits.length} 处（节点 ${hits[next].type} · ${hits[next].path}）`);
  };

  const replaceCurrent = (): void => {
    if (!hits.length) return;
    const hit = hits[Math.min(cursor, hits.length - 1)];
    const patch = computeReplacements(doc, query, replacement, { caseSensitive }).find((p) => p.nodeId === hit.nodeId);
    if (!patch) return;
    // 只替换这一处：该节点上的**首次**命中（其余留给"全部替换"或再点一次）
    updateProps(patch.nodeId, firstOnly(patch.patch, query, replacement, caseSensitive));
    log.action('find.replaceOne', { nodeId: patch.nodeId, path: hit.path });
  };

  const replaceAll = (): void => {
    const patches = computeReplacements(doc, query, replacement, { caseSensitive });
    const changed = patches.reduce((n, p) => n + p.count, 0);
    for (const p of patches) updateProps(p.nodeId, p.patch);
    log.action('find.replaceAll', { query, replacement, nodes: patches.length, changed });
  };

  return (
    <Modal open={open} title="查找 / 替换" onClose={() => toggleUI('findOpen')} width={620}>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[12px] text-gray-600">查找</span>
          <input
            ref={inputRef}
            data-find="query"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="要查找的文字（支持组件文本 / 表题 / 表格单元格）"
            className="h-7 min-w-0 flex-1 rounded border border-line bg-white px-2 text-xs outline-none focus:border-primary"
          />
          <span className="flex-none text-2xs text-gray-400" data-find-count="1">
            {query ? `共 ${total} 处` : '范围：文档文本与表格内容（Markdown 视图同源）'}
          </span>
        </label>

        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[12px] text-gray-600" />
          <button type="button" data-find-prev="1" disabled={!hits.length} onClick={() => goto(-1)} className="flex h-7 items-center gap-1 rounded border border-line px-2 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40">
            <ChevronUp className="h-3 w-3" /> 上一个
          </button>
          <button type="button" data-find-next="1" disabled={!hits.length} onClick={() => goto(1)} className="flex h-7 items-center gap-1 rounded border border-line px-2 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40">
            <ChevronDown className="h-3 w-3" /> 下一个
          </button>
          <label className="ml-2 flex items-center gap-1 text-2xs text-gray-600">
            <input type="checkbox" data-find="case" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            区分大小写
          </label>
        </div>

        <label className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[12px] text-gray-600">替换为</span>
          <input
            data-find="replace"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="留空 = 删除命中的文字"
            className="h-7 min-w-0 flex-1 rounded border border-line bg-white px-2 text-xs outline-none focus:border-primary"
          />
          <button type="button" data-find-replace="1" disabled={!hits.length || !query} onClick={replaceCurrent} className="flex h-7 flex-none items-center gap-1 rounded border border-line px-2 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40">
            <Replace className="h-3 w-3" /> 替换
          </button>
          <button type="button" data-find-replace-all="1" disabled={!hits.length || !query} onClick={replaceAll} className="flex h-7 flex-none items-center gap-1 rounded border border-primary bg-primary/10 px-2 text-xs text-primary hover:bg-primary/20 disabled:opacity-40">
            <ReplaceAll className="h-3 w-3" /> 全部替换
          </button>
        </label>

        <div className="mt-1 max-h-[220px] overflow-auto rounded border border-line/70" data-find-list="1">
          {hits.length === 0 ? (
            <p className="m-0 px-2 py-2 text-2xs text-gray-400">{query ? '没有命中。' : '输入要查找的文字后这里会列出命中的组件与属性。'}</p>
          ) : (
            hits.map((h, i) => (
              <button
                key={`${h.nodeId}-${h.path}`}
                type="button"
                data-find-hit={h.path}
                onClick={() => {
                  setCursor(i);
                  selectComponent([h.nodeId]);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-2xs ${i === cursor ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <span className="flex-none font-mono">{h.type}</span>
                <span className="flex-none text-gray-400">{h.path}</span>
                <span className="ml-auto flex-none">{h.count} 处</span>
              </button>
            ))
          )}
        </div>
        <p className="m-0 text-2xs text-gray-400">
          替换会写进文档（可 Ctrl+Z 撤销）；「全部替换」按节点合并成若干步历史。表格单元格按 `a | b` 序列化格式处理。
        </p>
      </div>
    </Modal>
  );
}

/**
 * 只替换**首次**命中：把 patch 里每个字符串值的第一处替换回去（`computeReplacements` 算的是全量）。
 * 这样"替换"按钮的语义与常见编辑器一致（一次一处），"全部替换"才动全部。
 */
function firstOnly(patch: Record<string, unknown>, query: string, replacement: string, caseSensitive: boolean): Record<string, unknown> {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const one = (s: string): string => {
    const re = new RegExp(esc(query), caseSensitive ? '' : 'i');
    return s.replace(re, replacement);
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string') out[k] = one(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' ? one(x) : x));
    else out[k] = v;
  }
  return out;
}
