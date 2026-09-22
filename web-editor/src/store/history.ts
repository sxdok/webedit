/**
 * 职责：撤销/重做历史栈（上限 50 步）+ 连续输入的防抖合并闸门。
 * 纯函数，不依赖 store，便于单测。
 */
import type { EditorDocument } from '../registry/types';

export const HISTORY_LIMIT = 50;
/** 同一 key 的连续修改在 300ms 内合并成一步（§7 要求） */
export const MERGE_WINDOW_MS = 300;

export interface HistoryState {
  past: EditorDocument[];
  future: EditorDocument[];
}

export function emptyHistory(): HistoryState {
  return { past: [], future: [] };
}

/** 记录一步：压入修改前的快照，清空重做栈，并裁剪到上限 */
export function pushHistory(history: HistoryState, snapshot: EditorDocument): HistoryState {
  const past = [...history.past, snapshot];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

export function undo(
  history: HistoryState,
  current: EditorDocument,
): { history: HistoryState; doc: EditorDocument } | null {
  if (!history.past.length) return null;
  const past = [...history.past];
  const previous = past.pop() as EditorDocument;
  return { history: { past, future: [current, ...history.future] }, doc: previous };
}

export function redo(
  history: HistoryState,
  current: EditorDocument,
): { history: HistoryState; doc: EditorDocument } | null {
  if (!history.future.length) return null;
  const [next, ...future] = history.future;
  return { history: { past: [...history.past, current], future }, doc: next };
}

/** 防抖合并闸门：同 key 且在时间窗内的连续修改只记一步历史 */
export class MergeGate {
  private key = '';
  private at = 0;

  /** 返回 true 表示这次应当合并（不新增历史步） */
  shouldMerge(key: string | undefined, now: number = Date.now()): boolean {
    if (!key) {
      this.key = '';
      this.at = 0;
      return false;
    }
    const merge = this.key === key && now - this.at < MERGE_WINDOW_MS;
    this.key = key;
    this.at = now;
    return merge;
  }

  reset(): void {
    this.key = '';
    this.at = 0;
  }
}
