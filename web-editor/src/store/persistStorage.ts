/**
 * 职责：给 zustand `persist` 用的**配额安全**存储层（用户 2026-09-24 现场）。
 *
 * 背景：一份 7.2MB 的文档（9 个节点里 5 张图**内嵌 base64**，`image` 的 props 共 7.06MB）
 * 在 localStorage（约 5MB/源）里写不下 → `setItem` 抛 `QuotaExceededError` →
 * 错误落在 store 更新的**渲染路径**上 → 被错误边界抓住，弹「编辑器渲染出错」。
 * 而"打开这种 JSON" = 一次 store 更新，于是打开也立刻炸。
 *
 * 做法：**超预算就干脆不写**（绝不抛异常），并广播一个事件让界面把话说清楚：
 *   · 文档仍在内存里，编辑、导出都不受影响；
 *   · 想留住改动就用「文件 → 导出 JSON」写盘 —— 大文档（内嵌图片）的正路是**文件**，不是浏览器本地存储；
 *   · **内嵌的 base64 图片不写进 localStorage**（那是写爆的唯一原因）。
 */
import { log } from '../utils/logger';

export const PERSIST_KEY = 'visual-editor-v1';
/** 单次落盘预算（字符数）：localStorage 通常 5MB/源，给 UI 状态留出余量 */
export const PERSIST_BUDGET = 3.5 * 1024 * 1024;
/** 超预算时广播的事件名（界面据此给用户一句人话，不用把 store 再改一遍以免递归落盘） */
export const PERSIST_OVERFLOW_EVENT = 'editor:persist-overflow';

export interface PersistOverflowDetail {
  /** 本次想写的字符数 */
  bytes: number;
  /** budget = 自己先拦下（太大）；quota = 真写了但浏览器拒绝 */
  kind: 'budget' | 'quota';
}

/** 最后一次被拦下的落盘（供诊断面板/自检读取，不参与 React 状态） */
let lastOverflow: PersistOverflowDetail | null = null;

export function lastPersistOverflow(): PersistOverflowDetail | null {
  return lastOverflow;
}

function notify(detail: PersistOverflowDetail): void {
  lastOverflow = detail;
  log.warn(
    'store',
    detail.kind === 'budget'
      ? `文档太大（约 ${(detail.bytes / 1024 / 1024).toFixed(1)}MB），已跳过浏览器本地存储（含内嵌图片）`
      : `浏览器本地存储写入被拒（配额），已跳过：约 ${(detail.bytes / 1024 / 1024).toFixed(1)}MB`,
    { bytes: detail.bytes },
  );
  try {
    window.dispatchEvent(new CustomEvent<PersistOverflowDetail>(PERSIST_OVERFLOW_EVENT, { detail }));
  } catch {
    /* 无 window（理论上不会）时静默 */
  }
}

/** 这份 payload 该不该落盘（导出给自检用，便于直接断言预算逻辑） */
export function shouldPersist(bytes: number): boolean {
  return bytes <= PERSIST_BUDGET;
}

/** 与 localStorage 同形的最小存储（zustand `createJSONStorage` 接受它） */
export const safePersistStorage = {
  getItem: (name: string): string | null => {
    try {
      return window.localStorage.getItem(name);
    } catch (e) {
      log.warn('store', '本地存储读取失败（隐私模式？）', { error: String((e as Error)?.message ?? e) });
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    // ① 自己先拦：大文档（多半是内嵌 base64 图片）不写，避免每次编辑都去撞配额
    if (!shouldPersist(value.length)) {
      notify({ bytes: value.length, kind: 'budget' });
      return;
    }
    // ② 真写了被浏览器拒绝也**不能抛**：调用方在 store 的更新路径上，抛出去就是"渲染出错"
    try {
      window.localStorage.setItem(name, value);
    } catch (e) {
      notify({ bytes: value.length, kind: 'quota' });
      void e;
    }
  },
  removeItem: (name: string): void => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* 忽略 */
    }
  },
};
