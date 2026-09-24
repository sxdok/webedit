/**
 * 职责：**全局提示条**（视口正中、鼠标穿透、停留 1 秒后自动淡出）。
 *
 * 用户 2026-09-24 的要求：「弹出后停留 1 秒再淡出」「放在中间」「存在的时候不能影响打开的文档的编辑」——
 *   · **居中**：外层 `fixed inset-0 flex items-center justify-center`，不参与布局、不推挤画布；
 *   · **不挡编辑**：外层 `pointer-events-none`（点击 / 框选 / 拖拽 / 拖文件都直接落到画布上），
 *     只有面板本身 `pointer-events-auto`（✕ 还点得到）；
 *   · **自动淡出**：停留 `NOTICE_HOLD_MS` → 透明度过渡 `NOTICE_FADE_MS` → 卸载；
 *     期间来了新消息就重新计时（不会两条叠在一起）。
 *   · 唯一例外：`editor:persist-overflow`（大文档没有自动保存）**不自动消失** ——
 *     它要用户去「文件 → 导出 JSON」存盘，一闪而过会让人误以为已经存过了（数据安全相关，点了 ✕ 才走）。
 *
 * ★都用 window 事件而不是 store 状态 —— `persistStorage.setItem` 是在 store 更新路径上被调用的，
 *   那里若再改 store 会触发下一次落盘，形成递归。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { PERSIST_OVERFLOW_EVENT, type PersistOverflowDetail } from '../../store/persistStorage';

export const NOTICE_EVENT = 'editor:notice';

/** 停留时长（用户要求 1 秒）与淡出时长 —— 自检按这两个常量断言 */
export const NOTICE_HOLD_MS = 1000;
export const NOTICE_FADE_MS = 350;

export interface NoticeDetail {
  kind: 'info' | 'ok' | 'warn';
  title: string;
  detail?: string;
}

type ShownNotice = NoticeDetail & { persist?: boolean; sticky?: boolean };

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
  const [info, setInfo] = useState<ShownNotice | null>(null);
  /** 正在淡出（透明度归零中，等过渡结束再卸载） */
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback((): void => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  const show = useCallback(
    (d: ShownNotice): void => {
      clearTimers();
      setInfo(d);
      setLeaving(false);
      if (d.sticky) return; // 需要用户处理的消息：留着，直到点 ✕
      timers.current.push(
        window.setTimeout(() => {
          setLeaving(true);
          timers.current.push(window.setTimeout(() => setInfo(null), NOTICE_FADE_MS));
        }, NOTICE_HOLD_MS),
      );
    },
    [clearTimers],
  );

  useEffect(() => {
    const onNotice = (e: Event): void => {
      const d = (e as CustomEvent<NoticeDetail>).detail;
      if (d?.title) show(d);
    };
    const onOverflow = (e: Event): void => {
      const d = (e as CustomEvent<PersistOverflowDetail>).detail;
      if (d && typeof d.bytes === 'number') show({ ...overflowToNotice(d), persist: true, sticky: true });
    };
    window.addEventListener(NOTICE_EVENT, onNotice);
    window.addEventListener(PERSIST_OVERFLOW_EVENT, onOverflow);
    return () => {
      window.removeEventListener(NOTICE_EVENT, onNotice);
      window.removeEventListener(PERSIST_OVERFLOW_EVENT, onOverflow);
      clearTimers();
    };
  }, [show, clearTimers]);

  const close = (): void => {
    clearTimers();
    setInfo(null);
  };

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
      data-notice-leaving={leaving ? '1' : undefined}
      data-persist-overflow={info.persist ? '1' : undefined}
      className={`no-print pointer-events-none fixed inset-0 z-[60] flex items-center justify-center px-4 transition-opacity duration-300 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div
        data-notice-panel="1"
        data-notice-tone={info.kind}
        className={`pointer-events-auto flex w-[min(680px,92vw)] items-start gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-lg ${tone}`}
      >
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
          onClick={close}
          className="shrink-0 rounded p-0.5 hover:bg-black/5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
