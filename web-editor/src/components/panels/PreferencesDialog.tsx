/**
 * 职责：**首选项**（视图 → 首选项…）—— 编辑器自己的各项设置集中在这一个弹窗里。
 *
 * 设计：所有设置都读写 `store.ui`（已经随 ui 持久化，刷新后保持），所以这里只做"列表 + 开关/选择"，
 * 不引入第二套配置状态；底部提供「恢复默认设置」。
 *
 * 每一项都带 `data-pref="<key>"` 与 `data-pref-value`，便于自检逐项核对。
 */
import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useEditorStore, type UIState } from '../../store/editorStore';
import { PERSIST_KEY } from '../../store/persistStorage';
import { getLiveTypes, loadRuntimeComponents } from '../../registry/live';
import { useBridgeSummary } from '../../mcp/bridgeClient';
import { Modal } from '../ui/Modal';
import { SwitchControl } from '../property-controls/SwitchControl';
import type { PropSchemaItem } from '../../registry/types';

const FAKE_ITEM: PropSchemaItem = { key: 'pref', label: '', control: 'switch', group: '', defaultValue: false };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[12px] font-semibold text-gray-700">{title}</span>
        {hint && <span className="text-2xs text-gray-400">{hint}</span>}
      </div>
      <div className="rounded-md border border-line bg-gray-50 px-2 py-1">{children}</div>
    </div>
  );
}

function PrefSwitch({
  prefKey,
  label,
  hint,
  value,
  onChange,
}: {
  prefKey: string;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1" data-pref={prefKey} data-pref-value={value ? '1' : '0'}>
      <span className="min-w-0 flex-1 text-[12.5px] text-gray-700">
        {label}
        {hint && <span className="ml-1.5 text-2xs text-gray-400" data-pref-hint="1">{hint}</span>}
      </span>
      <SwitchControl item={FAKE_ITEM} value={value} onChange={(v) => onChange(v === true)} />
    </div>
  );
}

