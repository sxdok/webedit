/**
 * 职责：模式切换（文档模式 / Web 模式）。切换时若当前文档在**另一模式**已有内容，
 * 弹确认提示（提示"两套内容分别保留"），确认后只切换渲染层，数据零丢失。
 */
import { FileText, Monitor } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import type { EditorMode } from '../../registry/types';

export function useModeSwitch() {
  const mode = useEditorStore((s) => s.doc.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const doc = useEditorStore((s) => s.doc);

  return (next: EditorMode) => {
    if (next === mode) return;
    const otherCount =
      next === 'web' ? doc.web.root.children?.length ?? 0 : doc.document.components.length;
    const msg =
      next === 'web'
        ? `切换到 Web 模式？文档模式的 ${doc.document.components.length} 个组件与页面设置会原样保留。`
        : `切换到文档模式？Web 模式的 ${doc.web.root.children?.length ?? 0} 个元素与画布设置会原样保留。`;
    if (otherCount > 0 || window.confirm(msg)) setMode(next);
  };
}

/** 分段式模式切换（工具栏用） */
export function ModeSwitcher() {
  const mode = useEditorStore((s) => s.doc.mode);
  const switchMode = useModeSwitch();

  const item = (m: EditorMode, label: string, Icon: typeof FileText) => (
    <button
      type="button"
      onClick={() => switchMode(m)}
      className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] transition-colors ${
        mode === m ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 rounded-md bg-gray-100 p-0.5">
      {item('document', '文档模式', FileText)}
      {item('web', 'Web 模式', Monitor)}
    </div>
  );
}
