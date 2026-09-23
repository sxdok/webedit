/**
 * 职责：示例文档（`?demo=1`）—— **两种模式各一页，每页包含该模式下的全部组件**。
 *
 *   · 「文档模式示例」页：文档流的全部组件（每个组件前一行小标题写明「组件名（type）」），
 *     自动分页后可以逐页翻看；表格/图片/页码/分页符等都在里面。
 *   · 「Web 模式示例」页：设备画布上的全部组件，按 3 列网格摆开（带同样的标题），
 *     容器类组件（容器/卡片）也在里面，可以往里拖东西试。
 *
 * 两页就是画布上方的两个分页标签（各自独立模式），切换标签即可对照两种模式。
 * 组件清单**从注册表实时取**（`getAllComponents()`）：新增/删除组件、外部热加载组件都会自动出现，
 * 不需要维护第二份清单。
 */
import { getAllComponents } from '../registry';
import {
  CATEGORY_ORDER,
  type ComponentDefinition,
  type ComponentNode,
  type EditorDocument,
  type EditorMode,
} from '../registry/types';
import { createInitialDocument, useEditorStore, type EditorPage } from './editorStore';
import { createNode } from './treeUtils';
import { createId } from '../utils/id';

/** 该模式下的全部组件（跳过自检用的 `__*` 探针；按左侧分类顺序排，便于按类浏览） */
function componentsFor(mode: EditorMode): ComponentDefinition[] {
  const rank = (c: string): number => {
    const i = (CATEGORY_ORDER as readonly string[]).indexOf(c);
    return i < 0 ? 99 : i;
  };
  return getAllComponents()
    .filter((d) => !d.type.startsWith('__') && d.supportedModes.includes(mode))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.type.localeCompare(b.type));
}

const node = (type: string, props: Record<string, unknown>, extra: Partial<ComponentNode> = {}): ComponentNode => ({
  id: createId(type.slice(0, 3)),
  type,
  props,
  ...extra,
});

/** 组件上方的小标题（一眼看出是哪个组件、type 是什么） */
const label = (def: ComponentDefinition, mode: EditorMode, extra: Partial<ComponentNode> = {}): ComponentNode =>
  node(
    mode === 'document' ? 'heading' : 'paragraph',
    mode === 'document'
      ? { text: `${def.label}（${def.type}）`, level: 4, fontSize: 11.5, marginTop: 10, marginBottom: 2 }
      : { html: `${def.label} <span style="color:#8a94a6">（${def.type}）</span>`, fontSize: 10, marginTop: 0, marginBottom: 0 },
    extra,
  );

/** 文档模式示例（全部文档模式组件，文档流里从上到下） */
export function buildDocumentDemo(): EditorDocument {
  const doc = createInitialDocument();
  const list = componentsFor('document');
  doc.mode = 'document';
  doc.title = `文档模式示例 · 全部 ${list.length} 个组件`;
  const out: ComponentNode[] = [
    node('heading', { text: '文档模式 · 全部组件示例', level: 1, align: 'center', fontSize: 20, marginBottom: 6 }),
    node('paragraph', {
      html: `本页包含文档模式下注册的 <b>全部 ${list.length} 个组件</b>；每个组件上方的小标题写明「组件名（type）」。属性都在右侧面板里改。`,
      fontSize: 11,
      align: 'center',
      marginBottom: 10,
    }),
  ];
  for (const def of list) {
    out.push(label(def, 'document'));
    out.push(createNode(def, 'document'));
  }
  doc.document.components = out;
  return doc;
}

/** Web 模式示例（全部 Web 模式组件，按 3 列网格摆在设备画布上） */
export function buildWebDemo(): EditorDocument {
  const doc = createInitialDocument();
  const list = componentsFor('web');
  doc.mode = 'web';
  doc.title = `Web 模式示例 · 全部 ${list.length} 个组件`;

  const COL = 3;
  const CELL_W = 400;
  const GAP = 24;
  const PAD = 24;
  const LABEL_H = 20;
  const items: ComponentNode[] = [
    node('heading', { text: 'Web 模式 · 全部组件示例', level: 2, fontSize: 18, marginTop: 0 }, { frame: { x: PAD, y: PAD, w: 640, h: 34 } }),
    node(
      'paragraph',
      {
        html: `本页包含 Web 模式下注册的 <b>全部 ${list.length} 个组件</b>；容器/卡片可以直接往里拖组件。`,
        fontSize: 11,
        marginTop: 0,
      },
      { frame: { x: PAD + 660, y: PAD + 4, w: 640, h: 26 } },
    ),
  ];
  let x = PAD;
  let y = PAD + 60;
  let rowH = 0;
  let col = 0;
  for (const def of list) {
    const w = def.defaultFrame?.w ?? 240;
    const h = def.defaultFrame?.h ?? 60;
    items.push(label(def, 'web', { frame: { x, y, w: CELL_W, h: LABEL_H } }));
    items.push({ ...createNode(def, 'web'), frame: { x, y: y + LABEL_H, w, h } });
    rowH = Math.max(rowH, LABEL_H + h);
    col += 1;
    if (col >= COL) {
      col = 0;
      x = PAD;
      y += rowH + GAP;
      rowH = 0;
    } else {
      x += CELL_W + GAP;
    }
  }
  doc.web.canvas = {
    ...doc.web.canvas,
    device: 'Custom',
    width: Math.max(1440, PAD * 2 + COL * CELL_W + (COL - 1) * GAP),
    height: Math.max(900, y + rowH + PAD),
  };
  doc.web.root.children = items;
  return doc;
}

/** 两页示例（文档模式页 + Web 模式页） */
export function buildDemoPages(): EditorPage[] {
  const d = buildDocumentDemo();
  const w = buildWebDemo();
  return [
    { id: d.id, title: d.title, mode: d.mode, doc: d },
    { id: w.id, title: w.title, mode: w.mode, doc: w },
  ];
}

/** 把两页示例灌进 store（分页标签会出现两页；第一页是文档模式示例） */
export function seedDemo(): void {
  const pages = buildDemoPages();
  useEditorStore.getState().setPages(pages, pages[0].id);
}
