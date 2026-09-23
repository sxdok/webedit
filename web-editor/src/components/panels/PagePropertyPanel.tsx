/**
 * 职责：未选中组件时的「页面属性」（文档模式）。与组件属性面板**同一套规格**（提示词 §2–§7）：
 *
 *   ▼ 通用属性抽屉：纸张 / 页边距 / 版式
 *   ▼ 专有属性抽屉：分页 / 分节页码 / 页眉 / 页脚
 *   ▼ 状态抽屉（只读）：当前页数 / 页码预览 / 页眉 / 页脚 / 纸张
 *
 * 与组件面板共用同一批零件：`PropertyDrawer`（抽屉）、`PropertyGroup`（26px 可折叠分组）、
 * `PropertyControl`（控件 + **28px 行 + 固定 96px 属性名列** + 悬停气泡 + 改值闪烁）。
 * **界面上不铺说明文字**：每个属性的说明、默认值、取值范围都在悬停气泡里
 * （由 `PropertyRow.tipOf` 从 item 的 label/默认值/范围生成）；分组说明在分组标题的气泡里。
 * 分组顺序 / 默认展开 / 分组说明来自 groupStrategy 的 `PAGE_*`（规格 §6，本文件只查表）。
 *
 * 只读写 store 的 document.page，不涉及具体组件。
 */
import type { ReactNode } from 'react';
import { FileText, Plus } from 'lucide-react';
import {
  PAGE_SIZES,
  pageBand,
  pageLabel,
  pageNumbering,
  type DocumentPageConfig,
  type PageBandConfig,
  type PageNumberingConfig,
  type PageSizeKey,
  type PropSchemaItem,
} from '../../registry/types';
import { useEditorStore } from '../../store/editorStore';
import { PropertyControl } from '../property-controls';
import { Tooltip } from '../ui/Tooltip';
import { PropertyDrawer } from './PropertyDrawer';
import { PropertyGroup } from './PropertyGroup';
import { PropertyRow } from './PropertyRow';
import { PAGE_DEFAULT_OPEN, PAGE_GROUP_HINTS } from './groupStrategy';

/* ══════════════ 属性定义 ══════════════
   全部定义成**模块级常量**：对象标识稳定，`PropertyRow` 的 memo 才真正生效。 */

const PAPER: PropSchemaItem = {
  key: 'page.size',
  label: '纸张尺寸（A4/A3/A5/Letter/Legal；选「自定义」后宽高可任意改）',
  control: 'select',
  group: '纸张',
  defaultValue: 'A4',
  options: (Object.keys(PAGE_SIZES) as PageSizeKey[]).map((k) => ({
    value: k,
    label: k === 'Custom' ? '自定义' : `${k}（${PAGE_SIZES[k].width}×${PAGE_SIZES[k].height}mm）`,
  })),
};

const ORIENT: PropSchemaItem = {
  key: 'page.orientation',
  label: '方向（纵向＝竖版纸张；横向＝宽高互换）',
  control: 'select',
  group: '纸张',
  defaultValue: 'portrait',
  options: [
    { value: 'portrait', label: '纵向' },
    { value: 'landscape', label: '横向' },
  ],
};

const PAPER_W: PropSchemaItem = {
  key: 'page.width',
  label: '宽度（纸张宽度，单位 mm）',
  control: 'unit',
  group: '纸张',
  defaultValue: 210,
  min: 20,
  max: 2000,
  step: 1,
  unit: 'mm',
};

const PAPER_H: PropSchemaItem = {
  ...PAPER_W,
  key: 'page.height',
  label: '高度（纸张高度，单位 mm）',
  defaultValue: 297,
};

const MARGIN: PropSchemaItem = {
  key: 'page.margin',
  label: '页边距（按 上 / 右 / 下 / 左 的顺序，单位 mm；可用联动锁四边同步）',
  control: 'edge',
  group: '页边距',
  defaultValue: { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 },
};

