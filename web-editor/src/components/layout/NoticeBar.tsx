/**
 * 职责：**全局提示条**（底部居中、可关闭）。
 *
 * 两个来源共用它：
 *   · `editor:persist-overflow`（`store/persistStorage.ts` 派发：大文档没落盘）；
 *   · `editor:notice`（导入结果等一次性消息，`notify()` 派发）。
 * ★都用 window 事件而不是 store 状态 —— `persistStorage.setItem` 是在 store 更新路径上被调用的，
 *   那里若再改 store 会触发下一次落盘，形成递归。
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { PERSIST_OVERFLOW_EVENT, type PersistOverflowDetail } from '../../store/persistStorage';

export const NOTICE_EVENT = 'editor:notice';

export interface NoticeDetail {
  kind: 'info' | 'ok' | 'warn';
  title: string;
  detail?: string;
}

/** 供任意模块弹一条提示（不碰 store，不会递归） */
export function notify(detail: NoticeDetail): void {
  try {
    window.dispatchEvent(new CustomEvent<NoticeDetail>(NOTICE_EVENT, { detail }));
  } catch {
    /* 忽略 */
  }
}

/** 大文档未落盘 → 同一根提示条（`persistStorage` 只派发它自己的事件，这里转成统一形态） */
function overflowToNotice(d: PersistOverflowDetail): NoticeDetail {
  const mb = (d.bytes / 1024 / 1024).toFixed(1);
  return {
    kind: 'warn',
    title: `这份文档约 ${mb}MB，超过浏览器本地存储上限，没有自动保存（文档还在，编辑不受影响）`,
    detail:
      '多半是图片以 data: 内嵌进了文档（内嵌图不写本地存储）。要留住改动请用 文件 → 导出 JSON 存到磁盘；' +
      '也可以把图片换成外链或先压小再插入。',
  };
}

export function NoticeBar() {
  const [info, setInfo] = useState<(NoticeDetail & { persist?: boolean }) | null>(null);

  useEffect(() => {
    const onNotice = (e: Event): void => {
      const d = (e as CustomEvent<NoticeDetail>).detail;
      if (d?.title) setInfo(d);
    };
    const onOverflow = (e: Event): void => {
      const d = (e as CustomEvent<PersistOverflowDetail>).detail;
      if (d && typeof d.bytes === 'number') setInfo({ ...overflowToNotice(d), persist: true });
    };
    window.addEventListener(NOTICE_EVENT, onNotice);
    window.addEventListener(PERSIST_OVERFLOW_EVENT, onOverflow);
    return () => {
      window.removeEventListener(NOTICE_EVENT, onNotice);
      window.removeEventListener(PERSIST_OVERFLOW_EVENT, onOverflow);
    };
  }, []);

  if (!info) return null;
  const tone =
    info.kind === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : info.kind === 'info'
        ? 'border-line bg-white text-gray-700'
        : 'border-amber-300 bg-amber-50 text-amber-900';
  const Icon = info.kind === 'ok' ? CheckCircle2 : info.kind === 'info' ? Info : AlertTriangle;
  return (
    <div
      data-notice-bar="1"
      data-persist-overflow={info.persist ? '1' : undefined}
      className={`no-print fixed bottom-3 left-1/2 z-[60] w-[min(680px,92vw)] -translate-x-1/2 rounded-lg border px-3 py-2 text-[12px] shadow-lg ${tone}`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{info.title}</div>
          {info.detail && <div className="mt-0.5 whitespace-pre-wrap leading-5">{info.detail}</div>}
        </div>
        <button
          type="button"
          data-persist-overflow-close="1"
          data-notice-bar-close="1"
          title="知道了"
          onClick={() => setInfo(null)}
          className="shrink-0 rounded p-0.5 hover:bg-black/5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

