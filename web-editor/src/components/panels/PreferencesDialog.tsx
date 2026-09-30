/**
 * 职责：**首选项**（视图 → 首选项…）—— 编辑器自己的各项设置集中在这一个弹窗里。
 *
 * 设计：所有设置都读写 `store.ui`（已经随 ui 持久化，刷新后保持），所以这里只做"列表 + 开关/选择"，
 * 不引入第二套配置状态；底部提供「恢复默认设置」。
 *
 * 每一项都带 `data-pref="<key>"` 与 `data-pref-value`，便于自检逐项核对。
 *
 * ★布局与"提示"的两条规矩（2026-09-29 用户要求"提示类内容改为悬浮气泡，现在这样太乱了"）：
 *   ① **行内只留"短状态"**（≤ 16 字，如「当前 3 个」「已连接 · 写已禁用」），够扫就行；
 *   ② **解释性长句一律进悬浮气泡**（`data-tip-text` → 全局 `data-tip-text` 委托，见 ui/Tooltip.tsx；
 *      **不用原生 `title`**，与 D16 一致）。气泡挂在标签后的 ⓘ 上，`data-pref-tip="1"` 便于自检核对。
 *   这样每行高度一致、左右两列对齐，扫一眼就能找到开关，想了解细节时再 hover。
 */
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useEditorStore, type UIState } from '../../store/editorStore';
import { PERSIST_KEY } from '../../store/persistStorage';
import { getLiveTypes, loadRuntimeComponents } from '../../registry/live';
import { useBridgeSummary, refreshDesktopWriteState } from '../../mcp/bridgeClient';
import { desktopApi } from '../../utils/desktopChrome';
import { Modal } from '../ui/Modal';
import { SwitchControl } from '../property-controls/SwitchControl';
import type { PropSchemaItem } from '../../registry/types';

const FAKE_ITEM: PropSchemaItem = { key: 'pref', label: '', control: 'switch', group: '', defaultValue: false };

/** 行内"短状态"的上限（超过就该进气泡了；自检按这个数核对） */
export const PREF_INLINE_MAX = 16;

/**
 * ⓘ：把长说明挂成悬浮气泡。`data-tip-text` 由全局委托层接管（400ms 延迟、深色、最大 280px），
 * 所以这里**只写属性**、不自己实现浮层。
 */
function InfoTip({ text }: { text: string }) {
  return (
    <span
      data-pref-tip="1"
      data-tip-text={text}
      role="img"
      aria-label={text}
      className="inline-flex h-3.5 w-3.5 flex-none cursor-help items-center justify-center rounded-full border border-line text-[9px] leading-none text-gray-400 hover:border-primary hover:text-primary"
    >
      ⓘ
    </span>
  );
}

/** 一行：左「标签（+ⓘ+短状态）」、右「控件」。两列对齐，行高一致。 */
function Row({ prefKey, value, children }: { prefKey: string; value: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-1" data-pref={prefKey} data-pref-value={value}>
      {children}
    </div>
  );
}

function Label({ text, tip, status }: { text: string; tip?: string; status?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-gray-700">
      <span className="flex-none">{text}</span>
      {tip && <InfoTip text={tip} />}
      {status && (
        <span className="min-w-0 truncate text-2xs text-gray-400" data-pref-hint="1">
          {status}
        </span>
      )}
    </span>
  );
}

function Section({ title, tip, children }: { title: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[12px] font-semibold text-gray-700">{title}</span>
        {tip && <InfoTip text={tip} />}
      </div>
      <div className="rounded-md border border-line bg-gray-50 px-2 py-0.5">{children}</div>
    </div>
  );
}

function PrefSwitch({
  prefKey,
  label,
  tip,
  status,
  value,
  onChange,
}: {
  prefKey: string;
  label: string;
  /** 解释性长句（进气泡） */
  tip?: string;
  /** 行内短状态（≤ PREF_INLINE_MAX 字） */
  status?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row prefKey={prefKey} value={value ? '1' : '0'}>
      <Label text={label} tip={tip} status={status} />
      <SwitchControl item={FAKE_ITEM} value={value} onChange={(v) => onChange(v === true)} />
    </Row>
  );
}

