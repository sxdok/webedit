/**
 * 职责：全局快捷键（§6.1）。只在焦点不在输入框时生效，避免和属性面板输入冲突。
 */
import { useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { findParentId, flatten, getForest } from '../../store/treeUtils';
import {
  clampCell,
  parseTableData,
  readCellBlock,
  rectKeys,
  serializeTableData,
  tableGrid,
  writeCellBlock,
} from '../../registry/components/common/tableKit';
import { log } from '../../utils/logger';
import { toggleFullscreen } from '../../utils/viewActions';
import { exportJsonFile, openJsonFile, saveAsHtmlFile } from './fileActions';

/** 单元格剪贴板（编辑器态，不进文档、不入持久化）；Ctrl+C/V 在表格选中单元格时优先作用于单元格 */
let cellClipboard: string[][] | null = null;

/** 方向键 → 行列增量（单元格导航用） */
const ARROW_STEP: Record<string, [number, number]> = {
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
};

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

/** `选中的单元格键` → 0 基矩形（"行,列"） */
function cellRange(cells: string[]): { r0: number; c0: number; r1: number; c1: number } | null {
  const pts = cells
    .map((k) => k.split(',').map((n) => Number(n)))
    .filter((p) => p.length === 2 && p.every((n) => Number.isFinite(n)));
  if (!pts.length) return null;
  return {
    r0: Math.min(...pts.map((p) => p[0])),
    r1: Math.max(...pts.map((p) => p[0])),
    c0: Math.min(...pts.map((p) => p[1])),
    c1: Math.max(...pts.map((p) => p[1])),
  };
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const S = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const ids = S.doc.selectedIds;
      const primary = ids[0];
      // 表格里选中了单元格时：Ctrl+C/V 与方向键作用于**单元格**（Excel 习惯），否则作用于组件
      const sel = S.ui.tableCells;
      const cellNode = sel ? flatten(getForest(S.doc)).find((f) => f.node.id === sel.nodeId)?.node : undefined;

      if (e.key === 'Escape') {
        S.selectComponent([]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        S.setNewDocOpen(true); // 新建：先选模式再填参数（类似 PS）
        return;
      }
      /* ── 单元格复制 / 粘贴（有单元格选择时优先于组件复制粘贴）── */
      if (mod && e.key.toLowerCase() === 'c' && sel && cellNode) {
        e.preventDefault();
        const r = cellRange(sel.cells);
        const rows = parseTableData(cellNode.props.data);
        cellClipboard = r ? readCellBlock(rows, r.r0, r.c0, r.r1, r.c1) : null;
        log.action('copyCells', { nodeId: sel.nodeId, cells: sel.cells.length, block: cellClipboard?.length ?? 0 });
        return;
      }
      if (mod && e.key.toLowerCase() === 'v' && sel && cellNode && cellClipboard) {
        e.preventDefault();
        const r = cellRange(sel.cells);
        const rows = parseTableData(cellNode.props.data);
        // 粘贴到选区左上角
        const next = writeCellBlock(rows, r?.r0 ?? 0, r?.c0 ?? 0, cellClipboard);
        S.updateProps(sel.nodeId, { data: serializeTableData(next) });
        log.action('pasteCells', { nodeId: sel.nodeId, rows: cellClipboard.length });
        return;
      }
      /* ── 单元格键盘导航（Excel 习惯）：方向键移动活动格、Shift+方向键扩选、Tab 下一格、Enter 跳「内容」框 ── */
      if (sel && cellNode && (ARROW_STEP[e.key] || e.key === 'Tab' || e.key === 'Enter')) {
        const rows = parseTableData(cellNode.props.data);
        const grid = tableGrid(rows);
        const rng = cellRange(sel.cells);
        // 活动格 = 选区最后一个（拖选/扩选后就是刚落到的那一格）
        const [ar, ac] = (sel.cells[sel.cells.length - 1] ?? '0,0').split(',').map((n) => Number(n));
        if (e.key === 'Enter') {
          // 先收敛到活动格（「内容」框只在**单格**选中时可用），下一帧再把焦点交给它
          e.preventDefault();
          S.selectTableCells(sel.nodeId, [`${ar},${ac}`]);
          window.setTimeout(() => {
            const ta = document.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null;
            ta?.focus();
            ta?.select();
          }, 60);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const flat = (ar * grid.cols + ac + (e.shiftKey ? -1 : 1) + grid.rows * grid.cols) % (grid.rows * grid.cols);
          const next = `${Math.floor(flat / grid.cols)},${flat % grid.cols}`;
          S.selectTableCells(sel.nodeId, [next]);
          return;
        }
        const [dr, dc] = ARROW_STEP[e.key];
        const to = clampCell(ar + dr, ac + dc, grid);
        e.preventDefault();
        if (e.shiftKey && rng) {
          // 从选区左上角拉到新的焦点格（Excel 的 Shift+方向键扩选）
          const anchor = `${rng.r0},${rng.c0}`;
          S.selectTableCells(sel.nodeId, rectKeys(anchor, `${to.r},${to.c}`));
        } else {
          S.selectTableCells(sel.nodeId, [`${to.r},${to.c}`]);
        }
        return;
      }
      /* ── 层级：Ctrl+] 上移一层 / Ctrl+[ 下移一层 ── */
      if (mod && (e.key === ']' || e.key === '[')) {
        if (!primary) return;
        e.preventDefault();
        ids.forEach((id) => (e.key === ']' ? S.bringForward(id) : S.sendBackward(id)));
        return;
      }
      /* ── Tab / Shift+Tab：在组件之间移动选择（按画布的扁平顺序循环）── */
      if (e.key === 'Tab' && ids.length) {
        const flat = flatten(getForest(S.doc)).map((f) => f.node.id);
        if (flat.length) {
          e.preventDefault();
          const at = primary ? flat.indexOf(primary) : -1;
          const next = e.shiftKey ? (at <= 0 ? flat.length - 1 : at - 1) : (at + 1) % flat.length;
          S.selectComponent([flat[next]]);
        }
        return;
      }
      /* ── Enter：进出容器（有子节点→进第一个子节点；否则→选父容器）── */
      if (e.key === 'Enter' && primary) {
        const forest = getForest(S.doc);
        const node = flatten(forest).find((f) => f.node.id === primary)?.node;
        e.preventDefault();
        if (node?.children?.length) S.selectComponent([node.children[0].id]);
        else {
          const parent = findParentId(forest, primary);
          if (parent) S.selectComponent([parent]);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) S.redo();
        else S.undo();
        return;
      }
      /* M-8：Windows 惯例还认 Ctrl+Y 重做（菜单里显示 Ctrl+Y，Ctrl+Shift+Z 也继续支持） */
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        S.redo();
        return;
      }
      /* M-6：剪切（Electron 标准 Edit 必备项；原来菜单与快捷键都没有） */
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        S.cutSelection();
        return;
      }
      /* M-7：全屏（F11，Electron 标准 View 项）。桌面版走窗口全屏 IPC；浏览器退回 DOM Fullscreen API。 */
      if (e.key === 'F11') {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        S.copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        S.pasteClipboard();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        ids.forEach((id) => S.duplicateComponent(id));
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        S.selectComponent(flatten(getForest(S.doc)).map((f) => f.node.id));
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        S.setMode(S.doc.mode === 'document' ? 'web' : 'document');
        return;
      }
      /* ── 文件级快捷键（M-10；与菜单共用 components/layout/fileActions 的实现，
            保证"菜单标了什么、按下去就真做什么"）── */
      if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        // Ctrl+Shift+S = 导出 JSON…（可再编辑的工程文件）
        e.preventDefault();
        const msg = exportJsonFile();
        log.info('file', msg.split('\n')[0]);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
        // Ctrl+S = 保存为 HTML 文件（决策 #12 / Q3）
        e.preventDefault();
        const msg = saveAsHtmlFile();
        log.info('file', msg.split('\n')[0]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openJsonFile().then((msg) => {
          if (msg != null) log.info('file', msg.split('\n')[0]);
        });
        return;
      }
      if (mod && e.key === ',') {
        // Ctrl+, = 首选项（与「编辑 → 首选项…」同一入口）
        e.preventDefault();
        S.toggleUI('prefsOpen');
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        S.setZoom(S.zoom + 0.1);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        S.setZoom(S.zoom - 0.1);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        S.setZoom(1);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!ids.length) return;
        e.preventDefault();
        ids.forEach((id) => S.removeComponent(id));
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!primary) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const delta = e.key === 'ArrowUp' ? -step : step;
        if (S.doc.mode === 'web') {
          const forest = getForest(S.doc);
          const hit = flatten(forest).find((f) => f.node.id === primary);
          const frame = hit?.node.frame;
          if (frame) S.updateFrame(primary, { y: frame.y + delta });
        } else {
          const forest = getForest(S.doc);
          const parentId = findParentId(forest, primary);
          const siblings = parentId ? (findNodeById(forest, parentId)?.children ?? []) : forest;
          const index = siblings.findIndex((n) => n.id === primary);
          if (index < 0) return;
          const target = Math.max(0, Math.min(siblings.length - 1, index + (delta < 0 ? -1 : 1)));
          if (target !== index) S.moveComponent(primary, parentId, target);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function findNodeById(forest: ReturnType<typeof getForest>, id: string) {
  return flatten(forest).find((f) => f.node.id === id)?.node;
}
