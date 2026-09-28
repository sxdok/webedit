/**
 * 职责：「最近打开」清单（M-11）——**桌面版与浏览器版刻意分开**（方案 §7.2 M-11）。
 *
 *   · 桌面版：真源在 `userData/recent-docs.json`（主进程写），这里只是页面侧的**订阅缓存**，
 *     因为只有主进程能拿到"路径"，也只有它才能把别的文件读回来 → 点一下就重开；
 *   · 浏览器版：存 localStorage 的**文件名**（拿不到路径、也读不了本地文件），
 *     菜单里如实标成"点不开"，指向「打开…」——宁可说清做不到，也不给个点了没反应的入口。
 *
 * 为什么做成可订阅缓存：菜单要在清单变化后重渲染（`useSyncExternalStore`），
 * 而清单的写入发生在主进程（桌面）或 localStorage（浏览器），页面侧需要一个共同读取点。
 */
import { desktopApi, type RecentDoc } from './desktopChrome';

const KEY = 'visual-editor.recentDocs.v1';
const MAX = 8;

let cache: RecentDoc[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* 订阅者自己的问题不影响这里 */
    }
  }
}

export function subscribeRecents(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 同步快照（useSyncExternalStore 用；必须是稳定引用，变化时才换新数组） */
export function recentDocs(): RecentDoc[] {
  return cache;
}

function readLocal(): RecentDoc[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((r) => r && typeof r.title === 'string').slice(0, MAX).map((r) => ({ ...r, kind: 'name' as const }))
      : [];
  } catch {
    return [];
  }
}

function writeLocal(list: RecentDoc[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 配额/隐私模式：记不上就算了，不打断主流程 */
  }
}

/** 从真源刷新（桌面：主进程清单；浏览器：localStorage） */
export async function refreshRecents(): Promise<RecentDoc[]> {
  const d = desktopApi();
  if (d) {
    try {
      const list = await d.recentList();
      cache = Array.isArray(list) ? list : [];
      emit();
      return cache;
    } catch {
      /* 拿不到就保持现状 */
    }
  }
  cache = readLocal();
  emit();
  return cache;
}

/** 浏览器版记录一条（只有名字，点不开；用于"至少知道刚才存过什么"） */
export function rememberLocalName(name: string): void {
  const next: RecentDoc[] = [
    { path: name, title: name, at: Date.now(), kind: 'name' as const },
    ...cache.filter((r) => r.title !== name),
  ].slice(0, MAX);
  cache = next;
  writeLocal(next);
  emit();
}

/** 清空（桌面：写回空清单；浏览器：清 localStorage） */
export async function clearRecents(): Promise<void> {
  const d = desktopApi();
  if (d) {
    try {
      cache = await d.recentClear();
    } catch {
      cache = [];
    }
  } else {
    cache = [];
    writeLocal([]);
  }
  emit();
}
