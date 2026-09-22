/**
 * 职责：未选中组件时的「页面属性」（文档模式）：纸张尺寸、方向、页边距、背景色、默认字体与行距。
 * 只读写 store 的 document.page，不涉及具体组件。
 */
import {
  PAGE_SIZES,
  pageBand,
  pageLabel,
  pageNumbering,
  type PageBandConfig,
  type PageNumberingConfig,
  type PageSizeKey,
} from '../../registry/types';
import { useEditorStore } from '../../store/editorStore';

const rowCls = 'mb-2 flex items-center gap-2';
const labelCls = 'w-20 shrink-0 text-2xs text-gray-500';
const inputCls =
  'h-7 w-full rounded border border-line bg-white px-2 text-[13px] outline-none focus:border-primary';

/** 页眉/页脚编辑块（页面级设置）：一行三栏 + 两行参数，标签等宽对齐，不换行 */
function BandEditor({
  which,
  enabled,
  cfg,
  onToggle,
  onChange,
}: {
  which: 'header' | 'footer';
  enabled: boolean;
  cfg: PageBandConfig;
  onToggle: (v: boolean) => void;
  onChange: (patch: Partial<PageBandConfig>) => void;
}) {
  const num = 'h-6 w-12 shrink-0 rounded border border-line bg-white px-1 text-center text-xs';
  const txt = 'h-6 min-w-0 rounded border border-line bg-white px-1 text-xs';
  const label = 'shrink-0 text-2xs text-gray-400';
  return (
    <div className={enabled ? '' : 'opacity-60'}>
      <label className="mb-1 flex items-center justify-between">
        <span className="text-2xs text-gray-600">
          {which === 'header' ? '页眉' : '页脚'}
          <span className="ml-1 text-gray-400">页面属性</span>
        </span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </label>

      {/* 左 / 右 并排一行；中栏独占整行 —— 中栏最常放页码，需要宽度（否则 "第 {page} 页 / 共 {total} 页" 会被截断） */}
      <div className="mb-1 flex items-center gap-1">
        <span className={`${label} w-4 shrink-0`}>左</span>
        <input className={`${txt} min-w-0 flex-1`} value={cfg.left} onChange={(e) => onChange({ left: e.target.value })} />
        <span className={`${label} w-4 shrink-0 text-right`}>右</span>
        <input className={`${txt} min-w-0 flex-1`} value={cfg.right} onChange={(e) => onChange({ right: e.target.value })} />
      </div>
      <div className="mb-1 flex items-center gap-1">
        <span className={`${label} w-4 shrink-0`}>中</span>
        <input className={`${txt} min-w-0 flex-1`} value={cfg.center} onChange={(e) => onChange({ center: e.target.value })} />
      </div>

      {/* 位置 + 字号：一行放完，标签等宽右对齐 */}
      <div className="mb-1 flex items-center gap-1" data-band-row="pos">
        <span className={`${label} w-10 shrink-0`}>{which === 'header' ? '距页顶' : '距页底'}</span>
        <input
          type="number"
          step={0.5}
          className={num}
          value={cfg.offset}
          onChange={(e) => onChange({ offset: Number(e.target.value) })}
        />
        <span className={`${label} w-5`}>mm</span>
        <span className={`${label} ml-auto w-8 text-right`}>字号</span>
        <input
          type="number"
          step={0.5}
          className={num}
          value={cfg.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
        />
        <span className={`${label} w-4`}>pt</span>
      </div>

      {/* 颜色 + 分隔线：同一行 */}
      <div className="flex items-center gap-1">
        <span className={`${label} w-10`}>颜色</span>
        <input
          type="color"
          className="h-6 w-10 rounded border border-line bg-white p-0.5"
          value={cfg.color}
          onChange={(e) => onChange({ color: e.target.value })}
        />
        <label className="ml-auto flex items-center gap-1 text-2xs text-gray-400">
          分隔线
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={cfg.showBorder}
            onChange={(e) => onChange({ showBorder: e.target.checked })}
          />
        </label>
      </div>
    </div>
  );
}

/** 变量说明：两列对齐（代码 + 含义），每行一个变量 */
function BandTokensHint() {
  const code = 'rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-primary';
  const row = 'flex items-baseline gap-2';
  return (
    <div className="mt-2 border-t border-line pt-1.5">
      <div className="mb-1 text-2xs text-gray-400">可用变量</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <span className={row}>
          <code className={code}>{'{page}'}</code>
        </span>
        <span className="text-2xs text-gray-500">当前页</span>
        <span className={row}>
          <code className={code}>{'{total}'}</code>
        </span>
        <span className="text-2xs text-gray-500">总页数</span>
        <span className={row}>
          <code className={code}>{'{date}'}</code>
        </span>
        <span className="text-2xs text-gray-500">日期</span>
      </div>
    </div>
  );
}

export function PagePropertyPanel() {
  const page = useEditorStore((s) => s.doc.document.page);
  const setPageSize = useEditorStore((s) => s.setPageSize);
  const setOrientation = useEditorStore((s) => s.setOrientation);
  const setMargin = useEditorStore((s) => s.setMargin);
  const setPageProp = useEditorStore((s) => s.setPageProp);
  const addComponent = useEditorStore((s) => s.addComponent);
  const pageCount = useEditorStore((s) => s.ui.docPageCount);
  const head = pageBand(page, 'header');
  const foot = pageBand(page, 'footer');
  const setBand = (which: 'header' | 'footer', patch: Partial<PageBandConfig>) =>
    setPageProp(which, { ...(which === 'header' ? head : foot), ...patch });
  // 三段式页码：numbering 是嵌套对象，整块替换（setPageProp 是浅合并）
  const numbering = pageNumbering(page);
  const setNumbering = (patch: Partial<PageNumberingConfig>) => setPageProp('numbering', { ...numbering, ...patch });

  return (
    <div className="px-3 py-2">
      <div className="mb-2 rounded bg-primary/5 px-2 py-1 text-2xs text-primary">
        未选中组件 —— 这里是文档（页面）属性
      </div>

      <div className={rowCls}>
        <span className={labelCls}>纸张尺寸</span>
        <select
          className={inputCls}
          value={page.size}
          onChange={(e) => setPageSize(e.target.value as PageSizeKey)}
        >
          {(Object.keys(PAGE_SIZES) as PageSizeKey[]).map((k) => (
            <option key={k} value={k}>
              {k === 'Custom' ? '自定义' : `${k} (${PAGE_SIZES[k].width}×${PAGE_SIZES[k].height}mm)`}
            </option>
          ))}
        </select>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>方向</span>
        <select
          className={inputCls}
          value={page.orientation}
          onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
        >
          <option value="portrait">纵向</option>
          <option value="landscape">横向</option>
        </select>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>宽 × 高</span>
        <input
          type="number"
          className={inputCls}
          value={page.width}
          onChange={(e) => setPageProp('width', Number(e.target.value))}
        />
        <input
          type="number"
          className={inputCls}
          value={page.height}
          onChange={(e) => setPageProp('height', Number(e.target.value))}
        />
        <span className="text-2xs text-gray-400">mm</span>
      </div>

      <div className="mb-2">
        <span className={labelCls}>页边距 mm</span>
        <div className="mt-1 grid grid-cols-4 gap-1">
          {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
            <label key={k} className="block">
              <span className="mb-0.5 block text-center text-2xs text-gray-400">
                {k === 'top' ? '上' : k === 'right' ? '右' : k === 'bottom' ? '下' : '左'}
              </span>
              <input
                type="number"
                step={0.1}
                className="h-7 w-full rounded border border-line bg-white px-1 text-center text-xs"
                value={page.margin[k]}
                onChange={(e) => setMargin({ [k]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mb-3 rounded border border-line px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-2xs text-gray-500">
          <span>分页</span>
          <span className="text-primary">当前共 {pageCount} 页</span>
        </div>
        <button
          type="button"
          className="mb-1 w-full rounded border border-line py-1 text-2xs hover:border-primary hover:text-primary"
          title="在当前模式内容的末尾插入一个分页符（相当于 Word 的 Ctrl+Enter）"
          onClick={() => addComponent('pageBreak')}
        >
          ＋ 插入分页符（新增一页）
        </button>
        <p className="text-2xs leading-relaxed text-gray-400">
          内容超出纸张版心会自动排到下一页；要在这里手动换页就先选中某个组件、再从左侧「文档专用 →
          分页符」双击插入到指定位置。
        </p>
      </div>

      {/* 三段式页码（对齐 A4 编辑器的分节编号：封面无页码 → 目录罗马数字 → 正文阿拉伯数字） */}
      <div className="mb-3 rounded border border-line px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-2xs text-gray-500">
          <span>分节页码（三段式）</span>
          <span className="truncate text-primary" title="前几页的实际显示效果">
            {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => pageLabel(i + 1, numbering) || '无').join(' · ')}
            {pageCount > 5 ? ' …' : ''}
          </span>
        </div>
        <label className="mb-1 flex items-center justify-between text-2xs text-gray-500">
          <span>首页（封面）不显示页码</span>
          <input
            type="checkbox"
            checked={numbering.hideFirstPage}
            onChange={(e) => setNumbering({ hideFirstPage: e.target.checked })}
          />
        </label>
        <div className="mb-1 flex items-center gap-2 text-2xs text-gray-500">
          <span className="w-28 shrink-0">目录页数（罗马数字）</span>
          <input
            type="number"
            min={0}
            max={20}
            className="h-6 w-12 shrink-0 rounded border border-line bg-white px-1 text-center text-xs"
            value={numbering.frontMatterPages}
            onChange={(e) => setNumbering({ frontMatterPages: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span className="w-20 shrink-0 text-right">正文起始页</span>
          <input
            type="number"
            min={1}
            max={999}
            className="h-6 w-12 shrink-0 rounded border border-line bg-white px-1 text-center text-xs"
            value={numbering.bodyStartPage}
            onChange={(e) => setNumbering({ bodyStartPage: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
        <p className="text-2xs leading-relaxed text-gray-400">
          例：首页不显示 + 目录 1 页 + 正文起始 1 → 封面无、第 2 页 I、第 3 页起 1、2、3…；
          {`{page}`} 会换成这里算出的页码。不显示页码的页，其页眉/页脚整块不渲染（同 Word「首页不同」）。
        </p>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>背景色</span>
        <input
          type="color"
          className="h-7 w-10 rounded border border-line bg-white p-0.5"
          value={page.background}
          onChange={(e) => setPageProp('background', e.target.value)}
        />
      </div>

      <div className={rowCls}>
        <span className={labelCls}>默认字体</span>
        <select
          className={inputCls}
          value={page.defaultFont}
          onChange={(e) => setPageProp('defaultFont', e.target.value)}
        >
          {['宋体', '黑体', '楷体', '仿宋', '微软雅黑'].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>默认字号</span>
        <input
          type="number"
          step={0.5}
          className={inputCls}
          value={page.defaultFontSize}
          onChange={(e) => setPageProp('defaultFontSize', Number(e.target.value))}
        />
        <span className="text-2xs text-gray-400">pt</span>
      </div>

      <div className={rowCls}>
        <span className={labelCls}>行距</span>
        <input
          type="number"
          step={0.1}
          className={inputCls}
          value={page.lineHeight}
          onChange={(e) => setPageProp('lineHeight', Number(e.target.value))}
        />
      </div>

      <div className="mb-3 rounded border border-line px-2 py-1.5" data-band-editor="1">
        <BandEditor
          which="header"
          enabled={page.showHeader}
          cfg={head}
          onToggle={(v) => setPageProp('showHeader', v)}
          onChange={(p) => setBand('header', p)}
        />
        <div className="my-2 border-t border-line" />
        <BandEditor
          which="footer"
          enabled={page.showFooter}
          cfg={foot}
          onToggle={(v) => setPageProp('showFooter', v)}
          onChange={(p) => setBand('footer', p)}
        />
        <BandTokensHint />
      </div>
    </div>
  );
}
