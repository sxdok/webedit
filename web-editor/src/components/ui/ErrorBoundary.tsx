/**
 * 职责：React 错误边界——渲染期抛错时不让整棵树白屏，显示可复制的诊断信息并把错误写进日志。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { log } from '../../utils/logger';
import { buildDiagnosticReport } from '../../utils/diagnostics';

interface State {
  error: Error | null;
  info: string;
  copied: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('react', `渲染出错：${error.message}`, {
      stack: error.stack?.split('\n').slice(0, 8).join('\n'),
      componentStack: info.componentStack?.split('\n').slice(0, 8).join('\n'),
    });
    this.setState({ info: info.componentStack ?? '' });
  }

  override render(): ReactNode {
    const { error, info, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center bg-panel p-6">
        <div className="w-[720px] max-w-full rounded-lg border border-red-200 bg-white p-5 shadow-lg">
          <h2 className="mb-1 text-base font-semibold text-red-600">编辑器渲染出错</h2>
          <p className="mb-3 text-[13px] text-gray-600">
            界面已停止渲染，但你的文档数据仍在浏览器本地存储里（键 <code>visual-editor-v1</code>）。
            请把下面的诊断信息复制给开发者定位。
          </p>
          <pre className="thin-scroll mb-3 max-h-56 overflow-auto rounded bg-gray-50 p-3 text-2xs leading-5 text-gray-700">
            {error.message}
            {'\n'}
            {error.stack}
            {'\n'}
            {info}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              className="h-8 rounded bg-primary px-3 text-[13px] text-white hover:bg-primary-hover"
              onClick={() => {
                void navigator.clipboard?.writeText(`${error.stack}\n${info}`);
                this.setState({ copied: true });
              }}
            >
              {copied ? '已复制错误栈' : '复制错误栈'}
            </button>
            <button
              type="button"
              className="h-8 rounded border border-line px-3 text-[13px] text-gray-700 hover:bg-gray-50"
              onClick={() => {
                const text = buildDiagnosticReport();
                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `editor-diagnostic-${Date.now()}.txt`;
                a.click();
              }}
            >
              下载完整诊断报告
            </button>
            <button
              type="button"
              className="h-8 rounded border border-line px-3 text-[13px] text-gray-700 hover:bg-gray-50"
              onClick={() => location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