const BACKGROUND: PropSchemaItem = {
  key: 'page.background',
  label: '背景色（纸张底色；打印时通常保持白色）',
  control: 'color',
  group: '版式',
  defaultValue: '#ffffff',
};

const DEFAULT_FONT: PropSchemaItem = {
  key: 'page.defaultFont',
  label: '默认字体（组件没有单独指定字体时用它）',
  control: 'font',
  group: '版式',
  defaultValue: '宋体',
};

const DEFAULT_FONT_SIZE: PropSchemaItem = {
  key: 'page.defaultFontSize',
  label: '默认字号（单位 pt，组件没有单独指定字号时用它）',
  control: 'unit',
  group: '版式',
  defaultValue: 12,
  min: 5,
  max: 72,
  step: 0.5,
  unit: 'pt',
};

const LINE_HEIGHT: PropSchemaItem = {
  key: 'page.lineHeight',
  label: '行距（正文行高倍数，1.5 表示 1.5 倍行距）',
  control: 'number',
  group: '版式',
  defaultValue: 1.5,
  min: 0.8,
  max: 4,
  step: 0.1,
};

const INSERT_BREAK: PropSchemaItem = {
  key: 'page.break',
  label: '插入分页符（在当前内容末尾新增一页，相当于 Word 的 Ctrl+Enter）',
  control: 'text',
  group: '分页',
  defaultValue: '—',
};

const HIDE_FIRST_PAGE: PropSchemaItem = {
  key: 'page.numbering.hideFirstPage',
  label: '首页不显示页码（封面页的页眉/页脚整块不渲染，同 Word 的「首页不同」）',
  control: 'switch',
  group: '分节页码',
  defaultValue: false,
};

const FRONT_MATTER_PAGES: PropSchemaItem = {
  key: 'page.numbering.frontMatterPages',
  label: '目录页数（封面之后按罗马数字编号的页数，0 表示没有目录节）',
  control: 'number',
  group: '分节页码',
  defaultValue: 0,
  min: 0,
  max: 20,
  step: 1,
};

const BODY_START_PAGE: PropSchemaItem = {
  key: 'page.numbering.bodyStartPage',
  label: '正文起始页（正文第一页显示成第几页；{page} 会换成这里算出的页码）',
  control: 'number',
  group: '分节页码',
  defaultValue: 1,
  min: 1,
  max: 999,
  step: 1,
};

interface BandItems {
  enable: PropSchemaItem;
  left: PropSchemaItem;
  center: PropSchemaItem;
  right: PropSchemaItem;
  offset: PropSchemaItem;
  fontSize: PropSchemaItem;
  color: PropSchemaItem;
  border: PropSchemaItem;
}

/** 页眉/页脚两套属性：只有名称、默认值与「距页顶/距页底」不同 */
function bandItems(which: 'header' | 'footer'): BandItems {
  const zh = which === 'header' ? '页眉' : '页脚';
  const pos = which === 'header' ? '距页顶' : '距页底';
  return {
    enable: {
      key: `page.${which}.on`,
      label: `启用${zh}（关闭后这一区域整块不渲染）`,
      control: 'switch',
      group: zh,
      defaultValue: which === 'footer',
    },
    left: {
      key: `page.${which}.left`,
      label: '左（左对齐的一段文字；支持变量 {page} 当前页、{total} 总页数、{date} 日期）',
      control: 'text',
      group: zh,
      defaultValue: '',
    },
    center: {
      key: `page.${which}.center`,
      label: '中（居中文字；页码通常放这一段）',
      control: 'text',
      group: zh,
      defaultValue: which === 'footer' ? '第 {page} 页 / 共 {total} 页' : '',
    },
    right: {
      key: `page.${which}.right`,
      label: '右（右对齐的一段文字，变量同左侧）',
      control: 'text',
      group: zh,
      defaultValue: '',
    },
    offset: {
      key: `page.${which}.offset`,
      label: `${pos}（${zh}区距纸张边缘的距离，单位 mm）`,
      control: 'unit',
      group: zh,
      defaultValue: 12.7,
      min: 0,
      max: 80,
      step: 0.5,
      unit: 'mm',
    },
    fontSize: {
      key: `page.${which}.fontSize`,
      label: '字号（这一段文字的字号，单位 pt）',
      control: 'unit',
      group: zh,
      defaultValue: 10.5,
      min: 5,
      max: 36,
      step: 0.5,
      unit: 'pt',
    },
    color: {
      key: `page.${which}.color`,
      label: '颜色（这一段文字的颜色）',
      control: 'color',
      group: zh,
      defaultValue: '#5b6472',
    },
    border: {
      key: `page.${which}.border`,
      label: '分隔线（在纸张内侧画一条细线，隔开正文与页眉/页脚）',
      control: 'switch',
      group: zh,
      defaultValue: true,
    },
  };
}