function PrefSelect<T extends string>({
  prefKey,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  prefKey: string;
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1" data-pref={prefKey} data-pref-value={value}>
      <span className="min-w-0 flex-1 text-[12.5px] text-gray-700">
        {label}
        {hint && <span className="ml-1.5 text-2xs text-gray-400">{hint}</span>}
      </span>
      <select
        data-pref-select={prefKey}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-6 rounded border border-line bg-white px-1 text-2xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 默认值（与 store 里的 initialUI 一致；「恢复默认设置」按这份还原） */
const DEFAULTS: Pick<
  UIState,
  'showGrid' | 'showRuler' | 'showGuides' | 'snap' | 'fitWhenNarrow' | 'preview' | 'showTree' | 'compPreview' | 'autoNumber' | 'autoBridge' | 'autoSave' | 'theme' | 'leftWidth' | 'rightWidth'
> = {
  showGrid: false,
  showRuler: true,
  showGuides: true,
  snap: true,
  fitWhenNarrow: true,
  preview: false,
  showTree: false,
  compPreview: false,
  autoNumber: false,
  autoBridge: false,
  autoSave: false,
  theme: 'light',
  leftWidth: 240,
  rightWidth: 300,
};

export function PreferencesDialog() {
  const ui = useEditorStore((s) => s.ui);
  const toggleUI = useEditorStore((s) => s.toggleUI);
  const setCompPreview = useEditorStore((s) => s.setCompPreview);
  const setTheme = useEditorStore((s) => s.setTheme);
  const setPanelWidth = useEditorStore((s) => s.setPanelWidth);
  const setState = useEditorStore.setState;
  /** 「重载外部组件」（收进首选项的那个入口）的状态 */
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState('');
  /** MCP 桥接只读状态（订阅着，状态一变这里就跟着变） */
  const bridge = useBridgeSummary();

  const close = useMemo(() => () => toggleUI('prefsOpen'), [toggleUI]);
  /** 当前存档大小（只读展示；随手一读 localStorage，不订阅任何东西） */
  const savedSize = (() => {
    try {
      const raw = window.localStorage.getItem(PERSIST_KEY) ?? '';
      return raw.length >= 1024 ? `${Math.round(raw.length / 1024)}KB` : `${raw.length} 字节`;
    } catch {
      return '读不到';
    }
  })();
  const restore = (): void => {
    setState((s) => ({
      ui: { ...s.ui, ...DEFAULTS, propClosed: { groups: {}, drawers: {} } },
    }));
  };

  return (
    <Modal open={ui.prefsOpen === true} title="首选项" onClose={close} width={620}>
      <Section title="组件箱" hint="左侧组件面板">
        <PrefSwitch
          prefKey="compPreview"
          label="显示组件缩略图"
          hint="关 = 紧凑两列（默认）；开 = 每张卡片真渲染一份预览"
          value={ui.compPreview === true}
          onChange={setCompPreview}
        />
        <PrefSwitch prefKey="showTree" label="显示组件树" value={ui.showTree === true} onChange={() => toggleUI('showTree')} />
        {/* ★外部组件重载入口（用户 2026-09-24：从「帮助」菜单与组件箱底部收进首选项，只留这一个入口） */}
        <div className="flex items-center gap-2 py-1" data-pref="reloadLive" data-pref-value={String(getLiveTypes().length)}>
          <span className="w-32 shrink-0 text-[12px] text-gray-600">重载外部组件</span>
          <span className="min-w-0 flex-1 truncate text-2xs text-gray-400" data-pref-hint="1">
            {`改完 public/组件/*.js 点这里重新加载，不用重新构建；当前 ${getLiveTypes().length} 个`}
          </span>
          <button
            type="button"
            data-reload-live="1"
            disabled={reloading}
            onClick={() => {
              setReloading(true);
              void loadRuntimeComponents(true)
                .then((r) => {
                  useEditorStore.getState().bumpRegistry();
                  setReloadMsg(
                    r.failed.length
                      ? `成功 ${r.ok} 个，失败 ${r.failed.length} 个：${r.failed.join('、')}（详情见 帮助 → 诊断信息）`
                      : `已重载 ${getLiveTypes().length} 个（${r.source}）`,
                  );
                })
                .finally(() => setReloading(false));
            }}
            className="flex-none whitespace-nowrap rounded border border-line px-2 py-1 text-2xs hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {reloading ? '重载中…' : '重载'}
          </button>
        </div>
        {reloadMsg && (
          <p className="py-0.5 text-2xs text-gray-400" data-reload-msg="1">
            {reloadMsg}
          </p>
        )}
      </Section>

      <Section title="画布" hint="只影响编辑时的显示，不影响导出与打印">
        <PrefSwitch prefKey="showGrid" label="显示网格" value={ui.showGrid === true} onChange={() => toggleUI('showGrid')} />
        <PrefSwitch prefKey="showRuler" label="显示标尺" value={ui.showRuler === true} onChange={() => toggleUI('showRuler')} />
        <PrefSwitch prefKey="showGuides" label="显示辅助线" value={ui.showGuides === true} onChange={() => toggleUI('showGuides')} />
        <PrefSwitch prefKey="snap" label="对齐吸附" value={ui.snap === true} onChange={() => toggleUI('snap')} />
        {/* ★用户 2026-09-24：「浏览器调整尺寸又触发画布位置偏移」= 视口比纸窄时纸张贴到左边缘、不再居中 */}
        <PrefSwitch
          prefKey="fitWhenNarrow"
          label="窗口放不下时自动缩小"
          hint="文档模式：视口比纸张窄时预览自动缩到放得下（纸张始终居中，不贴左边缘；导出/打印不受影响）"
          value={ui.fitWhenNarrow !== false}
          onChange={() => toggleUI('fitWhenNarrow')}
        />
        <PrefSwitch
          prefKey="preview"
          label="预览模式"
          hint="隐藏选中框、手柄等编辑态装饰"
          value={ui.preview === true}
          onChange={() => toggleUI('preview')}
        />
      </Section>

      <Section title="文档">
        <PrefSwitch
          prefKey="autoNumber"
          label="图表按章编号"
          hint="图 X-Y / 表 X-Y（章号 = 一级标题序号）"
          value={ui.autoNumber === true}
          onChange={() => toggleUI('autoNumber')}
        />
      </Section>

      {/* ★保存到浏览器（用户 2026-09-24：「浏览器不要默认保存做的文件，刷新一下就应该打开一个全新的文档」） */}
      <Section title="保存" hint="做的文件要不要留在浏览器里">
        <PrefSwitch
          prefKey="autoSave"
          label="保存到浏览器"
          hint="关 = 刷新后是全新文档（默认）；开 = 刷新后接着编上次那份"
          value={ui.autoSave === true}
          onChange={() => toggleUI('autoSave')}
        />
        {/* 只读信息行：存档落在哪、现在多大、上限多少（都是可核对的实数，不是"大概"） */}
        <div className="flex items-center gap-2 py-1" data-pref="saveStatus" data-pref-value={ui.autoSave === true ? 'on' : 'off'}>
          <span className="w-32 shrink-0 text-[12px] text-gray-600">存储位置</span>
          <span className="min-w-0 flex-1 truncate text-2xs text-gray-400" data-save-status="1">
            {`localStorage['${PERSIST_KEY}']（约 5MB 上限）· ${
              ui.autoSave === true ? `已存 ${savedSize}，随编辑自动写入` : '当前只存设置，正文不写入'
            }`}
          </span>
          <span className="flex-none text-2xs text-gray-400">交付请用 文件 → 导出</span>
        </div>
      </Section>

      <Section title="MCP 桥接" hint="把编辑器接到本机的 MCP 服务器（Live 联动）">
        <PrefSwitch
          prefKey="autoBridge"
          label="启动时自动连接"
          hint="开 = 每次打开编辑器就自动连 ws://127.0.0.1:37650/bridge（默认关）"
          value={ui.autoBridge === true}
          onChange={() => toggleUI('autoBridge')}
        />
        {/* 只读状态：**不放第二个"连接/断开"按钮**（用户 2026-09-24 要求入口收敛，那个开关在 帮助 → MCP 桥接） */}
        <div className="flex items-center gap-2 py-1" data-pref="bridgeStatus" data-pref-value={bridge.state}>
          <span className="w-32 shrink-0 text-[12px] text-gray-600">当前状态</span>
          <span className="min-w-0 flex-1 truncate text-2xs text-gray-400" data-bridge-summary="1">
            {bridge.label}
            {bridge.detail ? ` · ${bridge.detail}` : ''}
          </span>
          <span className="flex-none text-2xs text-gray-400">连接开关在 帮助 → MCP 桥接</span>
        </div>
      </Section>

      <Section title="外观">
        <PrefSelect
          prefKey="theme"
          label="界面主题"
          value={ui.theme === 'monokai' ? 'monokai' : 'light'}
          options={[
            { value: 'light', label: '浅色' },
            { value: 'monokai', label: '深色（Monokai）' },
          ]}
          onChange={(v) => setTheme(v)}
        />
      </Section>

      <Section title="面板">
        <div className="flex items-center gap-2 py-1" data-pref="panelWidths" data-pref-value={`${ui.leftWidth ?? 240}/${ui.rightWidth ?? 300}`}>
          <span className="min-w-0 flex-1 text-[12.5px] text-gray-700">
            面板宽度
            <span className="ml-1.5 text-2xs text-gray-400">左 240 / 右 300 是默认（也可以直接拖面板之间的分隔线）</span>
          </span>
          <span className="font-mono text-2xs text-gray-500">
            {ui.leftWidth ?? 240} / {ui.rightWidth ?? 300} px
          </span>
          <button
            type="button"
            data-pref-reset-widths="1"
            className="h-6 rounded border border-line px-2 text-2xs text-gray-600 hover:border-primary hover:text-primary"
            onClick={() => {
              setPanelWidth('left', DEFAULTS.leftWidth);
              setPanelWidth('right', DEFAULTS.rightWidth);
            }}
          >
            恢复默认宽度
          </button>
        </div>
      </Section>

      <div className="flex items-center gap-2 border-t border-line pt-2">
        <button
          type="button"
          data-pref-restore="1"
          onClick={restore}
          className="flex h-7 items-center gap-1 rounded bg-primary px-2.5 text-xs text-white hover:bg-primary-hover"
        >
          <RotateCcw className="h-3.5 w-3.5" /> 恢复默认设置
        </button>
        <span className="text-2xs text-gray-400">所有设置随「ui」持久化保存（刷新后保持），不影响文档内容与导出。</span>
      </div>
    </Modal>
  );
}
