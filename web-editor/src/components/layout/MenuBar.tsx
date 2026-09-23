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
import { flatten, getForest } from '../../store/treeUtils';
import { downloadText, pickTextFile, saveToRunDir } from '../../utils/download';
import { log } from '../../utils/logger';
import { saveDiagnosticReportToRunDir } from '../../utils/diagnostics';
import { buildComponentSpecSheet } from '../../utils/specSheet';
import { getLiveTypes, loadRuntimeComponents } from '../../registry/live';
import {
  buildPluginPackage,
  installPluginPackage,
  packageFileName,
  validatePluginPackage,
  PACKAGE_FORMAT,
  type PluginPackage,
} from '../../utils/pluginPackage';
import { bridgeSummary, isBridgeEnabled, setBridgeEnabled, useBridgeSummary, waitBridgeSettled } from '../../mcp/bridgeClient';
import { fitZoom } from '../canvas/fitZoom';
import { DropdownMenu, MenuBarShell, type MenuEntry } from '../ui/Menu';
import { Modal, SHORTCUTS } from '../ui/Modal';

const MARGIN_PRESETS: { label: string; value: number }[] = [
  { label: '常规 上下25.4 / 左右31.7mm', value: 0 },
  { label: '窄 四边12.7mm', value: 12.7 },
  { label: '适中 四边19.05mm', value: 19.05 },
  { label: '宽 四边31.7mm', value: 31.7 },
];