const HEAD = bandItems('header');
const FOOT = bandItems('footer');

type SetPageProp = <K extends keyof DocumentPageConfig>(key: K, value: DocumentPageConfig[K]) => void;

/** 页眉或页脚的 8 行（启用 / 左 / 中 / 右 / 距边 / 字号 / 颜色 / 分隔线） */
function BandRows({
  which,
  items,
  page,
  setBand,
  setPageProp,
}: {
  which: 'header' | 'footer';
  items: BandItems;
  page: DocumentPageConfig;
  setBand: (which: 'header' | 'footer', patch: Partial<PageBandConfig>) => void;
  setPageProp: SetPageProp;
}) {
  const cfg = pageBand(page, which);
  const on = which === 'header' ? page.showHeader : page.showFooter;
  return (
    <div className={on ? '' : 'opacity-60'}>
      <PropertyControl
        item={items.enable}
        value={on}
        onChange={(v) => (which === 'header' ? setPageProp('showHeader', v === true) : setPageProp('showFooter', v === true))}
      />
      <PropertyControl item={items.left} value={cfg.left} onChange={(v) => setBand(which, { left: String(v) })} />
      <PropertyControl item={items.center} value={cfg.center} onChange={(v) => setBand(which, { center: String(v) })} />
      <PropertyControl item={items.right} value={cfg.right} onChange={(v) => setBand(which, { right: String(v) })} />
      <PropertyControl item={items.offset} value={cfg.offset} onChange={(v) => setBand(which, { offset: Number(v) })} />
      <PropertyControl item={items.fontSize} value={cfg.fontSize} onChange={(v) => setBand(which, { fontSize: Number(v) })} />
      <PropertyControl item={items.color} value={cfg.color} onChange={(v) => setBand(which, { color: String(v) })} />
      <PropertyControl item={items.border} value={cfg.showBorder} onChange={(v) => setBand(which, { showBorder: v === true })} />
    </div>
  );
}

