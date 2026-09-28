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
import { buildPluginPackage, installPluginPackage, packageFileName, validatePluginPackage, PACKAGE_FORMAT, type PluginPackage } from '../../utils/pluginPackage';
import { exportJsonFile, openJsonFile, saveAsHtmlFile } from './fileActions';
import { toggleFullscreen } from '../../utils/viewActions';
import { bridgeSummary, isBridgeEnabled, setBridgeEnabled, useBridgeSummary, waitBridgeSettled } from '../../mcp/bridgeClient';
import { fitZoom } from '../canvas/fitZoom';
import { desktopApi, formatUpdateResult } from '../../utils/desktopChrome';
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

  /* ── HTML / JSON → 编辑器 ──
     B13 的 UI 入口。**与"把文件拖进窗口"共用 `utils/importDocument`**（`?load=` 也是同一套逻辑的 URL 版），
     这样菜单、拖拽、URL 三条入口的结果文案与统计口径永远一致。 */
  const importHtmlText = (html: string, src: string, baseUrl?: string): void => {
    void import('../../utils/importDocument').then(async (m) => {
      const r = await m.importHtmlIntoEditor(html, src, baseUrl);
      setNotice(`已把 HTML 载入编辑器：${src}\n${r.detail}`);
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
      label: '打开…（.editor.json）',
      shortcut: 'Ctrl+O',
      onClick: () => {
        void openJsonFile().then((msg) => {
          if (msg != null) setNotice(msg);
        });
      },
    },
    { key: 'open-html', label: '打开 HTML（导入成组件）…', onClick: () => void openHtmlFile() },
    { key: 'load-html-url', label: '从 URL 载入 HTML…', onClick: () => void loadHtmlFromUrl() },
    { key: 's1', separator: true },
    {
      /* M-10 + 决策 #12 / Q3：**「保存」= 保存为可独立打开的 HTML 文件**。
         复用已有 `exportHTML()`（含 `@page`），不新造实现；Ctrl+S 也指到这里；
         「保存到浏览器」那个含糊入口去掉（它的老用途——只读态自救——正好由这条承担）。 */
      key: 'save-html',
      label: '保存为 HTML 文件',
      shortcut: 'Ctrl+S',
      onClick: () => setNotice(saveAsHtmlFile()),
    },
    {
      key: 'save-json',
      label: '导出 JSON…（可再编辑的工程文件）',
      shortcut: 'Ctrl+Shift+S',
      onClick: () => setNotice(exportJsonFile()),
    },
    { key: 's2', separator: true },
    {
      key: 'export-sub',
      label: '导出',
      submenu: [
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
        {
          /* M-5：说明清单是**交付物**，原来在「帮助」里不合惯例 → 归到「文件 → 导出」。 */
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
      ],
    },
    {
      /* M-5：组件包是**数据导入导出**，不是"帮助" → 归到「文件」。 */
      key: 'pkg-sub',
      label: '组件包',
      submenu: [
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
          label: '导入组件包（.json，写回组件目录）…',
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
      ],
    },
    { key: 's3', separator: true },
    /* 打印是"另存为 PDF"的通路；P4.5-E2 会在这里再加「导出 PDF【免费】」（桌面版走 printToPDF 真落盘） */
    { key: 'print', label: '打印…', shortcut: 'Ctrl+P', onClick: () => window.print() },
  ];

  const editMenu: MenuEntry[] = [
    { key: 'undo', label: '撤销', shortcut: 'Ctrl+Z', disabled: !canUndo, onClick: () => S().undo() },
    /* M-8：Windows 惯例显示 Ctrl+Y（Ctrl+Shift+Z 也继续支持，两者都真绑上了） */
    { key: 'redo', label: '重做', shortcut: 'Ctrl+Y', disabled: !canRedo, onClick: () => S().redo() },
    { key: 'e1', separator: true },
    /* M-6：Electron 标准 Edit 必备的「剪切」（原来菜单与快捷键都没有） */
    { key: 'cut', label: '剪切', shortcut: 'Ctrl+X', disabled: !selectedIds().length, onClick: () => S().cutSelection() },
    { key: 'copy', label: '复制', shortcut: 'Ctrl+C', disabled: !selectedIds().length, onClick: () => S().copySelection() },
    { key: 'paste', label: '粘贴', shortcut: 'Ctrl+V', onClick: () => S().pasteClipboard() },
    { key: 'dup', label: '原地复制', shortcut: 'Ctrl+D', disabled: !selectedIds().length, onClick: () => selectedIds().forEach((id) => S().duplicateComponent(id)) },
    { key: 'del', label: '删除', shortcut: 'Delete', danger: true, disabled: !selectedIds().length, onClick: () => selectedIds().forEach((id) => S().removeComponent(id)) },
    { key: 'e2', separator: true },
    { key: 'all', label: '全选', shortcut: 'Ctrl+A', disabled: !allIds().length, onClick: () => S().selectComponent(allIds()) },
    /* M-9：文档编辑器的基本盘（长文档 / 表格内容 / Markdown 视图都要） */
    { key: 'find', label: '查找/替换…', shortcut: 'Ctrl+F', onClick: () => S().toggleUI('findOpen') },
    {
      key: 'clear',
      label: '清空当前模式内容',
      danger: true,
      disabled: !forest.length,
      onClick: () => {
        if (window.confirm('清空当前模式的全部组件？（可用 Ctrl+Z 撤销）')) S().clearAll();
      },
    },
    { key: 'e3', separator: true },
    /* M-1：首选项从「视图」移到「编辑」末项（Windows 惯例「工具→选项」或「编辑→首选项」；
       Chrome / VS Code 亦在应用/文件级）。视图菜单从此只管"看什么"，不再混设置。 */
    { key: 'prefs', label: '首选项…', shortcut: 'Ctrl+,', onClick: () => S().toggleUI('prefsOpen') },
  ];

  const viewMenu: MenuEntry[] = [
    /* M-12：模式切换（Ctrl+Shift+M）原来只有快捷键、没有菜单入口 → 补「视图 → 模式」，并标出当前模式。
       ★与 §7.3 写法的一处偏差：那里写「模式（文档/Web/PPT）」，但**编辑器实际只有两种模式**
       （`EditorMode = 'document' | 'web'`）；PPT 是"两种模式都能用的组件类别"（MCP 的 mode.list 也这么解释）。
       所以这里只列两个 → 免得菜单给出一个点了没用的入口。 */
    {
      key: 'mode-sub',
      label: '模式',
      submenu: [
        { key: 'mode-document', label: '文档模式（A4 纸张 + 文档流）', shortcut: 'Ctrl+Shift+M', checked: mode === 'document', onClick: () => S().setMode('document') },
        { key: 'mode-web', label: 'Web 模式（设备画布）', shortcut: 'Ctrl+Shift+M', checked: mode === 'web', onClick: () => S().setMode('web') },
      ],
    },
    { key: 'v0', separator: true },
    { key: 'grid', label: '显示网格', checked: ui.showGrid, onClick: () => S().toggleUI('showGrid') },
    { key: 'ruler', label: '显示标尺', checked: ui.showRuler, onClick: () => S().toggleUI('showRuler') },
    { key: 'guides', label: '显示辅助线', checked: ui.showGuides, onClick: () => S().toggleUI('showGuides') },
    { key: 'snap', label: '对齐吸附', checked: ui.snap, onClick: () => S().toggleUI('snap') },
    { key: 'v1', separator: true },
    /* M-7：缩放收进子菜单并**标出快捷键**（原来菜单不标，用户不知道 Ctrl+=/-/0 存在） */
    {
      key: 'zoom-sub',
      label: `缩放（当前 ${Math.round(zoom * 100)}%）`,
      submenu: [
        { key: 'zin', label: '放大', shortcut: 'Ctrl+=', onClick: () => S().setZoom(S().zoom + 0.1) },
        { key: 'zout', label: '缩小', shortcut: 'Ctrl+-', onClick: () => S().setZoom(S().zoom - 0.1) },
        { key: 'z100', label: '实际大小 100%', shortcut: 'Ctrl+0', checked: zoom === 1, onClick: () => S().setZoom(1) },
        { key: 'z50', label: '50%', checked: zoom === 0.5, onClick: () => S().setZoom(0.5) },
        { key: 'z75', label: '75%', checked: zoom === 0.75, onClick: () => S().setZoom(0.75) },
        { key: 'zfitw', label: '适应宽度', onClick: () => S().setZoom(fitZoom(mode, page, canvas, 'width')) },
        { key: 'zfitp', label: '适应页面', onClick: () => S().setZoom(fitZoom(mode, page, canvas, 'page')) },
      ],
    },
    /* M-7：Electron 标准 View 的 togglefullscreen；桌面版走窗口全屏（见 utils/viewActions.ts） */
    { key: 'fullscreen', label: '全屏', shortcut: 'F11', onClick: () => void toggleFullscreen() },
    { key: 'v2', separator: true },
    /* ★主题切换只留在「首选项 → 外观 → 界面主题」（用户 2026-09-24：视图菜单里不要重复一个深色模式） */
    { key: 'tree', label: '显示组件树', checked: ui.showTree, onClick: () => S().toggleUI('showTree') },
    { key: 'md', label: 'Markdown 源码', checked: ui.showMarkdown, onClick: () => S().toggleUI('showMarkdown') },
    /* M-2：「图表按章编号」改的是**输出内容**（图 X-Y / 表 X-Y），不是显示 → 移到「页面」菜单 */
    { key: 'preview', label: '预览模式（隐藏编辑态边框）', checked: ui.preview, onClick: () => S().toggleUI('preview') },
  ];

  const pageMenu: MenuEntry[] =
    mode === 'document'
      ? [
          /* M-13：同一菜单在两种模式下内容不同是合理的（已按模式分派），但要让用户一眼看出现在是哪套 */
          { key: 'pmode', label: '当前：文档模式（纸张 / 方向 / 页边距 / 编号）', disabled: true },
          { key: 'pm0', separator: true },
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
          { key: 'p3', separator: true },
          /* M-2：从「视图」移来 —— 它改的是**输出内容**（图 X-Y / 表 X-Y），与纸张/页边距同属"页面的产出" */
          { key: 'autonum', label: '图表按章编号（图 X-Y / 表 X-Y）', checked: ui.autoNumber, onClick: () => S().toggleUI('autoNumber') },
        ]
      : [
          { key: 'pmode', label: '当前：Web 模式（设备画布 / 背景色）', disabled: true },
          { key: 'pm0', separator: true },
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

  /* ── 桌面版（Electron）专属菜单：惯例放在「页面」与「帮助」之间，叫「工具」──
     桌面版没有原生菜单栏（无边框窗口把标题栏与菜单栏都去掉了，系统按钮画在网页右上角），
     所以"检查更新 / MCP 服务 / 日志目录"这些**应用级**动作放在这里；浏览器里这个菜单不出现
     （`window.desktop` 不存在）—— 也就是说网页版的行为完全没变。 */
  const ds = desktopApi();
  const desktopMenu: MenuEntry[] = ds
    ? [
        {
          key: 'd-mcp-url',
          label: '复制 MCP 地址（给外部 AI 客户端）',
          onClick: () => {
            void ds.copyMcpUrl().then((url) => setNotice(url ? `已复制到剪贴板：\n${url}\n\n把它填进支持 Streamable HTTP 的 MCP 客户端即可。` : 'MCP 没启动：配置里 mcp.enabled=false 或启动失败（「MCP 服务状态」可看原因）。'));
          },
        },
        {
          // P0 决策 #1/#4：MCP 现在**强制校验 token**，只复制地址不够用 —— 这一项复制的配置里
          // 带 `headers.Authorization`，粘进其它 AI 客户端即可（我们**不会**替别的应用写配置）。
          key: 'd-mcp-config',
          label: '复制 MCP 客户端配置（含 token）',
          onClick: () => {
            void ds.copyMcpConfig().then((text: string | null) =>
              setNotice(
                text
                  ? `已复制到剪贴板（含 Authorization 头）：\n${text}\n\n注意：token 等同密码，别发到不可信的地方；重置方式见「MCP 服务状态」。`
                  : 'MCP 没启动或还没生成 token：先看「MCP 服务状态」。',
              ),
            );
          },
        },
        {
          key: 'd-mcp-status',
          label: 'MCP 服务状态（现场握手探测）',
          onClick: () => {
            void Promise.all([ds.getStatus(), ds.probeMcp()]).then(([s, p]) => {
              const m = s.mcp;
              setNotice(
                [
                  `运行状态：${m ? `${m.state}${m.external ? '（接管了外部已在跑的进程）' : ''}` : '(未启动)'}`,
                  `进程号：${m?.pid ?? '(不是本应用拉起的)'}`,
                  `地址：${m?.url ?? '-'}`,
                  `桥接中转：${m?.bridgeUrl ?? '-'}`,
                  `自动重启次数：${m?.restarts ?? 0}`,
                  `握手探测：${p?.ok ? `通过（${p.serverInfo?.name ?? '?'} ${p.serverInfo?.version ?? ''}，协议 ${p.protocolVersion ?? '?'}）` : `未通过（${p?.error ?? '无响应'}）`}`,
                  m?.lastError ? `最近错误：${m.lastError}` : '',
                ]
                  .filter(Boolean)
                  .join('\n'),
              );
            });
          },
        },
        {
          key: 'd-mcp-restart',
          label: '重启 MCP 服务',
          onClick: () => {
            void ds.restartMcp().then((st) => setNotice(st ? `已重启：${st.state}\n${st.url}${st.lastError ? `\n错误：${st.lastError}` : ''}` : 'MCP 未启用。'));
          },
        },
        { key: 'd2', separator: true },
        { key: 'd-logdir', label: '打开日志目录', onClick: () => void ds.openLogDir().then((r) => setNotice(`日志目录：\n${r.path ?? '-'}${r.error ? `\n（打开失败：${r.error}）` : ''}`)) },
        { key: 'd-datadir', label: '打开数据目录（文档 / 组件）', onClick: () => void ds.openDataDir().then((r) => setNotice(`数据目录：\n${r.path ?? '-'}${r.error ? `\n（打开失败：${r.error}）` : ''}`)) },
        { key: 'd-confdir', label: '打开配置目录（加密配置）', onClick: () => void ds.openConfigDir().then((r) => setNotice(`配置目录：\n${r.path ?? '-'}${r.error ? `\n（打开失败：${r.error}）` : ''}`)) },
      ]
    : [];

  /**
   * 「工具」菜单 —— **两种环境都有**（用户 2026-09-28：MCP 桥接项从「帮助」移到「工具」）：
   *   · 浏览器里只有 MCP 桥接这一项（原来在 帮助 菜单，属于"把编辑器接到外部服务器"的运维动作，
   *     和"查日志/看快捷键"不是一类，移到工具更合惯例）；
   *   · 桌面版里这一项后面再接上应用级动作（检查更新 / MCP 服务 / 目录 / 关于）。
   */
  const toolsMenu: MenuEntry[] = [
    // ★MCP 桥接（规格 §11）：默认不开，但启动时若探测到本机 MCP 会自动接入（见 mcp/bridgeClient.ts）
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
              '  1) 起 MCP 服务器（它会在 37650 起桥接中转 hub）。桌面版由应用自己起，不用手敲；\n' +
              '     命令行起法（stdio）：cd E:\\可视化编辑器\\editor-mcp; node dist\\index.js --stdio\n' +
              '  2) 若 37650 被别的实例占用，换端口：地址栏加\n' +
              '     ?bridge=1&bridgeUrl=ws://127.0.0.1:37652/bridge（并给 MCP 加 EDITOR_MCP_BRIDGE_URL 指到同一端口）\n' +
              '  3) 「帮助 → 诊断信息」里有桥接日志与最近错误。',
          );
        });
      },
    },
    ...(ds
      ? ([{ key: 't-sep', separator: true }, ...desktopMenu] as MenuEntry[])
      : []),
  ];

  const helpMenu: MenuEntry[] = [
    { key: 'sc', label: '快捷键说明', onClick: () => setHelpOpen(true) },
    { key: 'diag', label: '诊断信息（日志 / 状态 / 环境）', onClick: () => S().toggleUI('showDiagnostics') },
    /* ★「重载外部组件」收进首选项（用户 2026-09-24）：帮助菜单与组件箱底部都不再放，
       入口统一在「首选项 → 组件箱 → 重载外部组件」。 */
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
    /* M-4：检查更新 / 下载页从前面的「工具」移来 —— 与「关于」相邻更符合惯例（Chrome / VS Code 都在帮助）。
       组件包与说明清单（M-5）已移到「文件」；这里的帮助菜单只留"查资料 / 排故障 / 版本"三类。 */
    ...(ds
      ? ([
          { key: 'h1', separator: true },
          {
            key: 'd-update',
            label: '检查更新…',
            onClick: () => {
              void ds.checkUpdate().then((r) => setNotice(formatUpdateResult(r)));
            },
          },
          {
            key: 'd-download',
            label: '打开更新下载页',
            onClick: () => {
              void ds.openDownload().then((r) => setNotice(r.ok ? `已在系统浏览器里打开：\n${r.url}` : `打不开下载页：\n${r.error ?? '当前没有可用的下载地址（先点「检查更新…」）'}`));
            },
          },
        ] as MenuEntry[])
      : []),
    { key: 'h2', separator: true },
    {
      /* M-3：**关于只留这一处**（原来「工具」里一个 + 帮助底部一行 disabled 文案）。
         桌面版给全量运行环境 + 配置来源；网页版给一句话（含版本与构建时间口径一致的信息）。 */
      key: 'about',
      label: '关于（版本 / 运行环境 / 许可）',
      onClick: () => {
        if (!ds) {
          setNotice(
            [
              `可视化编辑器 —— By Sxdok`,
              `（网页版：${location.origin}${location.pathname}）`,
              `布局参照 Qt Designer，双模式可视化编辑器。`,
              `\n许可与授权状态在桌面版「帮助 → 关于」里显示。`,
            ].join('\n'),
          );
          return;
        }
        void ds.getStatus().then((s) => {
          setNotice(
            [
              `可视化编辑器 ${s.version} —— By Sxdok\n（桌面版 · ${s.mode === 'packaged' ? '已安装' : '开发模式'}）`,
              `Electron ${s.electron} / Chromium ${s.chrome} / Node ${s.node}`,
              `页面地址：${s.server?.url ?? '(未启动)'}`,
              `MCP 地址：${s.mcpUrl ?? '(未启动)'}`,
              `写入开关：${s.mcpWriteEnabled === true ? '允许（首选项可关）' : '已禁用（默认）'}`,
              `日志目录：${s.logDir ?? '-'}`,
              `配置来源：${s.config?.meta.source ?? '-'}（密钥：${s.config?.meta.keySource ?? '-'}）`,
              s.config?.meta.warnings?.length ? `\n配置提醒：\n${s.config.meta.warnings.join('\n')}` : '',
              s.config?.meta.problems?.length ? `\n配置问题：\n${s.config.meta.problems.join('\n')}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          );
        });
      },
    },
  ];

  return (
    <MenuBarShell desktop={ds != null}>
      <span className="mr-2 select-none text-[13px] font-semibold text-primary">可视化编辑器</span>
      <DropdownMenu label="文件" items={fileMenu} />
      <DropdownMenu label="编辑" items={editMenu} />
      <DropdownMenu label="视图" items={viewMenu} />
      <DropdownMenu label="页面" items={pageMenu} />
      <DropdownMenu label="工具" items={toolsMenu} />
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
