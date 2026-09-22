/**
 * 职责：诊断面板（帮助 → 诊断信息，或 ?diag=1）：实时显示环境/状态/注册表/结构 + 日志尾部，
 *       支持按级别过滤、复制报告、下载日志、清空日志。
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { log, type LogEntry, type LogLevel } from '../../utils/logger';
import { buildDiagnosticReport, snapshot } from '../../utils/diagnostics';
import { Modal } from '../ui/Modal';

const LEVELS: ('all' | LogLevel)[] = ['all', 'debug', 'info', 'warn', 'error'];

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: 'text-gray-400',
  info: 'text-gray-600',
  warn: 'text-amber-600',
  error: 'text-red-600',
};

export function DiagnosticsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<'all' | LogLevel>('all');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const off = log.subscribe(() => setTick((t) => t + 1));
    return off;
  }, [open]);

  const snap = useMemo(() => (open ? snapshot() : null), [open, tick]);
  const entries: LogEntry[] = useMemo(
    () => (open ? log.entries() : []).filter((e) => filter === 'all' || e.level === filter).slice(-200),
    [open, filter, tick],
  );

  const copy = async () => {
    const text = buildDiagnosticReport();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `editor-diagnostic-${Date.now()}.txt`;
      a.click();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal open={open} title="诊断信息（日志 / 状态 / 环境）" onClose={onClose} width={900}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="h-7 rounded bg-primary px-2.5 text-xs text-white hover:bg-primary-hover"
        >
          {copied ? '已复制' : '复制完整诊断报告'}
        </button>
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          className="flex h-7 items-center gap-1 rounded border border-line px-2 text-xs text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </button>
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([log.dump()], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `editor-log-${Date.now()}.txt`;
            a.click();
          }}
          className="flex h-7 items-center gap-1 rounded border border-line px-2 text-xs text-gray-700 hover:bg-gray-50"
        >
          <Download className="h-3.5 w-3.5" /> 下载日志
        </button>
        <button
          type="button"
          onClick={() => {
            log.clear();
            setTick((t) => t + 1);
          }}
          className="flex h-7 items-center gap-1 rounded border border-line px-2 text-xs text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> 清空
        </button>

        <span className="mx-1 h-5 w-px bg-line" />
        <span className="text-xs text-gray-500">级别</span>
        <select
          className="h-7 rounded border border-line px-1 text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | LogLevel)}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          输出级别
          <select
            className="h-7 rounded border border-line px-1 text-xs"
            value={log.getLevel()}
            onChange={(e) => {
              log.setLevel(e.target.value as LogLevel);
              setTick((t) => t + 1);
            }}
          >
            {(['debug', 'info', 'warn', 'error'] as LogLevel[]).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      {snap && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          {(['env', 'editor', 'registry', 'tree'] as const).map((key) => (
            <div key={key} className="rounded border border-line p-2">
              <div className="mb-1 text-2xs font-semibold text-gray-500">
                {key === 'env' ? '运行环境' : key === 'editor' ? '编辑器状态' : key === 'registry' ? '组件注册表' : '当前模式结构'}
              </div>
              <table className="w-full">
                <tbody>
                  {Object.entries(snap[key]).map(([k, v]) => (
                    <tr key={k}>
                      <td className="w-28 py-0.5 align-top text-2xs text-gray-400">{k}</td>
                      <td className="py-0.5 break-all font-mono text-2xs text-gray-700">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div className="rounded border border-line">
        <div className="flex items-center justify-between border-b border-line bg-gray-50 px-2 py-1">
          <span className="text-2xs font-semibold text-gray-500">
            日志（显示 {entries.length} 条 / 缓冲 {log.entries().length} 条）
          </span>
        </div>
        <div className="thin-scroll max-h-72 overflow-auto p-2 font-mono text-2xs leading-5">
          {entries.length === 0 && <div className="text-gray-400">暂无日志</div>}
          {entries.map((e, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              <span className="text-gray-400">{new Date(e.t).toISOString().slice(11, 23)}</span>{' '}
              <span className={LEVEL_COLOR[e.level]}>{e.level.toUpperCase().padEnd(5)}</span>{' '}
              <span className="text-primary">[{e.scope}]</span> {e.msg}
              {e.data !== undefined && <span className="text-gray-500"> {JSON.stringify(e.data)}</span>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
