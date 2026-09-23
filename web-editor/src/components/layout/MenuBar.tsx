/**
 * 职责：顶部菜单栏（文件 / 编辑 / 插入 / 视图 / 模式 / 页面 / 帮助）。
 * 只做菜单编排与调用 store action，不含业务逻辑。
 */
import { useState } from 'react';
import {
  DEVICE_PRESETS,
  PAGE_SIZES,
  type DeviceKey,
  type PageSizeKey,
} from '../../registry/types';
import {
  selectCanRedo,
  selectCanUndo,
  selectForest,
  selectMode,
  useEditorStore,
} from '../../store/editorStore';
import { flatten } from '../../store/treeUtils';
import { downloadText, pickTextFile, saveToRunDir } from '../../utils/download';
import { log } from '../../utils/logger';
import { saveDiagnosticReportToRunDir } from '../../utils/diagnostics';
import { buildComponentSpecSheet } from '../../utils/specSheet';
import { getLiveTypes, loadRuntimeComponents } from '../../registry/live';
import { bridgeStatus, isBridgeEnabled, setBridgeEnabled } from '../../mcp/bridgeClient';
import { fitZoom } from '../canvas/fitZoom';
import { DropdownMenu, MenuBarShell, type MenuEntry } from '../ui/Menu';
import { Modal, SHORTCUTS } from '../ui/Modal';
import { useModeSwitch } from './ModeSwitcher';

/** MCP 桥接状态文案（未开启 / 连接中 / 已连接 · 已重连 N 次 / 上次错误） */
function bridgeStatusLabel(): string {
  const s = bridgeStatus();
  if (s.state === 'connected') return `已连接（${s.liveComponents} 个外部组件）`;
  if (s.state === 'connecting') return '连接中…';
  return s.lastError ? `未开启（上次：${s.lastError.slice(0, 24)}）` : '未开启';
}

const MARGIN_PRESETS: { label: string; value: number }[] = [
  { label: '常规 上下25.4 / 左右31.7mm', value: 0 },
  { label: '窄 四边12.7mm', value: 12.7 },
  { label: '适中 四边19.05mm', value: 19.05 },
  { label: '宽 四边31.7mm', value: 31.7 },
];

