/**
 * 职责：属性控件集的**派发表**（由 PropSchemaItem.control 派发）。面板不写死任何组件的字段。
 *
 * 结构（规格 §12）：**每个控件一个文件**。这里只做三件事：
 *   ① 登记已实现控件 `IMPLEMENTED_CONTROLS`；② 声明哪些控件是"整行式" `WIDE_CONTROLS`；
 *   ③ 把 control 名派发到对应控件组件。
 * 行的**视觉与气泡**由 `panels/PropertyRow.tsx` 统一负责（96px 属性名列、28px 行高、悬停底色、
 * 编辑后闪烁、悬停气泡含 key/说明/默认值/范围），本目录只负责"控件本身长什么样"。
 *
 * 新增一种控件：在本目录加一个 `XxxControl.tsx`（props 用 `ControlProps`），
 * 在 `IMPLEMENTED_CONTROLS` 登记，并在下面 switch 里加一行。
 */
import type { PropSchemaItem } from '../../registry/types';
import { splitLabel } from '../../utils/label';
import { PropertyRow } from '../panels/PropertyRow';
import { TextControl } from './TextControl';
import { TextareaControl } from './TextareaControl';
import { NumberControl } from './NumberControl';
import { SliderControl } from './SliderControl';
import { ColorControl } from './ColorControl';
import { SelectControl, FontControl } from './SelectControl';
import { SwitchControl } from './SwitchControl';
import { AlignControl } from './AlignControl';
import { UnitControl } from './UnitControl';
import { EdgeControl } from './EdgeControl';
import { FrameControl } from './FrameControl';
import { ImageControl } from './ImageControl';
import { RichTextControl } from './RichTextControl';
import { SpacingControl } from './SpacingControl';
import { ChildrenControl } from './ChildrenControl';
import { TableCellsControl } from './TableCellsControl';
import { TableSizeControl } from './TableSizeControl';
import { TableHtmlControl } from './TableHtmlControl';
import { TableSortControl } from './TableSortControl';
import { TableRowHeightsControl } from './TableRowHeightsControl';
import { ImageRowsControl } from './ImageRowsControl';

export { splitLabel };

export interface ControlProps {
  item: PropSchemaItem;
  value: unknown;
  onChange: (value: unknown) => void;
  /** children 控件需要知道自己在编辑哪个容器节点 */
  nodeId?: string;
  /** 选中节点的**全部**属性（只读）：个别控件要参考同级属性（如图片行编辑器要看老字段 `src`） */
  allProps?: Record<string, unknown>;
  /** 一次写多个属性（可选）：需要"改自己的同时清理老字段"的控件用它，比 onChange 多写几个键 */
  onPatch?: (patch: Record<string, unknown>) => void;
}

/** 已实现的控件类型（自检用它核对：组件 schema 里不允许出现未实现的 control） */
export const IMPLEMENTED_CONTROLS: ReadonlySet<string> = new Set([
  'text',
  'textarea',
  'richtext',
  'number',
  'slider',
  'color',
  'select',
  'switch',
  'align',
  'font',
  'spacing',
  'edge',
  'image',
  'unit',
  'frame',
  'children',
  'cells',
  'tableSize',
  'tableHtml',
  'tableSort',
  'tableRowHeights',
  'imageRows',
]);

/** 需要独占整行宽度的控件（多行文本、工具条、多维输入、表格工具） */
export const WIDE_CONTROLS: ReadonlySet<string> = new Set([
  'textarea',
  'richtext',
  'spacing',
  'edge',
  'frame',
  'children',
  'cells',
  'tableSize',
  'tableHtml',
  'tableSort',
  'tableRowHeights',
  'imageRows',
]);

/** 该控件在面板里是不是"标签在上、控件独占整行"的两行式（清单/文档用它描述排版） */
export function isWideControl(control: string): boolean {
  return WIDE_CONTROLS.has(control);
}

function NotImplemented({ control }: { control: string }) {
  return (
    <div className="rounded border border-dashed border-line px-2 py-1 text-2xs text-gray-400">
      控件「{control}」未实现
    </div>
  );
}


/** 控件派发表：**每个控件一个文件**（规格 §12）；新增控件只需加一行 + 在 IMPLEMENTED_CONTROLS 里登记 */
export function PropertyControl({ item, value, onChange, nodeId, allProps, onPatch }: ControlProps) {
  const wide = WIDE_CONTROLS.has(item.control);
  /** 行的视觉/气泡统一由 PropertyRow 负责（这里只出控件本体） */
  const field = (children: React.ReactNode) => (
    <PropertyRow item={item} value={value} wide={wide}>
      {children}
    </PropertyRow>
  );
  const p = { item, value, onChange, nodeId, allProps, onPatch };

  switch (item.control) {
    case 'text':
      return field(<TextControl {...p} />);
    case 'textarea':
      return field(<TextareaControl {...p} />);
    case 'number':
      return field(<NumberControl {...p} />);
    case 'slider':
      return field(<SliderControl {...p} />);
    case 'color':
      return field(<ColorControl {...p} />);
    case 'select':
      return field(<SelectControl {...p} />);
    case 'switch':
      return field(<SwitchControl {...p} />);
    case 'align':
      return field(<AlignControl {...p} />);
    case 'font':
      return field(<FontControl {...p} />);
    case 'unit':
      return field(<UnitControl {...p} />);
    case 'edge':
      return field(<EdgeControl {...p} />);
    case 'frame':
      return field(<FrameControl {...p} />);
    case 'image':
      return field(<ImageControl {...p} />);
    case 'richtext':
      return field(<RichTextControl {...p} />);
    case 'spacing':
      return field(<SpacingControl {...p} />);
    case 'children':
      return field(<ChildrenControl nodeId={nodeId} />);
    case 'cells':
      return field(<TableCellsControl {...p} />);
    case 'tableSize':
      return field(<TableSizeControl {...p} />);
    case 'tableHtml':
      return field(<TableHtmlControl {...p} />);
    case 'tableSort':
      return field(<TableSortControl {...p} />);
    case 'tableRowHeights':
      return field(<TableRowHeightsControl {...p} />);
    case 'imageRows':
      return field(<ImageRowsControl {...p} />);
    default:
      return <NotImplemented control={item.control} />;
  }
}

/** 只读展示一行（状态抽屉用） */
export function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-2xs text-gray-500">
      <span className="w-24 shrink-0 truncate">{label}</span>
      <span className="ml-auto truncate font-mono text-gray-600" title={value}>
        {value}
      </span>
    </div>
  );
}