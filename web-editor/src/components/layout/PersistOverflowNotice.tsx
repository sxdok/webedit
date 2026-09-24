/**
 * 职责：**落盘被跳过 / 被拒时的提示条**（用户 2026-09-24 的 QuotaExceededError 现场）。
 *
 * 为什么单独一个组件：`persistStorage.setItem` 是在 store 更新路径上被调用的，
 * 那里**不能再改 store**（会触发下一次落盘 → 递归）；所以用 window 事件通知，这里只做展示。
 *
 * 文案要给足三件事：多大、为什么、怎么办（导出到磁盘才是大文档的正路）。
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { PERSIST_OVERFLOW_EVENT, type PersistOverflowDetail } from '../../store/persistStorage';

export function PersistOverflowNotice() {
  const [info, setInfo] = useState<PersistOverflowDetail | null>(null);

  useEffect(() => {
    const onOverflow = (e: Event): void => {
      const detail = (e as CustomEvent<PersistOverflowDetail>).detail;
      if (detail && typeof detail.bytes === 'number') setInfo(detail);
    };
    window.addEventListener(PERSIST_OVERFLOW_EVENT, onOverflow);
    return () => window.removeEventListener(PERSIST_OVERFLOW_EVENT, onOverflow);
  }, []);

  if (!info) return null;
  const mb = (info.bytes / 1024 / 1024).toFixed(1);
  return (
    <div
      data-persist-overflow="1"
      data-persist-overflow-kind={info.kind}
      className="no-print fixed bottom-3 left-1/2 z-[60] w-[min(680px,92vw)] -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 shadow-lg"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            这份文档约 {mb}MB，超过浏览器本地存储上限，**没有自动保存**（文档还在，编辑不受影响）
          </div>
          <div className="mt-0.5 leading-5">
            多半是图片以 `data:` 内嵌进了文档（内嵌图不写本地存储）。
            要留住改动请用 <span className="font-medium">文件 → 导出 JSON</span> 存到磁盘；也可以把图片换成外链/缩小后再插。
          </div>
        </div>
        <button
          type="button"
          data-persist-overflow-close="1"
          title="知道了"
          onClick={() => setInfo(null)}
          className="shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