export function MenuBar() {
  const [helpOpen, setHelpOpen] = useState(false);
  const mode = useEditorStore(selectMode);
  const forest = useEditorStore(selectForest);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const ui = useEditorStore((s) => s.ui);
  const zoom = useEditorStore((s) => s.zoom);
  const title = useEditorStore((s) => s.doc.title);
  const page = useEditorStore((s) => s.doc.document.page);
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  const switchMode = useModeSwitch();

  const S = () => useEditorStore.getState();

  const selectedIds = () => S().doc.selectedIds;
  const allIds = () => flatten(forest).map((f) => f.node.id);

  const fileMenu: MenuEntry[] = [
    {
      key: 'new',
      label: '新建…',
      shortcut: 'Ctrl+N',
      // 先选模式再填参数（类似 PS 的新建）；创建走 importJSON → 一步历史，可 Ctrl+Z 撤销
      onClick: () => S().setNewDocOpen(true),
    },
    {
      key: 'open',
      label: '打开（JSON）',
      onClick: async () => {
        const text = await pickTextFile();
        if (text == null) return;
        if (!S().importJSON(text)) window.alert('导入失败：不是有效的编辑器 JSON。');
      },
    },
    { key: 's1', separator: true },
    {
      key: 'save',
      label: '保存（导出 JSON）',
      onClick: () => downloadText(`${title || 'document'}.json`, S().exportJSON(), 'application/json'),
    },
    { key: 's2', separator: true },
    { key: 'html', label: '导出 HTML', onClick: () => downloadText(`${title || 'export'}.html`, S().exportHTML(), 'text/html') },
    { key: 'react', label: '导出 React 代码', onClick: () => downloadText(`${title || 'export'}.tsx`, S().exportReact(), 'text/plain') },
    {
      key: 'word',
      label: '导出 Word（.doc）',
      onClick: () => downloadText(`${title || 'export'}.doc`, S().exportWord(), 'application/msword'),
    },
    { key: 'print', label: '打印…', shortcut: 'Ctrl+P', onClick: () => window.print() },
  ];

  const editMenu: MenuEntry[] = [
    { key: 'undo', label: '撤销', shortcut: 'Ctrl+Z', disabled: !canUndo, onClick: () => S().undo() },
    { key: 'redo', label: '重做', shortcut: 'Ctrl+Shift+Z', disabled: !canRedo, onClick: () => S().redo() },
    { key: 'e1', separator: true },
    { key: 'copy', label: '复制', shortcut: 'Ctrl+C', disabled: !selectedIds().length, onClick: () => S().copySelection() },
    { key: 'paste', label: '粘贴', shortcut: 'Ctrl+V', onClick: () => S().pasteClipboard() },
    { key: 'dup', label: '原地复制', shortcut: 'Ctrl+D', disabled: !selectedIds().length, onClick: () => selectedIds().forEach((id) => S().duplicateComponent(id)) },
    { key: 'del', label: '删除', shortcut: 'Delete', danger: true, disabled: !selectedIds().length, onClick: () => selectedIds().forEach((id) => S().removeComponent(id)) },
    { key: 'e2', separator: true },
    { key: 'all', label: '全选', shortcut: 'Ctrl+A', disabled: !allIds().length, onClick: () => S().selectComponent(allIds()) },
    {
      key: 'clear',
      label: '清空当前模式内容',
      danger: true,
      disabled: !forest.length,
      onClick: () => {
        if (window.confirm('清空当前模式的全部组件？（可用 Ctrl+Z 撤销）')) S().clearAll();
      },
    },
  ];

  const viewMenu: MenuEntry[] = [
    { key: 'grid', label: '显示网格', checked: ui.showGrid, onClick: () => S().toggleUI('showGrid') },
    { key: 'ruler', label: '显示标尺', checked: ui.showRuler, onClick: () => S().toggleUI('showRuler') },
    { key: 'guides', label: '显示辅助线（页边距）', checked: ui.showGuides, onClick: () => S().toggleUI('showGuides') },
    { key: 'snap', label: '对齐吸附', checked: ui.snap, onClick: () => S().toggleUI('snap') },
    { key: 'v1', separator: true },
    { key: 'z50', label: '缩放 50%', onClick: () => S().setZoom(0.5) },
    { key: 'z75', label: '缩放 75%', onClick: () => S().setZoom(0.75) },
    { key: 'z100', label: '缩放 100%', checked: zoom === 1, onClick: () => S().setZoom(1) },
    { key: 'zfitw', label: '适应宽度', onClick: () => S().setZoom(fitZoom(mode, page, canvas, 'width')) },
    { key: 'zfitp', label: '适应页面', onClick: () => S().setZoom(fitZoom(mode, page, canvas, 'page')) },
    { key: 'v2', separator: true },
    { key: 'theme', label: '深色模式（Monokai）', checked: ui.theme === 'monokai', onClick: () => S().setTheme(ui.theme === 'monokai' ? 'light' : 'monokai') },
    { key: 'v3', separator: true },
    { key: 'tree', label: '显示组件树', checked: ui.showTree, onClick: () => S().toggleUI('showTree') },
    { key: 'preview', label: '预览模式（隐藏编辑态边框）', checked: ui.preview, onClick: () => S().toggleUI('preview') },
  ];

  const modeMenu: MenuEntry[] = [
    { key: 'doc', label: '切换到文档模式', checked: mode === 'document', onClick: () => switchMode('document') },
    { key: 'web', label: '切换到 Web 模式', checked: mode === 'web', onClick: () => switchMode('web') },
    { key: 'm1', separator: true },
    { key: 'note', label: '两套内容分别保留，切换不会互相覆盖', disabled: true },
  ];

  const pageMenu: MenuEntry[] =
    mode === 'document'
      ? [
          ...(Object.keys(PAGE_SIZES) as PageSizeKey[]).map((k) => ({
            key: `size-${k}`,
            label: `纸张 ${k === 'Custom' ? '自定义' : k}${k === 'Custom' ? '' : ` (${PAGE_SIZES[k].width}×${PAGE_SIZES[k].height}mm)`}`,
            checked: page.size === k,
            onClick: () => {
              if (k === 'Custom') {
                const w = Number(window.prompt('纸张宽度（mm）', String(page.width)) ?? page.width);
                const h = Number(window.prompt('纸张高度（mm）', String(page.height)) ?? page.height);
                if (w > 0 && h > 0) S().setPageSizeCustom(w, h);
              } else S().setPageSize(k);
            },
          })),
          { key: 'p1', separator: true },
          { key: 'portrait', label: '纵向', checked: page.orientation === 'portrait', onClick: () => S().setOrientation('portrait') },
          { key: 'landscape', label: '横向', checked: page.orientation === 'landscape', onClick: () => S().setOrientation('landscape') },
          { key: 'p2', separator: true },
          ...MARGIN_PRESETS.map((p) => ({
            key: `margin-${p.value}`,
            label: `页边距 ${p.label}`,
            onClick: () =>
              S().setMargin(
                p.value === 0
                  ? { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 }
                  : { top: p.value, right: p.value, bottom: p.value, left: p.value },
              ),
          })),
        ]
      : [
          ...(Object.keys(DEVICE_PRESETS) as DeviceKey[]).map((k) => ({
            key: `dev-${k}`,
            label: `设备 ${k}${k === 'Custom' ? '' : ` (${DEVICE_PRESETS[k].width}×${DEVICE_PRESETS[k].height})`}`,
            checked: canvas.device === k,
            onClick: () => S().setDevice(k),
          })),
          { key: 'd1', separator: true },
          { key: 'bg-white', label: '画布背景 白色', checked: canvas.background === '#ffffff', onClick: () => S().setCanvasProp('background', '#ffffff') },
          { key: 'bg-gray', label: '画布背景 浅灰', checked: canvas.background === '#f5f5f5', onClick: () => S().setCanvasProp('background', '#f5f5f5') },
          { key: 'bg-dark', label: '画布背景 深色', checked: canvas.background === '#1f1f1f', onClick: () => S().setCanvasProp('background', '#1f1f1f') },
          { key: 'bg-monokai', label: '画布背景 Monokai #272822', checked: canvas.background === '#272822', onClick: () => S().setCanvasProp('background', '#272822') },
        ];

  const helpMenu: MenuEntry[] = [
    { key: 'sc', label: '快捷键说明', onClick: () => setHelpOpen(true) },
    // ★MCP 桥接（规格 §11）：默认不开；开了之后 Claude/Cursor 这类客户端就能驱动这个编辑器
    {
      key: 'mcpbridge',
      label: `MCP 桥接：${bridgeStatusLabel()}`,
      checked: isBridgeEnabled(),
      onClick: () => {
        const on = !isBridgeEnabled();
        setBridgeEnabled(on);
        if (on) {
          window.setTimeout(() => {
            window.alert(
              `MCP 桥接已开启（${bridgeStatus().url}）\n\n` +
                `状态：${bridgeStatusLabel()}\n` +
                '若显示"连接失败"，请先在命令行启动 MCP 服务器：\n' +
                '  cd editor-mcp; node dist/index.js --stdio\n' +
                '（MCP 服务器会同时开一个桥接中转，本页面接进去）',
            );
          }, 800);
        }
      },
    },
    { key: 'diag', label: '诊断信息（日志 / 状态 / 环境）', onClick: () => S().toggleUI('showDiagnostics') },
    {
      key: 'reloadlive',
      label: `重载外部组件（当前 ${getLiveTypes().length} 个）`,
      onClick: () => {
        void loadRuntimeComponents(true).then((r) => {
          S().bumpRegistry();
          window.alert(`外部组件重载：成功 ${r.ok}/${r.total}${r.failed.length ? `，失败：${r.failed.join('、')}` : ''}`);
        });
      },
    },
    { key: 'logdump', label: '下载日志文件', onClick: () => downloadText(`editor-log-${Date.now()}.txt`, log.dump(), 'text/plain') },
    {
      key: 'saverun',
      label: '保存诊断报告到运行目录',
      onClick: () => {
        void saveDiagnosticReportToRunDir().then((r) => {
          if (r.ok) window.alert(`诊断报告已写入运行目录：\n${r.file}\n（${r.bytes} 字节）`);
          else window.alert('没有 /__log 接口（不是启动器托管）：已改为复制到剪贴板 / 下载。');
        });
      },
    },
    {
      key: 'specsheet',
      label: '导出组件与属性说明清单（Markdown）',
      onClick: () => {
        const text = buildComponentSpecSheet();
        void saveToRunDir('docs/组件与属性说明清单.md', text).then((r) => {
          if (r?.ok) {
            window.alert(`组件与属性说明清单已写入运行目录：\n${r.file}\n（${r.bytes} 字节）`);
            log.info('spec', '组件与属性说明清单已导出', { file: r.file, bytes: r.bytes });
          } else {
            downloadText('组件与属性说明清单.md', text, 'text/markdown');
            window.alert(
              r?.error ? `写入运行目录失败（${r.error}），已改为下载。` : '没有 /__save 接口（不是启动器托管）：已改为下载。',
            );
          }
        });
      },
    },
    { key: 'about', label: '关于：布局参照 Qt Designer，双模式可视化编辑器', disabled: true },
  ];

  return (
    <MenuBarShell>
      <span className="mr-2 select-none text-[13px] font-semibold text-primary">可视化编辑器</span>
      <DropdownMenu label="文件" items={fileMenu} />
      <DropdownMenu label="编辑" items={editMenu} />
      <DropdownMenu label="视图" items={viewMenu} />
      <DropdownMenu label="模式" items={modeMenu} />
      <DropdownMenu label="页面" items={pageMenu} />
      <DropdownMenu label="帮助" items={helpMenu} />
      <span className="ml-3 truncate text-2xs text-gray-400">
        {title} · {mode === 'document' ? '文档模式' : 'Web 模式'}
      </span>

      <Modal open={helpOpen} title="快捷键" onClose={() => setHelpOpen(false)}>
        <table className="w-full">
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k} className="border-b border-line/60 last:border-0">
                <td className="w-52 py-1 font-mono text-xs text-primary">{k}</td>
                <td className="py-1">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </MenuBarShell>
  );
}