export function MenuBar() {
  const [helpOpen, setHelpOpen] = useState(false);
  /** 结果提示（组件包导入/导出、HTML 导入）——用弹窗展示，而不是 window.alert，便于逐条看 */
  const [notice, setNotice] = useState<string | null>(null);
  const mode = useEditorStore(selectMode);
  const forest = useEditorStore(selectForest);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const ui = useEditorStore((s) => s.ui);
  const zoom = useEditorStore((s) => s.zoom);
  const title = useEditorStore((s) => s.doc.title);
  const page = useEditorStore((s) => s.doc.document.page);
  const canvas = useEditorStore((s) => s.doc.web.canvas);
  /** MCP 桥接状态：**订阅**着（状态一变菜单就跟着变），并区分"没开启"与"开了但没连上" */
  const bridge = useBridgeSummary();

  const S = () => useEditorStore.getState();

  const selectedIds = () => S().doc.selectedIds;
  const allIds = () => flatten(forest).map((f) => f.node.id);

  /* ── HTML → 编辑器（B13 的 UI 入口：`?load=` 是同一套逻辑的 URL 版）── */
  const showImportResult = (src: string, r: { mode: string; stats: { top: number; total: number; typed: number; guessed: number; skipped: number }; warnings: string[] }, title2: string): void => {
    setNotice(
      `已把 HTML 载入编辑器：${src}\n` +
        `文档标题：${title2}\n` +
        `识别模式：${r.mode === 'document' ? '文档模式' : 'Web 模式'}\n` +
        `顶层组件 ${r.stats.top} 个 / 含子节点共 ${r.stats.total} 个\n` +
        `（按 data-node-type 精确识别 ${r.stats.typed} 个、按标签识别 ${r.stats.guessed} 个、跳过 ${r.stats.skipped} 个）` +
        (r.warnings.length ? `\n\n提示：\n${r.warnings.slice(0, 8).map((w) => `· ${w}`).join('\n')}` : ''),
    );
  };
  const importHtmlText = (html: string, src: string, baseUrl?: string): void => {
    void import('../../utils/htmlImport').then((m) => {
      const { doc, result } = m.importHtmlToDocument(html, {
        title: src.split(/[\\/]/).pop()?.replace(/\.html?$/i, ''),
        baseUrl,
      });
      S().loadDocument(doc);
      log.info('load', 'HTML 已载入编辑器', { 来源: src, 模式: result.mode, 节点: result.stats });
      showImportResult(src, result, doc.title);
    });
  };
  const openHtmlFile = async (): Promise<void> => {
    const text = await pickTextFile('.html,.htm,text/html');
    if (text == null) return;
    importHtmlText(text, '（本地文件）');
  };
  const loadHtmlFromUrl = async (): Promise<void> => {
    const url = window.prompt('HTML 地址（http(s):// 或站内相对路径，如 /组件/示例.html）', location.origin + '/');
    if (!url) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      importHtmlText(await res.text(), url, url);
    } catch (e) {
      setNotice(`载入失败：${url}\n${e instanceof Error ? e.message : String(e)}\n\n（跨域地址需要对方允许 CORS；本工程自己的页面/导出物没有这个限制）`);
    }
  };

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
    { key: 'open-html', label: '打开 HTML（导入成组件）…', onClick: () => void openHtmlFile() },
    { key: 'load-html-url', label: '从 URL 载入 HTML…', onClick: () => void loadHtmlFromUrl() },
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
      key: 'docx',
      label: '导出 Word（.docx）',
      onClick: () => {
        void import('../../utils/export/docx').then((m) => {
          const r = m.downloadDocx(S().doc, getForest(S().doc));
          log.info('export', '导出 .docx', { 字节: r.bytes.length, 块数: r.blocks, 提示: r.warnings.length });
        });
      },
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
    { key: 'prefs', label: '首选项…', onClick: () => S().toggleUI('prefsOpen') },
    { key: 'v0', separator: true },
    { key: 'grid', label: '显示网格', checked: ui.showGrid, onClick: () => S().toggleUI('showGrid') },
    { key: 'ruler', label: '显示标尺', checked: ui.showRuler, onClick: () => S().toggleUI('showRuler') },
    { key: 'guides', label: '显示辅助线', checked: ui.showGuides, onClick: () => S().toggleUI('showGuides') },
    { key: 'snap', label: '对齐吸附', checked: ui.snap, onClick: () => S().toggleUI('snap') },
    { key: 'v1', separator: true },
    { key: 'z50', label: '缩放 50%', onClick: () => S().setZoom(0.5) },
    { key: 'z75', label: '缩放 75%', onClick: () => S().setZoom(0.75) },
    { key: 'z100', label: '缩放 100%', checked: zoom === 1, onClick: () => S().setZoom(1) },
    { key: 'zfitw', label: '适应宽度', onClick: () => S().setZoom(fitZoom(mode, page, canvas, 'width')) },
    { key: 'zfitp', label: '适应页面', onClick: () => S().setZoom(fitZoom(mode, page, canvas, 'page')) },
    { key: 'v2', separator: true },
    /* ★主题切换只留在「首选项 → 外观 → 界面主题」（用户 2026-09-24：视图菜单里不要重复一个深色模式） */
    { key: 'tree', label: '显示组件树', checked: ui.showTree, onClick: () => S().toggleUI('showTree') },
    { key: 'md', label: 'Markdown 源码', checked: ui.showMarkdown, onClick: () => S().toggleUI('showMarkdown') },
    { key: 'autonum', label: '图表按章编号（图 X-Y / 表 X-Y）', checked: ui.autoNumber, onClick: () => S().toggleUI('autoNumber') },
    { key: 'preview', label: '预览模式（隐藏编辑态边框）', checked: ui.preview, onClick: () => S().toggleUI('preview') },
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
    // ★MCP 桥接（规格 §11）：默认不开；开了之后 MCP 客户端就能驱动这个编辑器
    {
      key: 'mcpbridge',
      label: `MCP 桥接：${bridge.label}`,
      checked: bridge.on,
      onClick: () => {
        const on = !isBridgeEnabled();
        setBridgeEnabled(on);
        if (!on) return;
        /**
         * ★别再"抢着说成功"（用户 2026-09-24：弹窗说已开启，菜单里还是未开启）：
         *   等状态**落定**再报 —— 连上报已连接，没连上就把真实原因和排查办法说清楚。
         */
        void waitBridgeSettled(2500).then((settled) => {
          const s = bridgeSummary();
          if (settled === 'connected') {
            window.alert(`MCP 桥接已连接：${s.detail || s.label}`);
            return;
          }
          window.alert(
            `MCP 桥接还没连上（菜单里会实时显示状态）\n\n` +
              `当前：${s.label}\n` +
              `${s.detail ? `详情：${s.detail}\n` : ''}\n` +
              '排查顺序：\n' +
              '  1) 命令行启动 MCP 服务器（它会在 37650 起桥接中转 hub）：\n' +
              '     cd E:\\可视化编辑器\\editor-mcp; node dist\\index.js --stdio\n' +
              '  2) 若 37650 被别的实例占用，换端口：地址栏加\n' +
              '     ?bridge=1&bridgeUrl=ws://127.0.0.1:37652/bridge（并给 MCP 加 EDITOR_MCP_BRIDGE_URL 指到同一端口）\n' +
              '  3) 「帮助 → 诊断信息」里有桥接日志与最近错误。',
          );
        });
      },
    },
    { key: 'diag', label: '诊断信息（日志 / 状态 / 环境）', onClick: () => S().toggleUI('showDiagnostics') },
    /* ★「重载外部组件」收进首选项（用户 2026-09-24）：帮助菜单与组件箱底部都不再放，
       入口统一在「首选项 → 组件箱 → 重载外部组件」。 */
    { key: 'logdump', label: '下载日志文件', onClick: () => downloadText(`editor-log-${Date.now()}.txt`, log.dump(), 'text/plain') },
    /* ── 组件包（B14）：把 public/组件/*.js 打包导出 / 导入写回组件目录 ── */
    {
      key: 'pkg-export',
      label: `导出组件包（当前 ${getLiveTypes().length} 个外部组件）`,
      disabled: getLiveTypes().length === 0,
      onClick: () => {
        void buildPluginPackage().then(({ pkg, errors }) => {
          downloadText(packageFileName(), JSON.stringify(pkg, null, 2), 'application/json');
          setNotice(
            `已导出 ${pkg.plugins.length} 个组件的源码：\n${pkg.plugins.map((p) => `· ${p.name}（${p.code.length} 字符）`).join('\n')}` +
              (errors.length ? `\n\n读取失败 ${errors.length} 个：${errors.map((e) => `${e.name}（${e.error}）`).join('、')}` : ''),
          );
        });
      },
    },
    {
      key: 'pkg-import',
      label: '导入组件包（.json，写回组件目录）',
      onClick: () => {
        void pickTextFile('.json,application/json').then(async (text) => {
          if (text == null) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch (e) {
            setNotice(`不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
            return;
          }
          const check = validatePluginPackage(parsed);
          if (!check.ok) {
            setNotice(`组件包未通过校验，已整包拒收：\n${check.errors.map((e) => `· ${e}`).join('\n')}`);
            return;
          }
          const r = await installPluginPackage(parsed as PluginPackage);
          const reload = await loadRuntimeComponents(true);
          S().bumpRegistry();
          setNotice(
            `组件包导入完成：写回组件目录 ${r.saved.length} 个` +
              (r.runtime.length ? `、仅本次会话注册 ${r.runtime.length} 个` : '') +
              (r.failed.length ? `、失败 ${r.failed.length} 个（${r.failed.map((f) => `${f.name}：${f.error}`).join('；')}）` : '') +
              `\n重新加载外部组件：${reload.ok}/${reload.total}` +
              (r.persisted ? '\n（已写盘，刷新后仍在）' : '\n（启动器没有 /__savePlugin 接口，或写盘失败 → 只在本会话生效，刷新会丢）'),
          );
        });
      },
    },
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

      {/* 组件包导入 / 导出结果（B14） */}
      <Modal open={notice != null} title="提示" onClose={() => setNotice(null)} width={620}>
        <pre data-notice-msg="1" className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-gray-700">
          {notice ?? ''}
        </pre>
        <p className="mt-3 text-2xs text-gray-400">
          包格式：<code>{PACKAGE_FORMAT}</code> · 导入会把 <code>.js</code> 逐个写回组件目录（启动器
          <code>/__savePlugin</code>），没有该接口时退化为"仅本次会话注册"。
        </p>
      </Modal>
    </MenuBarShell>
  );
}