function PrefSelect<T extends string>({
  prefKey,
  label,
  tip,
  status,
  value,
  options,
  onChange,
}: {
  prefKey: string;
  label: string;
  tip?: string;
  status?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Row prefKey={prefKey} value={value}>
      <Label text={label} tip={tip} status={status} />
      <select
        data-pref-select={prefKey}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-6 flex-none rounded border border-line bg-white px-1 text-2xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
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
  autoBridge: true,
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
  /**
   * 「允许 MCP 写操作」（P0 决策 #2）：加密配置给默认值（分发版 **false**），
   * 用户在这里的改动由桌面应用写进 `userData/prefs.json` 并**重启 MCP** 生效。
   * 浏览器里没有桌面壳 → 只显示只读说明（写开关由启动 MCP 的那一方决定）。
   */
  const d = desktopApi();
  const [allowWrite, setAllowWrite] = useState<boolean | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  useEffect(() => {
    if (!d) return;
    let alive = true;
    void d
      .getStatus()
      .then((s) => {
        if (alive) setAllowWrite(s.mcpWriteEnabled === true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [d]);

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
      <Section title="组件箱" tip="左侧组件面板：缩略图会真渲染一份组件预览，卡片会变大；重载用于改完 external 组件后立即生效">
        <PrefSwitch
          prefKey="compPreview"
          label="显示组件缩略图"
          tip="关 = 紧凑两列（默认）；开 = 每张卡片真渲染一份预览（更直观，但卡片更大、首次渲染略慢）"
          value={ui.compPreview === true}
          onChange={setCompPreview}
        />
        <PrefSwitch prefKey="showTree" label="显示组件树" tip="在画布上方显示树形结构（可看层级、用于选中深层节点）" value={ui.showTree === true} onChange={() => toggleUI('showTree')} />
        {/* ★外部组件重载入口（用户 2026-09-24：从「帮助」菜单与组件箱底部收进首选项，只留这一个入口） */}
        <Row prefKey="reloadLive" value={String(getLiveTypes().length)}>
          <Label text="重载外部组件" tip="改完 public/组件/*.js 点这里重新加载，不用重新构建；也可以只改一个文件后重载全部" status={`当前 ${getLiveTypes().length} 个`} />
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
            className="h-6 flex-none whitespace-nowrap rounded border border-line px-2 text-2xs hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {reloading ? '重载中…' : '重载'}
          </button>
        </Row>
        {reloadMsg && (
          <p className="py-0.5 text-2xs text-gray-400" data-reload-msg="1">
            {reloadMsg}
          </p>
        )}
      </Section>

      <Section title="画布" tip="只影响编辑时的显示与预览，不影响导出与打印">
        <PrefSwitch prefKey="showGrid" label="显示网格" tip="在画布上叠加网格，便于对齐（Web 模式常用）" value={ui.showGrid === true} onChange={() => toggleUI('showGrid')} />
        <PrefSwitch prefKey="showRuler" label="显示标尺" tip="页面顶边/左边的标尺，会随滚动量走；单位 mm" value={ui.showRuler === true} onChange={() => toggleUI('showRuler')} />
        <PrefSwitch prefKey="showGuides" label="显示辅助线" tip="页边距/版心辅助线：导出与打印时**不会**出现" value={ui.showGuides === true} onChange={() => toggleUI('showGuides')} />
        <PrefSwitch prefKey="snap" label="对齐吸附" tip="拖动/缩放时自动吸附到网格、辅助线与相邻元素" value={ui.snap === true} onChange={() => toggleUI('snap')} />
        {/* ★用户 2026-09-24：「浏览器调整尺寸又触发画布位置偏移」= 视口比纸窄时纸张贴到左边缘、不再居中 */}
        <PrefSwitch
          prefKey="fitWhenNarrow"
          label="窗口放不下时自动缩小"
          tip="文档模式：视口比纸张窄时预览自动缩到放得下（纸张始终居中，不贴左边缘；导出/打印不受影响）"
          value={ui.fitWhenNarrow !== false}
          onChange={() => toggleUI('fitWhenNarrow')}
        />
        <PrefSwitch
          prefKey="preview"
          label="预览模式"
          tip="隐藏选中框、手柄、辅助线等编辑态装饰，只看成品效果（导出/打印本来就看不到这些）"
          value={ui.preview === true}
          onChange={() => toggleUI('preview')}
        />
      </Section>

      <Section title="文档">
        <PrefSwitch
          prefKey="autoNumber"
          label="图表按章编号"
          tip="图 X-Y / 表 X-Y（章号 = 一级标题序号；改标题顺序后编号自动跟着变）"
          value={ui.autoNumber === true}
          onChange={() => toggleUI('autoNumber')}
        />
      </Section>

      {/* ★保存到浏览器（用户 2026-09-24：「浏览器不要默认保存做的文件，刷新一下就应该打开一个全新的文档」） */}
      <Section title="保存" tip="做的文件要不要留在浏览器里（只有浏览器 localStorage 这一处；交付请用 文件 → 导出）">
        <PrefSwitch
          prefKey="autoSave"
          label="保存到浏览器"
          tip="关 = 刷新后是全新文档（默认）；开 = 刷新后接着编上次那份。注意 localStorage 约 5MB 上限，正文大时可能写不进去"
          value={ui.autoSave === true}
          onChange={() => toggleUI('autoSave')}
        />
        {/* 只读信息行：存档落在哪、现在多大（可核对的实数，不是"大概"） */}
        <Row prefKey="saveStatus" value={ui.autoSave === true ? 'on' : 'off'}>
          <Label
            text="存储位置"
            tip={`存在 localStorage['${PERSIST_KEY}']（约 5MB 上限）：关时只存设置、不写正文；开时随编辑自动写入。交付请用 文件 → 导出`}
            status={ui.autoSave === true ? `已存 ${savedSize}` : '只存设置'}
          />
          <span className="flex-none text-2xs text-gray-400" data-save-status="1">
            {`localStorage['${PERSIST_KEY}']`}
          </span>
        </Row>
      </Section>

      <Section title="MCP 桥接" tip="把编辑器接到本机的 MCP 服务器（Live 联动）：连上后 agent 的工具会直接作用在编辑器里打开的这份文档上">
        <PrefSwitch
          prefKey="autoBridge"
          label="启动时自动连接"
          tip="开 = 启动时探测本机 MCP 服务器（含应用带起来的那个），检测到就自动接入（默认开；没检测到不会硬连）"
          value={ui.autoBridge === true}
          onChange={() => toggleUI('autoBridge')}
        />
        {/* 只读状态：**不放第二个"连接/断开"按钮**（用户 2026-09-24 要求入口收敛；开关在 工具 → MCP 桥接） */}
        <Row prefKey="bridgeStatus" value={bridge.state}>
          <Label text="当前状态" tip="连接开关在 工具 → MCP 桥接（这里只显示状态，不放第二个入口）" status={bridge.label} />
          <span className="max-w-[220px] truncate text-2xs text-gray-400" data-bridge-summary="1">
            {bridge.detail ?? ''}
          </span>
        </Row>
        {/* 写开关（决策 #2）：只对桌面版显示可操作开关；浏览器里说明由谁决定 */}
        {d ? (
          <PrefSwitch
            prefKey="mcpAllowWrite"
            label="允许 MCP 写操作"
            tip="关 = MCP 的写工具一律被拒（默认，返回 WRITE_DISABLED）；开 = 允许写工作区与组件目录。改动会重启 MCP 服务器后生效"
            status={writeBusy ? '正在重启 MCP…' : `当前：${allowWrite === null ? '读取中' : allowWrite ? '开' : '关'}`}
            value={allowWrite === true}
            onChange={(v) => {
              if (!d || writeBusy) return;
              setWriteBusy(true);
              void d
                .setAllowWrite(v === true)
                .then((s) => {
                  setAllowWrite(s.mcpWriteEnabled === true);
                  // 让桥接菜单的三态文案立刻跟着变（"已连接 · 写已禁用"）
                  return refreshDesktopWriteState();
                })
                .catch(() => undefined)
                .finally(() => setWriteBusy(false));
            }}
          />
        ) : (
          <Row prefKey="mcpAllowWrite" value="managed">
            <Label
              text="允许 MCP 写操作"
              tip="由启动 MCP 服务器的一方决定（浏览器模式不可改；桌面版在这里有开关，改动会重启 MCP）"
              status="由启动方决定"
            />
            <span className="flex-none text-2xs text-gray-400" data-bridge-summary="1">
              浏览器模式不可改
            </span>
          </Row>
        )}
      </Section>

      <Section title="外观">
        <PrefSelect
          prefKey="theme"
          label="界面主题"
          tip="深色（Monokai）只改编辑器界面配色；导出与打印始终按文档自身的配色"
          value={ui.theme === 'monokai' ? 'monokai' : 'light'}
          options={[
            { value: 'light', label: '浅色' },
            { value: 'monokai', label: '深色（Monokai）' },
          ]}
          onChange={(v) => setTheme(v)}
        />
      </Section>

      <Section title="面板" tip="左右两个侧栏的宽度；也可以直接拖面板之间的分隔线">
        <Row prefKey="panelWidths" value={`${ui.leftWidth ?? 240}/${ui.rightWidth ?? 300}`}>
          <Label text="面板宽度" tip="左 240 / 右 300 是默认值；拖动分隔线或点右边按钮都可改" status={`${ui.leftWidth ?? 240} / ${ui.rightWidth ?? 300} px`} />
          <button
            type="button"
            data-pref-reset-widths="1"
            className="h-6 flex-none rounded border border-line px-2 text-2xs text-gray-600 hover:border-primary hover:text-primary"
            onClick={() => {
              setPanelWidth('left', DEFAULTS.leftWidth);
              setPanelWidth('right', DEFAULTS.rightWidth);
            }}
          >
            恢复默认宽度
          </button>
        </Row>
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
        <span className="flex items-center gap-1.5 text-2xs text-gray-400">
          <span>设置随「ui」保存</span>
          {/* 原来这里还有一整句内联说明（"所有设置随「ui」持久化保存…不影响文档内容与导出"），
              与旁边这颗 ⓘ 讲的是同一件事 → 合并进气泡，行内只留短状态（D16 审计 2026-09-30）。 */}
          <InfoTip text="写在 localStorage 的 ui 里，刷新后保持。与**文档内容分开**：恢复默认设置不会动你的文档，也不影响导出结果" />
        </span>
      </div>
    </Modal>
  );
}