export function PagePropertyPanel() {
  const page = useEditorStore((s) => s.doc.document.page);
  const pageCount = useEditorStore((s) => s.ui.docPageCount);
  const setPageSize = useEditorStore((s) => s.setPageSize);
  const setOrientation = useEditorStore((s) => s.setOrientation);
  const setMargin = useEditorStore((s) => s.setMargin);
  const setPageProp = useEditorStore((s) => s.setPageProp);
  const addComponent = useEditorStore((s) => s.addComponent);
  /* ★折叠状态放进 store.ui（随持久化保存 → 刷新后保持），规格阶段五「折叠状态持久化」。
     抽屉键加 `page:` 前缀，避免与组件属性面板的同名抽屉互串。 */
  const closedSt = useEditorStore((s) => s.ui.propClosed) ?? { groups: {}, drawers: {} };
  const setPropClosed = useEditorStore((s) => s.setPropClosed);
  const toggled = Object.fromEntries(Object.entries(closedSt.groups).map(([k, v]) => [k, !v]));
  const setToggled = (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => {
    const next = fn(toggled);
    const groups: Record<string, boolean> = {};
    for (const [k, open] of Object.entries(next)) if (open !== toggled[k]) groups[k] = !open; // 只报变化的键
    setPropClosed({ groups });
  };
  const drawer = {
    通用属性: closedSt.drawers['page:通用属性'] !== true,
    专有属性: closedSt.drawers['page:专有属性'] !== true,
    状态: closedSt.drawers['page:状态'] !== true,
  };
  const setDrawer = (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => {
    const next = fn(drawer);
    const entries: Record<string, boolean> = {};
    (['通用属性', '专有属性', '状态'] as const).forEach((k) => {
      if (next[k] !== drawer[k]) entries[`page:${k}`] = next[k] === false; // 只报变化的键
    });
    setPropClosed({ drawers: entries });
  };

  const numbering = pageNumbering(page);
  // numbering 是嵌套对象，setPageProp 是浅合并 → 整块替换
  const setNumbering = (patch: Partial<PageNumberingConfig>) => setPageProp('numbering', { ...numbering, ...patch });
  const setBand = (which: 'header' | 'footer', patch: Partial<PageBandConfig>) =>
    setPageProp(which, { ...pageBand(page, which), ...patch });

  /** 分组的展开状态：手动切换优先，否则用策略里的默认展开（规格 §6） */
  const openOf = (g: string) => toggled[g] ?? PAGE_DEFAULT_OPEN.includes(g);
  const group = (name: string, count: number, body: ReactNode) => (
    <PropertyGroup
      key={name}
      name={name}
      count={count}
      open={openOf(name)}
      hint={PAGE_GROUP_HINTS[name]}
      onToggle={() => setToggled((s) => ({ ...s, [name]: !openOf(name) }))}
    >
      {body}
    </PropertyGroup>
  );

  /** 状态抽屉（只读） */
  const preview =
    Array.from({ length: Math.min(pageCount, 5) }, (_, i) => pageLabel(i + 1, numbering) || '无').join(' · ') +
    (pageCount > 5 ? ' …' : '');
  const status: Record<string, string> = {
    对象: '页面（文档页面，未选中组件）',
    当前页数: `${pageCount} 页`,
    '页码预览': preview || '—',
    页眉: page.showHeader ? '显示' : '隐藏',
    页脚: page.showFooter ? '显示' : '隐藏',
    纸张: `${page.size === 'Custom' ? '自定义' : page.size} · ${page.width}×${page.height}mm · ${
      page.orientation === 'portrait' ? '纵向' : '横向'
    }`,
  };

  return (
    <div className="px-2.5 py-1.5" data-props-panel="1" data-props-page="1">
      {/* ── 顶部固定区：页面身份 ── */}
      <div className="mb-2 flex items-center gap-1.5">
        <FileText className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-semibold text-gray-800">页面（文档）</span>
        <Tooltip
          content={{
            name: '页面（文档）',
            keyText: 'document.page',
            detail: ['未选中任何组件时，右侧显示的是文档页面自己的属性（纸张、页边距、分页、页眉页脚）。'],
          }}
        >
          <span className="cursor-help rounded bg-gray-100 px-1.5 py-0.5 font-mono text-2xs text-gray-500">
            document.page
          </span>
        </Tooltip>
      </div>

      {/* ── 通用属性抽屉 ── */}
      <PropertyDrawer
        name="通用属性"
        open={drawer['通用属性'] !== false}
        onToggle={() => setDrawer((s) => ({ ...s, 通用属性: s['通用属性'] === false }))}
        badge="9 项"
        hint="每份文档都有的页面属性：纸张与方向、页边距、底色与默认字体。"
      >
        {group(
          '纸张',
          4,
          <>
            <PropertyControl item={PAPER} value={page.size} onChange={(v) => setPageSize(v as PageSizeKey)} />
            <PropertyControl
              item={ORIENT}
              value={page.orientation}
              onChange={(v) => setOrientation(v as DocumentPageConfig['orientation'])}
            />
            <PropertyControl item={PAPER_W} value={page.width} onChange={(v) => setPageProp('width', Number(v))} />
            <PropertyControl item={PAPER_H} value={page.height} onChange={(v) => setPageProp('height', Number(v))} />
          </>,
        )}
        {group(
          '页边距',
          1,
          <PropertyControl
            item={MARGIN}
            value={page.margin}
            onChange={(v) => setMargin(v as Partial<DocumentPageConfig['margin']>)}
          />,
        )}
        {group(
          '版式',
          4,
          <>
            <PropertyControl item={BACKGROUND} value={page.background} onChange={(v) => setPageProp('background', String(v))} />
            <PropertyControl item={DEFAULT_FONT} value={page.defaultFont} onChange={(v) => setPageProp('defaultFont', String(v))} />
            <PropertyControl
              item={DEFAULT_FONT_SIZE}
              value={page.defaultFontSize}
              onChange={(v) => setPageProp('defaultFontSize', Number(v))}
            />
            <PropertyControl item={LINE_HEIGHT} value={page.lineHeight} onChange={(v) => setPageProp('lineHeight', Number(v))} />
          </>,
        )}
      </PropertyDrawer>

      {/* ── 专有属性抽屉 ── */}
      <PropertyDrawer
        name="专有属性"
        open={drawer['专有属性'] !== false}
        onToggle={() => setDrawer((s) => ({ ...s, 专有属性: s['专有属性'] !== false ? false : true }))}
        badge="20 项"
        hint="只属于文档结构的部分：分页、三段式页码、页眉与页脚。"
      >
        {group(
          '分页',
          1,
          <PropertyRow item={INSERT_BREAK} value={pageCount}>
            <button
              type="button"
              data-insert-pagebreak="1"
              className="ml-auto flex h-7 items-center gap-1 rounded-md border border-line bg-white px-2 text-2xs text-gray-600 hover:border-primary hover:text-primary"
              onClick={() => addComponent('pageBreak')}
            >
              <Plus className="h-3 w-3" />
              插入分页符
            </button>
          </PropertyRow>,
        )}
        {group(
          '分节页码',
          3,
          <>
            <PropertyControl
              item={HIDE_FIRST_PAGE}
              value={numbering.hideFirstPage}
              onChange={(v) => setNumbering({ hideFirstPage: v === true })}
            />
            <PropertyControl
              item={FRONT_MATTER_PAGES}
              value={numbering.frontMatterPages}
              onChange={(v) => setNumbering({ frontMatterPages: Number(v) })}
            />
            <PropertyControl
              item={BODY_START_PAGE}
              value={numbering.bodyStartPage}
              onChange={(v) => setNumbering({ bodyStartPage: Number(v) })}
            />
          </>,
        )}
        <div data-band-editor="1">
          {group('页眉', 8, <BandRows which="header" items={HEAD} page={page} setBand={setBand} setPageProp={setPageProp} />)}
          {group('页脚', 8, <BandRows which="footer" items={FOOT} page={page} setBand={setBand} setPageProp={setPageProp} />)}
        </div>
      </PropertyDrawer>

      {/* ── 状态抽屉（只读） ── */}
      <PropertyDrawer
        name="状态"
        open={drawer['状态'] !== false}
        onToggle={() => setDrawer((s) => ({ ...s, 状态: s['状态'] === false }))}
        hint="只读信息：当前页数、页码效果预览、页眉页脚开关、纸张规格。"
      >
        {Object.entries(status).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 py-0.5 text-2xs text-gray-500" data-status-row={k}>
            <span className="w-24 shrink-0 truncate">{k}</span>
            <span className="ml-auto truncate font-mono text-gray-600" title={v}>
              {v}
            </span>
          </div>
        ))}
      </PropertyDrawer>
    </div>
  );
}
