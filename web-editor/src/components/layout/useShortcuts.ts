/**
 * 职责：全局快捷键（§6.1）。只在焦点不在输入框时生效，避免和属性面板输入冲突。
 */
import { useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { findParentId, flatten, getForest } from '../../store/treeUtils';

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const S = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const ids = S.doc.selectedIds;
      const primary = ids[0];

      if (e.key === 'Escape') {
        S.selectComponent([]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        S.setNewDocOpen(true); // 新建：先选模式再填参数（类似 PS）
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) S.redo();
        else S.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        S.copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        S.pasteClipboard();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        ids.forEach((id) => S.duplicateComponent(id));
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        S.selectComponent(flatten(getForest(S.doc)).map((f) => f.node.id));
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        S.setMode(S.doc.mode === 'document' ? 'web' : 'document');
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        S.setZoom(S.zoom + 0.1);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        S.setZoom(S.zoom - 0.1);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        S.setZoom(1);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!ids.length) return;
        e.preventDefault();
        ids.forEach((id) => S.removeComponent(id));
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!primary) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const delta = e.key === 'ArrowUp' ? -step : step;
        if (S.doc.mode === 'web') {
          const forest = getForest(S.doc);
          const hit = flatten(forest).find((f) => f.node.id === primary);
          const frame = hit?.node.frame;
          if (frame) S.updateFrame(primary, { y: frame.y + delta });
        } else {
          const forest = getForest(S.doc);
          const parentId = findParentId(forest, primary);
          const siblings = parentId ? (findNodeById(forest, parentId)?.children ?? []) : forest;
          const index = siblings.findIndex((n) => n.id === primary);
          if (index < 0) return;
          const target = Math.max(0, Math.min(siblings.length - 1, index + (delta < 0 ? -1 : 1)));
          if (target !== index) S.moveComponent(primary, parentId, target);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function findNodeById(forest: ReturnType<typeof getForest>, id: string) {
  return flatten(forest).find((f) => f.node.id === id)?.node;
}
