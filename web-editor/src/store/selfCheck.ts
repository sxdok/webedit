/**
 * 职责：自检（?check=1）。分两段：
 *   ① 数据层（同步）：store / 注册表 / 历史栈 / 双模式隔离 / 页面与设备 / 导入导出 / 持久化；
 *   ② 渲染层（等 React 渲染一帧后）：插入组件 → 画布出现对应 DOM；切模式 → 另一模式内容仍在、当前模式不含对方节点；
 *      结束后把文档还原成自检前的状态，避免污染用户内容。
 * 结果写入 document.title、console 与右下角浮层（便于无头截图/PDF 核对）。
 * 对应验收标准：1、2、3、4、5、7、9、10。
 */
import { Type } from 'lucide-react';
import { getAllComponents, getCategoriesByMode, getComponent, getComponentsByMode, registerComponent, unregisterComponent } from '../registry';
import { COMPONENT_MODULES, collectComponents } from '../registry/components';
import { IMPLEMENTED_CONTROLS } from '../components/property-controls';
import { CATEGORY_ORDER, pageLabel, type ComponentDefinition, type ComponentNode, type EditorDocument } from '../registry/types';
import { createInitialDocument, useEditorStore } from './editorStore';
import { HISTORY_LIMIT } from './history';
import { mmToPx } from '../utils/units';

/** 标尺条的固定厚度（与 Canvas.tsx 里的 RULER_H 一致；这里只用于断言几何） */
const RULER_W = 18;
const RULER_H = 18;
import { log, planPost } from '../utils/logger';
import { buildDiagnosticReport } from '../utils/diagnostics';
import { buildComponentSpecSheet } from '../utils/specSheet';
import { buildDemoPages } from './demo';
import { parseTableHtml, serializeTableHtml } from '../registry/components/common/tableHtml';
import { buildDocMarkdown } from '../utils/markdown';
import { importHtml, importHtmlToDocument } from '../utils/htmlImport';
import { buildPluginPackage, packageFileName, validatePluginPackage, PACKAGE_FORMAT } from '../utils/pluginPackage';
import { buildDocx, docxParts, isZip } from '../utils/export/docx';
import { continueSeries, fillSeries } from '../registry/components/common/tableFill';
import { saveToRunDir } from '../utils/download';
import { findNode, findParentId, getForest, normalizeDoc } from './treeUtils';
import { routeLive } from '../mcp/liveMethods';
import { autoStartBridgeFromPrefs, bridgeSummary, setBridgeEnabled } from '../mcp/bridgeClient';
import { PERSIST_BUDGET, PERSIST_KEY, lastPersistOverflow, shouldPersist } from './persistStorage';
import { getLiveTypes, loadRuntimeComponents } from '../registry/live';

interface Result {
  name: string;
  pass: boolean;
  note: string;
}

const results: Result[] = [];
const ok = (name: string, pass: boolean, note = '') => results.push({ name, pass, note });

function makeDef(type: string, label: string, modes: ('document' | 'web')[]): ComponentDefinition {
  return {
    type,
    label,
    category: modes.includes('web') ? 'Web 专用 / 基础控件' : '通用',
    supportedModes: modes,
    icon: Type,
    defaultProps: { text: label },
    defaultFrame: { x: 20, y: 20, w: 120, h: 32 },
    propSchema: [],
    render: (props) => String(props.text ?? label),
  };
}

function finish(): void {
  const good = results.filter((r) => r.pass).length;
  const title = `check: ${good}/${results.length}${good === results.length ? ' 全部通过' : ' 有失败'}`;
  document.title = title;
  // eslint-disable-next-line no-console
  console.log(title, results);
  renderReport(title);
  // 自检结果也落盘到运行目录（logs/check-YYYY-MM-DD.log）——由启动器的 /__log 写；没有接口就静默跳过
  void log.saveReport(
    'check',
    [
      `# 自检结果 ${new Date().toLocaleString()}`,
      `# ${title}`,
      `# URL: ${location.href}`,
      ...results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? `  → ${r.note}` : ''}`),
    ].join('\n'),
  );
}

function renderReport(title: string): void {
  document.getElementById('__check_report')?.remove();
  const host = document.createElement('div');
  host.id = '__check_report';
  host.setAttribute('data-check-report', '1');
  host.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:9999;max-height:72vh;overflow:auto;' +
    'background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.18);font:12px/1.7 ui-monospace,Consolas,monospace;max-width:660px';
  host.innerHTML =
    `<div style="font-weight:700;margin-bottom:6px">${title}</div>` +
    results
      .map(
        (r) =>
          `<div style="color:${r.pass ? '#16a34a' : '#dc2626'}">${r.pass ? 'PASS' : 'FAIL'}  ${r.name}` +
          (r.note ? `  → ${r.note}` : '') +
          '</div>',
      )
      .join('');
  document.body.appendChild(host);
}

export function runSelfCheck(): void {
  results.length = 0;
  const S = () => useEditorStore.getState();

  /* ① 默认文档模式 + A4 物理尺寸（验收 1） */
  const d0 = createInitialDocument();
  const a4w = Math.round(mmToPx(d0.document.page.width));
  const a4h = Math.round(mmToPx(d0.document.page.height));
  ok('默认进入文档模式', d0.mode === 'document', d0.mode);
  ok('A4 纸张 794×1123px @96DPI', a4w === 794 && a4h === 1123, `${a4w}×${a4h}`);

  /* ② 注册表按模式过滤（验收 2、10） */
  registerCheck();

  /* ③ 控件覆盖：schema 里不允许出现未实现的 control（验收 5、10） */
  const controls = new Set<string>();
  getAllComponents().forEach((d) => d.propSchema.forEach((it) => controls.add(it.control)));
  const missing = [...controls].filter((c) => !IMPLEMENTED_CONTROLS.has(c));
  ok(
    '所有组件 schema 的控件都已实现',
    missing.length === 0,
    missing.length ? `缺：${missing.join(',')}` : `${controls.size} 种控件全部实现`,
  );

  /* ④ 双模式内容互不覆盖（验收 3） */
  S().importJSON(JSON.stringify({ ...createInitialDocument(), mode: 'document' }));
  const docId = S().addComponent('heading');
  S().setMode('web');
  const webId = S().addComponent('button');
  const docCountWhileInWeb = S().doc.document.components.length;
  const webCountWhileInWeb = (S().doc.web.root.children ?? []).length;
  S().setMode('document');
  const docKept = S().doc.document.components.some((n) => n.id === docId);
  S().setMode('web');
  const webKept = (S().doc.web.root.children ?? []).some((n) => n.id === webId);
  ok(
    '两套内容独立保留（往返切换互不覆盖）',
    !!docId && !!webId && docKept && webKept && docCountWhileInWeb === 1 && webCountWhileInWeb === 1,
    `文档侧 ${docCountWhileInWeb} 个 / Web 侧 ${webCountWhileInWeb} 个`,
  );

  /* ⑤ 模式切换可撤销（验收 8） */
  S().undo();
  const afterUndo = S().doc.mode;
  S().redo();
  ok('模式切换可撤销/重做', afterUndo === 'document' && S().doc.mode === 'web', `${afterUndo} → ${S().doc.mode}`);

  /* ⑥ 属性连续输入合并 + 历史上限（验收 8） */
  S().setMode('document');
  const t0 = S().doc.document.components[0];
  const stepsBefore = S().history.past.length;
  if (t0) for (let i = 0; i < 5; i++) S().updateProps(t0.id, { text: `t${i}` });
  const merged = S().history.past.length - stepsBefore <= 1;
  const a = S().addComponent('heading');
  const b = S().addComponent('paragraph');
  if (a && b) {
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      S().updateProps(i % 2 ? a : b, { text: `n${i}` });
      S().updateProps(i % 2 ? b : a, { text: `m${i}` });
    }
  }
  ok('连续属性输入合并成一步', merged, `本次 +${S().history.past.length - stepsBefore} 步`);
  ok('历史栈上限 50 步', S().history.past.length <= HISTORY_LIMIT, `${S().history.past.length} 步`);

  /* ⑦ 页面尺寸 / 设备预设（验收 6、7） */
  S().setPageSize('A3');
  const a3 = `${S().doc.document.page.width}×${S().doc.document.page.height}`;
  S().setPageSize('Letter');
  const letter = `${S().doc.document.page.width}×${S().doc.document.page.height}`;
  S().setPageSize('A4');
  ok('页面尺寸可切换（A3 297×420 / Letter 215.9×279.4）', a3 === '297×420' && letter === '215.9×279.4', `${a3} / ${letter}`);
  S().setMode('web');
  S().setDevice('Mobile');
  const mobile = `${S().doc.web.canvas.width}×${S().doc.web.canvas.height}`;
  S().setDevice('Desktop');
  ok('设备预设可切换（Mobile 375×812）', mobile === '375×812', mobile);

  /* ⑧ 导出 JSON → 导入往返（验收 9） */
  const json = S().exportJSON();
  const before = JSON.stringify(S().doc);
  S().importJSON(json);
  ok('导出 JSON 再导入完全还原', JSON.stringify(S().doc) === before, `${json.length} 字节`);

  /* ⑨ 持久化（验收 5） */
  const persisted = !!localStorage.getItem('visual-editor-v1');
  ok('localStorage 持久化已写入', persisted, persisted ? 'visual-editor-v1' : '未写入');

  /* ⑩ 未注册组件兜底（验收 10） */
  ok('未注册组件返回 undefined（面板/画布有兜底）', getComponent('__not_registered__') === undefined);

  /* ⑪ 日志与诊断（长期可定位性） */
  const entries = log.entries();
  const actionNames = entries.filter((e) => e.scope === 'action').map((e) => e.msg);
  ok(
    '日志记录了本次自检的动作（审计轨迹）',
    actionNames.includes('addComponent') && actionNames.includes('setMode'),
    `共 ${entries.length} 条；动作 ${actionNames.length} 个`,
  );
  ok(
    '日志带时间戳/级别/作用域',
    entries.length > 0 && entries.every((e) => typeof e.t === 'number' && !!e.level && !!e.scope),
    `样例：${entries.length ? `${entries[entries.length - 1].level}/${entries[entries.length - 1].scope}` : '-'}`,
  );

  // 模拟一次运行时错误，验证全局 error 捕获真的落进日志
  const beforeErr = log.entries().filter((e) => e.level === 'error').length;
  window.dispatchEvent(
    new ErrorEvent('error', { message: '自检模拟错误（用于验证全局捕获）', error: new Error('selfcheck-probe') }),
  );
  const afterErr = log.entries().filter((e) => e.level === 'error').length;
  ok('window 运行时错误被捕获进日志', afterErr > beforeErr, `error 条目 ${beforeErr} → ${afterErr}`);

  const report = buildDiagnosticReport();
  ok(
    '诊断报告包含环境/状态/注册表/日志四段',
    ['【运行环境】', '【编辑器状态】', '【组件注册表】', '【日志（尾部）】'].every((k) => report.includes(k)),
    `${report.length} 字符`,
  );

  finish();

  /* ══════════ 渲染层自检（等 React 画一帧）══════════ */
  window.setTimeout(() => {
    const beforeRestore = S().exportJSON();
    const dom: Result[] = [];
    const push = (name: string, pass: boolean, note = '') => dom.push({ name, pass, note });
    const q = (id: string, sel: string) => document.querySelector(`[data-node-id="${id}"] ${sel}`);

    // 从空文档开始，保证断言只针对本次插入的节点
    S().importJSON(JSON.stringify({ ...createInitialDocument(), mode: 'document' }));
    const hid = S().addComponent('heading');
    S().updateProps(String(hid), { text: '渲染自检标题', level: 2 });

    window.setTimeout(() => {
      const h2 = hid ? q(hid, 'h2') : null;
      push('文档模式：标题渲染为真实 h2 且文本正确', !!h2 && h2.textContent === '渲染自检标题', h2?.textContent ?? '未渲染');

      // 切到 Web 模式插入按钮 → 文档模式的标题节点应消失，按钮节点出现
      S().setMode('web');
      const bid = S().addComponent('button');
      S().updateProps(String(bid), { text: '渲染自检按钮' });

      window.setTimeout(() => {
        const btn = bid ? q(bid, 'button') : null;
        const headingGone = !document.querySelector('[data-node-type="heading"]');
        push('Web 模式：按钮渲染为真实 button 且文本正确', !!btn && btn.textContent === '渲染自检按钮', btn?.textContent ?? '未渲染');
        push('切到 Web 模式后文档模式节点不在画布上', headingGone, headingGone ? '已隐藏' : '仍在');

        // 切回文档模式：标题仍在、按钮不在
        S().setMode('document');
        window.setTimeout(() => {
          const h2b = hid ? q(hid, 'h2') : null;
          const btnGone = !document.querySelector('[data-node-type="button"]');
          push('切回文档模式后原内容完整保留', !!h2b && h2b.textContent === '渲染自检标题', h2b?.textContent ?? '丢失');
          push('切回后 Web 节点不在画布上', btnGone, btnGone ? '已隐藏' : '仍在');

          // 还原文档，避免污染
          S().importJSON(beforeRestore);
          push('自检后文档已还原', true);

          results.push(...dom);
          void interactionChecks().then((list) => {
            results.push(...list);
            finish();
          });
        }, 260);
      }, 260);
    }, 260);
  }, 200);
}

function registerCheck(): void {
  registerProbe();
  const inDoc = getComponentsByMode('document').map((c) => c.type);
  const inWeb = getComponentsByMode('web').map((c) => c.type);
  const webOnly = getAllComponents()
    .filter((d) => d.supportedModes.length === 1 && d.supportedModes[0] === 'web')
    .map((d) => d.type);
  const leaked = webOnly.filter((t) => inDoc.includes(t));
  ok(
    '注册表按模式过滤组件（Web 专用不出现在文档面板）',
    inDoc.includes('heading') && inWeb.includes('heading') && inWeb.includes('button') && !inDoc.includes('button') && leaked.length === 0,
    `文档模式 ${inDoc.length} 个 / Web 模式 ${inWeb.length} 个`,
  );
}

/** 注册两个探针组件，验证「只声明 supportedModes 就能被面板自动支持」 */
/** 收集一棵节点树里出现的所有 type（示例覆盖度断言用） */
function collectTypes(roots: { type: string; children?: unknown[] }[]): string[] {
  const out: string[] = [];
  const walk = (list: { type: string; children?: unknown[] }[]): void => {
    list.forEach((n) => {
      out.push(n.type);
      if (Array.isArray(n.children) && n.children.length) walk(n.children as { type: string; children?: unknown[] }[]);
    });
  };
  walk(roots);
  return out;
}

function registerProbe(): void {
  registerComponent(makeDef('__probe_doc', '探针·仅文档', ['document']));
  registerComponent(makeDef('__probe_web', '探针·仅 Web', ['web']));
}

/* ══════════════ 阶段三：交互自检（真实 PointerEvent） ══════════════ */

async function interactionChecks(): Promise<Result[]> {
  const out: Result[] = [];
  const add = (name: string, pass: boolean, note = '') => out.push({ name, pass, note });
  const S = () => useEditorStore.getState();
  const wait = (ms = 160) => new Promise((r) => setTimeout(r, ms));
  /* ★自检报告面板是 fixed 覆盖层（z-index 9999），会挡住"按真实命中点派发"的指针事件：
     不藏起来的话，下面用 elementFromPoint 做的命中测试量到的全是报告面板本身。
     （不用还原：selfCheck 结束时的 finish() 会 remove + 重建报告元素） */
  const reportHost = document.getElementById('__check_report');
  if (reportHost) reportHost.style.display = 'none';
  /**
   * 取元素中心的**屏幕坐标**，并先把它滚进视口。
   * ★必须滚进来：画布视口比设备画布（1440px）窄，不滚的话元素中心可能落在面板底下，
   *   elementFromPoint 命中的就是左侧/右侧面板，而不是画布里的元素。
   */
  const centerOf = async (el: HTMLElement): Promise<{ x: number; y: number }> => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await wait(80);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  /** 某个属性分组若默认折叠就点开它（现在只默认展开第一个分组，其余要显式展开） */
  const openGroup = async (name: string): Promise<boolean> => {
    const g = document.querySelector(`[data-prop-group="1"][data-group-name="${name}"]`) as HTMLElement | null;
    if (!g) return false;
    if (g.dataset.groupOpen !== '1') {
      (g.querySelector('button') as HTMLButtonElement | null)?.click();
      await wait(200);
    }
    return true;
  };
  /** 复位分组折叠状态（"默认展开"类断言前用：前面的用例可能点开过别的分组） */
  const resetGroups = (): void => {
    useEditorStore.setState((s) => ({ ui: { ...s.ui, propClosed: { ...s.ui.propClosed, groups: {} } } }));
  };
  const pe = (type: string, x: number, y: number, target: EventTarget) =>
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }),
    );
  const frameOf = (id: string) => findNode(getForest(S().doc), id)?.frame;

  /* ── Web 模式：移动 / 缩放 / 框选 ── */
  S().setMode('web');
  S().clearAll();
  const id = S().addComponent('button');
  if (!id) {
    add('Web 交互前置：插入按钮', false, 'addComponent 返回空');
    return out;
  }
  S().updateFrame(id, { x: 80, y: 80, w: 120, h: 32 });
  await wait();

  const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
  if (el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    pe('pointerdown', cx, cy, el);
    pe('pointermove', cx + 64, cy + 40, window);
    pe('pointerup', cx + 64, cy + 40, window);
    await wait();
    const f = frameOf(id);
    add('Web 拖动移动元素（真实 PointerEvent）', !!f && f.x > 100 && f.y > 100, f ? `x=${f.x} y=${f.y}` : '无 frame');
  } else {
    add('Web 拖动移动元素（真实 PointerEvent）', false, '找不到节点 DOM');
  }

  const before = frameOf(id);
  const handle = document.querySelector('[data-handle="se"]') as HTMLElement | null;
  if (handle && before) {
    const hr = handle.getBoundingClientRect();
    const hx = hr.left + hr.width / 2;
    const hy = hr.top + hr.height / 2;
    pe('pointerdown', hx, hy, handle);
    pe('pointermove', hx + 48, hy + 24, window);
    pe('pointerup', hx + 48, hy + 24, window);
    await wait();
    const after = frameOf(id);
    add(
      'Web 缩放手柄改变尺寸（真实 PointerEvent）',
      !!after && after.w > before.w + 16 && after.h > before.h + 8,
      after ? `${before.w}×${before.h} → ${after.w}×${after.h}` : '无 frame',
    );
  } else {
    add('Web 缩放手柄改变尺寸（真实 PointerEvent）', false, handle ? '无 frame' : '找不到 se 手柄');
  }

  const canvasEl = document.querySelector('[data-device="1"]') as HTMLElement | null;
  if (canvasEl) {
    const cr = canvasEl.getBoundingClientRect();
    S().selectComponent([]);
    pe('pointerdown', cr.left + 4, cr.top + 4, canvasEl);
    pe('pointermove', cr.left + 600, cr.top + 400, window);
    pe('pointerup', cr.left + 600, cr.top + 400, window);
    await wait();
    add('Web 框选能选中元素', S().doc.selectedIds.length >= 1, `选中 ${S().doc.selectedIds.length} 个`);
  } else {
    add('Web 框选能选中元素', false, '找不到设备画布');
  }

  /* ── 选中框**不能挡住**节点（用户 2026-09-23 反馈的 Web 模式三个问题是同一个根因）──
     以前选中框里有一层 `pointer-events-auto absolute inset-0` 的透明层，把整个节点盖住：
       ① 拖过一次之后再拖就不动了；② 容器里的子组件点不中；③ 表格单元格必须先取消选中才能点。
     这里用"节点中心 elementFromPoint 命中谁 + 连续两次真实拖动"把根因钉住。 */
  S().setMode('web');
  S().clearAll();
  const dragId = S().addComponent('button');
  if (dragId) S().updateFrame(dragId, { x: 60, y: 60, w: 140, h: 36 });
  await wait(240);
  S().selectComponent(dragId ? [dragId] : []);
  await wait(240);
  {
    const el = dragId ? (document.querySelector(`[data-node-id="${dragId}"]`) as HTMLElement | null) : null;
    const r = el?.getBoundingClientRect();
    const cx = r ? r.left + r.width / 2 : 0;
    const cy = r ? r.top + r.height / 2 : 0;
    const hit = r ? (document.elementFromPoint(cx, cy) as HTMLElement | null) : null;
    const stack = (r ? (document.elementsFromPoint(cx, cy) as HTMLElement[]) : [])
      .slice(0, 3)
      .map((n) => n.outerHTML.slice(0, 90).replace(/\s+/g, ' '))
      .join(' ‖ ');
    add(
      '选中框不吃指针事件（节点中心命中的仍是节点自己）',
      !!hit && !!hit.closest(`[data-node-id="${dragId}"]`),
      `命中栈：${stack || '无'}`,
    );

    const f0 = dragId ? frameOf(dragId) : undefined;
    // 第一次拖动：直接派发在节点上（先滚进视口）
    if (el) {
      const c1 = await centerOf(el);
      pe('pointerdown', c1.x, c1.y, el);
      pe('pointermove', c1.x + 45, c1.y + 30, window);
      pe('pointerup', c1.x + 45, c1.y + 30, window);
    }
    await wait(240);
    const f1 = dragId ? frameOf(dragId) : undefined;
    // 第二次拖动：事件派发到"该点最顶层的元素"（真人再按一次时命中的就是它）
    const el2 = dragId ? (document.querySelector(`[data-node-id="${dragId}"]`) as HTMLElement | null) : null;
    let diag = '';
    if (el2) {
      const c2 = await centerOf(el2);
      const top2 = (document.elementFromPoint(c2.x, c2.y) as HTMLElement | null) ?? el2;
      diag = `命中=${top2.outerHTML.slice(0, 46).replace(/\s+/g, ' ')}`;
      pe('pointerdown', c2.x, c2.y, top2);
      await wait(40);
      diag += `；down 后 selected=${S().doc.selectedIds.join('|') || '无'}`;
      pe('pointermove', c2.x + 45, c2.y + 30, window);
      await wait(40);
      diag += `；move 后 x=${frameOf(dragId!)?.x ?? '?'}`;
      pe('pointerup', c2.x + 45, c2.y + 30, window);
    }
    await wait(240);
    const f2 = dragId ? frameOf(dragId) : undefined;
    add(
      '定位后还能继续拖动（连续两次拖动都生效，不必重新点选）',
      !!f0 && !!f1 && !!f2 && f1.x > f0.x + 20 && f2.x > f1.x + 20,
      f0 && f1 && f2 ? `x：${f0.x} → ${f1.x} → ${f2.x}；${diag}` : `无 frame；${diag}`,
    );
  }

  /* ── 容器里的子组件：容器被选中时子组件仍可直接点选 ── */
  S().clearAll();
  const contId = S().addComponent('container');
  if (contId) S().updateFrame(contId, { x: 40, y: 40, w: 420, h: 220 });
  await wait(200);
  const childId = contId ? S().addComponent('button', contId) : null;
  if (childId) S().updateFrame(childId, { x: 24, y: 24, w: 130, h: 34 });
  await wait(300);
  S().selectComponent(contId ? [contId] : []); // 容器先选中：选中框正盖在容器上
  await wait(240);
  {
    const childEl = childId ? (document.querySelector(`[data-node-id="${childId}"]`) as HTMLElement | null) : null;
    if (childEl) {
      const c = await centerOf(childEl);
      const top = (document.elementFromPoint(c.x, c.y) as HTMLElement | null) ?? childEl;
      const before = S().doc.selectedIds.join('|');
      pe('pointerdown', c.x, c.y, top);
      const immediate = S().doc.selectedIds.join('|');
      await wait(200);
      const later = S().doc.selectedIds.join('|');
      add(
        '容器里的子组件可以直接点选（不必先取消选中容器）',
        !!childId && S().doc.selectedIds[0] === childId,
        `选中 ${later || '无'}（子组件=${childId ?? '无'}）；点前=${before} 点后立即=${immediate} 200ms 后=${later}；命中 ${top.outerHTML.slice(0, 60).replace(/\s+/g, ' ')}`,
      );
    } else {
      add('容器里的子组件可以直接点选（不必先取消选中容器）', false, '找不到子组件 DOM（容器未渲染出子节点？）');
    }
  }

  /* ── Web 容器要**裁掉越界内容**（用户 2026-09-23：子组件拖出容器后不该再看见）──
     容器 300×160、子组件放到 x=240（宽 130）→ 右侧超界 70px：
     ① 容器必须有裁剪层（inset:0 + overflow:hidden）；
     ② 容器内的点仍命中子组件；③ 超界处的点**不再**命中子组件（这才是"看不见"的行为证据）。 */
  if (contId && childId) {
    S().updateFrame(contId, { x: 60, y: 60, w: 300, h: 160 });
    S().updateFrame(childId, { x: 240, y: 20, w: 130, h: 34 });
    await wait(320);
    const contEl = document.querySelector(`[data-node-id="${contId}"]`) as HTMLElement | null;
    const childEl = document.querySelector(`[data-node-id="${childId}"]`) as HTMLElement | null;
    const clipLayer = contEl?.querySelector('[data-container-clip="1"]') as HTMLElement | null;
    const clipStyle = clipLayer ? getComputedStyle(clipLayer) : null;
    let insideHitsChild = false;
    let outsideHitsChild = false;
    let outsideEl: HTMLElement | null = null;
    if (childEl) {
      if (contEl) await centerOf(contEl);
      else await centerOf(childEl);
      const cr = childEl.getBoundingClientRect();
      const y = cr.top + cr.height / 2;
      outsideEl = document.elementFromPoint(cr.right + 24, y) as HTMLElement | null;
      insideHitsChild = !!((document.elementFromPoint(cr.left + 10, y) as HTMLElement | null)?.closest(`[data-node-id="${childId}"]`));
      outsideHitsChild = !!outsideEl?.closest(`[data-node-id="${childId}"]`);
    }
    add(
      'Web 容器裁剪越界内容（子组件拖出容器的部分不可见，也点不到）',
      !!clipStyle && clipStyle.overflow === 'hidden' && insideHitsChild && !outsideHitsChild && !!outsideEl,
      `裁剪层=${clipStyle ? `${clipStyle.position}/${clipStyle.overflow}` : '缺失'}；容器内命中子组件=${insideHitsChild}；超界处=${outsideEl ? `命中 ${outsideEl.tagName.toLowerCase()}${outsideEl.getAttribute('data-node-id') ? `#${outsideEl.getAttribute('data-node-id')}` : ''}（不是子组件）` : '视口外，未测到'}`,
    );

    /* ── 子组件被**夹在容器内**（用户 2026-09-23：拖到边上会把边框截断）── */
    {
      S().selectComponent([childId]);
      await wait(200);
      const childEl = document.querySelector(`[data-node-id="${childId}"]`) as HTMLElement | null;
      const contFrame = findNode(getForest(S().doc), contId)?.frame;
      if (childEl && contFrame) {
        const c = await centerOf(childEl);
        pe('pointerdown', c.x, c.y, childEl);
        pe('pointermove', c.x + 700, c.y + 500, window); // 远远拖出容器
        pe('pointerup', c.x + 700, c.y + 500, window);
        await wait(300);
        const after = findNode(getForest(S().doc), childId)?.frame;
        const inside =
          !!after && after.x >= 0 && after.y >= 0 && after.x + after.w <= contFrame.w + 0.5 && after.y + after.h <= contFrame.h + 0.5;
        add(
          '容器内的子组件被夹在容器内（拖到边上不会截断边框）',
          inside,
          after
            ? `容器 ${contFrame.w}×${contFrame.h}；子组件 x=${after.x} y=${after.y} w=${after.w} h=${after.h} → 右下角 ${after.x + after.w},${after.y + after.h}`
            : '无 frame',
        );
      } else {
        add('容器内的子组件被夹在容器内（拖到边上不会截断边框）', false, '找不到子组件/容器 frame');
      }
    }

    /* ── 顶层组件**拖进容器**：换父级要换算坐标（保持视觉位置）并夹在容器内 ── */
    {
      S().setMode('web');
      S().clearAll();
      const c2 = S().addComponent('container');
      if (c2) S().updateFrame(c2, { x: 60, y: 60, w: 320, h: 200 });
      await wait(220);
      const b2 = S().addComponent('button');
      if (b2) S().updateFrame(b2, { x: 460, y: 300, w: 140, h: 36 });
      await wait(280);
      const btnEl = b2 ? (document.querySelector(`[data-node-id="${b2}"]`) as HTMLElement | null) : null;
      const contEl2 = c2 ? (document.querySelector(`[data-node-id="${c2}"]`) as HTMLElement | null) : null;
      if (btnEl && contEl2 && b2 && c2) {
        const from = await centerOf(btnEl);
        const to = await centerOf(contEl2);
        pe('pointerdown', from.x, from.y, btnEl);
        // 分两步移动：先靠近，再落在容器中心（更贴近真实拖拽）
        pe('pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, window);
        await wait(60);
        pe('pointermove', to.x, to.y, window);
        await wait(60);
        pe('pointerup', to.x, to.y, window);
        await wait(320);
        const forest = getForest(S().doc);
        const movedParent = findParentId(forest, b2);
        const local = findNode(forest, b2)?.frame;
        const abs = document.querySelector(`[data-node-id="${b2}"]`)?.getBoundingClientRect();
        const contRect = contEl2.getBoundingClientRect();
        const insideContainer =
          !!abs && abs.left >= contRect.left - 1 && abs.top >= contRect.top - 1 && abs.right <= contRect.right + 1 && abs.bottom <= contRect.bottom + 1;
        add(
          '顶层组件拖进容器：换父级并换算坐标（留在容器内、位置不跳飞）',
          movedParent === c2 && !!local && insideContainer,
          `父容器=${movedParent ?? '根'}（期望 ${c2}）；局部 frame=${local ? `${local.x},${local.y} ${local.w}×${local.h}` : '无'}；画布上落在容器内=${insideContainer}`,
        );
      } else {
        add('顶层组件拖进容器：换父级并换算坐标（留在容器内、位置不跳飞）', false, '插入容器/按钮失败');
      }
    }
  }

  /* ── 表格单元格：Web 模式下也能直接点选、直接改选另一格 ── */
  S().clearAll();
  const tblId = S().addComponent('table');
  if (tblId) {
    S().updateFrame(tblId, { x: 20, y: 20, w: 520, h: 190 });
    S().updateProps(tblId, { data: '列1 | 列2 | 列3\nA | B | C\nD | E | F' });
  }
  await wait(320);
  S().selectComponent(tblId ? [tblId] : []);
  await wait(280);
  {
    const cells = tblId ? ([...document.querySelectorAll(`[data-node-id="${tblId}"] [data-cell]`)] as HTMLElement[]) : [];
    let lastHit = '';
    const clickCell = async (el: HTMLElement) => {
      const c = await centerOf(el);
      const top = (document.elementFromPoint(c.x, c.y) as HTMLElement | null) ?? el;
      lastHit = top.outerHTML.slice(0, 70).replace(/\s+/g, ' ');
      pe('pointerdown', c.x, c.y, top);
      pe('pointerup', c.x, c.y, window);
    };
    if (cells.length >= 6) {
      await clickCell(cells[1]);
      await wait(160);
      const first = (S().ui.tableCells?.cells ?? []).join('|');
      await clickCell(cells[5]); // 不取消选中，直接点另一格
      await wait(160);
      const second = (S().ui.tableCells?.cells ?? []).join('|');
      add(
        'Web 模式表格单元格可直接点选并改选另一格（无需先取消选中）',
        !!first && !!second && first !== second && S().doc.selectedIds.includes(tblId!),
        `第一次 [${first}] → 第二次 [${second}]；整表仍选中=${S().doc.selectedIds.includes(tblId!)}；单元格 DOM=${cells.length}；末次命中=${lastHit}`,
      );
    } else {
      add('Web 模式表格单元格可直接点选并改选另一格（无需先取消选中）', false, `只找到 ${cells.length} 个单元格 DOM`);
    }
  }

  /* ── 表格属性面板（用户 2026-09-23 反馈 ③ + "内容以单元格为主"）──
     ① 「数据」属性行已删除（内容改在「单元格」组里逐格改）；props.data 仍是存储形态；
     ② 新增「首列为表头」：默认关（默认仍是首行为表头），打开后第一列渲染成 th[scope=row]；
     ③ 行/列数量与单元格格式两组控件重排后不能把面板撑出横向滚动。 */
  {
    const panel = document.querySelector('[data-props-panel="1"]') as HTMLElement | null;
    const dataRow = panel?.querySelector('[data-prop-key="data"]');
    const cellText = panel?.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null;
    add(
      '表格「数据」属性行已移除，内容改由「单元格」组的内容框负责（data 仍是存储形态）',
      !dataRow && !!cellText,
      `${dataRow ? '仍存在「数据」行' : '无「数据」行'}；单元格内容框=${cellText ? '存在' : '缺失'}`,
    );

    const headColBefore = tblId ? document.querySelectorAll(`[data-node-id="${tblId}"] th[scope="row"]`).length : -1;
    if (tblId) S().updateProps(tblId, { headerCol: true });
    await wait(220);
    const headColAfter = tblId ? document.querySelectorAll(`[data-node-id="${tblId}"] th[scope="row"]`).length : -1;
    if (tblId) S().updateProps(tblId, { headerCol: false });
    await wait(140);
    add(
      '首列为表头选项：默认关闭；打开后第一列渲染成 th[scope=row]',
      headColBefore === 0 && headColAfter > 0,
      `关闭时 ${headColBefore} 个 → 打开后 ${headColAfter} 个`,
    );

    // 「行 / 列数量」控件在「表格」组里，而默认只展开第一个分组（表格类=「单元格」）→ 先点开它
    await openGroup('表格');
    const panel2 = document.querySelector('[data-props-panel="1"]') as HTMLElement | null;
    const fmt = panel2?.querySelector('[data-cell-format-box="1"]') as HTMLElement | null;
    const sizeBox = panel2?.querySelector('[data-table-size="1"]') as HTMLElement | null;
    const overflow = panel2 ? panel2.scrollWidth - panel2.clientWidth : -1;
    add(
      '表格属性控件重排：单元格格式成组显示、行/列数量成格、面板无横向溢出',
      !!fmt && !!sizeBox && overflow <= 1,
      `${fmt ? '格式盒√' : '格式盒×'} ${sizeBox ? '行列数量√' : '行列数量×'}；面板溢出 ${overflow}px`,
    );

    // 五个表格组件共用同一份 schema → 扩展的四个预设也一并去掉了「数据」行
    const tableTypes = ['table', 'threeLineTable', 'paramTable', 'detailTable', 'checkTable'];
    const withData = tableTypes.filter((t) => (getComponent(t)?.propSchema ?? []).some((i) => i.key === 'data'));
    const missingDef = tableTypes.filter((t) => !getComponent(t));
    add(
      '五个表格组件（表格 + 三线表 / 两列参数表 / 明细表 / 核对表）都没有「数据」属性行',
      withData.length === 0 && missingDef.length === 0,
      `含 data 行的：${withData.join('、') || '无'}；未注册的：${missingDef.join('、') || '无'}（共查 ${tableTypes.length} 个）`,
    );
  }

  /* ── 外部组件「参数对比表」：也按**单元格逻辑**编辑（无「参数」整块文本属性）──
     它现在用 EditorKit 暴露的表格内核渲染（renderTable + tableSchema），
     所以点选一格就能在「单元格格式」里改内容，还有「行 / 列数量」可用。 */
  {
    const cmp = getComponent('liveCompareCard');
    const keys = (cmp?.propSchema ?? []).map((i) => i.key);
    add(
      '外部组件「参数对比表」：删掉「参数」整块属性、改用单元格逻辑（含 单元格格式 / 行·列数量 控件）',
      !!cmp &&
        !keys.includes('items') &&
        !keys.includes('leftTitle') &&
        !keys.includes('rightTitle') &&
        (cmp.propSchema ?? []).some((i) => i.control === 'cells') &&
        (cmp.propSchema ?? []).some((i) => i.control === 'tableSize'),
      cmp ? `schema ${keys.length} 项：${keys.slice(0, 8).join(',')}…` : '未注册（外部组件未加载？）',
    );

    if (cmp) {
      S().setMode('document');
      S().clearAll();
      const cid = S().addComponent('liveCompareCard');
      await wait(360);
      const cellEls = cid ? ([...document.querySelectorAll(`[data-node-id="${cid}"] [data-cell]`)] as HTMLElement[]) : [];
      S().selectComponent(cid ? [cid] : []);
      await wait(240);
      if (cid && cellEls.length >= 6) {
        const c = await centerOf(cellEls[3]);
        const top = (document.elementFromPoint(c.x, c.y) as HTMLElement | null) ?? cellEls[3];
        pe('pointerdown', c.x, c.y, top);
        pe('pointerup', c.x, c.y, window);
        await wait(220);
        const picked = (S().ui.tableCells?.cells ?? []).join('|');
        const box = document.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null;
        if (box) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          setter?.call(box, '单元格改的字');
          box.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await wait(260);
        const node = findNode(getForest(S().doc), cid);
        const written = String(node?.props.data ?? '');
        const shown = document.querySelector(`[data-node-id="${cid}"] [data-cell="1,0"]`)?.textContent ?? '';
        add(
          '外部组件「参数对比表」真的能按单元格改内容（点选一格 →「内容」框 → 写回 data 与画布）',
          !!picked && !!box && written.includes('单元格改的字') && shown.includes('单元格改的字'),
          `选中格=[${picked}]；内容框=${box ? '有' : '无'}；data 含新字=${written.includes('单元格改的字')}；画布该格=「${shown}」`,
        );
      } else {
        const renderErr = document.querySelector('[data-node-render-error]') as HTMLElement | null;
        const nodeIds = document.querySelectorAll('[data-node-id]').length;
        add(
          '外部组件「参数对比表」真的能按单元格改内容（点选一格 →「内容」框 → 写回 data 与画布）',
          false,
          `单元格 DOM=${cellEls.length}；节点 cid=${cid ?? 'null'}；画布节点数=${nodeIds}；文档节点=${S().doc.document.components.map((n) => n.type).join(',') || '空'}；渲染错误框=${renderErr ? renderErr.textContent?.slice(0, 50) : '无'}`,
        );
      }
    }
  }

  /* ── 左侧分类的**名称与排序**（用户 2026-09-23：通用、布局、Word、Excel、PPT）── */
  {
    // 文档模式下正好是这五类（Web 控件/Web 容器只在 Web 模式出现）
    S().setMode('document');
    await wait(220);
    const catEls = [...document.querySelectorAll('[data-category-name]')];
    const names = catEls.map((n) => n.getAttribute('data-category-name'));
    const want = ['通用', '布局分页', 'Word 常用', 'Excel 表格', 'PPT 专用'];
    const shown = catEls.map((n) => (n.textContent ?? '').replace(/\d+$/, '').trim());
    add(
      '左侧组件分类按「通用 / 布局 / Word / Excel / PPT」排序，且用短名显示',
      names.length === want.length && want.every((w, i) => names[i] === w) && shown.join('/') === '通用/布局/Word/Excel/PPT',
      `顺序=${names.join(' > ') || '空'}；显示名=${shown.join('/') || '空'}`,
    );
  }

  /* ── 未注册组件的红框必须能删掉（用户 2026-09-23 反馈 ②）── */
  {
    const withGhost = {
      ...S().doc,
      mode: 'document' as const,
      document: { ...S().doc.document, components: [{ id: '__ghost__', type: '__not_registered__', props: {} }] },
    };
    S().importJSON(JSON.stringify(withGhost));
    await wait(240);
    /* ★画布上有两份：一份是**离屏测量层**（分页用，不带 data-node-id），一份是可见画布。
       这里要断言的是"可见那份在**可选中的节点**里"，所以挑带 data-node-id 祖先的那个。 */
    const boxes = [...document.querySelectorAll('[data-node-unregistered]')] as HTMLElement[];
    const ghost = boxes.find((b) => !!b.closest('[data-node-id]')) ?? null;
    const wrapped = ghost?.closest('[data-node-id="__ghost__"]');
    add(
      '未注册组件的红框在可选中的节点里（带 data-node-id，可点选/删除）',
      !!ghost && !!wrapped,
      ghost ? `共 ${boxes.length} 个红框（含离屏测量层）；可见那份外层节点=${wrapped ? '有 data-node-id' : '没有（会被漏掉）'}` : '找不到红框',
    );
    const del = ghost?.querySelector('[data-remove-unregistered]') as HTMLElement | null;
    del?.click();
    await wait(240);
    const gone = !([...document.querySelectorAll('[data-node-unregistered]')] as HTMLElement[]).some((b) => !!b.closest('[data-node-id]'));
    add('未注册组件可以一键删除（红框里的「删除该节点」）', !!del && gone, del ? (gone ? '点后已移除' : '点后仍在') : '找不到删除按钮');
  }

  /* ── 左右面板可拖拽调宽（用户 2026-09-23 反馈 ⑤）── */
  {
    const resizer = document.querySelector('[data-panel-resizer="left"]') as HTMLElement | null;
    const aside = document.querySelector('[data-panel="left"]') as HTMLElement | null;
    const w0 = aside?.getBoundingClientRect().width ?? -1;
    if (resizer && aside) {
      const r = resizer.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + 40;
      const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7 };
      resizer.dispatchEvent(new PointerEvent('pointerdown', base));
      resizer.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: x + 60 }));
      resizer.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: x + 60 }));
      await wait(220);
    }
    const w1 = aside?.getBoundingClientRect().width ?? -1;
    add('左右面板可拖拽调宽（真实 PointerEvent 拖动分隔条）', !!resizer && !!aside && w1 > w0 + 40, `左面板宽度 ${w0} → ${w1}px`);
    if (resizer) {
      resizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await wait(220);
    }
    const w2 = aside?.getBoundingClientRect().width ?? -1;
    add('双击分隔条恢复默认宽度（240px）', Math.abs(w2 - 240) <= 1, `双击后 ${w2}px`);
  }

  /* ── 热加载（异步阶段，此时加载一定已完成） ── */
  const liveTypes = getLiveTypes();
  add(
    '外部组件目录已热加载（无需构建）',
    liveTypes.length >= 1 && !!getComponent('liveNotice'),
    `已加载 ${liveTypes.length} 个：${liveTypes.join('、') || '无'}`,
  );
  add(
    '外部组件 schema 与内置组件共用同一套控件',
    (getComponent('liveNotice')?.propSchema ?? []).every((i) => IMPLEMENTED_CONTROLS.has(i.control)),
    `${getComponent('liveNotice')?.propSchema.length ?? 0} 个字段`,
  );

  /* ── 热加载：重载应幂等（同名先卸载再注册，不产生重复） ── */
  const beforeReload = getLiveTypes().length;
  const rr = await loadRuntimeComponents(true);
  add(
    '外部组件重载幂等（同名覆盖、类型数不增长）',
    rr.failed.length === 0 && getLiveTypes().length === beforeReload && getLiveTypes().length >= 1,
    `成功 ${rr.ok}/${rr.total}，类型数 ${beforeReload} → ${getLiveTypes().length}`,
  );

  /* ── 文档模式：自动分页 / 拖动排序 ── */
  S().setMode('document');
  S().clearAll();
  for (let i = 0; i < 12; i++) {
    const pid = S().addComponent('paragraph');
    if (pid) S().updateProps(pid, { html: `第 ${i + 1} 段：用于把内容推到第二页的示例文字。`.repeat(12) });
  }
  await wait(600);
  const papers = document.querySelectorAll('[data-paper]').length;
  add('文档模式自动分页（内容超出纸张）', papers > 1, `${papers} 页`);

  const ids = S().doc.document.components.map((n) => n.id);
  const secondEl = ids[1] ? (document.querySelector(`[data-node-id="${ids[1]}"]`) as HTMLElement | null) : null;
  if (secondEl && ids.length > 3) {
    const r = secondEl.getBoundingClientRect();
    pe('pointerdown', r.left + 10, r.top + 4, secondEl);
    pe('pointermove', r.left + 10, r.top - 300, window);
    pe('pointerup', r.left + 10, r.top - 300, window);
    await wait(260);
    const after = S().doc.document.components.map((n) => n.id);
    add(
      '文档模式拖动排序（插入指示线 + 真实 PointerEvent）',
      after[0] === ids[1],
      `原第 2 项现在位于第 ${after.indexOf(ids[1]) + 1} 位`,
    );
  } else {
    add('文档模式拖动排序（插入指示线 + 真实 PointerEvent）', false, '节点不足');
  }

  /* ── 缩放入口唯一性：顶部工具栏不再有缩放，只保留画布右下角一处（两种模式都如此） ── */
  const zoomAudit = () => {
    // 缩放控件在画布区右下角（画布区现在= [data-canvas-body]，不再叫 #canvas-viewport 的子元素）
    const pills = document.querySelectorAll('[data-canvas-body="1"] .zoom-pill').length;
    const inToolbar = document.querySelectorAll('[data-toolbar] button[title*="适应宽度"]').length;
    const toolbarZoomText = /\d+%/.test(document.querySelector('[data-toolbar]')?.textContent ?? '');
    return { pills, inToolbar, toolbarZoomText };
  };
  S().setMode('document');
  await wait(200);
  const auditDoc = zoomAudit();
  S().setMode('web');
  await wait(220);
  const auditWeb = zoomAudit();
  add(
    '缩放控件只保留右下角一处（文档/Web 两种模式一致）',
    auditDoc.pills === 1 &&
      auditWeb.pills === 1 &&
      auditDoc.inToolbar === 0 &&
      auditWeb.inToolbar === 0 &&
      !auditDoc.toolbarZoomText &&
      !auditWeb.toolbarZoomText,
    `右下角 ${auditDoc.pills}/${auditWeb.pills} 处，工具栏残留 ${auditDoc.inToolbar}/${auditWeb.inToolbar}，工具栏含百分比=${auditDoc.toolbarZoomText}/${auditWeb.toolbarZoomText}`,
  );
  S().setMode('document');
  await wait(160);

  /* ── 页面属性面板（未选中组件）：必须与组件面板**同一套规格** ──
     抽屉（通用/专有/状态）+ 26px 分组 + 28px 属性行 + 固定 96px 属性名列 + 说明只在悬停气泡里。 */
  S().selectComponent([]); // 让右侧显示"页面属性"
  await wait(200);
  {
    const pagePanel = document.querySelector('[data-props-page="1"]') as HTMLElement | null;
    // 折叠的分组先点开：审计要量全部属性行（默认只展开纸张/分页/分节页码）
    pagePanel?.querySelectorAll('[data-prop-group="1"]').forEach((g) => {
      if (!g.querySelector('[data-prop-list="1"]')) (g.querySelector('button') as HTMLButtonElement | null)?.click();
    });
    await wait(90);

    const drawers = [...(pagePanel?.querySelectorAll('[data-drawer="1"]') ?? [])].map((d) =>
      d.getAttribute('data-drawer-name'),
    );
    const groupNames = [...(pagePanel?.querySelectorAll('[data-prop-group="1"]') ?? [])].map((g) =>
      g.getAttribute('data-group-name'),
    );
    const rows = [...(pagePanel?.querySelectorAll('[data-prop-row="1"]') ?? [])] as HTMLElement[];
    const wantDrawers = ['通用属性', '专有属性', '状态'];
    // ★「分页」分组已移除（用户 2026-09-23：文档属性里的分页与组件的分页符重复，只保留组件分页符）
    const wantGroups = ['纸张', '页边距', '版式', '分节页码', '页眉', '页脚'];
    const missing = [...wantDrawers.filter((d) => !drawers.includes(d)), ...wantGroups.filter((g) => !groupNames.includes(g))];
    add(
      '页面属性面板结构：三抽屉（通用/专有/状态）+ 六个分组 + 全部属性行',
      !!pagePanel && pagePanel.clientWidth > 100 && missing.length === 0 && rows.length >= 28,
      pagePanel
        ? `面板宽 ${pagePanel.clientWidth}px；抽屉 ${drawers.length}（${drawers.join('/')}）；分组 ${groupNames.length}；属性行 ${rows.length}；缺 ${missing.length ? missing.join('/') : '无'}`
        : '未找到页面属性面板（data-props-page）',
    );

    const boxOverflow = pagePanel ? pagePanel.scrollWidth - pagePanel.clientWidth : -1;
    const rowLabel = (r: HTMLElement) =>
      (r.querySelector('[data-prop-label="1"]')?.textContent ?? '?').trim().slice(0, 8);
    const rowOverflow = rows.filter((r) => r.scrollWidth > r.clientWidth + 1).map(rowLabel);
    const wrapped = rows.filter((r) => {
      const lab = r.querySelector('[data-prop-label="1"]') as HTMLElement | null;
      return !!lab && lab.getBoundingClientRect().height > 18;
    }).length;
    // 非整行式属性行的属性名列必须正好 96px（规格 §3）
    const badLabelW = rows
      .filter((r) => r.dataset.propWide !== '1')
      .filter((r) => {
        const lab = r.querySelector('[data-prop-label="1"]') as HTMLElement | null;
        if (!lab) return true;
        return Math.abs(lab.getBoundingClientRect().width - 96) > 2;
      }).length;
    const tooTall = rows.filter((r) => r.dataset.propWide !== '1' && r.getBoundingClientRect().height > 40).length;
    add(
      '页面属性面板排版：无溢出 / 属性名列 96px / 无折行无超高行',
      rows.length >= 28 && rowOverflow.length === 0 && wrapped === 0 && badLabelW === 0 && tooTall === 0 && boxOverflow <= 1,
      `${rows.length} 行；横向溢出 ${rowOverflow.length}、属性名列非 96px ${badLabelW}、折行 ${wrapped}、超高 ${tooTall}；面板溢出 ${boxOverflow}px`,
    );

    // 规格 §7：说明默认隐藏 —— 面板里不铺说明文字，每个属性名都挂着气泡触发器
    const prose = pagePanel ? pagePanel.querySelectorAll('p').length : -1;
    const noTip = rows.filter((r) => !r.querySelector('[data-tip="1"]')).length;
    add(
      '页面属性说明默认隐藏（面板内无说明段落，属性名均可悬停出气泡）',
      prose === 0 && rows.length >= 28 && noTip === 0,
      `说明段落 ${prose} 个、缺气泡的属性行 ${noTip} 行`,
    );

    const bandBox = pagePanel?.querySelector('[data-band-editor="1"]') as HTMLElement | null;
    add(
      '页眉/页脚编辑区不溢出面板宽度',
      !!bandBox && bandBox.scrollWidth - bandBox.clientWidth <= 1,
      bandBox ? `溢出 ${bandBox.scrollWidth - bandBox.clientWidth}px` : '未找到编辑区（data-band-editor）',
    );
  }

  /* ── 左侧组件面板：**两列网格**对齐（每行 2 个、等宽等高）、图标 24px、名称单行省略 ──
     背景：Tooltip 的包装元素若用行内级盒子（inline-flex），组件项会横向流动成"挤在一起的两列"，
     宽度参差、名称也不省略。这里把"两列对齐 + 等宽 + 省略号"钉成断言。 */
  {
    // ★紧凑两列是「显示预览」**关掉**时的形态（B9 开了缩略图就变成单列卡片）；
    //   这里先关掉预览验紧凑布局，验完再打开（顺便把开关本身也走一遍）。
    S().setCompPreview(false);
    await wait(280);
    const grid = document.querySelector('[data-comp-grid="1"]') as HTMLElement | null;
    const items = [...(grid?.querySelectorAll('[data-comp-item="1"]') ?? [])] as HTMLElement[];
    const perRow = (() => {
      const byTop = new Map<number, number>();
      items.forEach((it) => {
        const t = Math.round(it.getBoundingClientRect().top);
        byTop.set(t, (byTop.get(t) ?? 0) + 1);
      });
      return [...byTop.values()];
    })();
    const widths = items.map((it) => Math.round(it.getBoundingClientRect().width));
    const heights = items.map((it) => Math.round(it.getBoundingClientRect().height));
    const wSpread = widths.length ? Math.max(...widths) - Math.min(...widths) : -1;
    const twoCol = perRow.length > 1 && perRow.slice(0, -1).every((n) => n === 2);
    add(
      '左侧组件面板：两列网格对齐（每行 2 个、两列等宽、行高一致）',
      items.length >= 8 && twoCol && wSpread <= 1 && heights.every((h) => Math.abs(h - 32) <= 1),
      grid
        ? `${items.length} 项；每行 ${perRow.join('/')} 个；宽度极差 ${wSpread}px；行高 ${[...new Set(heights)].join('/')}`
        : '未找到组件网格（data-comp-grid）',
    );

    const iconW = items.map((it) => Math.round((it.querySelector('[data-comp-icon="1"]') as HTMLElement | null)?.getBoundingClientRect().width ?? 0));
    const names = items.map((it) => it.querySelector('[data-comp-name="1"]') as HTMLElement | null);
    const wrappedName = names.filter((n) => !!n && n.getBoundingClientRect().height > 24).length;
    const ellipsis = names.filter((n) => !!n && getComputedStyle(n).textOverflow === 'ellipsis').length;
    add(
      '左侧组件项：图标 24px、名称单行省略（超长自动省略号，不换行）',
      items.length >= 8 && iconW.every((w) => Math.abs(w - 24) <= 1) && wrappedName === 0 && ellipsis === names.length,
      `图标 ${[...new Set(iconW)].join('/')}px；名称换行 ${wrappedName} 行；带省略号 ${ellipsis}/${names.length}`,
    );

    // 「通用」分类里有 7/9 字的长名称（徽章/按键标签、提示/示意/警示框）：展开它验证**真的**被省略
    const catBtn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').replace(/\s+/g, '').startsWith('通用'),
    ) as HTMLButtonElement | undefined;
    catBtn?.click();
    await wait(90);
    const longName = [...document.querySelectorAll('[data-comp-name="1"]')].find((n) =>
      (n.textContent ?? '').length >= 7,
    ) as HTMLElement | undefined;
    const longTruncated = !!longName && longName.scrollWidth > longName.clientWidth + 1;
    const longSingleLine = !!longName && longName.getBoundingClientRect().height <= 24;
    add(
      '左侧组件长名称按列宽省略（≥7 字自动省略号，仍不换行）',
      !!longName && longTruncated && longSingleLine,
      longName
        ? `「${longName.textContent}」文本宽 ${longName.scrollWidth}px / 列宽 ${longName.clientWidth}px，行高 ${Math.round(longName.getBoundingClientRect().height)}px`
        : '未找到 ≥7 字的组件名（通用分类未展开？）',
    );
    catBtn?.click(); // 还原折叠状态
    await wait(60);
    S().setCompPreview(false); // 还原「显示缩略图」的**默认值（关）**，后面的 B9 断言从这里起步
    await wait(280);
  }

  /* ── 打印外壳审计：主行里除 main 以外的元素（面板/折叠把手等）必须都标了 no-print ── */
  // 只审计主行这一层（div.print-block）；main 也带 print-block 类，
  // 用元素名 div 限定，否则会把 main 的子元素 #canvas-viewport 也算成外壳元素
  const shells = [...document.querySelectorAll('div.print-block > *:not(main)')];
  const missing = shells.filter((el) => !el.classList.contains('no-print')).map((el) => el.className.slice(0, 40));
  add(
    '打印外壳元素全部标记 no-print（不会印到纸上）',
    shells.length >= 2 && missing.length === 0,
    `${shells.length} 个外壳元素，未标记 ${missing.length} 个${missing.length ? '：' + missing.join(' / ') : ''}`,
  );

  /* ── 导出：HTML / Word 内容特征 ── */
  const exportHtml = S().exportHTML();
  add(
    '导出 HTML 是完整文档（@page + 正文内容）',
    exportHtml.startsWith('<!doctype html>') &&
      exportHtml.includes('@page') &&
      exportHtml.includes('<div') &&
      exportHtml.includes(S().doc.title) &&
      exportHtml.length > 800,
    `${exportHtml.length} 字节`,
  );
  // ★2026-09-23 用户要求：**移除导出 .doc**（HTML 版式的 Word），只保留真 .docx；
  //   所以这里不再断言 .doc，改为断言"菜单里没有 .doc、有 .docx"（见下面菜单结构断言）。

  /* ── 导出 React 代码（阶段五最后一项）── */
  S().setMode('web');
  await wait(200);
  S().clearAll();
  const rxBtn = S().addComponent('button');
  if (rxBtn) S().updateFrame(rxBtn, { x: 120, y: 64, w: 160, h: 40 });
  await wait(220);
  const reactCode = S().exportReact();
  add(
    '导出 React：含组件函数与默认导出',
    reactCode.includes('export function ExportedDocument') && reactCode.includes('export default'),
    `${reactCode.length} 字节`,
  );
  add(
    '导出 React：含 Tailwind 布局类（Web 绝对定位来自 frame）',
    reactCode.includes('className=') && /absolute left-\[120px\] top-\[64px\]/.test(reactCode),
    `absolute=${/absolute left-\[120px\]/.test(reactCode)} w=${/w-\[160px\]/.test(reactCode)}`,
  );
  add(
    '导出 React：不再是占位实现',
    !reactCode.includes('待实现') && reactCode.includes('<button'),
    `${reactCode.length} 字节，含 <button>=${reactCode.includes('<button')}`,
  );

  /* ── 组件树：拖拽改层级 ── */
  const treeContainer = S().addComponent('container');
  const treeButton = S().addComponent('button');
  let reparented = false;
  if (treeContainer && treeButton) {
    S().reparentComponent(treeButton, treeContainer);
    const f = getForest(S().doc);
    reparented = !!findNode(f, treeContainer)?.children?.some((c) => c.id === treeButton);
  }
  if (!S().ui.showTree) S().toggleUI('showTree'); // 组件树面板默认关闭，先打开再审计
  await wait(260);
  const treeRows = document.querySelectorAll('[data-tree-row="1"]');
  const draggableRows = [...treeRows].filter((r) => r.getAttribute('draggable') === 'true').length;
  add(
    '组件树拖拽改层级（reparent 生效 + 行可拖拽）',
    reparented && treeRows.length > 0 && draggableRows === treeRows.length,
    `reparent=${reparented}，可拖拽行 ${draggableRows}/${treeRows.length}`,
  );

  /* ── 页眉/页脚：页面属性（不再是组件）+ 变量替换 ── */
  add(
    '页眉页脚已改为页面属性（组件已移除）',
    !getComponent('headerFooter'),
    `getComponent('headerFooter') = ${String(getComponent('headerFooter'))}`,
  );
  S().setMode('document');
  await wait(200);
  S().setPageProp('showFooter', true);
  S().setPageProp('footer', {
    left: '誉创',
    center: '第 {page} 页 / 共 {total} 页',
    right: '{date}',
    fontSize: 10.5,
    color: '#5b6472',
    showBorder: true,
    offset: 12.7,
  });
  await wait(260);
  // 位置可调：把页脚 offset 从 12.7mm 改到 40mm，页脚应明显上移（距纸底更远）
  const paperEl = document.querySelector('[data-paper]') as HTMLElement | null;
  const gapOf = () => {
    const f = document.querySelector('.page-foot') as HTMLElement | null;
    if (!f || !paperEl) return -1;
    return Math.round(paperEl.getBoundingClientRect().bottom - f.getBoundingClientRect().bottom);
  };
  const gapBefore = gapOf();
  S().setPageProp('footer', { ...S().doc.document.page.footer, offset: 40 });
  await wait(240);
  const gapAfter = gapOf();
  add(
    '页脚位置可调（距纸底 mm 生效）',
    gapBefore >= 0 && gapAfter > gapBefore + 20,
    `距纸底 ${gapBefore} → ${gapAfter}px`,
  );
  S().setPageProp('footer', { ...S().doc.document.page.footer, offset: 12.7 });
  await wait(200);

  const footEl = document.querySelector('.page-foot') as HTMLElement | null;
  const footText = (footEl?.textContent ?? '').replace(/\s+/g, ' ').trim();
  add(
    '页脚变量替换生效（{page}/{total}/{date}）',
    /第 1 页 \/ 共 \d+ 页/.test(footText) && /\d{4}-\d{2}-\d{2}/.test(footText) && footText.includes('誉创'),
    footText || '未渲染页脚',
  );

  /* ── 三段式页码：封面无页码 / 目录罗马数字 / 正文阿拉伯数字（合入自 A4 编辑器）── */
  const SEC = { hideFirstPage: true, frontMatterPages: 1, bodyStartPage: 1 };
  add(
    '三段式页码计算（封面空 / 目录罗马 / 正文阿拉伯）',
    pageLabel(1, SEC) === '' &&
      pageLabel(2, SEC) === 'I' &&
      pageLabel(3, SEC) === '1' &&
      pageLabel(4, SEC) === '2' &&
      pageLabel(1, { hideFirstPage: false, frontMatterPages: 0, bodyStartPage: 1 }) === '1',
    `封面「${pageLabel(1, SEC)}」/ 第2页「${pageLabel(2, SEC)}」/ 第3页「${pageLabel(3, SEC)}」/ 第4页「${pageLabel(4, SEC)}」`,
  );

  // 端到端：造多页文档 → 首页页脚整块不渲染、第 2 页 I、第 3 页 1
  S().clearAll();
  for (let i = 0; i < 12; i++) {
    const pid = S().addComponent('paragraph');
    if (pid) S().updateProps(pid, { html: `三段式页码自检：把内容推到多页的示例文字。`.repeat(12) });
  }
  S().setPageProp('numbering', SEC);
  await wait(620);
  const papers3 = document.querySelectorAll('[data-paper]');
  const footAt = (i: number) =>
    ((papers3[i]?.querySelector('.page-foot')?.textContent ?? '') as string).replace(/\s+/g, ' ').trim();
  const f1 = footAt(0);
  const f2 = footAt(1);
  const f3 = footAt(2);
  add(
    '三段式页码端到端（封面无页脚 / 第2页 I / 第3页 1）',
    papers3.length >= 3 && f1 === '' && /第 I 页/.test(f2) && /第 1 页/.test(f3),
    `${papers3.length} 页：首页「${f1}」/ 第2页「${f2}」/ 第3页「${f3}」`,
  );
  S().setPageProp('numbering', { hideFirstPage: false, frontMatterPages: 0, bodyStartPage: 1 });
  await wait(200);

  /* ── 分页：分页符 / 上下边距计入高度 / 点空白回页面属性 ── */
  S().setMode('document');
  S().clearAll();
  for (let i = 0; i < 6; i++) {
    const pid = S().addComponent('paragraph');
    if (pid) S().updateProps(pid, { html: `分页自检段落 ${i + 1}` });
  }
  await wait(400);
  const papersBefore = document.querySelectorAll('[data-paper]').length;

  const pbId = S().addComponent('pageBreak');
  await wait(400);
  const papersAfterPb = document.querySelectorAll('[data-paper]').length;
  add(
    '分页符强制另起一页（纸张数 +1）',
    !!pbId && papersAfterPb === papersBefore + 1,
    `${papersBefore} → ${papersAfterPb} 页`,
  );
  add(
    '页面属性面板的页数与实际纸张数一致',
    S().ui.docPageCount === papersAfterPb,
    `面板显示 ${S().ui.docPageCount} / 实际 ${papersAfterPb}`,
  );

  // 上/下边距必须计入分页高度（offsetHeight 不含 margin；漏算会把内容压到页脚上）
  S().doc.document.components.forEach((n) => {
    if (n.type === 'paragraph') S().updateProps(n.id, { marginBottom: 100 });
  });
  await wait(600);
  const papersWithMargin = document.querySelectorAll('[data-paper]').length;
  add(
    '上/下边距计入分页高度（加边距后页数增加）',
    papersWithMargin > papersAfterPb,
    `加 100mm 下边距后 ${papersAfterPb} → ${papersWithMargin} 页`,
  );

  /* ── 分页填充效率（贪心不变式）：**不许留"明明放得下"的空白** ──
     对每页算"已用高度"，再看下一页首块高度：若它 ≤ 本页剩余，就说明这块本可以填上来。
     分页符另起一页是用户显式换页，跳过。
     背景：用户反馈"很多页面有大面积空白，Edge 里能把后一页的内容往前填"。 */
  {
    S().setMode('document');
    S().clearAll();
    for (let i = 0; i < 5; i++) {
      const p = S().addComponent('paragraph');
      if (p) S().updateProps(p, { html: `分页填充自检 ${i + 1}：` + '用于占位的示例文字。'.repeat(20) });
    }
    const tFill = S().addComponent('table');
    if (tFill) {
      S().updateProps(tFill, {
        data: Array.from({ length: 20 }, (_, i) => `行 ${i + 1} | 值 ${i + 1} | 第 ${i + 1} 行说明`).join('\n'),
      });
    }
    const tailFill = S().addComponent('paragraph');
    if (tailFill) S().updateProps(tailFill, { html: '收尾段落。' });
    await wait(800);

    const fillPapers = [...document.querySelectorAll('[data-paper]')] as HTMLElement[];
    const fillFlows = fillPapers.map((p) => p.querySelector('.page-flow') as HTMLElement | null);
    const contentH = Math.round(fillFlows[0]?.getBoundingClientRect().height ?? 0);
    /** 一页里内容已用到的高度（含 margin，和分页算法的口径一致） */
    const usedOf = (flow: HTMLElement | null): number => {
      if (!flow) return 0;
      let max = 0;
      [...flow.children].forEach((c) => {
        const el = c as HTMLElement;
        if (!el.offsetHeight) return;
        const cs = getComputedStyle(el);
        const mb = Number.parseFloat(cs.marginBottom) || 0;
        max = Math.max(max, el.offsetTop + el.offsetHeight + mb);
      });
      return Math.round(max);
    };
    const blockH = (el: HTMLElement): number => {
      const cs = getComputedStyle(el);
      return Math.round(
        el.offsetHeight + (Number.parseFloat(cs.marginTop) || 0) + (Number.parseFloat(cs.marginBottom) || 0),
      );
    };
    const useds = fillFlows.map(usedOf);
    const blanks = useds.map((u) => Math.max(0, contentH - u));
    const waste: string[] = [];
    for (let i = 0; i + 1 < fillFlows.length; i += 1) {
      const first = fillFlows[i + 1]?.firstElementChild as HTMLElement | null;
      if (!first) continue;
      if (first.getAttribute('data-node-type') === 'pageBreak') continue; // 显式换页
      const room = contentH - useds[i];
      const h = blockH(first);
      if (h <= room + 1) waste.push(`第${i + 1}页剩 ${room}px 却放不下 ${h}px 的块`);
    }
    const summary = `${fillPapers.length} 页 / 版心 ${contentH}px ｜ ${useds
      .map((u, i) => `第${i + 1}页 用 ${u} 剩 ${blanks[i]}`)
      .join('；')}`;
    add(
      '分页填充：除末页外每页剩余空间都放不下下一页首块（贪心填满，不留可填的空白）',
      fillPapers.length >= 2 && waste.length === 0,
      waste.length ? `${summary} ｜ 可填未填：${waste.join(' / ')}` : summary,
    );
  }

  /* ── 表格跨页续排（Word/HTML 的表格跨页行为）──
     放不下的表**按行拆到下一页**、续表重复表头；以前整块推到下一页 → 上一页留一大片空白。 */
  {
    S().setMode('document');
    S().clearAll();
    for (let i = 0; i < 3; i++) {
      const p = S().addComponent('paragraph');
      if (p) S().updateProps(p, { html: `表格续排自检 ${i + 1}：` + '占位文字。'.repeat(60) });
    }
    const ROWS = 24;
    const tSplit = S().addComponent('table');
    if (tSplit) {
      S().updateProps(tSplit, {
        headerRow: true,
        data: ['序号 | 名称 | 说明', ...Array.from({ length: ROWS }, (_, i) => `${i + 1} | 项目 ${i + 1} | 说明文字 ${i + 1}`)].join('\n'),
      });
    }
    await wait(800);

    const segTables = [...document.querySelectorAll('[data-node-type="table"]')] as HTMLElement[];
    const conts = segTables.filter((el) => el.hasAttribute('data-node-split'));
    const withThead = segTables.filter((el) => el.querySelector('thead'));
    // 行数守恒：所有段的 tbody 行加起来 == 原始数据行数（不丢行、不重复）
    const bodyRows = segTables.reduce((n, el) => n + el.querySelectorAll('tbody tr').length, 0);
    add(
      '表格跨页续排：放不下的表按行拆到下一页（续表重复表头、正文行数守恒）',
      segTables.length >= 2 &&
        conts.length >= 1 &&
        withThead.length === segTables.length &&
        bodyRows === ROWS,
      `${segTables.length} 段（其中续表 ${conts.length}）｜正文行 ${bodyRows}/${ROWS}｜每段都有表头 ${withThead.length}/${segTables.length}`,
    );
  }

  /* ── 表格列宽策略（"单元格内容按 HTML 写法"）：没填列宽按内容自适应、填了列宽按比例严格分列；
        长内容/长串一律在**格内换行**，不把列撑破、不顶出版心 ── */
  {
    const paperTable = () => document.querySelector('[data-paper] [data-node-type="table"] table') as HTMLTableElement | null;
    const flowOf = () => document.querySelector('[data-paper] .page-flow') as HTMLElement | null;

    S().setMode('document');
    S().clearAll();
    const tAuto = S().addComponent('table');
    if (tAuto) {
      S().updateProps(tAuto, {
        headerRow: true,
        colWidths: '',
        data: '项目 | 说明\n短 | 这一格是很长很长很长很长很长很长很长很长很长的说明文字',
      });
    }
    await wait(320);
    const tbAuto = paperTable();
    const autoLayout = tbAuto ? getComputedStyle(tbAuto).tableLayout : 'n/a';
    const cells = [...(tbAuto?.querySelectorAll('td,th') ?? [])] as HTMLElement[];
    const cellOverflow = cells.filter((c) => c.scrollWidth > c.clientWidth + 1).length;
    const tableW = Math.round(tbAuto?.getBoundingClientRect().width ?? 0);
    const flowW = Math.round(flowOf()?.getBoundingClientRect().width ?? 0);

    S().clearAll();
    const tFixed = S().addComponent('table');
    if (tFixed) S().updateProps(tFixed, { headerRow: true, colWidths: '20,80', data: '窄列 | 宽列\nA | B' });
    await wait(320);
    const tbFixed = paperTable();
    const fixedLayout = tbFixed ? getComputedStyle(tbFixed).tableLayout : 'n/a';
    const headCells = [...(tbFixed?.querySelector('tr')?.children ?? [])] as HTMLElement[];
    const w0 = headCells[0]?.getBoundingClientRect().width ?? 0;
    const w1 = headCells[1]?.getBoundingClientRect().width ?? 0;
    const ratio = w1 > 0 ? w0 / w1 : 0;
    add(
      '表格列宽：未填列宽按内容自适应、填了列宽按比例严格分列（长内容在格内换行、不顶出版心）',
      autoLayout === 'auto' &&
        fixedLayout === 'fixed' &&
        cellOverflow === 0 &&
        tableW > 0 &&
        tableW <= flowW + 1 &&
        Math.abs(ratio - 0.25) < 0.06,
      `未填列宽 layout=${autoLayout}（表宽 ${tableW} / 版心 ${flowW}，溢出格 ${cellOverflow}）；填 20,80 layout=${fixedLayout}（列宽比 ${ratio.toFixed(2)}，期望 0.25）`,
    );
  }

  /* ── 单元格内容可直接改（不再只能去改整块「数据」文本）+ 面板里不留常驻说明文字 ── */
  {
    S().setMode('document');
    S().clearAll();
    const tCell = S().addComponent('table');
    if (tCell) {
      S().updateProps(tCell, { data: '甲 | 乙\n丙 | 丁', headerRow: true });
      await wait(320);
      S().selectComponent([tCell]);
      S().selectTableCells(tCell, ['1,1']); // 第 2 行第 2 列
      await wait(220);

      const input = document.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null;
      const before = input?.value ?? '(未找到内容输入框)';
      /** React 受控组件：用原生 setter + input 事件才能触发 onChange */
      const typeInto = (el: HTMLTextAreaElement | null, text: string) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      typeInto(input, '新内容');
      await wait(320);
      const nodeNow = S().doc.document.components.find((n) => n.id === tCell);
      const dataNow = String(nodeNow?.props.data ?? '');
      const td = document.querySelector(`[data-node-id="${tCell}"] td[data-cell="1,1"]`);
      const painted = (td?.textContent ?? '').trim();
      add(
        '单元格内容可直接改（选中一格 → 「内容」输入框 → 同时写回 data 与画布）',
        before === '丁' && dataNow.includes('新内容') && painted === '新内容' && dataNow.includes('甲 | 乙'),
        `输入框原值「${before}」；data=「${dataNow.replace(/\n/g, ' ⏎ ')}」；画布该格=「${painted}」`,
      );

      /* 格内换行 与 内容里的竖线（转义）：`\n` 存的是两个字符，渲染成真换行；`|` 转义成 `\|` 不拆列 */
      const tdBefore = document.querySelector(`[data-node-id="${tCell}"] tr:nth-child(1)`)?.children.length ?? 0;
      const fresh = document.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null;
      typeInto(fresh, '第一行\n第二行');
      await wait(320);
      const tdNl = document.querySelector(`[data-node-id="${tCell}"] td[data-cell="1,1"]`) as HTMLElement | null;
      const nlText = tdNl?.textContent ?? '';
      const nlH = Math.round(tdNl?.getBoundingClientRect().height ?? 0);
      typeInto(document.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null, 'A|B');
      await wait(320);
      const tdPipe = document.querySelector(`[data-node-id="${tCell}"] td[data-cell="1,1"]`) as HTMLElement | null;
      const dataPipe = String(S().doc.document.components.find((n) => n.id === tCell)?.props.data ?? '');
      const colsAfter = document.querySelector(`[data-node-id="${tCell}"] tr:nth-child(1)`)?.children.length ?? 0;
      add(
        '单元格内容支持格内换行与竖线（\\n 渲染成两行；| 转义成 \\| 不拆列）',
        nlText === '第一行\n第二行' &&
          nlH > 24 &&
          (tdPipe?.textContent ?? '').trim() === 'A|B' &&
          dataPipe.includes('A\\|B') &&
          colsAfter === tdBefore,
        `换行：文字=${JSON.stringify(nlText)}、格高 ${nlH}px；竖线：画布=「${(tdPipe?.textContent ?? '').trim()}」、data 含 \\| =${dataPipe.includes('A\\|B')}、列数 ${tdBefore}→${colsAfter}`,
      );

      /* 插入行时选中格跟着内容平移（否则格式跟着走、选中框留在原地，看着像内容丢了） */
      S().selectTableCells(tCell, ['1,1']);
      await wait(200);
      typeInto(document.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null, '要跟着走的字');
      await wait(300);
      const beforeIns = (document.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null)?.value ?? '';
      await openGroup('表格'); // 「插入行」在「表格」组里（默认只展开第一个分组）
      (document.querySelector('[data-table-ins-row="1"]') as HTMLButtonElement | null)?.click();
      await wait(360);
      const selAfter = S().ui.tableCells?.cells.join(' ') ?? '(无)';
      const textAfter = (document.querySelector('[data-cell-text="1"]') as HTMLTextAreaElement | null)?.value ?? '(无)';
      const movedTd = document.querySelector(`[data-node-id="${tCell}"] td[data-cell="2,1"]`);
      add(
        '插入行时选中的单元格跟着内容一起平移（格式/列宽/选区同一规则）',
        beforeIns === '要跟着走的字' && selAfter === '2,1' && textAfter === '要跟着走的字' && (movedTd?.textContent ?? '') === '要跟着走的字',
        `插入前选区 1,1 内容「${beforeIns}」→ 插入后选区 ${selAfter}、「内容」框「${textAfter}」、画布 (2,1)=「${(movedTd?.textContent ?? '').trim()}」`,
      );

      /* 这个组件到底是不是"HTML 格式"：**渲染出来的是真 HTML 表格**（<table><caption><colgroup><thead><th><tbody><td>），
         但**存储**不是 HTML 源码 —— 数据是 `a | b` 文本 + A1 键的格式表。这条把 DOM 骨架钉下来。 */
      const tbl = document.querySelector(`[data-node-id="${tCell}"] table`) as HTMLTableElement | null;
      const skeleton = tbl
        ? [...tbl.querySelectorAll('*')].slice(0, 8).map((el) => `<${el.tagName.toLowerCase()}>`).join('')
        : '(无)';
      add(
        '表格渲染为真 HTML 表格（真实 table/thead/th/tbody/td 元素，不是 div 拼的）',
        !!tbl &&
          !!tbl.querySelector('thead > tr > th') &&
          !!tbl.querySelector('tbody > tr > td') &&
          !!tbl.querySelector('colgroup > col') &&
          !!tbl.querySelector('td,th'),
        `DOM 骨架：${skeleton}；td 数=${tbl?.querySelectorAll('td').length ?? 0}、th 数=${tbl?.querySelectorAll('th').length ?? 0}`,
      );

      /* ── 表格 HTML ↔ 组件数据（"用 HTML 代码写表格"）：纯函数往返 + 面板入口 ── */
      const src =
        '<table><thead><tr><th>项目</th><th>取值</th></tr></thead><tbody>' +
        '<tr><td style="background:#fff2cc">纸张</td><td>A4</td></tr>' +
        '<tr><td colspan="2">A3/A4/Letter<br>一行两列</td></tr></tbody></table>';
      const parsed = parseTableHtml(src);
      const back = parsed ? serializeTableHtml({ data: parsed.data, headerRow: parsed.headerRow, cellStyles: parsed.cellStyles }) : '';
      const mergeKey = parsed ? Object.keys(parsed.cellStyles).find((k) => k.includes(':')) : undefined;
      add(
        '表格 HTML 可解析成组件数据（行/列、首行表头、底色、合并、<br>换行都认得）',
        !!parsed &&
          parsed.rows === 3 &&
          parsed.cols === 2 &&
          parsed.headerRow &&
          parsed.data.includes('纸张') &&
          parsed.data.includes('A3/A4/Letter\\n一行两列') &&
          Object.values(parsed.cellStyles).some((s) => s.background === '#fff2cc') &&
          !!mergeKey,
        parsed
          ? `${parsed.rows} 行 × ${parsed.cols} 列；表头=${parsed.headerRow}；底色格=${Object.values(parsed.cellStyles).filter((s) => s.background).length}；合并键=${mergeKey ?? '无'}；data=「${parsed.data.replace(/\n/g, ' ⏎ ')}」`
          : '解析失败（返回 null）',
      );
      add(
        '表格可反向生成 HTML（含 thead/th、合并 colspan、底色与 <br>）',
        back.includes('<thead>') &&
          back.includes('<th') &&
          back.includes('colspan="2"') &&
          back.includes('background-color:#fff2cc') &&
          back.includes('<br>'),
        `生成 ${back.length} 字符；含 thead=${back.includes('<thead>')}、colspan=${back.includes('colspan="2"')}、底色=${back.includes('background-color:#fff2cc')}、<br>=${back.includes('<br>')}`,
      );

      // 面板入口：粘贴到「HTML 源码」→ 点「导入 HTML」→ 画布表格真的变了
      await openGroup('表格'); // 「HTML 源码」在「表格」组里（默认只展开第一个分组）
      const htmlBox = document.querySelector('[data-table-html-text="1"]') as HTMLTextAreaElement | null;
      typeInto(htmlBox, '<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr></table>');
      await wait(160);
      (document.querySelector('[data-table-html-import="1"]') as HTMLButtonElement | null)?.click();
      await wait(360);
      const importedData = String(S().doc.document.components.find((n) => n.id === tCell)?.props.data ?? '');
      const importedHtml = (document.querySelector(`[data-node-id="${tCell}"] table`) as HTMLTableElement | null)?.outerHTML ?? '';
      add(
        '表格属性面板：粘贴 HTML → 「导入 HTML」→ 直接换成那张表（走的是组件自己的 data/cellStyles）',
        !!htmlBox &&
          importedData.includes('A | B') &&
          importedData.includes('x | y') &&
          importedHtml.includes('<th') &&
          importedHtml.includes('>x<'),
        `data=「${importedData.replace(/\n/g, ' ⏎ ')}」；画布含 <th>=${importedHtml.includes('<th')}、含 x=${importedHtml.includes('>x<')}`,
      );

      // 说明不许铺在面板上：展开全部分组后，属性面板里不应有 <p> 说明段落
      document.querySelectorAll('[data-props-panel] [data-prop-group="1"]').forEach((g) => {
        if (!g.querySelector('[data-prop-list="1"]')) (g.querySelector('button') as HTMLButtonElement | null)?.click();
      });
      await wait(120);
      const panelNow = document.querySelector('[data-props-panel="1"]') as HTMLElement | null;
      const prose = panelNow ? [...panelNow.querySelectorAll('p')].map((p) => (p.textContent ?? '').slice(0, 30)) : [];
      add(
        '表格属性面板无常驻说明文字（说明改到悬停气泡里）',
        !!panelNow && prose.length === 0,
        prose.length ? `还有 ${prose.length} 段：${prose.join(' / ')}` : '说明段落 0 个',
      );
    } else {
      add('单元格内容可直接改（选中一格 → 「内容」输入框 → 同时写回 data 与画布）', false, 'addComponent(table) 失败');
      add('表格属性面板无常驻说明文字（说明改到悬停气泡里）', false, 'addComponent(table) 失败');
    }
  }

  // 点 A4 纸空白处（非组件）→ 取消选中 → 属性面板回到页面属性
  const firstId = S().doc.document.components[0]?.id;
  if (firstId) {
    S().selectComponent([firstId]);
    await wait(120);
    const paper = document.querySelector('[data-paper]') as HTMLElement | null;
    if (paper) {
      paper.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      await wait(160);
      add(
        '点 A4 纸空白处回到页面属性（取消选中）',
        S().doc.selectedIds.length === 0,
        `点击后选中数 ${S().doc.selectedIds.length}`,
      );
    } else {
      add('点 A4 纸空白处回到页面属性（取消选中）', false, '找不到纸张元素');
    }
  } else {
    add('点 A4 纸空白处回到页面属性（取消选中）', false, '没有可选中组件');
  }

  /* ── 画布缩放：Ctrl+滚轮只缩放画布，并阻止浏览器整页缩放 ── */
  const zoomVp = document.getElementById('canvas-viewport');
  if (zoomVp) {
    const zoomBefore = S().zoom;
    const wheelEv = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true });
    const notPrevented = zoomVp.dispatchEvent(wheelEv); // false = preventDefault 被调用（浏览器缩放被阻止）
    await wait(140);
    const zoomAfter = S().zoom;
    add(
      'Ctrl+滚轮只缩放画布（已阻止浏览器整页缩放）',
      !notPrevented && zoomAfter > zoomBefore,
      `默认行为已阻止=${!notPrevented}，缩放 ${zoomBefore} → ${zoomAfter}`,
    );
  } else {
    add('Ctrl+滚轮只缩放画布（已阻止浏览器整页缩放）', false, '找不到 #canvas-viewport');
  }

  /* ── 深色主题（Monokai）：切主题后 <html data-theme> 与外壳底色都要变 ── */
  const html = document.documentElement;
  S().setTheme('monokai');
  await wait(160);
  const darkAttr = html.dataset.theme === 'monokai';
  const panelEl = document.querySelector('aside.bg-white') as HTMLElement | null;
  const darkBg = panelEl ? getComputedStyle(panelEl).backgroundColor : '';
  S().setTheme('light');
  await wait(120);
  const lightAttr = html.dataset.theme === 'light';
  const lightBg = panelEl ? getComputedStyle(panelEl).backgroundColor : '';
  add(
    '深色主题（Monokai）切换生效且配色改变',
    darkAttr && lightAttr && darkBg !== lightBg && darkBg === 'rgb(39, 40, 34)',
    `深色 ${darkBg} / 浅色 ${lightBg}`,
  );

  /* 画布内容**不跟**编辑器主题（用户 2026-09-24：深色主题下画布里的 Web 输入框被主题涂黑了） */
  {
    S().setTheme('light');
    S().setMode('web');
    S().clearAll();
    const inNode = S().addComponent('input');
    await wait(480);
    const readInput = (): Record<string, string> | null => {
      const el = document.querySelector(`[data-node-id="${inNode}"] input`) as HTMLElement | null;
      const wrap = el?.parentElement;
      if (!el || !wrap) return null;
      const ci = getComputedStyle(el);
      const cw = getComputedStyle(wrap);
      return {
        内层底色: ci.backgroundColor,
        内层字色: ci.color,
        外层底色: cw.backgroundColor,
        外层字色: cw.color,
        外层边框: cw.borderTopColor,
        占位变量: ci.getPropertyValue('--input-ph').trim(),
      };
    };
    const lightStyle = readInput();
    S().setTheme('monokai');
    await wait(340);
    const darkStyle = readInput();
    const sameStyle = !!lightStyle && JSON.stringify(lightStyle) === JSON.stringify(darkStyle);
    add(
      '画布内容不跟编辑器主题：切到深色主题后，画布里的 Web 输入框计算样式**一点不变**',
      sameStyle,
      sameStyle
        ? `六项全等：${JSON.stringify(lightStyle)}`
        : `浅色=${JSON.stringify(lightStyle)}；深色=${JSON.stringify(darkStyle)}`,
    );

    // 组件自己可调颜色（画布改深色后，输入框也能配深色）
    if (inNode) {
      S().updateProps(inNode, {
        background: '#272822',
        color: '#f8f8f2',
        placeholderColor: '#a9a99c',
        borderColor: '#3e3d32',
        borderWidth: 2,
      });
    }
    await wait(380);
    const styled = readInput();
    add(
      '输入框能自己调颜色：背景 / 文字 / 占位 / 边框（深色画布上可配深色，且不受编辑器主题影响）',
      styled?.外层底色 === 'rgb(39, 40, 34)' &&
        styled?.内层字色 === 'rgb(248, 248, 242)' &&
        styled?.外层边框 === 'rgb(62, 61, 50)' &&
        styled?.占位变量 === '#a9a99c',
      `背景=${styled?.外层底色} 文字=${styled?.内层字色} 边框=${styled?.外层边框} 占位=${styled?.占位变量}`,
    );
    S().setTheme('light');
    S().setMode('document');
    S().clearAll();
    await wait(300);
  }

  /**
   * ══ 暗色模式**自动审计**（用户 2026-09-24：「检查所有组件有没有正确适配暗色模式」）══
   *
   * 为什么要有它：暗色不是"每个组件写一套暗色样式"，而是 `index.css` 里把外壳用到的 Tailwind
   * 工具类**一条条重映射** —— 漏一个类（尤其 `hover:`/`disabled:`/`/xx` 透明度和 `text-[#xxx]` 任意值）
   * 就留下一块浅色底板或看不见的字。人眼很难扫全 40+ 个组件的面板，所以这里**遍历全部组件**自动查。
   *
   * 判据（只看编辑器外壳；`#canvas-viewport` 里的纸张/画布是"要打印的成品"，颜色来自文档配置，不跟主题）：
   *   · 浅色底板：元素"视觉底色"（把半透明层叠出来的真实颜色）发白且接近灰；
   *   · 低对比文字：自带文字的元素，字色与视觉底色对比度 < 2.0。
   */
  {
    const parseRgb = (s: string): { r: number; g: number; b: number; a: number } | null => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => Number.parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] };
    };
    const lum = (c: { r: number; g: number; b: number }): number => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    /** 元素"看起来"的底色：把自己和祖先的半透明背景依次叠起来 */
    const shownBg = (el: Element): { r: number; g: number; b: number } => {
      const layers: { r: number; g: number; b: number; a: number }[] = [];
      let e: Element | null = el;
      while (e) {
        const c = parseRgb(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0.01) layers.push(c);
        if (c && c.a >= 0.999) break;
        e = e.parentElement;
      }
      let base = { r: 255, g: 255, b: 255 };
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const f = layers[i];
        base = {
          r: f.r * f.a + base.r * (1 - f.a),
          g: f.g * f.a + base.g * (1 - f.a),
          b: f.b * f.a + base.b * (1 - f.a),
        };
      }
      return base;
    };
    const darkAudit = (): string[] => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('#canvas-viewport') || el.closest('#__check_report')) continue;
        // 组件缩略图（`data-comp-thumb`）= 组件在"小纸"上的实时预览，属于**内容侧**，
        // 白底/浅字是它的正确外观（跟画布同理，不跟主题）
        if (el.closest('[data-comp-thumb]')) continue;
        // 取色器色板（`data-color-swatch`）：那一格的背景**就是它代表的颜色**，白色板当然得是白的
        if (el.closest('[data-color-swatch]') || el.matches('[data-color-swatch]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) continue;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue;
        const bg = shownBg(el);
        const sat = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
        // 元素签名：**不要用 `<tag>` 尖括号** —— 报告是 innerHTML 渲染的，尖括号会被当标签吃掉；
        // 顺带给出最近的 data-* 祖先和最外层 HTML 片段，好定位到底是哪一块。
        const anc = el.closest(
          '[data-props-panel],[data-comp-grid],[data-comp-item],[data-page-tabs],[data-new-doc-examples],[data-canvas-body],[data-status-bar],[data-menu-bar],[data-pref],[data-prefs-dialog]',
        );
        const ancTag = anc
          ? '@' +
            [...anc.attributes]
              .map((a) => a.name)
              .filter((n) => n.startsWith('data-'))
              .slice(0, 2)
              .join(',')
          : '';
        const snippet = el.outerHTML.replace(/</g, '‹').replace(/\s+/g, ' ').slice(0, 160);
        const label = `[${el.tagName.toLowerCase()} .${String(el.className ?? '').split(/\s+/).slice(0, 3).join('.')}]${ancTag} ${snippet}`;
        // 带上当时的主题：审计前提是"当前确实是暗色"，否则结论没意义（note 里一眼能看出）
        const stamp = document.documentElement.dataset.theme === 'monokai' ? '' : '⚠主题非暗色 ';
        if ((sat < 24 && lum(bg) > 0.6) || (lum(bg) > 0.82 && sat < 60)) {
          bad.push(`${stamp}浅色底板 ${label} 视觉底色=rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
          continue;
        }
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1);
        if (!ownText) continue;
        const fg = parseRgb(st.color);
        if (!fg || fg.a < 0.5) continue;
        const l1 = Math.max(lum(fg), lum(bg));
        const l2 = Math.min(lum(fg), lum(bg));
        const cr = (l1 + 0.05) / (l2 + 0.05);
        if (cr < 2) {
          bad.push(
            `${stamp}低对比文字 ${label} ${st.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}) 对比=${cr.toFixed(2)}`,
          );
        }
      }
      return [...new Set(bad)].slice(0, 8); // 去重 + 截断，别把 note 撑爆
    };
    /**
     * ★审计期间**临时关掉过渡动画**：无头浏览器 + `--virtual-time-budget` 下 CSS transition 不会推进，
     *   带 `transition-colors` 的元素会**停在切主题前那一刻的颜色**（浅色），把"暗色审计"整片带偏
     *   （第一版就是这样报了 39 处"深底配浅色字"，实际全是这个假象 —— 诊断里 CSS/变量/探针都是对的）。
     *   关闭过渡后颜色立即落到主题值，结果才可信。
     */
    const freezeAnim = (): (() => void) => {
      const st = document.createElement('style');
      st.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
      document.head.appendChild(st);
      return () => st.remove();
    };
    /** 属性面板默认只展开第一个分组 —— 审计前把**所有分组**都展开，否则扫不到后面的控件 */
    const openAllGroups = (): void => {
      document.querySelectorAll('button.prop-group-head').forEach((b) => {
        if (b.closest('[data-group-open]')?.getAttribute('data-group-open') === '0') (b as HTMLElement).click();
      });
    };
    /** 组件箱的分类默认只开「通用」—— 全部展开，才能审到每个组件卡片 */
    /** 审计失败时附带的环境诊断：把"主题到底生效没有"钉死（避免把浅色状态下看到的深灰当漏项） */
    const cssDiag = (): string => {
      const cs = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      probe.className = 'text-gray-700';
      probe.textContent = 'x';
      document.body.appendChild(probe);
      const probeColor = getComputedStyle(probe).color;
      probe.remove();
      let sheets = 0;
      let mkRules = 0;
      let grayRules = 0;
      for (const sheet of [...document.styleSheets]) {
        sheets += 1;
        let rules: CSSRuleList | null = null;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const r of [...(rules ?? [])]) {
          const sel = (r as CSSStyleRule).selectorText ?? '';
          if (sel.includes('data-theme') && sel.includes('monokai')) mkRules += 1;
          if (sel.includes('data-theme') && sel.includes('.text-gray-700')) grayRules += 1;
        }
      }
      return `诊断：--mk-ink=「${cs.getPropertyValue('--mk-ink').trim()}」--ui-ink-2=「${cs
        .getPropertyValue('--ui-ink-2')
        .trim()}」现造 text-gray-700 探针=${probeColor} 样式表=${sheets} monokai规则=${mkRules} text-gray-700重映射=${grayRules}`;
    };
    const openAllCategories = (): void => {
      document.querySelectorAll('button[data-category-name]').forEach((h) => {
        if (!h.parentElement?.querySelector('[data-comp-grid]')) (h as HTMLElement).click();
      });
    };

    // 语义色令牌（.ui-ink-2 等）：这是"新增界面代码别再写死颜色"的落点，必须两边都对
    const inkOf = (): string => {
      const probe = document.createElement('span');
      probe.className = 'ui-ink-2';
      probe.textContent = '探针';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    S().setTheme('monokai');
    S().setMode('document');
    S().clearAll();
    await wait(300);
    const darkInk = inkOf();
    S().setTheme('light');
    await wait(120);
    const lightInk = inkOf();
    add(
      '暗色模式：语义色令牌随主题走（.ui-ink-2 = 浅色 #374151 / 暗色 #e6e6dd；界面代码用它就别写死颜色）',
      lightInk === 'rgb(55, 65, 81)' && darkInk === 'rgb(230, 230, 221)',
      `浅色=${lightInk}；暗色=${darkInk}`,
    );

    S().setTheme('monokai');
    S().setMode('document');
    S().clearAll();
    await wait(300);
    /**
     * ★`clearAll()` / `setMode()` 会顺带重置 `ui`（主题会被带回浅色），所以**审计前必须重新确认主题**；
     *   这里做成"确认是暗色才审，否则重设再来"，并把当时的主题写进结论里 ——
     *   否则会拿浅色的 DOM 去做"暗色适配"判断（第一版就踩了这个坑：报了一堆"深底配浅色字"，
     *   实际是那一刻主题已经是浅色了，且浅色的浅色底板被当成漏项）。
     */
    const auditWhenDark = async (): Promise<string[]> => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        S().setTheme('monokai');
        const unfreeze = freezeAnim();
        await wait(200);
        if (document.documentElement.dataset.theme === 'monokai') {
          const out = darkAudit();
          const stable = document.documentElement.dataset.theme === 'monokai';
          unfreeze();
          if (stable) return out;
        } else {
          unfreeze();
        }
      }
      return ['（主题反复被重置成浅色，本次审计未取得可信结果）'];
    };
    openAllCategories();
    await wait(240);
    const offenders: string[] = (await auditWhenDark()).map((o) => `外壳/组件箱：${o}`);

    // ① 逐个组件：加一个 → 选中 → 展开全部属性分组 → 审计（含左栏组件箱）
    const allDefs = getAllComponents();
    let scanned = 0;
    for (const def of allDefs) {
      if (def.type.startsWith('__')) continue; // `__probe_*` 是自检探针，不是真组件
      const wantMode: 'document' | 'web' = def.supportedModes.includes('document') ? 'document' : 'web';
      S().setMode(wantMode);
      S().clearAll();
      const id = S().addComponent(def.type);
      if (!id) continue;
      await wait(110);
      S().selectComponent([id]);
      await wait(110);
      openAllGroups();
      await wait(110);
      scanned += 1;
      offenders.push(...(await auditWhenDark()).map((o) => `${def.type}：${o}`));
    }

    // ② 最容易漏的浮层：首选项 / 新建文档 / Markdown 源码 / 诊断面板
    const overlays: [string, () => void][] = [
      ['首选项', () => S().toggleUI('prefsOpen')],
      ['新建文档', () => S().setNewDocOpen(true)],
      ['Markdown 源码', () => S().toggleUI('showMarkdown')],
      ['诊断面板', () => S().toggleUI('showDiagnostics')],
    ];
    for (const [name, toggle] of overlays) {
      toggle();
      await wait(340);
      offenders.push(...(await auditWhenDark()).map((o) => `${name}：${o}`));
      toggle();
      await wait(200);
    }

    add(
      `暗色模式自动审计：全部 ${scanned} 个组件的属性面板（分组全展开）+ 组件箱 + 4 个浮层，没有浅色底板 / 低对比文字`,
      scanned > 40 && offenders.length === 0,
      offenders.length
        ? `${offenders.length} 处：${offenders.slice(0, 3).join(' ｜ ')} ｜ ${cssDiag()}`
        : `扫了 ${scanned} 个组件，外壳干净`,
    );

    S().setTheme('light');
    S().setMode('document');
    S().clearAll();
    await wait(260);
  }

  /* ── 标尺**脱离画布**：固定在视口顶部/左侧；画布平移时标尺自己不动，只有刻度跟着平移量走 ── */
  S().setMode('document');
  await wait(220);
  {
    const body = document.querySelector('[data-canvas-body="1"]') as HTMLElement | null;
    const boxH = document.querySelector('[data-ruler-box="h"]') as HTMLElement | null;
    const boxV = document.querySelector('[data-ruler-box="v"]') as HTMLElement | null;
    const tickBefore = boxH?.querySelector('div') as HTMLElement | null;
    const beforeBox = boxH?.getBoundingClientRect();
    const beforeTick = tickBefore?.getBoundingClientRect();
    const anchor = document.getElementById('canvas-viewport');
    const pan0 = S().ui.pan ?? { x: 0, y: 0 };
    if (body && boxH && boxV && anchor && beforeBox && beforeTick) {
      /**
       * ★标尺的"跟随量"按模式不同（用户 2026-09-23）：
       *   · **文档模式** = 滚动量（视口 overflow:auto，刻度随 scrollLeft/scrollTop 走）；
       *   · **Web 模式** = 平移量（自由平移，刻度随 pan 走）。
       *   两种模式下"标尺框本身都钉在视口边缘"这一条不变。
       * ★2026-09-23 修正：文档模式的内容宽**就是纸张宽 794px**，比视口还窄 —— 正常情况下横向
       *   根本滚不动。原来这条断言"能横滚 120px"其实是靠 `contentW` 被 Web 模式的实测值污染成
       *   1440 才成立的（那个 bug 已修，见「文档 ↔ Web 来回切模式」那条断言）。这里改成先把画布
       *   放大到 150%（794×1.5=1191 > 视口宽），再验证刻度跟着**真实滚动量**走。
       */
      S().setZoom(1.5);
      await wait(240);
      const tickOf = (box: HTMLElement): HTMLElement | null => box.querySelector('[data-ruler-ticks="h"]') as HTMLElement | null;
      const tickBefore2 = tickOf(boxH)?.getBoundingClientRect();
      // 文档模式：横向滚动 100px（放大后才有得滚），刻度应跟着走
      anchor.scrollLeft = 100;
      anchor.dispatchEvent(new Event('scroll', { bubbles: true }));
      await wait(200);
      const afterBox = boxH.getBoundingClientRect();
      const afterTick = tickOf(boxH)?.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const fixedTop = Math.abs(afterBox.top - bodyRect.top) <= 2;
      const fixedLeft = Math.abs(afterBox.left - (bodyRect.left + RULER_W)) <= 2;
      const sx = anchor.scrollLeft;
      const tickMoved = !!tickBefore2 && !!afterTick && sx > 50 && Math.abs(afterTick.left - tickBefore2.left + sx) <= 2;
      add(
        '标尺脱离画布固定在视口顶部/左侧（文档模式：标尺不动、刻度跟着**滚动量**走）',
        fixedTop && fixedLeft && tickMoved,
        `标尺框 top ${Math.round(beforeBox.top - bodyRect.top)}→${Math.round(afterBox.top - bodyRect.top)}px、left ${Math.round(afterBox.left - bodyRect.left)}px（期望 ${RULER_W}）；实际滚动 ${sx}px，刻度位移 ${afterTick && tickBefore2 ? Math.round(afterTick.left - tickBefore2.left) : '?'}px（期望 -${sx}）`,
      );
      anchor.scrollLeft = 0;
      anchor.dispatchEvent(new Event('scroll', { bubbles: true }));
      S().setZoom(1);
      await wait(160);

      // Web 模式：平移 120px，刻度跟着平移量走
      S().setMode('web');
      await wait(260);
      const boxH2 = document.querySelector('[data-ruler-box="h"]') as HTMLElement | null;
      const anchor2 = document.getElementById('canvas-viewport');
      if (boxH2 && anchor2) {
        const t0 = tickOf(boxH2)?.getBoundingClientRect();
        const panW = S().ui.pan ?? { x: 0, y: 0 };
        S().setPan({ x: panW.x - 120, y: panW.y });
        await wait(220);
        const boxRect = boxH2.getBoundingClientRect();
        const bodyRect2 = body.getBoundingClientRect();
        const t1 = tickOf(boxH2)?.getBoundingClientRect();
        add(
          '标尺脱离画布固定在视口顶部/左侧（Web 模式：标尺不动、刻度跟着**平移量**走）',
          Math.abs(boxRect.top - bodyRect2.top) <= 2 && !!t0 && !!t1 && Math.abs(t1.left - t0.left + 120) <= 2,
          `标尺框 top=${Math.round(boxRect.top - bodyRect2.top)}px；刻度位移 ${t0 && t1 ? Math.round(t1.left - t0.left) : '?'}px（期望 -120）`,
        );
        S().setPan(panW);
      } else {
        add('标尺脱离画布固定在视口顶部/左侧（Web 模式：标尺不动、刻度跟着**平移量**走）', false, '找不到 Web 模式标尺框');
      }
      S().setMode('document');
      await wait(200);
      S().setPan(pan0);
      await wait(160);
    } else {
      add('标尺脱离画布固定在视口顶部/左侧（文档模式：标尺不动、刻度跟着**滚动量**走）', false, '找不到标尺框/#canvas-viewport');
    }
  }

  /* ── 表格：列宽（colgroup）/ 行高（对齐 A4 编辑器表格属性）── */
  S().setMode('document');
  S().clearAll();
  const tRef = S().addComponent('table');
  if (tRef) {
    S().updateProps(tRef, { colWidths: '20,50,30', rowHeight: '9' });
    await wait(320);
    const cols = document.querySelectorAll(`[data-node-id="${tRef}"] colgroup col`);
    const widths = [...cols].map((c) => (c as HTMLElement).style.width);
    add(
      '表格列宽生效（colgroup 20%/50%/30%）',
      widths.length === 3 && widths[0] === '20%' && widths[1] === '50%' && widths[2] === '30%',
      `${widths.length} 列：[${widths.join(', ')}]`,
    );
    const firstCell = document.querySelector(`[data-node-id="${tRef}"] tbody tr td`) as HTMLElement | null;
    add(
      '表格行高生效（纯数字按 mm）',
      firstCell?.style.height === '9mm',
      `单元格 height=${firstCell?.style.height || '(空)'}`,
    );
    // mm 写法与"未给出的列保持自动"也要对（A4 同一套语义）
    S().updateProps(tRef, { colWidths: '35mm, 65mm' });
    await wait(240);
    const cols2 = [...document.querySelectorAll(`[data-node-id="${tRef}"] colgroup col`)].map(
      (c) => (c as HTMLElement).style.width,
    );
    add(
      '表格列宽支持 mm 且列数不缩水',
      cols2[0] === '35mm' && cols2[1] === '65mm' && cols2.length >= 3,
      `[${cols2.join(', ')}]`,
    );

    /* ── 单元格选择 → 按单元格填背景色 → 列宽拖拽手柄 ── */
    const colSpecOf = (id: string): number[] => {
      const n = S().doc.document.components.find((x) => x.id === id);
      return String(n?.props.colWidths ?? '')
        .split(',')
        .map((s) => Number.parseFloat(s))
        .filter((v) => !Number.isNaN(v));
    };
    S().updateProps(tRef, { colWidths: '20,40,40', rowHeight: '', cellStyles: {} });
    await wait(340);

    const td = document.querySelector(`[data-node-id="${tRef}"] tbody tr td`) as HTMLElement | null;
    if (td) {
      const r = td.getBoundingClientRect();
      pe('pointerdown', r.left + r.width / 2, r.top + r.height / 2, td);
      pe('pointerup', r.left + r.width / 2, r.top + r.height / 2, td);
      await wait(260);
      const sel = S().ui.tableCells;
      const cellKey = td.dataset.cell ?? '';
      const rectEl = document.querySelector('[data-cell-selected="1"]');
      const overlay = document.querySelector('[data-table-overlay="1"]') as HTMLElement | null;
      add(
        '表格单元格可点选（编辑器态选框 + 覆盖层 no-print）',
        !!sel && sel.nodeId === tRef && cellKey !== '' && sel.cells.includes(cellKey) && !!rectEl && !!overlay?.classList.contains('no-print'),
        `选中 ${sel?.cells.length ?? 0} 格 [${sel?.cells.join(' ') ?? ''}]；选框=${!!rectEl}、覆盖层 no-print=${!!overlay?.classList.contains('no-print')}`,
      );

      const json = S().exportJSON();
      add(
        '单元格选择不写进文档（不入导出/打印）',
        !json.includes('tableCells'),
        `导出 JSON ${json.length} 字节，含 tableCells=${json.includes('tableCells')}`,
      );

      /* Excel 式单元格格式：改哪项就作用到**选中的格**，同表其它格不受影响 */
      const cell2 = document.querySelector(`[data-node-id="${tRef}"] tbody tr td:nth-child(2)`) as HTMLElement | null;
      const ta2Before = cell2 ? getComputedStyle(cell2).textAlign : '';
      const weightSel = document.querySelector('[data-cell-weight="1"]') as HTMLSelectElement | null;
      const nativeSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (weightSel && nativeSel) {
        nativeSel.call(weightSel, '700');
        weightSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      (document.querySelector('[data-cell-align="center"]') as HTMLButtonElement | null)?.click();
      await wait(300);
      const fw = getComputedStyle(td).fontWeight;
      const ta = getComputedStyle(td).textAlign;
      const ta2 = cell2 ? getComputedStyle(cell2).textAlign : '';
      add(
        '单元格格式只作用于选中格（加粗/居中，不是整表）',
        fw === '700' && ta === 'center' && ta2 === ta2Before,
        `选中格 字重=${fw} 对齐=${ta}；同表另一格 对齐=${ta2}（改前 ${ta2Before}）`,
      );

      // ★A1 记法：键必须是 "B2" 这种，而不是旧的 "1,0"
      const keys = Object.keys(
        (S().doc.document.components.find((n) => n.id === tRef)?.props.cellStyles ?? {}) as Record<string, unknown>,
      );
      add(
        '单元格格式用 Excel A1 记法（如 B2），不再是 "行,列"',
        keys.length > 0 && keys.every((k) => /^[A-Z]+\d+(:[A-Z]+\d+)?$/.test(k)),
        `键：${keys.join(' ') || '（空）'}`,
      );

      // 底色：走面板上的真实颜色控件（原生 setter + input 事件 → React onChange）
      const bgInput = document.querySelector('[data-cell-bg="1"]') as HTMLInputElement | null;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (bgInput && nativeSetter) {
        nativeSetter.call(bgInput, '#ff0000');
        bgInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await wait(280);
      const bg = getComputedStyle(td).backgroundColor;
      add('单元格底色（选中格 → 颜色控件即时生效）', bg === 'rgb(255, 0, 0)', `目标 #ff0000 → 实际 ${bg || '(空)'}`);

      const json2 = S().exportJSON();
      add(
        '单元格格式是文档数据（cellStyles 进导出，与"选择"区分开）',
        json2.includes('cellStyles') && !json2.includes('tableCells'),
        `导出含 cellStyles=${json2.includes('cellStyles')}、含 tableCells=${json2.includes('tableCells')}`,
      );

      (document.querySelector('[data-cell-clear="1"]') as HTMLButtonElement | null)?.click();
      await wait(260);
      const bgAfter = getComputedStyle(td).backgroundColor;
      const fwAfter = getComputedStyle(td).fontWeight;
      add(
        '清除选中格式后回落到表格级默认',
        bgAfter === 'rgba(0, 0, 0, 0)' && fwAfter !== '700',
        `底色 ${bgAfter}、字重 ${fwAfter}`,
      );
    } else {
      add('表格单元格可点选（编辑器态选框 + 覆盖层 no-print）', false, '找不到 td');
      add('单元格选择不写进文档（不入导出/打印）', false, '找不到 td');
      add('单元格格式只作用于选中格（加粗/居中，不是整表）', false, '找不到 td');
      add('单元格底色（选中格 → 颜色控件即时生效）', false, '找不到 td');
      add('单元格格式是文档数据（cellStyles 进导出，与"选择"区分开）', false, '找不到 td');
      add('清除选中格式后回落到表格级默认', false, '找不到 td');
    }

    const before = colSpecOf(tRef);
    const handle = document.querySelector('[data-col-handle="1"][data-col-index="0"]') as HTMLElement | null;
    if (handle) {
      const tableEl = document.querySelector(`[data-node-id="${tRef}"] table`) as HTMLTableElement | null;
      const pxBefore = tableEl ? [...tableEl.rows[0].cells].map((c) => c.offsetWidth) : [];
      const hr = handle.getBoundingClientRect();
      const y = hr.top + Math.max(4, hr.height / 2);
      const dxScreen = 63 - 3;
      pe('pointerdown', hr.left + 3, y, handle);
      pe('pointermove', hr.left + 63, y, window);
      pe('pointerup', hr.left + 63, y, window);
      await wait(300);
      const after = colSpecOf(tRef);
      const sum = after.reduce((a, b) => a + b, 0);
      const pxAfter = tableEl ? [...tableEl.rows[0].cells].map((c) => c.offsetWidth) : [];
      add(
        '表格列宽可拖拽（真实 PointerEvent，只动相邻两列）',
        after.length === 3 && after[0] > before[0] + 3 && after[1] < before[1] - 3 && Math.abs(sum - 100) < 2,
        `${before.join('/')} → ${after.join('/')}（合计 ${sum.toFixed(1)}%）` +
          `；诊断 zoom=${S().zoom} 手柄屏幕位移=${dxScreen}px 表格布局宽=${tableEl?.offsetWidth ?? 0}px` +
          ` 单元格像素=${pxBefore.join('/')} → ${pxAfter.join('/')}`,
      );
    } else {
      add('表格列宽可拖拽（真实 PointerEvent，只动相邻两列）', false, '找不到列宽手柄（表格未选中或未显示 chrome）');
    }

    /* ── 影响面：同页两张表时，操作只作用于被选中的那一张（覆盖层按节点作用域）── */
    S().clearAll();
    const tA = S().addComponent('table');
    const tB = S().addComponent('table');
    if (tA && tB) {
      // A 与 B 故意做成不同列宽，才测得出"手柄挂在哪张表上"
      S().updateProps(tA, { data: 'A1 | A2 | A3\na | b | c', colWidths: '60,20,20', cellStyles: {} });
      S().updateProps(tB, { data: 'B1 | B2 | B3\nx | y | z', colWidths: '', cellStyles: {} });
      S().selectComponent([tB]);
      await wait(460);
      const propsA = () => JSON.stringify(S().doc.document.components.find((n) => n.id === tA)?.props ?? {});
      const propsB = () => JSON.stringify(S().doc.document.components.find((n) => n.id === tB)?.props ?? {});
      const beforeA = propsA();

      // ① 点 B 的单元格：只应高亮 B 的格子
      const tdB = document.querySelector(`[data-node-id="${tB}"] tbody tr td`) as HTMLElement | null;
      if (tdB) {
        const r = tdB.getBoundingClientRect();
        pe('pointerdown', r.left + 4, r.top + 4, tdB);
        pe('pointerup', r.left + 4, r.top + 4, tdB);
      }
      await wait(300);
      const rectCount = document.querySelectorAll('[data-cell-selected="1"]').length;
      add(
        '同页两张表：选中 B 的单元格不会连 A 一起高亮（覆盖层限定在选中节点内）',
        rectCount === 1 && S().ui.tableCells?.nodeId === tB && propsA() === beforeA,
        `选框 ${rectCount} 个（应为 1）、归属B=${S().ui.tableCells?.nodeId === tB}、A 属性未变=${propsA() === beforeA}`,
      );

      // ② 手柄必须挂在 B 的列边界上（用 A 的第一列边界做对照）
      const cellB0 = document.querySelector(`[data-node-id="${tB}"] tbody tr td`) as HTMLElement | null;
      const cellA0 = document.querySelector(`[data-node-id="${tA}"] tbody tr td`) as HTMLElement | null;
      const handleB = document.querySelector('[data-col-handle="1"][data-col-index="0"]') as HTMLElement | null;
      const borderB = cellB0 ? cellB0.getBoundingClientRect().right : -1;
      const borderA = cellA0 ? cellA0.getBoundingClientRect().right : -1;
      const handleX = handleB ? handleB.getBoundingClientRect().left + 3 : -999;
      add(
        '同页两张表：列宽手柄挂在被选中的 B 上（不是页面第一张 A）',
        !!handleB && borderB > 0 && Math.abs(handleX - borderB) <= 5,
        `手柄 x=${Math.round(handleX)}、B 第一列右边界=${Math.round(borderB)}、A 的=${Math.round(borderA)}`,
      );

      // ③ 拖 B 的手柄：只改 B
      const beforeBDrag = propsB();
      if (handleB) {
        const hr = handleB.getBoundingClientRect();
        const y = hr.top + Math.max(4, hr.height / 2);
        pe('pointerdown', hr.left + 3, y, handleB);
        pe('pointermove', hr.left + 43, y, window);
        pe('pointerup', hr.left + 43, y, window);
        await wait(340);
      }
      const bCols = String((JSON.parse(propsB()) as Record<string, unknown>).colWidths ?? '');
      add(
        '同页两张表：拖 B 的列宽只改 B，A 的属性一字未动',
        !!handleB && propsB() !== beforeBDrag && bCols !== '' && propsA() === beforeA,
        `B 列宽=${bCols || '(空)'}、B 有变化=${propsB() !== beforeBDrag}、A 未变=${propsA() === beforeA}`,
      );
    } else {
      add('同页两张表：选中 B 的单元格不会连 A 一起高亮（覆盖层限定在选中节点内）', false, '插入两张表失败');
      add('同页两张表：列宽手柄挂在被选中的 B 上（不是页面第一张 A）', false, '插入两张表失败');
      add('同页两张表：拖 B 的列宽只改 B，A 的属性一字未动', false, '插入两张表失败');
    }

    /* ── （预期内的全局影响）表格变高 → 文档流重排，页数增加 ──
       注意：单个超高块**不会**分页（它整块溢出纸面），所以表后面必须还有内容才观察得到重排。 */
    S().clearAll();
    const tall = S().addComponent('table');
    const after = S().addComponent('paragraph');
    if (tall && after) {
      S().updateProps(after, { html: '表格后面的段落：用它观察表格变高后的重排。' });
      const mk = (n: number) => Array.from({ length: n }, (_, i) => `r${i} | x | y`).join('\n');
      S().updateProps(tall, { data: mk(3), rowHeight: '12' });
      await wait(560);
      const pagesBefore = document.querySelectorAll('[data-paper]').length;
      S().updateProps(tall, { data: mk(26) });
      await wait(700);
      const pagesAfter = document.querySelectorAll('[data-paper]').length;
      add(
        '（预期内）表格变高会重排文档流：3 行 → 26 行，表格后的内容被推到下一页',
        pagesAfter > pagesBefore,
        `${pagesBefore} → ${pagesAfter} 页（表格只改了自己的属性，页数是文档流的必然结果）`,
      );
    } else {
      add('（预期内）表格变高会重排文档流：3 行 → 26 行，表格后的内容被推到下一页', false, '插入表格/段落失败');
    }

    /* ── 属性分组抽屉：默认只展开「内容」，点标题可切换 ──
       （自带一张表并选中，不依赖前一段留下的选中状态） */
    S().setMode('document');
    S().clearAll();
    S().addComponent('table');
    resetGroups(); // 复位折叠状态：前面的用例为拿控件点开过别的分组，这里要量的是**默认**状态
    await wait(380);
    const groupEls = [...document.querySelectorAll('[data-prop-group="1"]')] as HTMLElement[];
    const openNames = groupEls.filter((g) => g.dataset.groupOpen === '1').map((g) => g.dataset.groupName ?? '');
    const order = groupEls.map((g) => g.dataset.groupName ?? '');
    const listCount = document.querySelectorAll('[data-prop-list="1"]').length;
    add(
      '属性分组默认只展开第一个分组（表格组件 = 「单元格」组，其余折叠）',
      groupEls.length >= 2 && openNames.length === 1 && openNames[0] === '单元格' && listCount === 1,
      `${groupEls.length} 个分组，展开「${openNames.join('/') || '无'}」，渲染的属性列表 ${listCount} 个`,
    );
    add(
      '表格组件：单元格属性分组排在表格属性分组**上方**',
      order.includes('单元格') && order.includes('表格') && order.indexOf('单元格') < order.indexOf('表格'),
      `分组顺序=${order.join(' > ') || '空'}`,
    );

    /* ── 抽屉式分区（规格 §2）：通用属性 / 专有属性 / 状态 三抽屉，且可折叠 ── */
    {
      const drawers = [...document.querySelectorAll('[data-drawer="1"]')] as HTMLElement[];
      const names = drawers.map((d) => d.dataset.drawerName ?? '');
      const opened = drawers.filter((d) => d.dataset.drawerOpen === '1').length;
      // 通用属性抽屉必须装上下边距（从专有分组里抽出来），专有抽屉里不应再有它
      const universalText = document.querySelector('[data-drawer-name="通用属性"]')?.textContent ?? '';
      const ownText = document.querySelector('[data-drawer-name="专有属性"]')?.textContent ?? '';
      const movedOut = universalText.includes('上边距') && universalText.includes('下边距') && !ownText.includes('上边距');
      add(
        '属性面板按「通用属性 / 专有属性 / 状态」三抽屉组织（可折叠，上下边距归通用）',
        names.length === 3 &&
          names.includes('通用属性') &&
          names.includes('专有属性') &&
          names.includes('状态') &&
          opened === 3 &&
          movedOut,
        `抽屉 [${names.join(' / ')}]，默认展开 ${opened}/3；上下边距在通用抽屉=${movedOut}`,
      );
      // 状态抽屉要有只读信息（规格 §4.3）
      const statusKeys = [...document.querySelectorAll('[data-status-row]')].map((e) => (e as HTMLElement).dataset.statusRow);
      add(
        '状态抽屉含只读信息（类型 / ID / 父容器 / 同级序号 / 数据来源）',
        ['组件类型', '组件 ID', '父容器', '同级顺序', '数据来源'].every((k) => statusKeys.includes(k)),
        `只读行：${statusKeys.join(' / ')}`,
      );
    }

    /* ── 多选面板（规格 §2）：选中多个组件时只显示可批量修改的属性 ── */
    {
      S().setMode('web');
      S().clearAll();
      const a = S().addComponent('button');
      const b = S().addComponent('input');
      if (a && b) {
        S().selectComponent([a, b]);
        await wait(300);
        const panel = document.querySelector('[data-multi-select="1"]') as HTMLElement | null;
        const txt = panel?.textContent ?? '';
        add(
          '多选时显示批量面板（位置尺寸 / 对齐 / 层级 / 删除）',
          !!panel && txt.includes('批量修改') && txt.includes('位置与尺寸') && txt.includes('层级'),
          panel ? `面板文本：${txt.slice(0, 40).replace(/\s+/g, ' ')}…` : '未渲染多选面板',
        );
      } else {
        add('多选时显示批量面板（位置尺寸 / 对齐 / 层级 / 删除）', false, '插入两个组件失败');
      }
      S().setMode('document');
      await wait(160);
    }

    /* ── 非表格组件也必须有一个默认展开的分组（否则选中后看不到任何属性）── */
    {
      S().clearAll();
      S().addComponent('paragraph');
      resetGroups();
      await wait(380);
      const gs = [...document.querySelectorAll('[data-prop-group="1"]')] as HTMLElement[];
      const open = gs.filter((g) => g.dataset.groupOpen === '1').map((g) => g.dataset.groupName ?? '');
      add(
        '非表格组件也只展开第一个分组（段落 = 「内容」组）',
        gs.length >= 1 && open.length === 1 && open[0] === '内容',
        `${gs.length} 个分组，展开「${open.join('/') || '无'}」`,
      );
    }
    const target = '[data-prop-group="1"][data-group-name="单元格"]';
    let expandWorks = false;
    let toggleNote = '';
    // ★自带一张表并选中：前一段（多选）结尾 setMode 会清空选中，面板会退回"页面属性"，
    //   那时根本没有分组可点。
    S().setMode('document');
    S().clearAll();
    S().addComponent('table');
    await wait(380);
    const head = document.querySelector(target) as HTMLElement | null;
    if (head) {
      // 「单元格」现在是**第一个分组 → 默认就在展开状态**：点一下应变折叠，再点回展开
      const isOpen = () => !!document.querySelector(`${target} [data-prop-list="1"]`);
      const before = isOpen();
      (document.querySelector(`${target} button`) as HTMLButtonElement).click();
      await wait(220);
      const afterFirst = isOpen();
      (document.querySelector(`${target} button`) as HTMLButtonElement).click();
      await wait(180);
      const afterSecond = isOpen();
      expandWorks = before && !afterFirst && afterSecond;
      toggleNote = `初始展开=${before} → 点一次=${afterFirst} → 再点=${afterSecond}`;
    }
    add('属性分组可展开/折叠（点标题切换）', expandWorks, toggleNote || '找不到「单元格」分组');

    /* ── 表格行 / 列数量：输入（回车提交）与 ＋/− 按钮都要真改数据 ──
       （自带一张 3×3 表并选中，保证面板里确实有行列数量控件） */
    S().setMode('document');
    S().clearAll();
    const tSize = S().addComponent('table');
    if (tSize) S().updateProps(tSize, { data: 'a | b | c\nd | e | f\ng | h | i', headerRow: true, colWidths: '', rowHeight: '', cellStyles: {} });
    await wait(420);
    // 行/列数量、插入/删除行列都在「表格」组里（默认只展开第一个分组 =「单元格」）
    await openGroup('表格');
    const dataLines = (): string[] => {
      // 读**当前选中**的那张表（各段用例都自带选中状态，互不依赖）；
      // ★不过滤空行：空行在 Excel 语义里就是"一行空单元格"，插行/删行要靠它才验得出来
      const id = S().doc.selectedIds[0];
      const n = S().doc.document.components.find((x) => x.id === id);
      const text = String(n?.props.data ?? '');
      if (!text) return [];
      let lines = text.split('\n');
      if (text.endsWith('\n')) lines = lines.slice(0, -1);
      return lines;
    };
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const rowInput = document.querySelector('[data-table-rows="1"]') as HTMLInputElement | null;
    const colInput = document.querySelector('[data-table-cols="1"]') as HTMLInputElement | null;
    const commitInput = (el: HTMLInputElement, v: string) => {
      if (!nativeSet) return;
      nativeSet.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    };
    if (rowInput && colInput && nativeSet) {
      commitInput(rowInput, '5');
      await wait(320);
      const l5 = dataLines();
      const cur = S().doc.selectedIds[0];
      const ths = document.querySelector(`[data-node-id="${cur}"] thead tr`)?.children.length ?? 0;
      const trs = document.querySelectorAll(`[data-node-id="${cur}"] tbody tr`).length;
      add(
        '表格行数可改（输入 5 + 回车 → 数据与渲染同步）',
        l5.length === 5 && trs === 4 && ths === 3,
        `数据 ${l5.length} 行、表头 ${ths} 列、tbody ${trs} 行`,
      );

      commitInput(colInput, '4');
      await wait(320);
      const ths4 = document.querySelectorAll(`[data-node-id="${S().doc.selectedIds[0]}"] thead tr th`).length;
      const perLine = dataLines().map((l) => l.split('|').length);
      add(
        '表格列数可改（输入 4 + 回车 → 每行补到 4 列）',
        ths4 === 4 && perLine.length === 5 && perLine.every((n) => n === 4),
        `表头 ${ths4} 列、每行列数 [${perLine.join(',')}]`,
      );

      /* ── Excel 式：在**选中的单元格**处插入 / 删除整行整列（不是只会在末尾加减）── */
      const curId = S().doc.selectedIds[0];
      const clickCell = async (key: string) => {
        const el = document.querySelector(`[data-node-id="${curId}"] [data-cell="${key}"]`) as HTMLElement | null;
        if (!el) return false;
        const r = el.getBoundingClientRect();
        pe('pointerdown', r.left + 4, r.top + 4, el);
        pe('pointerup', r.left + 4, r.top + 4, el);
        await wait(220);
        return true;
      };
      const hasCell = await clickCell('1,0');
      const beforeRow = dataLines();
      (document.querySelector('[data-table-ins-row="1"]') as HTMLButtonElement | null)?.click();
      await wait(300);
      const afterIns = dataLines();
      const insertedEmpty = (afterIns[1] ?? '').split('|').every((c) => c.trim() === '');
      add(
        'Excel：在选中行处「插入行」（上方插入空行、其余下移）',
        hasCell && afterIns.length === beforeRow.length + 1 && insertedEmpty && afterIns[2] === beforeRow[1],
        `${beforeRow.length} → ${afterIns.length} 行；新第 2 行=「${afterIns[1] ?? ''}」；原第 2 行下移到第 3 行=${afterIns[2] === beforeRow[1]}`,
      );

      // ★插入后选区会**跟着原内容下移**（Excel 语义 / 用户要求），所以要删掉刚插的那一行，
      //   得先显式选回插入行（第 2 行），否则删掉的是原内容行。
      //   ★删除走**两次点击确认**（第一次只待确认），所以要点两下。
      S().selectTableCells(curId, ['1,0']);
      await wait(160);
      const delRowBtn = document.querySelector('[data-table-del-row="1"]') as HTMLButtonElement | null;
      delRowBtn?.click();
      await wait(80);
      const armedLabel = delRowBtn?.textContent ?? '';
      delRowBtn?.click();
      await wait(320);
      const afterDelRow = dataLines();
      add(
        '删除行需两次点击确认（第一次只待确认，标签变为「再点一次」）',
        armedLabel.includes('再点一次'),
        `第一次点击后按钮文字=「${armedLabel.trim()}」`,
      );
      add(
        'Excel：在选中行处「删除行」（删掉该整行，内容回到原样）',
        afterDelRow.length === beforeRow.length && afterDelRow.every((l, i) => i < beforeRow.length && l === beforeRow[i]),
        `${afterIns.length} → ${afterDelRow.length} 行，与插入前一致=${afterDelRow.every((l, i) => l === beforeRow[i])}`,
      );

      // 单元格格式要跟着列平移（Excel 里给 B 列上色，左边插一列后颜色应该跟着内容右移）
      S().updateProps(curId, { cellStyles: { '1,0': { bold: true } } });
      await wait(280);
      const colsBefore = dataLines().map((l) => l.split('|').length);
      (document.querySelector('[data-table-ins-col="1"]') as HTMLButtonElement | null)?.click();
      await wait(320);
      const colsAfter = dataLines().map((l) => l.split('|').length);
      const shiftedStyle = (() => {
        const n = S().doc.document.components.find((x) => x.id === curId);
        const st = (n?.props.cellStyles ?? {}) as Record<string, unknown>;
        // A1 记法：给 A2（1,0）上色后左边插一列 → 键应变成 B2（1,1）
        return !!st['B2'] && !st['A2'];
      })();
      const movedCell = document.querySelector(`[data-node-id="${curId}"] [data-cell="1,1"]`) as HTMLElement | null;
      add(
        'Excel：插入列后单元格格式与内容一起右移（不是留在原坐标）',
        colsAfter[0] === colsBefore[0] + 1 && shiftedStyle && getComputedStyle(movedCell!).fontWeight === '700',
        `每行 ${colsBefore[0]} → ${colsAfter[0]} 列；格式键 1,0 → 1,1=${shiftedStyle}；新格字重=${movedCell ? getComputedStyle(movedCell).fontWeight : '?'}`,
      );

      // 删除列也要**点两下**（第一次只待确认）
      const delColBtn = document.querySelector('[data-table-del-col="1"]') as HTMLButtonElement | null;
      delColBtn?.click();
      await wait(80);
      delColBtn?.click();
      await wait(320);
      const colsBack = dataLines().map((l) => l.split('|').length);
      add('Excel：删除列后回到原列数', colsBack[0] === colsBefore[0], `每行 ${colsAfter[0]} → ${colsBack[0]} 列`);

      /* ── Excel 式区域拖选：从一格拖到另一格 → 矩形区域 ── */
      // 拖拽靠 elementsFromPoint 取坐标下的格子，所以目标格必须落在**画布视口内**
      // （真实鼠标只能点在画布上；合成事件如果不先滚进来，坐标可能落到左右面板上）。
      if (S().ui.showTree) S().toggleUI('showTree'); // 收掉组件树，给画布腾出宽度
      const cellA = document.querySelector(`[data-node-id="${curId}"] [data-cell="1,0"]`) as HTMLElement | null;
      const cellB0 = document.querySelector(`[data-node-id="${curId}"] [data-cell="2,1"]`) as HTMLElement | null;
      if (cellA && cellB0) {
        cellB0.scrollIntoView({ block: 'center', inline: 'center' });
        await wait(340);
        const cellB = document.querySelector(`[data-node-id="${curId}"] [data-cell="2,1"]`) as HTMLElement | null;
        const vpRect = document.getElementById('canvas-viewport')?.getBoundingClientRect();
        const rb = (cellB ?? cellB0).getBoundingClientRect();
        const cx = rb.left + rb.width / 2;
        const cy = rb.top + rb.height / 2;
        const inVp = !!vpRect && cx >= vpRect.left && cx <= vpRect.right && cy >= vpRect.top && cy <= vpRect.bottom;
        const stack = (document.elementsFromPoint(cx, cy) as HTMLElement[])
          .slice(0, 4)
          .map((e) => `${e.tagName}${e.dataset?.cell ? `[${e.dataset.cell}]` : ''}`);
        pe('pointerdown', cellA.getBoundingClientRect().left + 4, cellA.getBoundingClientRect().top + 4, cellA);
        pe('pointermove', cx, cy, window);
        pe('pointerup', cx, cy, window);
        await wait(340);
        const picked = S().ui.tableCells?.cells ?? [];
        const want = ['1,0', '1,1', '2,0', '2,1'];
        const rects = document.querySelectorAll('[data-cell-selected="1"]').length;
        add(
          'Excel 式拖选区域（从 1,0 拖到 2,1 → 2×2 共 4 格）',
          inVp && picked.length === 4 && want.every((k) => picked.includes(k)) && rects === 4,
          `选中 ${picked.length} 格 [${picked.join(' ')}]；选框 ${rects} 个；目标点在画布视口内=${inVp}；坐标下元素栈=${stack.join(' | ')}`,
        );
      } else {
        add('Excel 式拖选区域（从 1,0 拖到 2,1 → 2×2 共 4 格）', false, '找不到目标单元格');
      }

      /* ── 表题由表格自身承载 + 去重后的类型确实不存在了 ── */
      S().updateProps(curId, { caption: '表 1-1　示例表题', captionAlign: 'left' });
      await wait(280);
      const capEl = document.querySelector(`[data-node-id="${curId}"] caption[data-table-caption="1"]`);
      add(
        '表题由表格自身承载（真实 caption 元素，显示在表格上方）',
        !!capEl && capEl.textContent === '表 1-1　示例表题',
        capEl ? `caption 文本=「${capEl.textContent}」` : '未渲染 caption',
      );

      add(
        '去重：独立「题注」「富文本」组件已移除（能力分别由 image/table 的 caption 属性与 paragraph 承载）',
        !getComponent('caption') && !getComponent('richtext'),
        `getComponent('caption')=${String(getComponent('caption'))}、getComponent('richtext')=${String(getComponent('richtext'))}`,
      );

      /* ── 合并 / 拆分（规格 §8.3）：范围键 + colSpan/rowSpan 渲染 ──
         ★自带一张 3×3 表并选中：前面的行/列增删用例会 clearAll，tRef 那时已不存在。 */
      {
        S().setMode('document');
        S().clearAll();
        const tMerge = S().addComponent('table');
        if (tMerge) {
          S().updateProps(tMerge, {
            data: 'h1 | h2 | h3\na | b | c\nd | e | f',
            headerRow: true,
            colWidths: '',
            cellStyles: {},
          });
        }
        await wait(420);
        const c1 = document.querySelector(`[data-node-id="${tMerge}"] [data-cell="1,0"]`) as HTMLElement | null;
        if (tMerge && c1) {
          c1.scrollIntoView({ block: 'center' });
          await wait(240);
          // 选区直接用 store 设定（拖选交互已有独立断言，这里专注验证"合并写入 + 渲染"）
          S().selectTableCells(tMerge, ['1,0', '1,1', '2,0', '2,1']);
          await wait(320);
          const mergeBtn = document.querySelector('[data-cell-merge="1"]') as HTMLButtonElement | null;
          mergeBtn?.click();
          await wait(360);
          const props = (S().doc.document.components.find((n) => n.id === tMerge)?.props ?? {}) as Record<string, unknown>;
          const cs = (props.cellStyles ?? {}) as Record<string, unknown>;
          const anchor = document.querySelector(`[data-node-id="${tMerge}"] [data-cell="1,0"]`) as HTMLElement | null;
          const coveredCell = document.querySelector(`[data-node-id="${tMerge}"] [data-cell="1,1"]`);
          const selNow = S().ui.tableCells;
          add(
            '合并单元格（写范围键 B2:C3 + 锚点 colSpan/rowSpan，被覆盖的格子不渲染）',
            Object.keys(cs).some((k) => k.includes(':')) &&
              !!anchor &&
              (anchor.getAttribute('colspan') ?? '1') === '2' &&
              (anchor.getAttribute('rowspan') ?? '1') === '2' &&
              !coveredCell,
            `范围键=${Object.keys(cs).find((k) => k.includes(':')) ?? '无'}；锚点 colSpan=${anchor?.getAttribute('colspan')} rowSpan=${anchor?.getAttribute('rowspan')}；被覆盖格仍在=${!!coveredCell}；` +
              `诊断：合并按钮存在=${!!mergeBtn}、禁用=${mergeBtn?.disabled}、当前选区=${selNow ? `${selNow.nodeId === tMerge ? '本表' : '别的表'}(${selNow.cells.join(' ')})` : '无'}`,
          );

          (document.querySelector('[data-cell-split="1"]') as HTMLButtonElement | null)?.click();
          await wait(340);
          const after = (S().doc.document.components.find((n) => n.id === tMerge)?.props ?? {}) as Record<string, unknown>;
          const cs2 = (after.cellStyles ?? {}) as Record<string, unknown>;
          add(
            '拆分单元格（去掉范围键，被覆盖的格子重新渲染）',
            !Object.keys(cs2).some((k) => k.includes(':')) && !!document.querySelector(`[data-node-id="${tMerge}"] [data-cell="1,1"]`),
            `剩余键：${Object.keys(cs2).join(' ') || '（空）'}`,
          );
        } else {
          add('合并单元格（写范围键 B2:C3 + 锚点 colSpan/rowSpan，被覆盖的格子不渲染）', false, '插入表格或找不到目标单元格');
          add('拆分单元格（去掉范围键，被覆盖的格子重新渲染）', false, '插入表格或找不到目标单元格');
        }
      }
    } else {
      add('表格行数可改（输入 5 + 回车 → 数据与渲染同步）', false, '找不到行/列数量输入框');
      add('表格列数可改（输入 4 + 回车 → 每行补到 4 列）', false, '找不到行/列数量输入框');
      add('Excel：在选中行处「插入行」（上方插入空行、其余下移）', false, '找不到行/列数量输入框');
      add('Excel：在选中行处「删除行」（删掉该整行，内容回到原样）', false, '找不到按钮');
      add('Excel：插入列后单元格格式与内容一起右移（不是留在原坐标）', false, '找不到按钮');
      add('Excel：删除列后回到原列数', false, '找不到按钮');
      add('Excel 式拖选区域（从 1,0 拖到 2,1 → 2×2 共 4 格）', false, '找不到按钮');
      add('表题由表格自身承载（真实 caption 元素，显示在表格上方）', false, '找不到表格');
      add('去重：独立「题注」「富文本」组件已移除（能力分别由 image/table 的 caption 属性与 paragraph 承载）', false, '前置失败');
    }

    /* ── 旧版持久化数据（缺少后来新增的 ui 字段）不能崩 ──
       真实现场：旧 localStorage 里的 ui 没有 lockedIds（本轮新增），
       zustand persist 默认只做顶层浅合并 → ui.lockedIds 是 undefined →
       属性面板一选中组件就读 .includes → TypeError。修法是 persist 里深合并 ui 默认值。 */
    {
      const KEY = 'visual-editor-v1';
      const backup = localStorage.getItem(KEY);
      const backupDoc = S().exportJSON();
      try {
        // 造一份"旧版"存档：ui 里去掉 lockedIds / tableCells
        const raw = JSON.parse(backup ?? '{"state":{}}') as { state?: Record<string, unknown>; version?: number };
        const st = (raw.state ?? {}) as Record<string, unknown>;
        const oldUi = { ...((st.ui ?? {}) as Record<string, unknown>) };
        delete oldUi.lockedIds;
        delete oldUi.tableCells;
        localStorage.setItem(KEY, JSON.stringify({ state: { ...st, ui: oldUi }, version: 1 }));
        await useEditorStore.persist.rehydrate();
        await wait(160);
        const ui = S().ui as unknown as Record<string, unknown>;
        const lockedOk = Array.isArray(ui.lockedIds);
        const cellsOk = ui.tableCells === null || typeof ui.tableCells === 'object';
        // 面板仍要能渲染（旧版数据缺字段时若不崩，这里能查到属性面板的抽屉/行容器）
        S().clearAll();
        const pid = S().addComponent('paragraph');
        await wait(320);
        const panelAlive = !!document.querySelector('[data-props-panel="1"]') && !!pid;
        add(
          '旧版持久化数据缺少新增 ui 字段时不会崩（persist 深合并回落默认值）',
          lockedOk && cellsOk && panelAlive,
          `旧存档（无 lockedIds/tableCells）恢复后：lockedIds 是数组=${lockedOk}、tableCells 有默认=${cellsOk}、属性面板仍渲染=${panelAlive}`,
        );
      } catch (e) {
        add('旧版持久化数据缺少新增 ui 字段时不会崩（persist 深合并回落默认值）', false, `恢复旧存档出错：${String(e)}`);
      } finally {
        // 还原现场
        if (backup != null) localStorage.setItem(KEY, backup);
        else localStorage.removeItem(KEY);
        S().importJSON(backupDoc);
        await wait(200);
      }
    }

    /* ── ★大文档不能把编辑器写崩（用户 2026-09-24：7.2MB 文档 = 5 张内嵌 base64 图 → localStorage 配额 → 渲染出错）
       现场调用链：文件 →「打开 JSON」= `importJSON()` → store 更新 → persist 落盘 → QuotaExceededError 冒到渲染路径。 ── */
    {
      const big = `data:image/png;base64,${'A'.repeat(1024 * 1024)}`; // 每张 ~1MB，凑出和现场同形的"内嵌图片大文档"
      S().setMode('document');
      S().clearAll();
      for (let i = 0; i < 5; i += 1) {
        const id = S().addComponent('image');
        if (id) S().updateProps(id, { src: big });
      }
      await wait(520);
      const before = window.localStorage.getItem(PERSIST_KEY);
      const json = S().exportJSON();
      const imported = S().importJSON(json); // ← 与「打开 JSON」同一条代码路径
      await wait(700);
      const after = window.localStorage.getItem(PERSIST_KEY);
      const notice = document.querySelector('[data-persist-overflow="1"]') as HTMLElement | null;
      add(
        '大文档（内嵌图片、超过浏览器本地存储预算）**打开不报错**：导入成功、文档完整、localStorage 不被写坏',
        S().doc.document.components.length === 5 && imported === true && after === before,
        `节点 ${S().doc.document.components.length} 个；JSON ${(json.length / 1024 / 1024).toFixed(1)}MB；导入=${imported}；localStorage 未变=${after === before}`,
      );
      add(
        '大文档落盘被跳过时**弹提示条**（说清多大 / 为什么 / 用「导出 JSON」存盘），且内嵌图片不进本地存储',
        !!notice && (notice.textContent ?? '').includes('没有自动保存'),
        `提示条=${!!notice}；文案=「${(notice?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 56)}」`,
      );
      const budget = shouldPersist(2 * 1024 * 1024) === true && shouldPersist(8 * 1024 * 1024) === false;
      add(
        `落盘预算：${Math.round(PERSIST_BUDGET / 1024 / 1024 * 10) / 10}MB 以内照常存、超过就跳过（不抛异常）`,
        budget && (lastPersistOverflow()?.bytes ?? 0) > PERSIST_BUDGET,
        `2MB→${shouldPersist(2 * 1024 * 1024)}；8MB→${shouldPersist(8 * 1024 * 1024)}；最近一次被拦=${((lastPersistOverflow()?.bytes ?? 0) / 1024 / 1024).toFixed(1)}MB（${lastPersistOverflow()?.kind ?? '—'}）`,
      );
      // 还原现场：关提示条 + 清空造出来的大文档（否则后面每个断言都在写 10MB 的 payload）
      (document.querySelector('[data-persist-overflow-close="1"]') as HTMLElement | null)?.click();
      S().clearAll();
      await wait(320);
    }

    /* ── 除通用属性（上/下边距，注册表统一补）外，每个组件都必须有自己的配置属性 ── */
    {
      const UNIVERSAL = new Set(['marginTop', 'marginBottom']);
      const audit = getAllComponents()
        .filter((d) => !d.type.startsWith('__')) // 自检探针不算业务组件
        .map((d) => ({ type: d.type, own: d.propSchema.filter((i) => !UNIVERSAL.has(i.key)).length }))
        .sort((a, b) => a.own - b.own);
      const zero = audit.filter((a) => a.own === 0);
      const thin = audit.filter((a) => a.own <= 2);
      add(
        '除通用属性外，每个组件都有自己的配置属性',
        audit.length > 0 && zero.length === 0,
        `${audit.length} 个组件；自有属性 ${audit[0]?.own ?? 0}–${audit[audit.length - 1]?.own ?? 0} 个；` +
          `仅通用属性的 ${zero.length} 个${zero.length ? `：${zero.map((z) => z.type).join(' ')}` : ''}；` +
          `偏少(≤2)：${thin.map((t) => `${t.type}:${t.own}`).join(' ') || '无'}`,
      );
    }

    /* ── 分类规范：只用约定的分类、每类都有组件（拼错分类名会静默多出一个分组）── */
    {
      const known = CATEGORY_ORDER as readonly string[];
      const cats = new Map<string, number>();
      getAllComponents()
        .filter((d) => !d.type.startsWith('__'))
        .forEach((d) => cats.set(d.category, (cats.get(d.category) ?? 0) + 1));
      const unknown = [...cats.keys()].filter((c) => !known.includes(c));
      const empty = known.filter((c) => !cats.has(c));
      add(
        '组件分类规范：只用约定分类，且每类都有组件',
        unknown.length === 0 && empty.length === 0,
        `${cats.size} 类：${[...cats.entries()].map(([c, n]) => `${c} ${n}`).join(' / ')}；未登记 ${unknown.length}${unknown.length ? `（${unknown.join(',')}）` : ''}、空分类 ${empty.length}${empty.length ? `（${empty.join(',')}）` : ''}`,
      );
    }

    /* ── 说明默认隐藏、悬停弹气泡（不是原生 title）──
       触发点在 Tooltip 的包装元素上（[data-tip]）；宽行式属性的 [data-prop-label] 是它的父节点，
       往父节点派发事件不会冒泡到子节点，所以必须打在包装元素上。
       规格：延迟 400ms 弹出、深色底 rgba(0,0,0,.82)、内容含 中文名 + key + 默认值。 */
    {
      // 定位到「专有属性」抽屉里的第一个属性行 —— 通用属性抽屉在它之上，
      // 直接取全局第一个会拿到"上边距"。属性 key 由 PropertyRow 的 data-prop-key 给出，
      // 这样断言不依赖"第一行恰好是哪个属性"（表格的「数据」行已移除）。
      const label =
        (document.querySelector('[data-drawer-name="专有属性"] [data-prop-label="1"]') as HTMLElement | null) ??
        (document.querySelector('[data-prop-label="1"]') as HTMLElement | null);
      const row = label?.closest('[data-prop-key]') as HTMLElement | null;
      const rowKey = row?.getAttribute('data-prop-key') ?? '';
      const trigger = (label?.querySelector('[data-tip="1"]') as HTMLElement | null) ?? label;
      const txt = (label?.textContent ?? '').trim();
      const hidden = !!label && !txt.includes('（');
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await wait(560); // > 400ms 延迟
      const tip = document.querySelector('[data-tooltip="1"]') as HTMLElement | null;
      const tipText = tip?.textContent ?? '';
      const dark = tip ? getComputedStyle(tip).backgroundColor : '';
      add(
        '属性说明默认隐藏、悬停弹气泡（400ms 延迟 / 深色底 / 含 key 与默认值，不走原生 title）',
        hidden && !!tip && !!rowKey && tipText.includes(rowKey) && tipText.includes('默认值') && dark === 'rgba(0, 0, 0, 0.82)',
        `属性名只显示=「${txt}」（key=${rowKey || '?'}）；气泡=${tip ? `「${tipText}」底色 ${dark}` : '未弹出'}`,
      );
      trigger?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      await wait(80);
    }
    {
      const liveSet = new Set(getLiveTypes());
      const discovered = collectComponents(COMPONENT_MODULES);
      const files = Object.keys(COMPONENT_MODULES);
      const builtins = getAllComponents().filter((d) => !d.type.startsWith('__') && !liveSet.has(d.type));
      const allRegistered = discovered.every((d) => getComponent(d.type)?.type === d.type);
      add(
        '组件注册表由目录自动发现（新增/删除组件无需改框架清单）',
        discovered.length > 0 && builtins.length === discovered.length && allRegistered && files.every((f) => f.endsWith('.tsx')),
        `目录发现 ${files.length} 个 .tsx → ${discovered.length} 个组件定义；注册表中内建 ${builtins.length} 个（一致=${builtins.length === discovered.length}）、全部已注册=${allRegistered}`,
      );
    }

    /* ── 日志/诊断落盘到**运行目录**（启动器提供 /__log；否则如实退回 localStorage）── */
    {
      const info = log.remoteInfo();
      await log.flushRemote(); // 先把待写队列推出去（可能为空，这是正常的）
      const httpLocal = /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
      // 落盘是否真的成功，用 /__loginfo 看**磁盘上今天的文件**有没有内容（比"本次 flush 的字节数"可靠：
      // 空闲时队列本来就是空的）
      let diskBytes = -1;
      let diskFile = '';
      if (info.enabled) {
        try {
          const j = (await (await fetch('/__loginfo', { cache: 'no-store' })).json()) as {
            today?: string;
            files?: { name: string; bytes: number }[];
          };
          const today = j.files?.find((f) => f.name === j.today);
          diskBytes = today?.bytes ?? 0;
          diskFile = today?.name ?? '';
        } catch {
          diskBytes = -1;
        }
      }
      const ok = info.enabled ? diskBytes > 0 : !httpLocal;
      add(
        '日志落盘到运行目录（启动器 /__log；无接口时如实退回本地存储）',
        ok,
        info.enabled
          ? `运行目录文件 ${diskFile || info.file} = ${diskBytes} 字节（目录 ${info.dir}）`
          : `未启用（页面来自 ${location.protocol}//${location.host}，无 /__log 接口）→ 退回 localStorage；本轮按"非启动器托管"判定`,
      );
      const report = buildDiagnosticReport();
      add(
        '诊断报告包含「日志落盘」段与路径',
        report.includes('【日志落盘】') && report.includes(info.dir || '—'),
        `报告 ${report.length} 字符，含落盘段=${report.includes('【日志落盘】')}，路径=${info.dir || '(未启用)'}`,
      );
      const rep = info.enabled ? await log.saveReport('diagnostic', report) : null;
      add(
        '诊断报告可写入运行目录（logs/diagnostic-*.log）',
        info.enabled ? !!rep?.ok && (rep.bytes ?? 0) > 0 : !httpLocal,
        info.enabled ? `已写入 ${rep?.file}（${rep?.bytes} 字节）` : `未启用（页面来自 ${location.protocol}${location.host}）`,
      );
      /* ★大报告要多块落盘：诊断/自检报告动辄上百 KB，而带 `keepalive` 的 fetch 请求体
         有 64KiB 硬上限 —— 一旦超了 fetch 直接抛错，被当成"落盘失败"→ remoteEnabled=false，
         之后**连 logs/check-*.log 都写不出去**（现象：日志里报告突然断掉，只剩 PDF）。
         这里钉住"切块 + 小块才带 keepalive"的规则。 */
      const plan = planPost(`${report}\n${'超长报告填充行。'.repeat(20000)}`);
      add(
        '大报告分块落盘：单块不超过服务端上限，且超 keepalive 上限的块不再带 keepalive',
        plan.chunks >= 3 && plan.maxBytes > 0 && plan.maxBytes <= 160 * 1024 && plan.keepalive < plan.chunks,
        `${plan.chunks} 块，最大块 ${plan.maxBytes} 字节（服务端上限 524288），带 keepalive 的块 ${plan.keepalive}/${plan.chunks}`,
      );
    }
  } else {
    add('表格列宽生效（colgroup 20%/50%/30%）', false, 'addComponent(table) 失败');
    add('表格行高生效（纯数字按 mm）', false, 'addComponent(table) 失败');
    add('表格列宽支持 mm 且列数不缩水', false, 'addComponent(table) 失败');
  }

  /* ── 组件与属性说明清单：覆盖全部组件/分类，且能落盘到运行目录 ── */
  {
    const spec = buildComponentSpecSheet();
    const all = getAllComponents().filter((d) => !d.type.startsWith('__'));
    const missing = all.filter((d) => !spec.includes(`\`${d.type}\``));
    const catsMissing = (CATEGORY_ORDER as readonly string[]).filter((c) => !spec.includes(`## ${c}（`));
    add(
      '组件与属性说明清单：覆盖全部组件与分类，且含"面板状态"与"功能属性"两段',
      missing.length === 0 &&
        catsMissing.length === 0 &&
        spec.includes('## 二、属性编辑器总说明') &&
        spec.includes('**选中它之后，属性编辑器的状态**') &&
        spec.includes('**它的功能属性**'),
      `清单 ${spec.length} 字符；组件 ${all.length} 个全部出现=${missing.length === 0}；分类齐全=${catsMissing.length === 0}` +
        (missing.length ? `；缺：${missing.map((d) => d.type).join(',')}` : ''),
    );
    const r = await saveToRunDir('docs/组件与属性说明清单.md', spec);
    const httpLocal = /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    add(
      '组件与属性说明清单可写入运行目录（docs/）',
      httpLocal ? !!r?.ok && (r.bytes ?? 0) > 0 : true,
      r ? (r.ok ? `已写入 ${r.file}（${r.bytes} 字节）` : `失败：${r.error ?? '未知'}`) : '没有 /__save 接口（非启动器托管）：菜单里会退回下载',
    );
  }

  /* ── 节点级错误边界：某个组件 render 抛错时只降级该节点，不能把编辑器拖垮 ──
     （这条是被"属性面板遍历全部组件"的审计逼出来的：外部组件 参数对比卡 的 render 抛错，
       当时整个应用被顶层错误边界替换成错误页 → 画布/面板全部消失。） */
  {
    const badType = '__probe_throw';
    registerComponent({
      type: badType,
      label: '探针·渲染抛错',
      category: '通用',
      supportedModes: ['document', 'web'],
      icon: Type,
      defaultProps: { text: 'x' },
      propSchema: [],
      render: () => {
        throw new Error('探针故意抛错');
      },
    });
    S().setMode('document');
    S().clearAll();
    const goodId = S().addComponent('paragraph');
    const badId = S().addComponent(badType);
    await wait(300);
    const viewportAlive = !!document.getElementById('canvas-viewport');
    const placeholder = document.querySelector('[data-node-render-error]');
    const goodStillThere = !!(goodId && document.querySelector(`[data-node-id="${goodId}"]`));
    add(
      '组件渲染抛错只降级该节点（节点级错误边界，不拖垮编辑器）',
      !!badId && viewportAlive && !!placeholder && goodStillThere,
      `视口存活=${viewportAlive}、错误占位=${!!placeholder}、同页其它节点仍在=${goodStillThere}`,
    );
    unregisterComponent(badType);
    S().clearAll();
    await wait(120);
  }

  /* ── 属性面板紧凑排版：遍历**全部组件**，检查属性行不溢出、标签不折行 ──
     注意：面板元素必须每轮**重新查询**（切换选中会让 React 重建这段 DOM，缓存旧引用会量到已卸载的 0×0 节点）。 */
  {
    const total = getAllComponents().length;
    let comps = 0;
    let rows = 0;
    let wideRows = 0;
    let maxRowH = 0;
    const overflow: string[] = [];
    const wrapped: string[] = [];
    const tooTall: string[] = [];
    const skipped: string[] = [];
    const uniq = (a: string[]) => [...new Set(a)].slice(0, 4).join(' ');
    const modeNow = () => S().doc.mode;

    for (const def of getAllComponents()) {
      const m = def.supportedModes.includes(modeNow()) ? modeNow() : def.supportedModes[0];
      if (!m) {
        skipped.push(`${def.type}:无可用模式`);
        continue;
      }
      if (modeNow() !== m) {
        S().setMode(m);
        await wait(40);
      }
      S().clearAll();
      const id = S().addComponent(def.type);
      if (!id) {
        skipped.push(`${def.type}:插入失败`);
        continue;
      }
      await wait(55);
      // 属性分组默认只展开「内容」；审计要量全部属性行，先把折叠的分组点开
      document.querySelectorAll('[data-prop-group="1"]').forEach((g) => {
        if (!g.querySelector('[data-prop-list="1"]')) (g.querySelector('button') as HTMLButtonElement | null)?.click();
      });
      await wait(35);
      const rowEls = document.querySelectorAll('[data-prop-row="1"]');
      const panelNow = document.querySelector('[data-props-panel="1"]') as HTMLElement | null;
      if (!rowEls.length) {
        skipped.push(`${def.type}:无可见属性`);
        continue;
      }
      if (!panelNow || panelNow.clientWidth < 100) {
        skipped.push(`${def.type}:面板未布局`);
        continue;
      }
      comps += 1;
      rowEls.forEach((r) => {
        const el = r as HTMLElement;
        rows += 1;
        const h = el.getBoundingClientRect().height;
        if (h > maxRowH) maxRowH = Math.round(h);
        if (el.dataset.propWide === '1') wideRows += 1;
        if (el.scrollWidth > el.clientWidth + 1) overflow.push(def.type);
        const lab = el.querySelector('[data-prop-label="1"]') as HTMLElement | null;
        if (lab && lab.getBoundingClientRect().height > 18) wrapped.push(def.type);
        if (el.dataset.propWide !== '1' && h > 40) tooTall.push(def.type);
      });
    }

    add(
      '属性面板紧凑排版：无溢出 / 标签不折行 / 无超高行',
      rows > 200 && overflow.length === 0 && wrapped.length === 0 && tooTall.length === 0,
      `${comps} 个组件 / ${rows} 个属性行（整行式 ${wideRows}，最高行 ${maxRowH}px）；溢出 ${overflow.length}、折行 ${wrapped.length}、超高 ${tooTall.length}` +
        (overflow.length ? `；溢出例：${uniq(overflow)}` : '') +
        (wrapped.length ? `；折行例：${uniq(wrapped)}` : '') +
        (tooTall.length ? `；超高例：${uniq(tooTall)}` : ''),
    );
    add(
      '属性面板排版审计覆盖全部组件',
      comps + skipped.length === total,
      `可检查 ${comps}/${total}${skipped.length ? `；跳过：${uniq(skipped)}` : ''}`,
    );
    const scrollNow = document.querySelector('[data-props-scroll="1"]') as HTMLElement | null;
    const alive = {
      viewport: !!document.getElementById('canvas-viewport'),
      nodes: document.querySelectorAll('[data-node-id]').length,
      panels: document.querySelectorAll('[data-props-scroll]').length,
      rightCollapsed: S().ui.rightCollapsed,
      mode: S().doc.mode,
      media: window.matchMedia('print').matches ? 'print' : 'screen',
      lastType: [...S().doc.document.components, ...getForest(S().doc)].slice(-1)[0]?.type ?? '(空)',
    };
    add(
      '属性面板无横向滚动（滚动容器未溢出）',
      !!scrollNow && scrollNow.clientWidth > 100 && scrollNow.scrollWidth <= scrollNow.clientWidth + 1,
      scrollNow
        ? `clientWidth=${scrollNow.clientWidth} / scrollWidth=${scrollNow.scrollWidth}`
        : `未找到滚动容器；诊断：视口=${alive.viewport} 画布节点=${alive.nodes} 面板数=${alive.panels} 右栏折叠=${alive.rightCollapsed} 模式=${alive.mode} 媒体=${alive.media} 最后类型=${alive.lastType}`,
    );
    S().clearAll();
    S().setMode('document');
    await wait(120);
  }

  /* ── 属性面板折叠状态持久化（规格阶段五）──
     以前折叠状态是面板内的 useState，刷新就丢；现在写进 store.ui.propClosed（随 ui 持久化）。 */
  {
    S().setMode('document');
    S().clearAll();
    const tFold = S().addComponent('table');
    if (tFold) {
      S().selectComponent([tFold]);
      await wait(260);
      // 右键？不：直接点分组标题切换折叠
      const before = JSON.stringify(S().ui.propClosed ?? {});
      const head = [...document.querySelectorAll('[data-props-panel] [data-prop-group="1"]')].find(
        (g) => g.getAttribute('data-group-open') === '1',
      );
      const headName = head?.getAttribute('data-group-name') ?? '';
      (head?.querySelector('button') as HTMLButtonElement | null)?.click();
      await wait(200);
      const after = S().ui.propClosed ?? { groups: {}, drawers: {} };
      const stored = after.groups[headName] === true;
      const groupEl = [...document.querySelectorAll('[data-props-panel] [data-prop-group="1"]')].find(
        (g) => g.getAttribute('data-group-name') === headName,
      );
      add(
        '属性面板折叠状态写进 store.ui（随持久化保存，刷新后仍保持）',
        !!head && stored && groupEl?.getAttribute('data-group-open') === '0' && before !== JSON.stringify(after),
        head
          ? `点「${headName}」后 ui.propClosed.groups.${headName}=${String(after.groups[headName])}；面板 data-group-open=${groupEl?.getAttribute('data-group-open')}`
          : '没找到已展开的分组（面板未渲染？）',
      );
      // 还原成展开（增量语义：显式把那一个键置回展开），避免影响后续断言
      if (headName) S().setPropClosed({ groups: { [headName]: false } });
      await wait(120);
    } else {
      add('属性面板折叠状态写进 store.ui（随持久化保存，刷新后仍保持）', false, 'addComponent(table) 失败');
    }
  }

  /* ── 清空内容（保结构）：两次点击确认后所有格变空、行列数与格式保留 ── */
  {
    S().setMode('document');
    S().clearAll();
    const tClear = S().addComponent('table');
    if (tClear) {
      S().updateProps(tClear, { data: 'A | B\nC | D', headerRow: true, cellStyles: { B2: { background: '#fff2cc' } } });
      await wait(320);
      S().selectComponent([tClear]);
      S().selectTableCells(tClear, ['0,0']);
      await wait(220);
      await openGroup('表格'); // 「清空内容」在「表格」组里
      const clearBtn = document.querySelector('[data-table-clear-content="1"]') as HTMLButtonElement | null;
      clearBtn?.click();
      await wait(100);
      const clearArmed = (clearBtn?.textContent ?? '').includes('再点一次');
      clearBtn?.click();
      await wait(360);
      const props = (S().doc.document.components.find((n) => n.id === tClear)?.props ?? {}) as Record<string, unknown>;
      const data = String(props.data ?? '');
      const cells = document.querySelectorAll(`[data-node-id="${tClear}"] td, [data-node-id="${tClear}"] th`);
      const emptyCells = [...cells].filter((c) => (c.textContent ?? '').trim() === '').length;
      add(
        '清空内容：两次点击确认后所有格变空（行列数与单元格格式保留）',
        clearArmed && data.includes('|') && emptyCells === cells.length && !!props.cellStyles,
        `第一次点击待确认=${clearArmed}；data=「${data.replace(/\n/g, ' ⏎ ')}」；空格 ${emptyCells}/${cells.length}；格式保留=${!!props.cellStyles}`,
      );
    } else {
      add('清空内容：两次点击确认后所有格变空（行列数与单元格格式保留）', false, 'addComponent(table) 失败');
    }
  }

  /* ── 容器组件的 children 走**第三个参数**（规格 §3.1 / §8.1）──
     以前靠 cloneElement 挂到根元素上，容器自己"忽略 children"（「分栏」就是这样）时子组件会整个消失。 */
  {
    S().setMode('document');
    S().clearAll();
    const colId = S().addComponent('columns');
    const childId = colId ? S().addComponent('paragraph', colId) : null;
    if (childId) S().updateProps(childId, { html: '分栏里的子组件' });
    await wait(460);
    const col0 = document.querySelector(`[data-node-id="${colId}"] [data-col="0"]`) as HTMLElement | null;
    const inCol0 = !!col0?.querySelector('[data-node-id]');
    const childText = (col0?.textContent ?? '').trim();
    add(
      '容器组件用 render 第三参承接子组件（拖进「分栏」的子组件不再消失）',
      !!childId && inCol0 && childText.includes('分栏里的子组件'),
      childId
        ? `分栏第 1 栏里含子节点=${inCol0}；文本=「${childText.slice(0, 20)}」`
        : 'addComponent(columns / paragraph) 失败',
    );
  }

  /* ── 外部组件契约：type 必须以 live 开头（规格 §7.2 / 验收 5）──
     没有这道闸，一个外部 .js 就能把内置组件顶掉（register 里本来就"允许覆盖同名"）。 */
  {
    const builtinBefore = getComponent('table');
    const kit = (window as unknown as { EditorKit?: { register: (d: unknown) => void } }).EditorKit;
    kit?.register({
      type: 'table',
      label: '（自检）试图覆盖内置表格',
      category: '通用',
      supportedModes: ['document'],
      icon: () => null,
      defaultProps: {},
      propSchema: [],
      render: () => null,
    });
    await wait(80);
    const builtinAfter = getComponent('table');
    add(
      '外部组件 type 必须 live 前缀（拒绝非 live 注册，内置组件不被顶掉）',
      !!kit && builtinAfter === builtinBefore && builtinAfter?.label === '表格',
      kit
        ? `试图注册 type=table → 注册表里 table 仍是「${builtinAfter?.label ?? '(没了)'}」、定义对象未被替换=${builtinAfter === builtinBefore}`
        : '未找到 window.EditorKit（外部组件通道未启用）',
    );
  }

  /* ── 标尺：顶部 + **左侧**都要有（两种模式）；标尺贴在画布视口边缘（与面板边框相邻）── */
  {
    const measure = async (m: 'document' | 'web') => {
      S().setMode(m);
      await wait(280);
      const h = document.querySelector('[data-ruler="h"]') as HTMLElement | null;
      const v = document.querySelector('[data-ruler="v"]') as HTMLElement | null;
      const corner = document.querySelector('[data-ruler-corner="1"]') as HTMLElement | null;
      const body = document.querySelector('[data-canvas-body="1"]') as HTMLElement | null;
      const bodyRect = body?.getBoundingClientRect();
      const hBox = document.querySelector('[data-ruler-box="h"]')?.getBoundingClientRect();
      const vBox = document.querySelector('[data-ruler-box="v"]')?.getBoundingClientRect();
      return {
        hasH: !!h,
        hasV: !!v,
        hasCorner: !!corner,
        // 标尺固定在视口顶部/左侧：横向标尺贴 body 顶边、起点在左侧标尺右边；纵向标尺贴 body 左边
        topFlush: !!bodyRect && !!hBox ? Math.abs(hBox.top - bodyRect.top) <= 2 : false,
        leftFlush: !!bodyRect && !!vBox ? Math.abs(vBox.left - bodyRect.left) <= 2 : false,
        vTopFlush: !!bodyRect && !!vBox ? Math.abs(vBox.top - (bodyRect.top + RULER_H)) <= 2 : false,
      };
    };
    const d = await measure('document');
    add(
      '文档模式：顶部与**左侧**都有标尺（左上角交汇格；标尺贴在画布视口边缘）',
      d.hasH && d.hasV && d.hasCorner && d.topFlush && d.leftFlush && d.vTopFlush,
      `横=${d.hasH} 纵=${d.hasV} 角=${d.hasCorner}；横标尺贴顶=${d.topFlush}、纵标尺贴左=${d.leftFlush}/${d.vTopFlush}`,
    );
    const w = await measure('web');
    add(
      'Web 模式：顶部与左侧都有标尺（单位 px，同样贴在视口边缘）',
      w.hasH && w.hasV && w.hasCorner && w.topFlush && w.leftFlush && w.vTopFlush,
      `横=${w.hasH} 纵=${w.hasV} 角=${w.hasCorner}；横标尺贴顶=${w.topFlush}、纵标尺贴左=${w.leftFlush}/${w.vTopFlush}`,
    );
    S().setMode('document');
    await wait(160);
  }

  /* ── 文档模式：**滚动条**浏览（不平移）+ 标尺覆盖全文 + 外部写入自动跟随（用户 2026-09-23）── */
  {
    S().setMode('document');
    S().clearAll();
    S().setZoom(1);
    // 塞够内容让它分页（≥2 页），这样才能验"标尺覆盖全文"和"跟随下一页"
    for (let i = 0; i < 28; i += 1) {
      const h = S().addComponent('heading');
      if (h) S().updateProps(h, { level: 2, text: `第 ${i + 1} 节` });
      const p = S().addComponent('paragraph');
      if (p) S().updateProps(p, { html: `第 ${i + 1} 节的正文内容。`.repeat(6) });
    }
    await wait(900);
    const vp = document.getElementById('canvas-viewport') as HTMLElement | null;
    add(
      '文档模式：画布用**滚动条**浏览（视口 overflow=auto，空格/中键不再平移画布）',
      !!vp &&
        getComputedStyle(vp).overflowY === 'auto' &&
        vp.getAttribute('data-scroll') === '1' &&
        vp.scrollHeight > vp.clientHeight + 40,
      `overflowY=${vp ? getComputedStyle(vp).overflowY : '—'}、data-scroll=${vp?.getAttribute('data-scroll')}、内容 ${vp?.scrollHeight ?? 0}px / 视口 ${vp?.clientHeight ?? 0}px`,
    );

    if (vp) {
      // 空格 + 拖拽在中键/空格按下时也不该平移（pan 不变、纸张位置不变）
      const panBefore = S().ui.pan ?? { x: 0, y: 0 };
      const paperBefore = (document.querySelector('#canvas-viewport .print-reset') as HTMLElement | null)?.getBoundingClientRect();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      await wait(60);
      const panReadyInDoc = vp.getAttribute('data-pan') === 'ready';
      const r = vp.getBoundingClientRect();
      pe('pointerdown', r.left + r.width / 2, r.top + r.height / 2, vp);
      pe('pointermove', r.left + r.width / 2 - 120, r.top + r.height / 2 - 90, vp);
      pe('pointerup', r.left + r.width / 2 - 120, r.top + r.height / 2 - 90, vp);
      await wait(160);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
      await wait(80);
      const panAfter = S().ui.pan ?? { x: 0, y: 0 };
      const paperAfter = (document.querySelector('#canvas-viewport .print-reset') as HTMLElement | null)?.getBoundingClientRect();
      add(
        '文档模式：按住空格 + 拖拽**不再平移画布**（回到滚动条浏览）',
        !panReadyInDoc &&
          panAfter.x === panBefore.x &&
          panAfter.y === panBefore.y &&
          !!paperAfter &&
          !!paperBefore &&
          Math.abs(paperAfter.left - paperBefore.left) <= 1,
        `空格抓手=${panReadyInDoc}；pan (${panBefore.x},${panBefore.y}) → (${panAfter.x},${panAfter.y})；纸张位移 ${paperAfter && paperBefore ? Math.round(paperAfter.left - paperBefore.left) : '?'}px`,
      );

      // 滚轮 = 原生滚动（能滚到下一页），标尺刻度跟着滚动量走
      vp.scrollTop = 0;
      vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 400 }));
      await wait(120);
      vp.scrollTop = Math.min(vp.scrollHeight - vp.clientHeight, 500);
      vp.dispatchEvent(new Event('scroll', { bubbles: true }));
      await wait(160);
      const vTicks = document.querySelector('[data-ruler-ticks="v"]') as HTMLElement | null;
      const scrolled = vp.scrollTop;
      add(
        '文档模式：滚动时**标尺刻度跟着滚动量走**（标尺本身钉在视口边缘）',
        scrolled > 0 && !!vTicks && (vTicks.getAttribute('style') ?? '').includes(`translateY(${-scrolled}px)`),
        `scrollTop=${scrolled}；标尺刻度 transform=${vTicks?.getAttribute('style') ?? '—'}`,
      );

      // 标尺覆盖**全文**：纵向刻度高度 ≈ 内容总高，而不是一页高
      const onePage = mmToPx(S().doc.document.page.height);
      const vBox = document.querySelector('[data-ruler-box="v"]') as HTMLElement | null;
      const tickH = Number.parseFloat(vTicks?.style.height || '0');
      const pages = S().ui.docPageCount ?? 1;
      add(
        '标尺覆盖**全文**（多页时纵向刻度按内容总高，不再只画一页）',
        pages >= 2 && tickH > onePage * 1.6 && tickH >= (vBox?.clientHeight ?? 0),
        `共 ${pages} 页；单页 ${Math.round(onePage)}px；刻度高 ${Math.round(tickH)}px（期望 ≈ 内容总高 ${vp.scrollHeight}px）`,
      );

      /* ★2026-09-24 用户反馈：26 页时纵向标尺数字"越数越长、挤成一片"、缩放后"变形"
         → 纵向标尺改成**逐页分段、每页从 0 读数**；刻度步长**随缩放自适应**。 */
      const vLabelNums = [...(vTicks?.querySelectorAll('span') ?? [])]
        .map((s) => Number.parseInt(s.textContent ?? '', 10))
        .filter((n) => Number.isFinite(n));
      const zeroCount = vLabelNums.filter((n) => n === 0).length;
      const maxLabel = vLabelNums.length ? Math.max(...vLabelNums) : -1;
      add(
        '文档模式纵向标尺**逐页从 0 开始**（每页 0…页高；26 页也不会把数字数到 7000+mm）',
        zeroCount >= 2 && maxLabel > 0 && maxLabel <= Math.ceil(S().doc.document.page.height) + 1,
        `共 ${pages} 页；出现 ${zeroCount} 次「0mm」；最大读数 ${maxLabel}mm（页高 ${S().doc.document.page.height}mm）`,
      );
      const majorOf = (): number =>
        Number(document.querySelector('[data-ruler="v"]')?.getAttribute('data-ruler-major') ?? 0);
      const zoomBack = S().zoom;
      S().setZoom(1);
      await wait(220);
      const major100 = majorOf();
      S().setZoom(0.4);
      await wait(240);
      const major40 = majorOf();
      S().setZoom(zoomBack);
      await wait(200);
      add(
        '标尺步长随缩放自适应：缩到 40% 时大格从 10mm 自动放大到 50mm（数字不再挤成一片）',
        major100 === 10 && major40 > major100 && major40 % 10 === 0,
        `100% 时大格 ${major100}mm / 40% 时大格 ${major40}mm`,
      );

      /* ★横向标尺的 0 必须跟**纸张左边缘**对齐（用户 2026-09-24 截图：顶部比例尺偏移）
         —— 内容比视口窄时 `margin:0 auto` 会把它居中，刻度必须把这个内缩算进去。 */
      const hZeroX = (): number => {
        const layer = document.querySelector('[data-ruler-ticks="h"]');
        const zero = [...(layer?.querySelectorAll('span') ?? [])].find((s) => (s.textContent ?? '').trim() === '0mm');
        const t = zero?.closest('div[style*="left"]');
        return t ? t.getBoundingClientRect().left : Number.NaN;
      };
      const paperLeftX = document.querySelector('[data-paper]')?.getBoundingClientRect().left ?? Number.NaN;
      const hDelta = hZeroX() - paperLeftX;
      add(
        '文档模式横向标尺的 0 与**纸张左边缘**对齐（内容居中时不再差一个 auto margin）',
        Number.isFinite(hDelta) && Math.abs(hDelta) <= 2,
        `纸张左边 x=${Math.round(paperLeftX)}；标尺 0mm x=${Math.round(hZeroX())}；差 ${Math.round(hDelta)}px`,
      );

      // ★外部（MCP 走同一套 store 写入）继续写 → 预览自动跟到下一页
      vp.scrollTop = Math.max(0, vp.scrollHeight - vp.clientHeight); // 假装"正在看最后一页"
      await wait(120);
      const beforeFollow = vp.scrollTop;
      const grow = S().addComponent('paragraph');
      if (grow) S().updateProps(grow, { html: '外部写入的新段落，应该把预览带到新的底部。'.repeat(20) });
      await wait(700);
      const afterFollow = vp.scrollTop;
      const atBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
      add(
        '外部写入把文档写长/翻页时，预览**自动跟到新的底部**（原先停在旧位置）',
        afterFollow > beforeFollow + 10 && atBottom <= 8,
        `scrollTop ${beforeFollow} → ${afterFollow}（内容 ${vp.scrollHeight}px / 视口 ${vp.clientHeight}px，距底 ${Math.round(atBottom)}px）`,
      );

      // 用户在中间看别处时不该被拽走
      vp.scrollTop = 200;
      vp.dispatchEvent(new Event('scroll', { bubbles: true }));
      await wait(120);
      const midBefore = vp.scrollTop;
      const grow2 = S().addComponent('paragraph');
      if (grow2) S().updateProps(grow2, { html: '再看一处新内容。'.repeat(20) });
      await wait(700);
      add(
        '正在看中间内容时，外部写入**不抢视线**（不会强制跳到底部）',
        Math.abs(vp.scrollTop - midBefore) <= 2,
        `scrollTop ${midBefore} → ${vp.scrollTop}`,
      );
    }
    S().clearAll();
    await wait(200);
  }

  /* ── 画布平移：按住空格拖拽 / 中键拖拽（PS 式手抓；**仅 Web 模式**，文档模式用滚动条）── */
  {
    S().setMode('web');
    S().clearAll();
    S().addComponent('button');
    S().setZoom(2);
    await wait(360);
    const vp = document.getElementById('canvas-viewport') as HTMLElement | null;
    const paperOf = () => (document.querySelector('#canvas-viewport .print-reset') as HTMLElement | null)?.getBoundingClientRect();
    const before = S().ui.pan ?? { x: 0, y: 0 };
    const paperBefore = paperOf();
    if (vp && paperBefore) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      await wait(60);
      const panReady = vp.getAttribute('data-pan') === 'ready';
      const rect = vp.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      pe('pointerdown', cx, cy, vp);
      pe('pointermove', cx - 140, cy - 110, vp);
      pe('pointerup', cx - 140, cy - 110, vp);
      await wait(160);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
      await wait(80);
      const after = S().ui.pan ?? { x: 0, y: 0 };
      const paperAfter = paperOf();
      const reset = vp.getAttribute('data-pan') === '0';
      const moved = !!paperAfter && Math.abs(paperAfter.left - paperBefore.left + 140) <= 3 && Math.abs(paperAfter.top - paperBefore.top + 110) <= 3;
      add(
        'Web 模式：画布可用**空格 + 拖拽**平移（PS 式手抓；自由不夹边界）',
        panReady && after.x === before.x - 140 && after.y === before.y - 110 && moved && reset,
        `空格提示=${panReady}；pan (${before.x},${before.y}) → (${after.x},${after.y})；画布位移 ${paperAfter && paperBefore ? `${Math.round(paperAfter.left - paperBefore.left)},${Math.round(paperAfter.top - paperBefore.top)}` : '?'}（期望 -140,-110）；松开后状态复原=${reset}`,
      );
    } else {
      add('Web 模式：画布可用**空格 + 拖拽**平移（PS 式手抓；自由不夹边界）', false, '找不到 #canvas-viewport');
    }
    // 中键拖拽（不按空格也能平移）
    if (vp) {
      const before2 = S().ui.pan ?? { x: 0, y: 0 };
      const rect = vp.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      vp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 1, pointerId: 21 }));
      vp.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx - 90, clientY: cy - 70, button: 1, pointerId: 21 }));
      vp.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx - 90, clientY: cy - 70, button: 1, pointerId: 21 }));
      await wait(160);
      const after2 = S().ui.pan ?? { x: 0, y: 0 };
      add(
        'Web 模式：中键拖拽也能平移（不必按空格）',
        after2.x === before2.x - 90 && after2.y === before2.y - 70,
        `pan (${before2.x},${before2.y}) → (${after2.x},${after2.y})（期望 -90,-70）`,
      );
    }
    S().setZoom(1);
    await wait(160);
    S().setPan({ x: 0, y: 0 });
    await wait(120);
  }

  /* ── 新建文档：先选模式 → 再填参数（类似 PS 的新建）── */
  {
    S().setNewDocOpen(true);
    await wait(240);
    const step1 = document.querySelector('[data-new-doc="1"][data-new-doc-step="1"]');
    const modes = document.querySelectorAll('[data-new-doc-mode]');
    add(
      '新建文档：第 1 步先选模式（文档模式 / Web 模式）',
      !!step1 && modes.length === 2,
      step1 ? `两种模式入口 ${modes.length} 个` : '对话框未打开',
    );

    // 选「文档模式」→ 第 2 步只有文档相关参数
    (document.querySelector('[data-new-doc-mode="document"]') as HTMLButtonElement | null)?.click();
    await wait(220);
    const p = document.querySelector('[data-new-doc-params="document"]');
    const paper = document.querySelector('[data-new-doc-paper="1"]') as HTMLSelectElement | null;
    const titleInput = document.querySelector('[data-new-doc-title="1"]') as HTMLInputElement | null;
    const orient = document.querySelector('[data-new-doc-orientation="1"]') as HTMLSelectElement | null;
    add(
      '新建文档：第 2 步按模式给参数（文档模式=纸张/宽高/方向/页边距）',
      !!p && !!paper && !!titleInput && !!orient && !document.querySelector('[data-new-doc-device="1"]'),
      p ? `纸张选项 ${paper?.options.length ?? 0} 个；方向=${!!orient}；无 Web 参数=${!document.querySelector('[data-new-doc-device="1"]')}` : '未进入第 2 步',
    );

    if (p && paper && titleInput && orient) {
      const setVal = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(titleInput, '自检新建的 A3 横向文档');
      setVal(paper, 'A3');
      await wait(120);
      setVal(orient, 'landscape');
      await wait(120);
      (document.querySelector('[data-new-doc-create="1"]') as HTMLButtonElement | null)?.click();
      await wait(460);
      const doc = S().doc;
      const pg = doc.document.page;
      const tabs = document.querySelectorAll('[data-page-tab]').length;
      add(
        '新建文档：按参数创建（新增一页 / A3 横向 420×297 / 弹窗关闭）',
        doc.title === '自检新建的 A3 横向文档' &&
          doc.mode === 'document' &&
          pg.size === 'A3' &&
          pg.orientation === 'landscape' &&
          pg.width === 420 &&
          pg.height === 297 &&
          tabs >= 2 &&
          !document.querySelector('[data-new-doc="1"]'),
        `标题=「${doc.title}」模式=${doc.mode} 纸张=${pg.size} ${pg.width}×${pg.height}（${pg.orientation}）；分页标签 ${tabs} 个；弹窗已关=${!document.querySelector('[data-new-doc="1"]')}`,
      );
    }

    // Web 模式路径
    S().setNewDocOpen(true);
    await wait(220);
    (document.querySelector('[data-new-doc-mode="web"]') as HTMLButtonElement | null)?.click();
    await wait(220);
    const dev = document.querySelector('[data-new-doc-device="1"]') as HTMLSelectElement | null;
    const titleW = document.querySelector('[data-new-doc-title="1"]') as HTMLInputElement | null;
    if (dev && titleW) {
      const setVal = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(titleW, '自检新建的手机画布');
      setVal(dev, 'Mobile');
      await wait(160);
      (document.querySelector('[data-new-doc-create="1"]') as HTMLButtonElement | null)?.click();
      await wait(460);
      const c = S().doc;
      const tabsW = document.querySelectorAll('[data-page-tab]').length;
      add(
        '新建文档：Web 模式按参数创建（Mobile 375×812 / 模式=web / 又是一页）',
        c.title === '自检新建的手机画布' && c.mode === 'web' && c.web.canvas.device === 'Mobile' && c.web.canvas.width === 375 && c.web.canvas.height === 812 && tabsW >= 3,
        `标题=「${c.title}」模式=${c.mode} 设备=${c.web.canvas.device} ${c.web.canvas.width}×${c.web.canvas.height}；分页标签 ${tabsW} 个`,
      );
    } else {
      add('新建文档：Web 模式按参数创建（Mobile 375×812 / 模式=web / 又是一页）', false, '第 2 步没有设备/标题字段');
    }

    /* ── 分页：点标签切换页面 → 模式与属性面板跟着换 ── */
    {
      const before = S().pages.length;
      const docPage = S().pages.find((p) => p.mode === 'document');
      const webPage = S().pages.find((p) => p.mode === 'web');
      let ok = false;
      let note = '';
      if (docPage && webPage) {
        S().setActivePage(docPage.id);
        await wait(300);
        const modeDoc = S().doc.mode;
        const paperVisible = !!document.querySelector('[data-paper]');
        // 切到 Web 页：模式变 web、画布变设备画布、右侧面板标题显示「画布」或选中的卡片属性
        S().setActivePage(webPage.id);
        await wait(340);
        const modeWeb = S().doc.mode;
        const canvasVisible = !!document.querySelector('[data-device]');
        const pagePanel = document.querySelector('[data-props-canvas="1"], [data-props-page="1"]');
        ok = modeDoc === 'document' && paperVisible && modeWeb === 'web' && canvasVisible && !!pagePanel;
        note = `页数=${before}；切文档页 → mode=${modeDoc}、纸张在=${paperVisible}；切 Web 页 → mode=${modeWeb}、设备画布在=${canvasVisible}、属性面板=${pagePanel ? '在' : '不在'}`;
      } else {
        note = '没有同时存在文档页与 Web 页';
      }
      add('分页切页：模式切换 + 画布与属性面板跟着换', ok, note);
      // 收尾：回到文档页，避免影响后面的用例
      const back = S().pages.find((p) => p.mode === 'document');
      if (back) S().setActivePage(back.id);
      await wait(240);
    }
  }

  /* ══════════ B 清单（按易→难实现）的验收断言 ══════════ */

  /* B1 面板级 memo：外层因鼠标坐标重渲染时，属性子树不应重渲染 */
  {
    S().setMode('document');
    S().clearAll();
    const b1 = S().addComponent('table');
    await wait(380);
    S().selectComponent(b1 ? [b1] : []);
    await wait(260);
    const panel = document.querySelector('[data-props-panel="1"]') as HTMLElement | null;
    const before = Number(panel?.getAttribute('data-props-renders') ?? '-1');
    // 画布上的 mousemove 会 setPointer（App 级 useState）→ App/面板整体重渲染；
    // 属性子树被 memo 挡住，渲染计数应当不动。
    const paper = document.querySelector('.page-flow') as HTMLElement | null;
    const coordsText = (): string =>
      [...document.querySelectorAll('span,div')].find((el) => el.textContent?.startsWith('光标：'))?.textContent ?? '';
    const c0 = coordsText();
    const rect = paper?.getBoundingClientRect();
    if (paper && rect) {
      const pts: Array<[number, number]> = [
        [rect.left + 30, rect.top + 30],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + rect.width - 30, rect.top + rect.height - 30],
      ];
      for (const [x, y] of pts) {
        paper.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
        await wait(60);
      }
    }
    await wait(260);
    const c1 = coordsText();
    const after = Number(document.querySelector('[data-props-panel="1"]')?.getAttribute('data-props-renders') ?? '-2');
    add(
      'B1 属性面板级 memo：画布鼠标移动引起的外层重渲染不再重渲染属性子树',
      before > 0 && after === before && !!c0 && c1 !== c0,
      `属性子树渲染计数 ${before} → ${after}；光标读数「${c0.trim()}」→「${c1.trim()}」（证明外层确实重渲染了）`,
    );
  }

  /* B2 快捷键：Tab/Shift+Tab 移动选择、Ctrl+]/Ctrl+[ 层级、Enter 进出容器 */
  {
    S().setMode('document');
    S().clearAll();
    const k1 = S().addComponent('paragraph');
    const k2 = S().addComponent('paragraph');
    const k3 = S().addComponent('paragraph');
    await wait(340);
    S().selectComponent(k1 ? [k1] : []);
    await wait(160);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await wait(200);
    const afterTab = S().doc.selectedIds[0];
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    await wait(200);
    const afterShiftTab = S().doc.selectedIds[0];
    S().selectComponent(k3 ? [k3] : []);
    await wait(160);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await wait(200);
    const wrapped = S().doc.selectedIds[0];
    add(
      'B2 快捷键 Tab / Shift+Tab：在组件之间前后移动选择（到末尾循环回第一个）',
      afterTab === k2 && afterShiftTab === k1 && wrapped === k1,
      `Tab→${afterTab}（期望 ${k2}）、Shift+Tab→${afterShiftTab}（期望 ${k1}）、末尾 Tab→${wrapped}（期望 ${k1}）`,
    );

    S().selectComponent(k1 ? [k1] : []);
    await wait(140);
    const orderBefore = S().doc.document.components.map((n) => n.id).join(',');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', ctrlKey: true, bubbles: true }));
    await wait(220);
    const orderAfter = S().doc.document.components.map((n) => n.id).join(',');
    add(
      'B2 快捷键 Ctrl+] / Ctrl+[：层级上移 / 下移一层',
      orderBefore !== orderAfter && S().doc.document.components[1]?.id === k1,
      `顺序 ${orderBefore} → ${orderAfter}`,
    );

    const cont = S().addComponent('columns');
    const child = cont ? S().addComponent('paragraph', cont) : null;
    await wait(340);
    S().selectComponent(cont ? [cont] : []);
    await wait(160);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(220);
    const into = S().doc.selectedIds[0];
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(220);
    const back = S().doc.selectedIds[0];
    add(
      'B2 快捷键 Enter：进出容器（有子节点→进第一个子节点；无子节点→回到父容器）',
      !!child && !!cont && into === child && back === cont,
      `第一次 Enter→${into ?? '无'}（期望子节点 ${child ?? '无'}）、第二次 Enter→${back ?? '无'}（期望父容器 ${cont ?? '无'}）`,
    );
  }

  /* B3 分页标签就地改名（双击 / F2） */
  {
    const pageId = S().activePageId;
    const tab = document.querySelector(`[data-page-select="${pageId}"]`) as HTMLElement | null;
    tab?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await wait(260);
    const input = document.querySelector(`[data-page-rename-input="${pageId}"]`) as HTMLInputElement | null;
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '改过名的页');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    await wait(320);
    const title = S().doc.title;
    const tabText = document.querySelector(`[data-page-select="${pageId}"]`)?.textContent ?? '';
    add(
      'B3 分页标签就地改名：双击（或 F2）出现输入框，Enter 提交后页标题与文档标题一起变',
      !!input && title === '改过名的页' && tabText.includes('改过名的页'),
      `输入框出现=${!!input}；文档标题=「${title}」；标签文本=「${tabText.trim()}」`,
    );
  }

  /* B4 表格组属性顺序 + 分组分割线 */
  {
    S().setMode('document');
    S().clearAll();
    const b4 = S().addComponent('table');
    await wait(380);
    S().selectComponent(b4 ? [b4] : []);
    await wait(240);
    await openGroup('表格');
    const tableGroup = document.querySelector('[data-prop-group="1"][data-group-name="表格"]');
    const keys = [...(tableGroup?.querySelectorAll('[data-prop-key]') ?? [])].map(
      (el) => el.getAttribute('data-prop-key') ?? '',
    );
    const at = (k: string) => keys.indexOf(k);
    const ordered =
      at('headerRow') >= 0 &&
      at('headerRow') < at('caption') &&
      at('caption') < at('tableSize') &&
      at('tableSize') < at('variant') &&
      at('variant') < at('width') &&
      at('width') < at('fontSize');
    add(
      'B4 表格组属性顺序：结构 → 数据 → 线条 → 尺寸 → 文字',
      ordered,
      `前 14 项=${keys.slice(0, 14).join(',')}`,
    );
    const groups = [...document.querySelectorAll('[data-prop-group="1"]')];
    const dividers = groups.filter((g) => g.getAttribute('data-group-divider') === '1').length;
    add(
      'B4 属性分组之间的分割线（第一个分组不画；每多一个分组多一条）',
      groups.length >= 2 && dividers === groups.length - 1,
      `${groups.length} 个分组，带分割线 ${dividers} 个`,
    );
  }

  /* B5 单元格复制 / 粘贴 */
  {
    S().setMode('document');
    S().clearAll();
    const b5 = S().addComponent('table');
    if (b5) S().updateProps(b5, { data: 'A | B\nC | D', headerRow: true, cellStyles: {} });
    await wait(400);
    S().selectComponent(b5 ? [b5] : []);
    S().selectTableCells(b5!, ['0,0', '1,0']);
    await wait(240);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    await wait(180);
    S().selectTableCells(b5!, ['0,1']);
    await wait(220);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    await wait(320);
    const data = String(findNode(getForest(S().doc), b5 ?? '')?.props.data ?? '');
    const flatData = data.replace(/\s+/g, '');
    add(
      'B5 单元格复制 / 粘贴：Ctrl+C 复制选区 → Ctrl+V 粘到目标格（自动补足行列）',
      flatData.includes('A|A') && flatData.includes('C|C'),
      `data=「${data.replace(/\n/g, ' ⏎ ')}」`,
    );
  }

  /* B6 单元格键盘导航（方向键 / Shift+方向键 / Tab / Enter）+ 双击画布单元格改字 */
  {
    S().setMode('document');
    S().clearAll();
    const b6 = S().addComponent('table');
    if (b6) S().updateProps(b6, { data: 'A | B | C\nD | E | F\nG | H | I', cellStyles: {} });
    await wait(420);
    S().selectComponent(b6 ? [b6] : []);
    S().selectTableCells(b6!, ['1,1']);
    await wait(240);
    const key = () => String(useEditorStore.getState().ui.tableCells?.cells.join(' ') ?? '');
    const arrow = (k: string, shift = false) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));

    arrow('ArrowRight');
    await wait(120);
    const right = key();
    arrow('ArrowDown');
    await wait(120);
    const down = key();
    // 左/上越界要**夹住**，不能跑到表外
    S().selectTableCells(b6!, ['0,0']);
    await wait(100);
    arrow('ArrowLeft');
    arrow('ArrowUp');
    await wait(140);
    const clamped = key();
    add(
      'B6 方向键在单元格之间移动活动格（越界夹住，不跑出表格）',
      right === '1,2' && down === '2,2' && clamped === '0,0',
      `右→${right}（期望 1,2）、下→${down}（期望 2,2）、左上越界→${clamped}（期望 0,0）`,
    );

    S().selectTableCells(b6!, ['1,1']);
    await wait(100);
    arrow('ArrowRight', true);
    await wait(140);
    const extended = key();
    add(
      'B6 Shift+方向键：从选区左上角扩选成一片',
      extended === '1,1 1,2',
      `Shift+右→「${extended}」（期望「1,1 1,2」）`,
    );

    S().selectTableCells(b6!, ['0,2']);
    await wait(100);
    arrow('Tab');
    await wait(140);
    const tabNext = key();
    S().selectTableCells(b6!, ['0,0']);
    await wait(100);
    arrow('Tab', true);
    await wait(140);
    const tabPrev = key();
    add(
      'B6 Tab / Shift+Tab：按行优先顺序走下一格 / 上一格（行末自动换行）',
      tabNext === '1,0' && tabPrev === '2,2',
      `行末 Tab→${tabNext}（期望 1,0）、首格 Shift+Tab→${tabPrev}（期望 2,2）`,
    );

    S().selectTableCells(b6!, ['2,1']);
    await wait(120);
    await openGroup('单元格');
    arrow('Enter');
    await wait(300);
    const focused = document.activeElement as HTMLElement | null;
    const collapsed = key();
    add(
      'B6 Enter：收敛到活动格并把焦点交给属性面板的「单元格内容」框',
      focused?.getAttribute('data-cell-text') === '1' && collapsed === '2,1',
      `焦点=${focused?.tagName}${focused?.getAttribute('data-cell-text') ? '（data-cell-text=1）' : ''}；选中=${collapsed}`,
    );
    (document.activeElement as HTMLElement | null)?.blur();

    /* 双击画布单元格 → 就地改字 */
    const cell = document.querySelector(`[data-node-id="${b6}"] [data-cell="1,1"]`) as HTMLElement | null;
    cell?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await wait(300);
    const editor = document.querySelector('[data-cell-editor="1"]') as HTMLInputElement | null;
    const inPaper = !!editor?.closest('[data-pan-layer="1"]');
    if (editor) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(editor, '双击改的字');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    await wait(320);
    const afterEdit = String(findNode(getForest(S().doc), b6 ?? '')?.props.data ?? '').replace(/\s+/g, '');
    add(
      'B6 双击画布单元格就地改字（输入框挂在缩放层里，Enter 提交写回 props.data）',
      !!cell && !!editor && inPaper && afterEdit.includes('双击改的字'),
      `命中格子=${!!cell}、输入框=${!!editor}、在缩放层内=${inPaper}；data=「${afterEdit}」`,
    );

    /* Esc 取消不写入 */
    const cell2 = document.querySelector(`[data-node-id="${b6}"] [data-cell="0,0"]`) as HTMLElement | null;
    cell2?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await wait(280);
    const editor2 = document.querySelector('[data-cell-editor="1"]') as HTMLInputElement | null;
    if (editor2) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(editor2, '不该写进去');
      editor2.dispatchEvent(new Event('input', { bubbles: true }));
      editor2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    await wait(300);
    const afterEsc = String(findNode(getForest(S().doc), b6 ?? '')?.props.data ?? '').replace(/\s+/g, '');
    add(
      'B6 Esc 取消双击改字（不写回数据，输入框收起）',
      !!editor2 && !afterEsc.includes('不该写进去') && !document.querySelector('[data-cell-editor="1"]'),
      `输入框出现过=${!!editor2}、数据含取消内容=${afterEsc.includes('不该写进去')}、输入框已收起=${!document.querySelector('[data-cell-editor="1"]')}`,
    );
  }

  /* B7 文档模式的**宽度拖拽手柄**（按 mm 写回 props.width） */
  {
    S().setMode('document');
    S().clearAll();
    const img = S().addComponent('image');
    const para = S().addComponent('paragraph');
    if (img) S().updateProps(img, { width: 84, src: '' });
    await wait(440);
    S().selectComponent(img ? [img] : []);
    await wait(320);

    const zoom = S().zoom || 1;
    const handle = document.querySelector('[data-width-handle="1"]') as HTMLElement | null;
    const box = document.querySelector(`[data-node-id="${img}"] [data-width-box="1"]`) as HTMLElement | null;
    const hr = handle?.getBoundingClientRect();
    const br = box?.getBoundingClientRect();
    const flush = !!hr && !!br && Math.abs(hr.left + hr.width / 2 - br.right) <= 3 * zoom + 2;
    add(
      'B7 文档模式选中图片出现宽度手柄（贴在图片右边缘，不是整列宽度）',
      !!handle && !!box && flush,
      `手柄=${!!handle}、宽度盒子=${!!box}；手柄中线与图片右边缘差 ${hr && br ? Math.round(hr.left + hr.width / 2 - br.right) : '—'}px（zoom=${zoom}）`,
    );

    const startW = Number(findNode(getForest(S().doc), img ?? '')?.props.width);
    const x0 = hr ? hr.left + hr.width / 2 : 0;
    const y0 = hr ? hr.top + hr.height / 2 : 0;
    handle?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, pointerId: 7 }),
    );
    await wait(90);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x0 + 40, clientY: y0, button: 0, pointerId: 7 }));
    await wait(160);
    const badge = document.querySelector('[data-width-badge="1"]')?.textContent?.trim() ?? '';
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x0 + 40, clientY: y0, button: 0, pointerId: 7 }));
    await wait(240);
    const endW = Number(findNode(getForest(S().doc), img ?? '')?.props.width);
    const want = Math.round((startW + 40 / zoom / mmToPx(1)) * 10) / 10;
    add(
      'B7 拖动宽度手柄 40px → 宽度按 mm 写回 props.width（并显示 mm 角标）',
      Math.abs(endW - want) < 1.6 && badge.includes('mm'),
      `${startW}mm --拖 40px（zoom=${zoom}）--> ${endW}mm（期望 ≈${want}mm）；拖动中角标「${badge}」`,
    );

    S().selectComponent(para ? [para] : []);
    await wait(280);
    add(
      'B7 没有 mm 宽度属性的组件（段落）不出现宽度手柄',
      !document.querySelector('[data-width-handle="1"]'),
      `手柄数=${document.querySelectorAll('[data-width-handle="1"]').length}`,
    );
  }

  /* B8 表格**行高拖拽手柄**（按行：拖哪一条只改哪一行；`rowHeight` 退化为整表默认）
     回归点（用户 2026-09-23 反馈）：以前拖任意一条边界都会**整表一起变**，所以这里额外钉住
     "其它行的高度必须一点不动"。 */
  {
    S().setMode('document');
    S().clearAll();
    const t8 = S().addComponent('table');
    if (t8) S().updateProps(t8, { data: 'A | B\nC | D\nE | F', rowHeight: '', rowHeights: {}, cellStyles: {} });
    await wait(460);
    S().selectComponent(t8 ? [t8] : []);
    await wait(360);

    const zoom8 = S().zoom || 1;
    const handles = [...document.querySelectorAll('[data-row-handle="1"]')] as HTMLElement[];
    const rowEls = [...document.querySelectorAll(`[data-node-id="${t8}"] tr`)] as HTMLElement[];
    const heights = (): number[] => rowEls.map((tr) => Math.round(tr.getBoundingClientRect().height));
    const before = heights();
    const hr8 = handles[0]?.getBoundingClientRect();
    const px = hr8 ? hr8.left + 5 : 0;
    const py = hr8 ? hr8.top + 3 : 0;
    handles[0]?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: px, clientY: py, button: 0, pointerId: 9 }),
    );
    await wait(90);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: px, clientY: py + 25, button: 0, pointerId: 9 }));
    await wait(220);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: px, clientY: py + 25, button: 0, pointerId: 9 }));
    await wait(340);

    const props8 = findNode(getForest(S().doc), t8 ?? '')?.props ?? {};
    const rh = String(props8.rowHeight ?? '');
    const overrides = (props8.rowHeights ?? {}) as Record<string, unknown>;
    const after = heights();
    const expectMm8 = Math.round(((before[0] + 25) / zoom8 / mmToPx(1)) * 10) / 10;
    const othersUntouched = after.slice(1).every((h, i) => Math.abs(h - before[i + 1]) <= 1);
    add(
      'B8 拖某一行边界 → **只改那一行**（渲染 +25px、其它行一点不动、写进 props.rowHeights[行号]）',
      handles.length === rowEls.length &&
        Math.abs(after[0] - before[0] - 25) <= 4 &&
        othersUntouched &&
        Object.keys(overrides).join(',') === '1' &&
        Math.abs(Number(overrides['1']) - expectMm8) <= 3,
      `手柄 ${handles.length} 个 / 行 ${rowEls.length} 个（每行都能单独拖，含最后一行）；行高 ${before.join('/')}px → ${after.join('/')}px（只有第 1 行 +25px）；props.rowHeights=${JSON.stringify(overrides)}（期望 ≈${expectMm8}mm）；props.rowHeight=「${rh}」（整表默认，没被改）`,
    );

    // 再拖第 2 条边界：两条按行行高**共存**，互不影响
    const hr8b = handles[1]?.getBoundingClientRect();
    const px2 = hr8b ? hr8b.left + 5 : 0;
    const py2 = hr8b ? hr8b.top + 3 : 0;
    handles[1]?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: px2, clientY: py2, button: 0, pointerId: 12 }),
    );
    await wait(90);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: px2, clientY: py2 + 15, button: 0, pointerId: 12 }));
    await wait(200);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: px2, clientY: py2 + 15, button: 0, pointerId: 12 }));
    await wait(340);
    const after2 = heights();
    const props8b = (findNode(getForest(S().doc), t8 ?? '')?.props ?? {}) as Record<string, unknown>;
    const overrides2 = (props8b.rowHeights ?? {}) as Record<string, unknown>;
    add(
      'B8 再拖另一条边界 → 两条按行行高共存（第 1 行保持上次改动，第 2 行变化，第 3 行不动）',
      Object.keys(overrides2).sort().join(',') === '1,2' &&
        Math.abs(after2[0] - after[0]) <= 1 &&
        Math.abs(after2[1] - before[1] - 15) <= 4 &&
        Math.abs(after2[2] - before[2]) <= 1,
      `行高 ${after2.join('/')}px（第 1 行延续 ${after[0]}、第 2 行 ${before[1]}→${after2[1]}、第 3 行 ${before[2]}→${after2[2]}）；rowHeights=${JSON.stringify(overrides2)}`,
    );

    // 最后一行也能单独拖（以前"行高是整表一个值"时它没有手柄）
    const lastHandle = handles[handles.length - 1];
    const hr8c = lastHandle?.getBoundingClientRect();
    const px3 = hr8c ? hr8c.left + 5 : 0;
    const py3 = hr8c ? hr8c.top + 3 : 0;
    lastHandle?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: px3, clientY: py3, button: 0, pointerId: 13 }),
    );
    await wait(90);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: px3, clientY: py3 + 20, button: 0, pointerId: 13 }));
    await wait(200);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: px3, clientY: py3 + 20, button: 0, pointerId: 13 }));
    await wait(340);
    const after3 = heights();
    const overrides3 = ((findNode(getForest(S().doc), t8 ?? '')?.props ?? {}) as Record<string, unknown>).rowHeights as Record<string, unknown>;
    add(
      'B8 最后一行也能单独拖高（每行一个手柄；拖它不影响上面的行）',
      Math.abs(after3[2] - before[2] - 20) <= 4 &&
        Math.abs(after3[0] - after2[0]) <= 1 &&
        Math.abs(after3[1] - after2[1]) <= 1 &&
        Object.keys(overrides3).sort().join(',') === '1,2,3',
      `行高 ${after2.join('/')}px → ${after3.join('/')}px（第 3 行 ${before[2]}→${after3[2]}）；rowHeights=${JSON.stringify(overrides3)}`,
    );

    // 属性面板「按行行高」：列出被改过的行，可逐条清除 / 全部清除
    await openGroup('表格');
    await wait(220);
    const items = [...document.querySelectorAll('[data-row-height-item]')].map((el) => el.getAttribute('data-row-height-item'));
    const clearOne = document.querySelector('[data-row-height-clear="1"]') as HTMLElement | null;
    const hasClearAll = !!document.querySelector('[data-row-heights-clear-all="1"]');
    clearOne?.click();
    await wait(320);
    const afterClear = (findNode(getForest(S().doc), t8 ?? '')?.props ?? {}) as Record<string, unknown>;
    const cleared = (afterClear.rowHeights ?? {}) as Record<string, unknown>;
    const afterClearHeights = heights();
    add(
      'B8 属性面板「按行行高」列出被改过的行，可逐条清除（清掉后那一行回到整表默认）',
      items.join(',') === '1,2,3' &&
        hasClearAll &&
        Object.keys(cleared).sort().join(',') === '2,3' &&
        Math.abs(afterClearHeights[0] - before[0]) <= 2,
      `列出 ${items.join('/')}；清除第 1 行后 rowHeights=${JSON.stringify(cleared)}；第 1 行渲染高 ${afterClearHeights[0]}px（默认时 ${before[0]}px）`,
    );

    S().selectComponent([]);
    await wait(240);
    add(
      'B8 取消选中后行高手柄收起（只在选中表格时出现）',
      document.querySelectorAll('[data-row-handle="1"]').length === 0,
      `手柄数=${document.querySelectorAll('[data-row-handle="1"]').length}`,
    );
  }

  /* B9 组件箱缩略图（**默认关**，2026-09-23 用户要求）+ 「首选项」集中管理编辑器设置 */
  {
    S().setMode('document');
    S().clearAll();
    S().setCompPreview(false);
    await wait(360);
    const toggle = document.querySelector('[data-comp-preview-toggle="1"]') as HTMLElement | null;
    const gridCols = (): string | null => document.querySelector('[data-comp-grid]')?.getAttribute('data-comp-grid-cols') ?? null;
    add(
      'B9 默认**不渲染缩略图**（组件箱是紧凑两列，缩略图 0 张）',
      toggle?.getAttribute('data-comp-preview-state') === '0' &&
        document.querySelectorAll('[data-comp-thumb]').length === 0 &&
        gridCols() === '2',
      `开关=${toggle?.getAttribute('data-comp-preview-state')}；缩略图=${document.querySelectorAll('[data-comp-thumb]').length} 张；网格列=${gridCols()}`,
    );

    /* 首选项：编辑器设置集中在这里（含"显示组件缩略图"） */
    S().toggleUI('prefsOpen');
    await wait(320);
    const prefKeys = [...document.querySelectorAll('[data-pref]')].map((el) => el.getAttribute('data-pref'));
    const wantPrefs = ['compPreview', 'showTree', 'reloadLive', 'showGrid', 'showRuler', 'showGuides', 'snap', 'preview', 'autoNumber', 'autoBridge', 'theme', 'panelWidths'];
    const missingPrefs = wantPrefs.filter((k) => !prefKeys.includes(k));
    add(
      '首选项（视图 → 首选项…）：编辑器各项设置集中在一个弹窗里（组件箱/画布/文档/外观/面板）',
      missingPrefs.length === 0 &&
        !!document.querySelector('[data-pref="compPreview"] [data-switch]') &&
        !!document.querySelector('[data-pref-select="theme"]') &&
        !!document.querySelector('[data-pref-restore="1"]'),
      `共 ${prefKeys.length} 项：${prefKeys.join('、')}${missingPrefs.length ? `；缺 ${missingPrefs.join('、')}` : ''}`,
    );
    add(
      '首选项 → 组件箱：有「重载外部组件」入口，且组件箱底部不再有那个重载按钮',
      !!document.querySelector('[data-pref="reloadLive"] [data-reload-live="1"]') &&
        !!document.querySelector('[data-comp-live-count]') &&
        !document.querySelector('[data-comp-live-count]')?.parentElement?.querySelector('button'),
      `首选项里有重载按钮=${!!document.querySelector('[data-reload-live="1"]')}；组件箱底部按钮数=${
        document.querySelector('[data-comp-live-count]')?.parentElement?.querySelectorAll('button').length ?? '?'
      }`,
    );
    add(
      '首选项 → MCP 桥接：有「启动时自动连接」开关 + 只读状态行（不重复放第二个连接按钮）',
      !!document.querySelector('[data-pref="autoBridge"] [data-switch]') &&
        !!document.querySelector('[data-pref="bridgeStatus"] [data-bridge-summary]'),
      `开关=${!!document.querySelector('[data-pref="autoBridge"] [data-switch]')}；状态行=「${(
        document.querySelector('[data-bridge-summary]')?.textContent ?? ''
      )
        .trim()
        .slice(0, 40)}」`,
    );

    // 用首选项里的开关打开缩略图（这是它的正式入口；组件箱头部的眼睛图标是快捷方式）
    const prefSwitch = document.querySelector('[data-pref="compPreview"] [data-switch]') as HTMLElement | null;
    prefSwitch?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(300);
    S().toggleUI('prefsOpen'); // 关掉弹窗再验缩略图（弹窗是 fixed 遮罩，会影响命中测试）
    await wait(400);
    // ★只算**真组件**：`__probe_*` 是自检自己注册的探针（render 返回字符串、不是元素），
    //   它在 ?check=1 时确实会出现在面板里，不该拿"有没有真元素"去要求它（示例页也按 `__` 前缀排除）。
    const isProbe = (el: Element | null): boolean =>
      String(el?.getAttribute('data-comp-thumb') ?? '').startsWith('__');
    const thumbs = ([...document.querySelectorAll('[data-comp-thumb]')] as HTMLElement[]).filter((t) => !isProbe(t));
    const cards = ([...document.querySelectorAll('[data-comp-item]')] as HTMLElement[]).filter(
      (c) => !isProbe(c.querySelector('[data-comp-thumb]')),
    );
    // 每张缩略图里都该有**真渲染出来的元素**（boundary 里不是空的），
    // 「标题」这一张还能具体验到：真的是个 <h2>（而不是图标/占位）
    const rendered = thumbs.filter((t) => !!t.firstElementChild?.firstElementChild).length;
    const headingReal = !!document.querySelector('[data-comp-thumb="heading"] h2');
    add(
      'B9 在首选项里打开「显示组件缩略图」→ 每张卡片真渲染一份（张数 = 卡片数，每张都有真元素）',
      S().ui.compPreview === true &&
        thumbs.length > 0 &&
        thumbs.length === cards.length &&
        rendered === thumbs.length &&
        headingReal &&
        gridCols() === '1',
      `缩略图 ${thumbs.length} 张 / 卡片 ${cards.length} 张；有真内容的 ${rendered} 张${
        rendered === thumbs.length
          ? ''
          : `（空的：${thumbs
              .filter((t) => !t.firstElementChild?.firstElementChild)
              .map((t) => t.getAttribute('data-comp-thumb') ?? '?')
              .join('、')}）`
      }；「标题」缩略图内含 <h2>=${headingReal}；网格列=${gridCols()}`,
    );

    const t0 = thumbs.find((t) => t.getBoundingClientRect().height > 0);
    const tr = t0?.getBoundingClientRect();
    const hit = tr ? document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2) : null;
    const pe = t0 ? getComputedStyle(t0).pointerEvents : '';
    const ariaHidden = t0?.getAttribute('aria-hidden');
    const inCard = !!hit?.closest('[data-comp-item]');
    add(
      'B9 缩略图不参与交互（pointer-events:none + aria-hidden，命中测试落到卡片按钮上）',
      !!tr && pe === 'none' && ariaHidden === 'true' && inCard,
      `pointer-events=${pe || '—'}、aria-hidden=${ariaHidden ?? '—'}、命中元素=${hit?.tagName ?? '—'}${inCard ? '（在卡片按钮内）' : '（不在卡片内）'}`,
    );

    // 首选项里再关掉 → 回到紧凑两列（再关掉弹窗）
    S().toggleUI('prefsOpen');
    await wait(320);
    const prefSwitch2 = document.querySelector('[data-pref="compPreview"] [data-switch]') as HTMLElement | null;
    prefSwitch2?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(300);
    S().toggleUI('prefsOpen');
    await wait(360);
    add(
      'B9 在首选项里关掉 → 缩略图消失、回到紧凑两列（状态写进 ui.compPreview，随 ui 持久化）',
      S().ui.compPreview === false &&
        document.querySelectorAll('[data-comp-thumb]').length === 0 &&
        gridCols() === '2',
      `缩略图=${document.querySelectorAll('[data-comp-thumb]').length}、网格列=${gridCols()}、ui.compPreview=${String(S().ui.compPreview)}`,
    );

    // 组件箱头部的眼睛图标是同一个开关的快捷入口（点一下开、再点一下关）
    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(360);
    const onByEye = document.querySelectorAll('[data-comp-thumb]').length > 0;
    document.querySelector('[data-comp-preview-toggle="1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(360);
    add(
      'B9 组件箱头部的眼睛图标是同一开关的快捷入口（开→关都能切）',
      onByEye && S().ui.compPreview === false && document.querySelectorAll('[data-comp-thumb]').length === 0,
      `眼睛图标打开后缩略图=${onByEye ? '有' : '无'}；再点一次后 ui.compPreview=${String(S().ui.compPreview)}、缩略图=${document.querySelectorAll('[data-comp-thumb]').length}`,
    );

    // 「恢复默认设置」：先把某个开关拧乱，再点恢复
    S().toggleUI('prefsOpen');
    await wait(300);
    const gridBefore = S().ui.showGrid;
    S().toggleUI('showGrid');
    S().setCompPreview(true);
    await wait(240);
    (document.querySelector('[data-pref-restore="1"]') as HTMLElement | null)?.click();
    await wait(340);
    add(
      '首选项「恢复默认设置」把各项设置还原（含缩略图默认关、网格默认不显示）',
      S().ui.showGrid === gridBefore && S().ui.compPreview === false && S().ui.autoNumber === false && S().ui.theme === 'light',
      `恢复后 showGrid=${String(S().ui.showGrid)}、compPreview=${String(S().ui.compPreview)}、autoNumber=${String(S().ui.autoNumber)}、theme=${S().ui.theme}`,
    );

    S().toggleUI('prefsOpen');
    await wait(240);
    add(
      '首选项弹窗可关闭（关掉后不留痕）',
      !document.querySelector('[data-pref-restore="1"]'),
      `弹窗还在=${!!document.querySelector('[data-pref-restore="1"]')}`,
    );
  }

  /* 菜单结构（2026-09-23 用户要求）：导出只留 .docx、HTML 载入入口、首选项入口 */
  {
    const openMenu = async (label: string): Promise<string[]> => {
      const btn = document.querySelector(`[data-menu="${label}"]`) as HTMLElement | null;
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(180);
      return [...document.querySelectorAll('[data-menu-item]')].map((el) => el.getAttribute('data-menu-item') ?? '');
    };
    /** 菜单项的**显示文字**（核对待清理的括号补充用） */
    const openMenuLabels = async (label: string): Promise<string[]> => {
      const btn = document.querySelector(`[data-menu="${label}"]`) as HTMLElement | null;
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(180);
      return [...document.querySelectorAll('[data-menu-item]')].map((el) => (el.textContent ?? '').trim());
    };
    const closeMenu = async (): Promise<void> => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await wait(140);
    };

    const fileItems = await openMenu('文件');
    await closeMenu();
    add(
      '菜单：文件 → 导出 Word **只保留 .docx**（.doc 已移除）',
      fileItems.includes('docx') && !fileItems.includes('word'),
      `文件菜单项：${fileItems.join(' / ')}`,
    );
    add(
      '菜单：文件 → 有 HTML 载入入口（打开 HTML / 从 URL 载入，就是 ?load= 的可视化入口）',
      fileItems.includes('open-html') && fileItems.includes('load-html-url'),
      `含 open-html=${fileItems.includes('open-html')}、load-html-url=${fileItems.includes('load-html-url')}`,
    );

    const viewItems = await openMenu('视图');
    await closeMenu();
    add(
      '菜单：视图 → 首选项…（编辑器设置入口）',
      viewItems[0] === 'prefs',
      `视图菜单项：${viewItems.join(' / ')}`,
    );
    add(
      '菜单：视图里不再重复放「深色模式」（用户 2026-09-24：主题只留在 首选项 → 外观）',
      !viewItems.includes('theme'),
      `视图菜单项：${viewItems.join(' / ')}`,
    );
    const helpItems = await openMenu('帮助');
    await closeMenu();
    add(
      '菜单：帮助里不再放「重载外部组件」（同上：收进 首选项 → 组件箱）',
      !helpItems.includes('reloadlive'),
      `帮助菜单项：${helpItems.join(' / ')}`,
    );

    /* MCP 桥接的状态文案（用户 2026-09-24：点开关弹窗说"已开启"，菜单里却还是「未开启」）
       —— 原来 `state === 'off'` 同时表示"没开启"和"开了但没连上"，且菜单没人订阅状态 → 说了假话 + 不刷新。 */
    const helpLabelsBefore = await openMenuLabels('帮助');
    await closeMenu();
    const bridgeBefore = bridgeSummary();
    setBridgeEnabled(true);
    await wait(500);
    const helpLabelsOn = await openMenuLabels('帮助');
    await closeMenu();
    const bridgeOn = bridgeSummary();
    setBridgeEnabled(false);
    await wait(400);
    const helpLabelsOff = await openMenuLabels('帮助');
    await closeMenu();
    const bridgeOff = bridgeSummary();
    const bridgeLine = (labels: string[]): string => labels.find((t) => t.includes('MCP 桥接')) ?? '(菜单里没有这一项)';
    add(
      'MCP 桥接状态文案：开启后菜单**不再写「未开启」**（"没开启"与"开了但没连上"分开），关掉后回到「未开启」',
      bridgeBefore.on === false &&
        bridgeLine(helpLabelsBefore).includes('未开启') &&
        bridgeOn.on === true &&
        !bridgeLine(helpLabelsOn).includes('未开启') &&
        bridgeOff.on === false &&
        bridgeLine(helpLabelsOff).includes('未开启'),
      `关：${bridgeLine(helpLabelsBefore)} → 开：${bridgeLine(helpLabelsOn)}（state=${bridgeOn.state}、detail=${bridgeOn.detail.slice(0, 30)}）→ 再关：${bridgeLine(helpLabelsOff)}`,
    );

    /* 首选项里的「启动时自动连接」开关（用户 2026-09-24 要求做成开关）：开着才自动连，默认关 */
    const uiSnapshot = useEditorStore.getState().ui;
    useEditorStore.setState({ ui: { ...uiSnapshot, autoBridge: true } });
    setBridgeEnabled(false);
    autoStartBridgeFromPrefs();
    const autoOn = bridgeSummary().on;
    setBridgeEnabled(false);
    useEditorStore.setState({ ui: { ...uiSnapshot, autoBridge: false } });
    autoStartBridgeFromPrefs();
    const autoOff = bridgeSummary().on;
    setBridgeEnabled(false);
    add(
      '首选项「启动时自动连接」开关生效：开着 → 启动逻辑自动连桥；关着 → 不连（**默认关**）',
      autoOn === true && autoOff === false,
      `开关开着时自动连=${autoOn}；关着时=${autoOff}`,
    );

    /* 文案收敛（用户 2026-09-24） */
    const viewLabels = await openMenuLabels('视图');
    await closeMenu();
    /** 勾选项的文字前面带 ✓ / ✔ 前缀，比对前去掉 */
    const bare = (t: string): string => t.replace(/^[✓✔√\s]+/, '').trim();
    const bareLabels = viewLabels.map(bare);
    add(
      '菜单文案：视图里的「显示辅助线」「Markdown 源码」不再带括号补充（页边距 / 只读）',
      bareLabels.includes('显示辅助线') &&
        bareLabels.includes('Markdown 源码') &&
        !viewLabels.some((t) => /（页边距）|（只读）/.test(t)),
      `视图菜单文字：${viewLabels.join(' / ')}`,
    );
    add(
      '菜单：**模式菜单已移除**（模式切换只在工具栏的分段控件里）',
      !document.querySelector('[data-menu="模式"]') &&
        [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '文档模式') &&
        [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Web 模式'),
      `还有"模式"菜单=${!!document.querySelector('[data-menu="模式"]')}；工具栏有文档/Web 模式按钮=${[...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '文档模式')}`,
    );
    add(
      '状态栏不再有"布局参照 Qt Designer"这类版式说明（右下角只留真实信息）',
      !(document.querySelector('[data-status-bar]')?.textContent ?? '').includes('Qt Designer'),
      `状态栏文字：${(document.querySelector('[data-status-bar]')?.textContent ?? '').trim().slice(0, 60)}`,
    );

    // 新建对话框不再有"（和 PS 的新建一样）"
    S().setNewDocOpen(true);
    await wait(340);
    const newDocText = document.body.textContent ?? '';
    add(
      '新建对话框不再写"（和 PS 的新建一样）"',
      !newDocText.includes('和 PS 的新建一样') && newDocText.includes('先选模式，下一步再填参数'),
      `含 PS 字样=${newDocText.includes('和 PS 的新建一样')}`,
    );
    S().setNewDocOpen(false);
    await wait(200);
  }

  /* 深色主题（Monokai）：新界面（首选项 / Markdown 视图）必须跟着适配
     背景与文字的对比度用 WCAG 公式算，避免"看着能看"，实际是浅底浅字。 */
  {
    const parseRGB = (s: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return [255, 255, 255, 1];
      const parts = m[1].split(',').map((x) => Number(x.trim()));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const lum = ([r, g, b]: [number, number, number, number]): number => {
      const f = (c: number): number => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (a: [number, number, number, number], b: [number, number, number, number]): number => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    /** 一路往上找到第一个"实际有底色"的祖先（中间的容器多是透明） */
    const effectiveBg = (el: HTMLElement): [number, number, number, number] => {
      let cur: HTMLElement | null = el;
      while (cur) {
        const [r, g, b, a] = parseRGB(getComputedStyle(cur).backgroundColor);
        if (a > 0.5) return [r, g, b, a];
        cur = cur.parentElement;
      }
      return [255, 255, 255, 1];
    };

    S().setTheme('monokai');
    await wait(320);
    S().toggleUI('prefsOpen');
    await wait(340);

    const rows = [...document.querySelectorAll('[data-pref]')] as HTMLElement[];
    const reports = rows.map((row) => {
      const label = row.firstElementChild as HTMLElement | null;
      const fg = parseRGB(getComputedStyle(label ?? row).color);
      const bg = effectiveBg(row);
      return { key: row.getAttribute('data-pref') ?? '', ratio: contrast(fg, bg), bgLum: lum(bg) };
    });
    const worst = [...reports].sort((a, b) => a.ratio - b.ratio)[0];
    add(
      '暗色主题：首选项每一项都是"深底浅字"（对比度 ≥ 3，没有残留浅色底板）',
      rows.length >= 8 && reports.every((r) => r.ratio >= 3 && r.bgLum < 0.4),
      `共 ${rows.length} 项；最低对比度 ${worst ? `${worst.ratio.toFixed(1)}（${worst.key}）` : '—'}；底板亮度范围 ${Math.min(...reports.map((r) => r.bgLum)).toFixed(2)}~${Math.max(...reports.map((r) => r.bgLum)).toFixed(2)}`,
    );

    const section = document.querySelector('[data-pref="compPreview"]')?.parentElement as HTMLElement | null;
    const sectionBg = section ? parseRGB(getComputedStyle(section).backgroundColor) : ([255, 255, 255, 1] as [number, number, number, number]);
    add(
      '暗色主题：首选项分组底板不再是浅灰（原来是 bg-gray-50/50 这类"带透明度"的类没被主题覆盖）',
      lum(sectionBg) < 0.4,
      `分组底板 rgba=${sectionBg.map((v) => Math.round(v * 100) / 100).join(',')}、亮度 ${lum(sectionBg).toFixed(2)}（<0.4 才算深色）`,
    );

    S().toggleUI('prefsOpen');
    await wait(220);

    // Markdown 视图同样验一遍（它的源码区原来也是 bg-gray-50/60）
    S().setMode('document');
    S().clearAll();
    const dm = S().addComponent('paragraph');
    if (dm) S().updateProps(dm, { text: '暗色下的 Markdown 视图' });
    await wait(320);
    S().toggleUI('showMarkdown');
    await wait(340);
    const src = document.querySelector('[data-md-source="1"]') as HTMLElement | null;
    const code = src?.querySelector('code') as HTMLElement | null;
    const mdRatio = src && code ? contrast(parseRGB(getComputedStyle(code).color), effectiveBg(src)) : 0;
    add(
      '暗色主题：Markdown 源码视图同样是深底浅字（对比度 ≥ 3）',
      !!src && mdRatio >= 3 && lum(effectiveBg(src)) < 0.4,
      `源码区对比度 ${mdRatio.toFixed(1)}、底板亮度 ${lum(effectiveBg(src!)).toFixed(2)}`,
    );
    S().toggleUI('showMarkdown');
    await wait(220);

    // 缩略图是"纸张预览"，暗色下仍应是白底（否则和纸张所见不一致）
    S().setCompPreview(true);
    await wait(360);
    const thumb = document.querySelector('[data-comp-thumb="heading"]') as HTMLElement | null;
    const tb = thumb ? parseRGB(getComputedStyle(thumb).backgroundColor) : ([0, 0, 0, 1] as [number, number, number, number]);
    add(
      '暗色主题：组件缩略图仍是**白底纸张预览**（不跟着变暗）',
      lum(tb) > 0.7,
      `缩略图底色亮度 ${lum(tb).toFixed(2)}（>0.7 才算白底）`,
    );
    S().setCompPreview(false);

    S().setTheme('light');
    await wait(320);
    add(
      '主题可切回浅色（设置随 ui 持久化，自检结束还原为浅色）',
      S().ui.theme === 'light' && document.documentElement.dataset.theme === 'light',
      `ui.theme=${S().ui.theme}、html[data-theme]=${document.documentElement.dataset.theme}`,
    );
  }

  /* B10 Markdown 源码视图（文档 → Markdown，只读 + 一键复制） */
  {
    S().setMode('document');
    S().clearAll();
    const mh = S().addComponent('heading');
    if (mh) S().updateProps(mh, { level: 2, text: '自检标题' });
    const mp = S().addComponent('paragraph');
    if (mp) S().updateProps(mp, { text: '正文一句话' });
    const mb = S().addComponent('bullets');
    if (mb) S().updateProps(mb, { items: '第一条\n  子要点\n第二条' });
    const mt = S().addComponent('table');
    if (mt) S().updateProps(mt, { data: 'A | B\nC | D', caption: '' });
    await wait(460);

    const md = buildDocMarkdown(S().doc);
    add(
      'B10 文档 → Markdown：抬头 + 标题层级 + 段落 + 项目符号（含缩进）+ 表格管道表',
      md.startsWith('# ') &&
        md.includes('## 自检标题') &&
        md.includes('正文一句话') &&
        md.includes('- 第一条') &&
        md.includes('  - 子要点') &&
        md.includes('| A | B |') &&
        md.includes('| --- | --- |') &&
        md.includes('| C | D |'),
      md
        .split('\n')
        .filter(Boolean)
        .slice(0, 10)
        .join(' ⏎ '),
    );

    S().toggleUI('showMarkdown');
    await wait(320);
    const src = document.querySelector('[data-md-source="1"]') as HTMLElement | null;
    const stats = document.querySelector('[data-md-stats="1"]')?.textContent ?? '';
    add(
      'B10 视图 → Markdown 源码：弹窗出现、内容与文档一致，带行数/字符统计与复制、下载按钮',
      !!src &&
        (src.textContent ?? '').includes('自检标题') &&
        stats.includes('行') &&
        stats.includes('字符') &&
        !!document.querySelector('[data-md-copy="1"]') &&
        !!document.querySelector('[data-md-download="1"]'),
      `弹窗=${!!src}；统计=「${stats.trim()}」`,
    );

    S().toggleUI('showMarkdown');
    await wait(280);
    add(
      'B10 关闭后弹窗移除（只读视图不改文档）',
      !document.querySelector('[data-md-source="1"]') &&
        String(findNode(getForest(S().doc), mh ?? '')?.props.text ?? '') === '自检标题',
      `弹窗还在=${!!document.querySelector('[data-md-source="1"]')}；标题文字=「${String(findNode(getForest(S().doc), mh ?? '')?.props.text ?? '')}」`,
    );
  }

  /* B11 图表按章编号（图 X-Y / 表 X-Y，按 heading(level=1) 计章） */
  {
    S().setMode('document');
    S().clearAll();
    const h1 = S().addComponent('heading');
    if (h1) S().updateProps(h1, { level: 1, text: '第一章 概述' });
    const i1 = S().addComponent('image');
    if (i1) S().updateProps(i1, { src: '', caption: '流水线示意' });
    const t1 = S().addComponent('table');
    if (t1) S().updateProps(t1, { data: 'A | B\nC | D', caption: '参数表' });
    const h2 = S().addComponent('heading');
    if (h2) S().updateProps(h2, { level: 1, text: '第二章 数据' });
    const ch1 = S().addComponent('chartBar');
    if (ch1) S().updateProps(ch1, { items: '一月|120\n二月|180', caption: '月度产量' });
    const t2 = S().addComponent('table');
    if (t2) S().updateProps(t2, { data: 'X | Y\n1 | 2', caption: '明细表' });
    await wait(520);

    // ★量到的题注/编号只数**纸张里的**：离屏测量容器（`[data-measure="1"]`）也会渲染一遍组件，
    //   组件箱缩略图里也可能有同名的题注属性 —— 不限定范围就会数成两倍/拿错节点。
    const labelList = (): string[] =>
      [...document.querySelectorAll('[data-paper] [data-auto-label]')].map((el) => el.getAttribute('data-auto-label') ?? '');
    const figText = document.querySelector('[data-paper] [data-figure-caption="1"]')?.textContent?.trim() ?? '';
    add(
      'B11 默认不开自动编号：图题/表题只显示用户填的文字',
      labelList().length === 0 && figText === '流水线示意',
      `带编号的题注 ${labelList().length} 个；第一个图题=「${figText}」`,
    );

    S().toggleUI('autoNumber');
    await wait(460);
    const labelsOn = labelList();
    const capTexts = [...document.querySelectorAll('[data-paper] [data-auto-label]')].map((el) => el.textContent?.trim() ?? '');
    add(
      'B11 打开自动编号：按章给出「图 X-Y / 表 X-Y」（章内图、表各自计数）',
      labelsOn.join(' / ') === '图 1-1 / 表 1-1 / 图 2-1 / 表 2-1' && capTexts[0].includes('流水线示意'),
      `编号=${labelsOn.join(' / ')}；第一个题注文字=「${capTexts[0] ?? ''}」`,
    );

    // 把"第一章"降级成 level=2 → 它不再计章，于是第二章变成第 1 章，而它之前的图/表落到"无章"连续编号
    if (h1) S().updateProps(h1, { level: 2 });
    await wait(460);
    const labelsAfter = labelList();
    add(
      'B11 章号随标题层级重排（把 level=1 降级后，编号自动重算；"章前"的图/表用连续编号）',
      labelsAfter.join(' / ') === '图 1 / 表 1 / 图 1-1 / 表 1-1',
      `重排后=${labelsAfter.join(' / ')}`,
    );

    S().toggleUI('autoNumber');
    await wait(380);
    add(
      'B11 关掉自动编号：编号消失，用户自己填的图题/表题原样保留',
      labelList().length === 0 &&
        (document.querySelector('[data-paper] [data-figure-caption="1"]')?.textContent?.trim() ?? '') === '流水线示意' &&
        (document.querySelector('[data-paper] [data-table-caption="1"]')?.textContent?.trim() ?? '') === '参数表',
      `带编号题注 ${labelList().length} 个；图题=「${document.querySelector('[data-paper] [data-figure-caption="1"]')?.textContent?.trim() ?? ''}」；表题=「${document.querySelector('[data-paper] [data-table-caption="1"]')?.textContent?.trim() ?? ''}」`,
    );
  }

  /* B12 表格排序（按列升/降；渲染期排序不动数据）+ 冻结首行（Web 模式 sticky） */
  {
    S().setMode('document');
    S().clearAll();
    const s12 = S().addComponent('table');
    const raw12 = '名称 | 值\nb | 2\na | 10\nc | 1';
    if (s12) S().updateProps(s12, { data: raw12, headerRow: true, cellStyles: { B3: { background: '#ffd7d7' } } });
    await wait(480);
    S().selectComponent(s12 ? [s12] : []);
    await wait(260);

    // 渲染出来的**正文行首列**（thead 不算）
    const colVals = (col: number): string[] =>
      [...document.querySelectorAll(`[data-paper] [data-node-id="${s12}"] tbody tr`)].map(
        (tr) => (tr.children[col] as HTMLElement | undefined)?.textContent?.trim() ?? '',
      );
    const before = colVals(0);
    if (s12) S().updateProps(s12, { sortBy: 1 });
    await wait(400);
    const numAsc = colVals(0);
    if (s12) S().updateProps(s12, { sortDir: 'desc' });
    await wait(400);
    const numDesc = colVals(0);
    add(
      'B12 按列排序：数值列升序 / 降序（"10" 不会再排到 "2" 前面）',
      before.join(',') === 'b,a,c' && numAsc.join(',') === 'c,b,a' && numDesc.join(',') === 'a,b,c',
      `原始=${before.join(',')}；数值升序=${numAsc.join(',')}（期望 c,b,a）；降序=${numDesc.join(',')}（期望 a,b,c）`,
    );

    if (s12) S().updateProps(s12, { sortBy: 0, sortDir: 'asc' });
    await wait(400);
    const textAsc = colVals(0);
    const stillRaw = String(findNode(getForest(S().doc), s12 ?? '')?.props.data ?? '');
    const headStillFirst = [...document.querySelectorAll(`[data-paper] [data-node-id="${s12}"] thead th`)].length === 2;
    add(
      'B12 排序是**渲染期**行为：按文字列排也能排，表头仍在第一行、`props.data` 原始行序不变',
      textAsc.join(',') === 'a,b,c' && stillRaw === raw12 && headStillFirst,
      `文字升序=${textAsc.join(',')}（期望 a,b,c）；表头仍是第一行=${headStillFirst}；data 未变=${stillRaw === raw12}`,
    );

    // 单元格格式（A1 键）跟着行一起走：原 B3 是 a|10，排完在数值升序里落到最后一行
    if (s12) S().updateProps(s12, { sortBy: 1, sortDir: 'asc' });
    await wait(420);
    const styledNow = [...document.querySelectorAll(`[data-paper] [data-node-id="${s12}"] tbody tr`)].findIndex(
      (tr) => (tr.children[0] as HTMLElement | undefined)?.textContent?.trim() === 'a',
    );
    const styledCell = document.querySelector(`[data-paper] [data-node-id="${s12}"] [data-cell="${styledNow + 1},1"]`) as HTMLElement | null;
    const bgOk = (styledCell?.getAttribute('style') ?? '').includes('255, 215, 215');
    add(
      'B12 单元格格式跟着行走（A1 键按行置换搬移，颜色不会留在原来的行号上）',
      styledNow >= 0 && bgOk,
      `带格式的原始行「a|10」排完后在第 ${styledNow + 1} 行；该格 style=${styledCell?.getAttribute('style') ?? '—'}`,
    );

    // 冻结首行：只在 Web 模式生效
    S().setMode('web');
    await wait(420);
    add(
      'B12 文档模式（纸张要打印）不生成冻结外壳',
      !document.querySelector('[data-sticky-wrap="1"]'),
      `冻结外壳数=${document.querySelectorAll('[data-sticky-wrap="1"]').length}`,
    );
    const w12 = S().addComponent('table');
    if (w12) S().updateProps(w12, { data: raw12, headerRow: true, stickyHeader: true, stickyHeight: 60 });
    await wait(480);
    const wrap = document.querySelector('[data-sticky-wrap="1"]') as HTMLElement | null;
    const th = wrap?.querySelector('thead th') as HTMLElement | null;
    add(
      'B12 冻结首行（Web 模式）：表格套一层可滚动外壳，表头 sticky 钉在顶部',
      !!wrap &&
        !!th &&
        getComputedStyle(th).position === 'sticky' &&
        wrap.scrollHeight > wrap.clientHeight &&
        String(findNode(getForest(S().doc), w12 ?? '')?.props.stickyHeader) === 'true',
      `外壳=${!!wrap}；表头 position=${th ? getComputedStyle(th).position : '—'}；外壳高 ${wrap?.clientHeight ?? 0} / 内容高 ${wrap?.scrollHeight ?? 0}`,
    );
  }

  /* B13 HTML → 文档（`?load=`）：本工程导出的 HTML 能读回；常见结构 HTML 也能导入 */
  {
    S().setMode('document');
    S().clearAll();
    const h13 = S().addComponent('heading');
    if (h13) S().updateProps(h13, { level: 1, text: '导入标题' });
    const p13 = S().addComponent('paragraph');
    if (p13) S().updateProps(p13, { text: '导入段落' });
    const b13 = S().addComponent('bullets');
    if (b13) S().updateProps(b13, { items: '甲\n乙' });
    const t13 = S().addComponent('table');
    if (t13) S().updateProps(t13, { data: 'A | B\nC | D', headerRow: true });
    await wait(460);

    const html13 = S().exportHTML();
    add(
      'B13 导出的 HTML 自带 data-node-type（结构自描述，可被读回）',
      html13.includes('data-node-type="heading"') && html13.includes('data-node-type="table"') && html13.includes('data-node-type="bullets"'),
      `含 heading/table/bullets 标记=${html13.includes('data-node-type="heading"')}/${html13.includes('data-node-type="table"')}/${html13.includes('data-node-type="bullets"')}`,
    );

    const back = importHtmlToDocument(html13);
    const typesBack = back.doc.document.components.map((n) => n.type).join(',');
    const tableBack = back.doc.document.components.find((n) => n.type === 'table');
    const headBack = back.doc.document.components.find((n) => n.type === 'heading');
    const bulletsBack = back.doc.document.components.find((n) => n.type === 'bullets');
    add(
      'B13 本工程导出的 HTML **能读回编辑器**（组件类型、标题层级、列表条目、表格数据都对得上）',
      typesBack === 'heading,paragraph,bullets,table' &&
        Number(headBack?.props.level) === 1 &&
        String(headBack?.props.text ?? '') === '导入标题' &&
        String(bulletsBack?.props.items ?? '').replace(/\s+/g, '') === '甲乙' &&
        String(tableBack?.props.data ?? '').replace(/\s+/g, '') === 'A|BC|D' &&
        back.result.stats.typed >= 4,
      `类型序列=${typesBack}；标题=「${String(headBack?.props.text ?? '')}」(level ${String(headBack?.props.level ?? '')})；列表=「${String(bulletsBack?.props.items ?? '').replace(/\n/g, '/')}」；表数据=「${String(tableBack?.props.data ?? '').replace(/\n/g, ' ⏎ ')}」；精确识别 ${back.result.stats.typed} 个`,
    );

    const raw = importHtml(
      '<html><head><title>外站页</title></head><body><h2>外站小节</h2><p>一段话</p>' +
        '<ul><li>一</li><li>二</li></ul>' +
        '<table><tr><th>X</th><th>Y</th></tr><tr><td>1</td><td>2</td></tr></table>' +
        '<figure><img src="a.png" alt="示例图"><figcaption>图注</figcaption></figure>' +
        '<script>bad()</script></body></html>',
    );
    const rawTypes = raw.components.map((n) => n.type).join(',');
    const rawImg = raw.components.find((n) => n.type === 'image');
    add(
      'B13 常见结构 HTML 也能导入（h2/p/ul/table/figure+img；<script> 被跳过且计入 skipped）',
      rawTypes === 'heading,paragraph,bullets,table,image' &&
        Number(raw.components[0]?.props.level) === 2 &&
        String(raw.components[2]?.props.items ?? '').replace(/\s+/g, '') === '一二' &&
        String(rawImg?.props.src ?? '') === 'a.png' &&
        String(rawImg?.props.caption ?? '') === '图注' &&
        raw.stats.skipped >= 1 &&
        raw.title === '外站页',
      `类型序列=${rawTypes}；h2 层级=${String(raw.components[0]?.props.level ?? '')}；图片 src=${String(rawImg?.props.src ?? '')}、图注=「${String(rawImg?.props.caption ?? '')}」；跳过 ${raw.stats.skipped} 个；标题=「${raw.title}」`,
    );
  }

  /* B14 组件包导入 / 导出（导出全部外部组件源码 → JSON；导入写回组件目录） */
  {
    const live = getLiveTypes();
    const { pkg, errors } = await buildPluginPackage();
    const hasRegister = pkg.plugins.every((p) => p.code.includes('EditorKit') || p.code.includes('register'));
    add(
      'B14 导出组件包：把 public/组件/*.js 的源码全部收进一个 JSON 包',
      pkg.format === PACKAGE_FORMAT &&
        pkg.plugins.length === live.length &&
        pkg.plugins.every((p) => p.name.endsWith('.js') && p.code.length > 50) &&
        hasRegister &&
        errors.length === 0,
      `${pkg.plugins.length} 个（当前外部组件 ${live.length} 个）：${pkg.plugins.map((p) => `${p.name}/${p.code.length}字符`).join('、') || '（无）'}；读取失败 ${errors.length} 个`,
    );

    const round = validatePluginPackage(JSON.parse(JSON.stringify(pkg)) as unknown);
    add(
      'B14 组件包能自我校验（导出 → 反序列化 → 校验通过）',
      round.ok && round.plugins.length === pkg.plugins.length && round.errors.length === 0,
      `校验=${round.ok}、组件 ${round.plugins.length} 个、问题 ${round.errors.length} 条`,
    );

    const bad = [
      { label: '路径穿越 ../evil.js', value: { format: PACKAGE_FORMAT, version: 1, plugins: [{ name: '../evil.js', code: 'x' }] } },
      { label: '内部文件 _manifest.json', value: { format: PACKAGE_FORMAT, version: 1, plugins: [{ name: '_manifest.json', code: 'x' }] } },
      { label: '非 .js 文件名', value: { format: PACKAGE_FORMAT, version: 1, plugins: [{ name: 'evil.html', code: 'x' }] } },
      { label: 'code 为空', value: { format: PACKAGE_FORMAT, version: 1, plugins: [{ name: 'ok.js', code: '   ' }] } },
      { label: 'format 不对', value: { format: 'something-else', version: 1, plugins: [{ name: 'ok.js', code: 'x' }] } },
      { label: 'plugins 为空', value: { format: PACKAGE_FORMAT, version: 1, plugins: [] } },
    ].map((c) => ({ label: c.label, rejected: !validatePluginPackage(c.value).ok }));
    add(
      'B14 组件包校验**整包拒收**不合法输入（路径穿越 / 内部文件 / 非 .js / 空源码 / format 不对 / 空包）',
      bad.every((b) => b.rejected),
      bad.map((b) => `${b.label}=${b.rejected ? '拒收' : '**放行**'}`).join('；'),
    );

    add(
      'B14 导出文件名带时间戳（组件包-YYYYMMDD-HHmm.json）',
      /^组件包-\d{8}-\d{4}\.json$/.test(packageFileName(new Date(2026, 8, 23, 9, 5))),
      packageFileName(new Date(2026, 8, 23, 9, 5)),
    );
  }

  /* B15 真 .docx（OOXML：ZIP + word/document.xml，自带最小 ZIP writer） */
  {
    S().setMode('document');
    S().clearAll();
    const dh = S().addComponent('heading');
    if (dh) S().updateProps(dh, { level: 1, text: '第一章 docx 验证' });
    const dp = S().addComponent('paragraph');
    if (dp) S().updateProps(dp, { html: '这是一段<strong>加粗</strong>的正文。' });
    const db = S().addComponent('bullets');
    if (db) S().updateProps(db, { items: '第一条\n第二条' });
    const dt = S().addComponent('table');
    if (dt) S().updateProps(dt, { data: '列一 | 列二\n甲 | 1\n乙 | 2', headerRow: true, caption: '验证表' });
    await wait(460);

    const docx = buildDocx(S().doc, getForest(S().doc));
    const parts = docxParts(docx.bytes);
    const asText = new TextDecoder('utf-8').decode(docx.bytes);
    add(
      'B15 导出真 .docx：ZIP 头（PK）+ OOXML 部件齐全（Content_Types / document / styles / numbering / rels / docProps）',
      isZip(docx.bytes) &&
        docx.bytes.length > 2000 &&
        parts.includes('[Content_Types].xml') &&
        parts.includes('word/document.xml') &&
        parts.includes('word/styles.xml') &&
        parts.includes('word/numbering.xml') &&
        parts.includes('_rels/.rels') &&
        parts.includes('word/_rels/document.xml.rels') &&
        parts.includes('docProps/core.xml'),
      `${docx.bytes.length} 字节；部件：${[...new Set(parts)].join('、')}`,
    );

    add(
      'B15 .docx 内容正确：纸张/页边距（sectPr）+ 标题样式 + 加粗片段 + 表格 + 列表编号引用',
      asText.includes('<w:pgSz') &&
        asText.includes('<w:pgMar') &&
        asText.includes('Heading1') &&
        asText.includes('这是') &&
        asText.includes('<w:tbl>') &&
        asText.includes('w:numId w:val="1"') &&
        asText.includes('第一章 docx 验证'),
      `含 sectPr=${asText.includes('<w:pgSz')}、Heading1=${asText.includes('Heading1')}、表格=${asText.includes('<w:tbl>')}、列表编号=${asText.includes('w:numId w:val="1"')}、块数 ${docx.blocks}`,
    );

    // 把字节用 base64 存到运行目录 docs/ 下，便于用 python-docx 在**编辑器之外**再验一次
    const b64 = (() => {
      let s = '';
      for (let i = 0; i < docx.bytes.length; i += 1) s += String.fromCharCode(docx.bytes[i]);
      return btoa(s);
    })();
    const saved = await saveToRunDir('docs/自检-docx.docx.b64', b64);
    add(
      'B15 .docx 字节可落盘（base64 写到运行目录 docs/，供 python-docx 外部复验）',
      !!saved?.ok && (saved?.bytes ?? 0) > 2000,
      saved?.ok ? `写入 ${saved.file}（${saved.bytes} 字节 base64）` : `落盘失败/无接口：${saved?.error ?? '（未托管）'}`,
    );

    /* ★导出也走本产品的 MCP 通道（用户 2026-09-24：本产品支持导出 html 与 docx，不该退回旧产线）
       —— 这里直接调**编辑器 Live 桥的同一条路由** `routeLive`，等于把 MCP 那条 `export.docx` / `export.html`
       真正跑一遍（浏览器内可测，不需要 MCP 进程或编辑器接入）。 */
    const liveDocx = (await routeLive('export.docx', {})) as {
      bytes?: number;
      base64?: string;
      blocks?: number;
      mime?: string;
      filename?: string;
    };
    const liveDocxBytes =
      typeof liveDocx.base64 === 'string'
        ? Uint8Array.from(atob(liveDocx.base64), (c) => c.charCodeAt(0))
        : new Uint8Array();
    add(
      'MCP 导出通道：`export.docx` 经 Live 桥返回 base64 字节（真 OOXML，本产品自带导出）',
      liveDocxBytes.length > 2000 &&
        isZip(liveDocxBytes) &&
        liveDocx.bytes === liveDocxBytes.length &&
        String(liveDocx.mime ?? '').includes('wordprocessingml') &&
        String(liveDocx.filename ?? '').endsWith('.docx') &&
        Number(liveDocx.blocks ?? 0) > 0,
      `${liveDocxBytes.length} 字节（声明 ${String(liveDocx.bytes)}）· ${Number(liveDocx.blocks)} 块 · ${String(
        liveDocx.filename,
      )}`,
    );
    const liveHtml = (await routeLive('export.html', {})) as { bytes?: number; html?: string };
    const liveHtmlText = String(liveHtml.html ?? '');
    add(
      'MCP 导出通道：`export.html` 经 Live 桥返回可独立打开的 HTML（带 @page 与 data-node-type）',
      liveHtmlText.length > 500 &&
        liveHtmlText.includes('data-node-type') &&
        liveHtmlText.includes('@page') &&
        Number(liveHtml.bytes) === liveHtmlText.length,
      `${liveHtmlText.length} 字节；含 data-node-type=${liveHtmlText.includes('data-node-type')}、@page=${liveHtmlText.includes('@page')}`,
    );
  }

  /* B16 表格填充柄（拖选区右下角按规则续内容；筛选经确认**不做**） */
  {
    // ① 纯函数：序列规则
    const cases: { label: string; got: string; want: string }[] = [
      { label: '单格数字 → +1 递增', got: continueSeries(['1'], 3).join(','), want: '2,3,4' },
      { label: '单格小数 → 保持小数位', got: continueSeries(['1.50'], 2).join(','), want: '2.50,3.50' },
      { label: '恒定差分 → 继续等差', got: continueSeries(['1', '3', '5'], 2).join(','), want: '7,9' },
      { label: '差分不恒定 → 按源循环', got: continueSeries(['1', '2', '9'], 4).join(','), want: '1,2,9,1' },
      { label: '单格日期 → +1 天', got: continueSeries(['2026-09-23'], 2).join(','), want: '2026-09-24,2026-09-25' },
      { label: '文字 → 原样重复', got: continueSeries(['甲'], 2).join(','), want: '甲,甲' },
      { label: '向右填充按行推', got: JSON.stringify(fillSeries([['1', '2']], 2, 'right')), want: JSON.stringify([['3', '4']]) },
      { label: '向下填充按列推（2 维源）', got: JSON.stringify(fillSeries([['1', '甲'], ['2', '乙']], 2, 'down')), want: JSON.stringify([['3', '甲'], ['4', '乙']]) },
    ];
    const wrong = cases.filter((c) => c.got !== c.want);
    add(
      'B16 填充序列规则（数字递增 / 等差继续 / 循环 / 日期 +1 天 / 按行按列推）',
      wrong.length === 0,
      wrong.length === 0
        ? `8 条规则全部符合：${cases.map((c) => c.label).join('、')}`
        : wrong.map((c) => `${c.label}：得到 ${c.got}，期望 ${c.want}`).join('；'),
    );

    // ② 画布上的填充柄：位置 + 拖动 + 只写一次
    S().setMode('document');
    S().clearAll();
    const t16 = S().addComponent('table');
    if (t16) S().updateProps(t16, { data: '值\n1', headerRow: true, cellStyles: {} });
    await wait(460);
    S().selectComponent(t16 ? [t16] : []);
    S().selectTableCells(t16!, ['1,0']);
    await wait(320);

    const zoom16 = S().zoom || 1;
    const handle16 = document.querySelector('[data-fill-handle="1"]') as HTMLElement | null;
    const cell16 = document.querySelector(`[data-paper] [data-node-id="${t16}"] [data-cell="1,0"]`) as HTMLElement | null;
    const hr16 = handle16?.getBoundingClientRect();
    const cr16 = cell16?.getBoundingClientRect();
    const atCorner =
      !!hr16 && !!cr16 && Math.abs(hr16.left + hr16.width / 2 - cr16.right) <= 3 * zoom16 + 2;
    add(
      'B16 选中单元格后出现填充柄（贴着选区右下角）',
      !!handle16 && atCorner,
      `手柄=${!!handle16}；手柄中线与格子右边缘差 ${hr16 && cr16 ? Math.round(hr16.left + hr16.width / 2 - cr16.right) : '—'}px`,
    );

    const rowH16 = (cr16?.height ?? 24) * zoom16;
    const hx = hr16 ? hr16.left + hr16.width / 2 : 0;
    const hy = hr16 ? hr16.top + hr16.height / 2 : 0;
    handle16?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: hx, clientY: hy, button: 0, pointerId: 11 }),
    );
    await wait(90);
    window.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: hx, clientY: hy + rowH16 * 2 + 2, button: 0, pointerId: 11 }),
    );
    await wait(180);
    const preview = document.querySelector('[data-fill-preview="1"]');
    window.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: hx, clientY: hy + rowH16 * 2 + 2, button: 0, pointerId: 11 }),
    );
    await wait(340);
    const filled = String(findNode(getForest(S().doc), t16 ?? '')?.props.data ?? '');
    const lines16 = filled.split('\n').map((l) => l.trim());
    const previewGone = !document.querySelector('[data-fill-preview="1"]');
    add(
      'B16 拖动填充柄往下 2 行：出现虚线预览框，松手后一次写回 props.data（1 → 2、3）',
      !!preview && lines16.join('|') === '值|1|2|3' && previewGone,
      `拖动中预览框=${!!preview}；data=「${lines16.join(' / ')}」（期望 值 / 1 / 2 / 3）；松手后预览已收=${previewGone}`,
    );

    // ③ 历史只有一条（撤销一次就回到填充前）
    const undone = S().undo();
    void undone;
    await wait(220);
    const afterUndo = String(findNode(getForest(S().doc), t16 ?? '')?.props.data ?? '')
      .split('\n')
      .map((l) => l.trim())
      .join('|');
    add(
      'B16 填充只记一条历史（Ctrl+Z 一次回到填充前）',
      afterUndo === '值|1',
      `撤销后 data=「${afterUndo}」（期望 值|1）`,
    );
  }

  /* 2026-09-23 追加：四边距 / 图片多图化 / HTML 导入的目录与图片 */
  {
    // ① 通用属性：上下左右四个边距（注册表统一补，所有组件都有）
    const all = getAllComponents();
    const missing = all.filter((d) => !['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].every((k) => d.propSchema.some((i) => i.key === k)));
    add(
      '通用属性：所有组件都有**上下左右四个边距**（mm，注册表统一补齐）',
      all.length > 20 && missing.length === 0,
      `组件 ${all.length} 个，缺边距的 ${missing.length} 个${missing.length ? `：${missing.slice(0, 5).map((d) => d.type).join(',')}` : ''}`,
    );

    // 面板里能看到 4 项；画布上真的生效（左边距 10mm ≈ 37.8px）
    S().setMode('document');
    S().clearAll();
    const mNode = S().addComponent('paragraph');
    if (mNode) S().updateProps(mNode, { marginLeft: 10, marginRight: 5, text: '四边距' });
    await wait(460);
    const propKeys = [...document.querySelectorAll('[data-prop-key]')].map((el) => el.getAttribute('data-prop-key'));
    const el = document.querySelector(`[data-node-id="${mNode}"]`) as HTMLElement | null;
    const cs = el ? getComputedStyle(el) : null;
    add(
      '四边距在属性面板可见、并在画布上生效（左边距 10mm → 37.8px，右边距 5mm → 18.9px）',
      ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].every((k) => propKeys.includes(k)) &&
        !!cs &&
        Math.abs(Number.parseFloat(cs.marginLeft) - mmToPx(10)) < 2 &&
        Math.abs(Number.parseFloat(cs.marginRight) - mmToPx(5)) < 2,
      `面板有 4 项=${['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].every((k) => propKeys.includes(k))}；计算样式 margin-left=${cs?.marginLeft} margin-right=${cs?.marginRight}（期望 ${mmToPx(10).toFixed(1)} / ${mmToPx(5).toFixed(1)}px）`,
    );

    // ② 图片组件：多图（一个组件搞定 2/3/4 张并排）
    S().clearAll();
    const gal = S().addComponent('image');
    const pix = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    if (gal) S().updateProps(gal, { images: `${pix} | 图一\n${pix} | 图二\n${pix} | 图三`, columns: 3, gap: 12 });
    await wait(460);
    const gallery = document.querySelector(`[data-node-id="${gal}"] [data-image-gallery="1"]`) as HTMLElement | null;
    const imgs = gallery?.querySelectorAll('img').length ?? 0;
    const caps = gallery?.querySelectorAll('[data-gallery-caption]').length ?? 0;
    add(
      '图片组件支持**多张**（多行 + 「列数」即可 3 张并排，每张各带图题）',
      !!gallery &&
        gallery.getAttribute('data-gallery-columns') === '3' &&
        imgs === 3 &&
        caps === 3 &&
        (gallery.getAttribute('style') ?? '').includes('repeat(3'),
      `网格列数=${gallery?.getAttribute('data-gallery-columns')}；<img> ${imgs} 个；图题 ${caps} 条`,
    );

    // 单图模式不受影响（老文档照旧）
    if (gal) S().updateProps(gal, { images: '', src: pix, caption: '单图' });
    await wait(400);
    const single = document.querySelector(`[data-node-id="${gal}"] img`);
    const stillGallery = document.querySelector(`[data-node-id="${gal}"] [data-image-gallery="1"]`);
    add(
      '图片组件清空图片行后回到单张兜底（老文档 src/caption 写法不受影响）',
      !!single && !stillGallery && !!document.querySelector(`[data-node-id="${gal}"] [data-figure-caption="1"]`),
      `单图 <img>=${!!single}、网格残留=${!!stillGallery}`,
    );

    // 并排双图：注册表里还在（老文档能开），但左侧面板不再出现
    const pairDef = getComponent('imagePair');
    const panelTypes = getCategoriesByMode('document').flatMap((c) => c.items.map((i) => i.type));
    add(
      '「并排双图」被「图片」的多张取代：仍注册（老文档照常渲染），但**左侧面板不再出现**',
      !!pairDef && pairDef.hidden === true && !panelTypes.includes('imagePair') && panelTypes.includes('image'),
      `imagePair 仍注册=${!!pairDef}、面板里有 imagePair=${panelTypes.includes('imagePair')}、面板里有 image=${panelTypes.includes('image')}`,
    );

    // ③ HTML 导入：目录 → toc 组件；内嵌 data: 图片真的带进来；相对路径按 baseUrl 解析
    const px = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const html = `<html><head><title>导入验证</title></head><body>
      <h1>第一章 概述</h1>
      <section><h3>目　录</h3><ol><li>AGV 系统概述 1</li><li>车型选型与参数 3</li><li>设备清单 9</li></ol></section>
      <figure><img src="${px}" alt="内嵌图"><figcaption>图 1-1 内嵌图</figcaption></figure>
      <p><img src="images/a.png" alt="相对路径图"></p>
    </body></html>`;
    const imp = importHtml(html, { baseUrl: 'http://example.com/doc/plan.html' });
    const types = imp.components.map((n) => n.type);
    const tocNode = imp.components.find((n) => n.type === 'toc');
    const absNode = imp.components.find((n) => String(n.props.src ?? '').includes('example.com'));
    add(
      'HTML 导入：`目录 + 有序列表` 识别成**目录组件**（不再是 Word 列表），条目按「标题|页码」写进 entries',
      types.includes('toc') &&
        !types.includes('list') &&
        imp.stats.tocFound === 1 &&
        String(tocNode?.props.entries ?? '').includes('AGV 系统概述|1'),
      `类型序列=${types.join(',')}；toc 条目=「${String(tocNode?.props.entries ?? '').replace(/\n/g, ' / ')}」`,
    );
    add(
      'HTML 导入：内嵌 `data:` 图片原样带进组件（不丢图），相对路径按 HTML 地址解析成绝对 URL',
      imp.stats.inlineAssets === 1 &&
        imp.stats.remoteAssets === 1 &&
        !!imp.components.find((n) => n.type === 'image' && String(n.props.src).startsWith('data:')) &&
        absNode?.props.src === 'http://example.com/doc/images/a.png',
      `内嵌资源 ${imp.stats.inlineAssets} 个、外链/相对 ${imp.stats.remoteAssets} 个；相对路径解析为 ${String(absNode?.props.src ?? '（没找到）')}`,
    );
  }

  /* 图片属性：**只有"一行一张图"一个入口**（默认 1 行 / ＋ 加行 / − 减行 / 最多 5 张） */
  {
    S().setMode('document');
    S().clearAll();
    const pix = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const rowsNode = S().addComponent('image');
    if (rowsNode) S().updateProps(rowsNode, { images: 'a.png | 图一', columns: 2 });
    await wait(440);
    S().selectComponent(rowsNode ? [rowsNode] : []);
    await wait(320);

    const rowsEl = document.querySelector('[data-image-rows="1"]') as HTMLElement | null;
    const count = (): number => Number(rowsEl?.getAttribute('data-image-rows-count') ?? '0');
    const srcInput = (i: number): HTMLInputElement | null =>
      document.querySelector(`[data-image-row-src="${i}"]`) as HTMLInputElement | null;
    const setInput = (el: HTMLInputElement | null, v: string): void => {
      if (!el) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const rowName = (i: number): string => String(document.querySelector(`[data-image-row-name="${i}"]`)?.textContent ?? '').trim();
    add(
      '图片属性只有"一行一张图"这一个入口：默认 1 行，行首写「图片1」，行尾 🖼（选本地文件）/ ＋ / −',
      !!rowsEl &&
        count() === 1 &&
        !!srcInput(1) &&
        !!document.querySelector('[data-image-row-caption="1"]') &&
        !!document.querySelector('[data-image-row-file="1"]') &&
        rowName(1) === '图片1',
      `行数=${count()}；行首=「${rowName(1)}」；地址框=${!!srcInput(1)}；图题框=${!!document.querySelector('[data-image-row-caption="1"]')}；选文件按钮=${!!document.querySelector('[data-image-row-file="1"]')}`,
    );
    add(
      '图片行编辑器不再显示底部说明文字（用户 2026-09-24：描述由属性名与悬停气泡承担）',
      !document.querySelector('[data-image-rows-hint]'),
      `说明行还在=${!!document.querySelector('[data-image-rows-hint]')}`,
    );
    add(
      '图片面板不再有单独的「图片（单图）」与「多图」两个字段（只剩这一个图片入口）',
      !document.querySelector('[data-prop-key="src"]') && !!document.querySelector('[data-prop-key="images"]'),
      `src 字段在面板里=${!!document.querySelector('[data-prop-key="src"]')}；images 字段在面板里=${!!document.querySelector('[data-prop-key="images"]')}`,
    );

    // ＋ 加行（点第 1 行的 +）
    (document.querySelector('[data-image-row-add="1"]') as HTMLElement | null)?.click();
    await wait(260);
    setInput(srcInput(2), 'b.png');
    setInput(document.querySelector('[data-image-row-caption="2"]') as HTMLInputElement | null, '图二');
    await wait(260);
    const afterAdd = String(findNode(getForest(S().doc), rowsNode ?? '')?.props.images ?? '');
    add(
      '点行尾 ＋ 加一行（新行行首「图片2」，地址与图题各填各的，写回 props.images）',
      count() === 2 && rowName(2) === '图片2' && afterAdd.split('\n').length === 2 && afterAdd.includes('b.png | 图二'),
      `行数=${count()}；第 2 行行首=「${rowName(2)}」；props.images=「${afterAdd.replace(/\n/g, ' / ')}」`,
    );

    // 加到 5 张后 ＋ 禁用；再点也不涨
    for (let i = 0; i < 5; i += 1) {
      const addBtn = document.querySelector(`[data-image-row-add="${count()}"]`) as HTMLButtonElement | null;
      addBtn?.click();
      await wait(160);
    }
    const capAdd = document.querySelector('[data-image-row-add="5"]') as HTMLButtonElement | null;
    add(
      '最多 5 张：加到 5 行后 ＋ 自动禁用（再点也不涨）',
      count() === 5 && capAdd?.disabled === true,
      `行数=${count()}；第 5 行 ＋ 的 disabled=${String(capAdd?.disabled)}`,
    );

    // − 减行；只剩 1 行时 − 禁用
    (document.querySelector('[data-image-row-remove="3"]') as HTMLElement | null)?.click();
    await wait(240);
    const afterRemove = count();
    for (let i = 0; i < 5; i += 1) {
      const rm = document.querySelector(`[data-image-row-remove="${afterRemove - i}"]`) as HTMLButtonElement | null;
      rm?.click();
      await wait(140);
    }
    const oneRemove = document.querySelector('[data-image-row-remove="1"]') as HTMLButtonElement | null;
    add(
      '点行尾 − 减一行；只剩 1 行时 − 禁用（不会删空）',
      afterRemove === 4 && count() === 1 && oneRemove?.disabled === true,
      `减一次后 ${afterRemove} 行 → 连减到 ${count()} 行；最后一行 − 的 disabled=${String(oneRemove?.disabled)}`,
    );

    // 老文档：只填了 `src`（老的单图写法）—— 面板照样当第 1 行显示，一编辑就迁移进 `images`
    S().clearAll();
    const oldNode = S().addComponent('image');
    if (oldNode) S().updateProps(oldNode, { images: '', src: pix, caption: '老图题' });
    await wait(440);
    S().selectComponent(oldNode ? [oldNode] : []);
    await wait(340);
    const legacySrcBox = document.querySelector('[data-image-row-src="1"]') as HTMLInputElement | null;
    const legacyCapBox = document.querySelector('[data-image-row-caption="1"]') as HTMLInputElement | null;
    const legacyShown = legacySrcBox?.value === pix && legacyCapBox?.value === '老图题';
    (document.querySelector('[data-image-row-add="1"]') as HTMLElement | null)?.click();
    await wait(300);
    const oldProps = findNode(getForest(S().doc), oldNode ?? '')?.props ?? {};
    const migrated = String(oldProps.images ?? '');
    add(
      '老文档（只有单图 src/caption）在面板里当第 1 行显示，一编辑就迁移进 images 并清空 src',
      legacyShown && migrated.includes(pix) && migrated.includes('老图题') && oldProps.src === '',
      `老图显示为第 1 行=${legacyShown}（地址框${legacySrcBox ? '有' : '无'}值、图题框值=「${legacyCapBox?.value ?? ''}」）；迁移后 images 第 1 行=「${migrated.split('\n')[0].slice(0, 40)}…」、src=「${String(oldProps.src ?? '')}」`,
    );

    /* ★用户 2026-09-23 报的两个 bug，同一个根因：行数只能由换行符决定。
       ① 没填地址时点 ＋ 加不出占位行；② 删掉上面一行后下面的占位行全没了。
       （原实现 `parseRows` 里 `if (text.trim() === '')` 会把 `'\n\n'` 压回一行。） */
    S().clearAll();
    const emptyNode = S().addComponent('image');
    await wait(460);
    S().selectComponent(emptyNode ? [emptyNode] : []);
    await wait(340);
    const rowsCount = (): number =>
      Number((document.querySelector('[data-image-rows="1"]') as HTMLElement | null)?.getAttribute('data-image-rows-count') ?? '0');
    const propsOf = (id: string): Record<string, unknown> => findNode(getForest(S().doc), id)?.props ?? {};
    const beforeAdd = rowsCount();
    (document.querySelector('[data-image-row-add="1"]') as HTMLElement | null)?.click();
    await wait(300);
    const afterAddEmpty = rowsCount();
    const emptyImages = String(propsOf(emptyNode ?? '').images ?? '');
    add(
      '图片行全空时点 ＋ 照样加出占位行（行数由换行符决定，不因"看着是空的"被压回一行）',
      beforeAdd === 1 && afterAddEmpty === 2 && emptyImages === '\n',
      `点 ＋ 前 ${beforeAdd} 行 → 后 ${afterAddEmpty} 行；props.images=「${emptyImages.replace(/\n/g, '⏎')}」`,
    );

    // 第 1 行有图、下面两行是空占位：删掉第 1 行，下面两行必须还在
    if (emptyNode) S().updateProps(emptyNode, { images: `${pix} | 图一\n\n` });
    await wait(320);
    const threeRows = rowsCount();
    (document.querySelector('[data-image-row-remove="1"]') as HTMLElement | null)?.click();
    await wait(300);
    const afterTopRemove = rowsCount();
    const restImages = String(propsOf(emptyNode ?? '').images ?? '');
    add(
      '删掉最上面一行时，下面的占位行不会被一并清掉',
      threeRows === 3 && afterTopRemove === 2 && restImages === '\n',
      `3 行 → 删第 1 行后 ${afterTopRemove} 行；props.images=「${restImages.replace(/\n/g, '⏎')}」`,
    );

    // 图题里能正常打空格：值是"输入框 → props → 再解析回输入框"往返的，
    // 尾部空白被 trim 掉的话，敲空格那一下就被吃掉（"图 1-1" 变 "图1-1"）。按真人逐字输入模拟。
    const capBox = (): HTMLInputElement | null =>
      document.querySelector('[data-image-row-caption="1"]') as HTMLInputElement | null;
    for (const ch of '图 1-1') {
      const el = capBox();
      if (!el) break;
      setInput(el, `${el.value}${ch}`);
      await wait(100);
    }
    await wait(200);
    const capStored = String(propsOf(emptyNode ?? '').images ?? '');
    add(
      '图题里能正常打空格（逐字输入 "图 1-1" 不会被吃成 "图1-1"）',
      capStored.includes('图 1-1'),
      `props.images=「${capStored.replace(/\n/g, '⏎')}」`,
    );
  }

  /* 组件 ID：面板显示位置 + 唯一性（用户 2026-09-24 问「toc_fe775e9026 是不是组件 ID、都是唯一的吗」） */
  {
    const idsOf = (d: EditorDocument): string[] => {
      const out: string[] = [];
      const walk = (list: ComponentNode[]): void => {
        list.forEach((n) => {
          out.push(n.id);
          if (n.children?.length) walk(n.children);
        });
      };
      walk(d.document.components);
      walk(d.web.root.children ?? []);
      return out;
    };

    // ① 面板：ID 跟 type 标签同一行（不再单独占一行）
    S().setMode('document');
    S().clearAll();
    const tocNode = S().addComponent('toc');
    await wait(460);
    S().selectComponent(tocNode ? [tocNode] : []);
    await wait(340);
    const idEls = [...document.querySelectorAll('[data-props-panel] [data-props-id]')] as HTMLElement[];
    const inHead = !!idEls[0]?.closest('[data-props-head]');
    add(
      '属性面板：组件 ID 显示在 type 标签**同一行**（不再单独占一行），内容就是该节点的 node.id',
      idEls.length === 1 &&
        inHead &&
        idEls[0]?.textContent === tocNode &&
        !!document.querySelector('[data-props-panel] [data-copy-id="1"]'),
      `面板里 ID 元素 ${idEls.length} 个、在标题行=${inHead}、文本=「${idEls[0]?.textContent ?? ''}」、节点 id=「${String(tocNode ?? '')}」`,
    );

    // ② 唯一性：示例两页全部节点（含嵌套）
    const demoIds = buildDemoPages().flatMap((p) => idsOf(p.doc));
    const dupDemo = demoIds.filter((id, i) => demoIds.indexOf(id) !== i);
    add(
      `组件 ID 唯一：示例两页共 ${demoIds.length} 个节点（含嵌套）无重复，且都带"类型前缀_随机"形状`,
      demoIds.length > 80 &&
        dupDemo.length === 0 &&
        demoIds.every((id) => /^[a-z]{2,4}_[0-9a-z]{6,}$/i.test(id)),
      `重复 ${dupDemo.length} 个${dupDemo.length ? `：${dupDemo.slice(0, 3).join('、')}` : ''}；样例 ${demoIds.slice(0, 3).join('、')}`,
    );

    // ③ 读档/导入规整：重复 / 缺失的 ID 会被重新生成
    const dirty = {
      ...S().doc,
      document: {
        ...S().doc.document,
        components: [
          { id: 'dup_id', type: 'paragraph', props: {} },
          { id: 'dup_id', type: 'heading', props: {} },
          { type: 'bullets', props: {} },
        ] as ComponentNode[],
      },
      web: {
        ...S().doc.web,
        root: { ...S().doc.web.root, children: [{ id: 'dup_id', type: 'button', props: {} } as ComponentNode] },
      },
    } as EditorDocument;
    const fixedIds = idsOf(normalizeDoc(dirty));
    add(
      '读档/导入规整：重复或缺失的组件 ID 会重新生成（首次出现保留，冲突与空 ID 换新）',
      fixedIds.length === 4 && new Set(fixedIds).size === 4 && fixedIds[0] === 'dup_id',
      `规整后 ${fixedIds.length} 个 ID：${fixedIds.join('、')}`,
    );

    // ④ 复制组件：整棵子树换新 ID
    S().clearAll();
    const copyParent = S().addComponent('columns');
    const copyChild = copyParent ? S().addComponent('paragraph', copyParent) : null;
    await wait(420);
    if (copyParent) S().duplicateComponent(copyParent);
    await wait(460);
    const afterCopyIds = idsOf(S().doc);
    add(
      '复制组件会为整棵子树重新生成 ID（副本与原节点不共用 ID）',
      afterCopyIds.length >= 4 && new Set(afterCopyIds).size === afterCopyIds.length && !!copyChild,
      `复制后 ${afterCopyIds.length} 个节点 / ${new Set(afterCopyIds).size} 个不同 ID`,
    );
  }

  /* 要点列表的**子要点**（用户 2026-09-23：bul_xxx 组件的子要点没有实现） */
  {
    S().setMode('document');
    S().clearAll();
    const bulNode = S().addComponent('bullets');
    if (bulNode) {
      S().updateProps(bulNode, {
        items: '一级要点\n  两空格子要点\n\tTab 子要点\n\u3000全角空格子要点\n    四空格二级',
      });
    }
    await wait(520);
    const bulletLis = [...document.querySelectorAll(`[data-node-id="${bulNode}"] li[data-bullet-level]`)] as HTMLElement[];
    const liOf = (i: number): { level: number; ml: number; mark: string } => {
      const li = bulletLis[i];
      if (!li) return { level: -1, ml: -1, mark: '' };
      return {
        level: Number(li.getAttribute('data-bullet-level')),
        ml: Math.round(Number.parseFloat(getComputedStyle(li).marginLeft) || 0),
        mark: li.querySelector('[data-bullet-marker]')?.textContent ?? '',
      };
    };
    const b0 = liOf(0);
    const b1 = liOf(1);
    const bTab = liOf(2);
    const bFull = liOf(3);
    const b2 = liOf(4);
    add(
      '要点列表的**子要点**真分级：行首 2 空格 / Tab / 全角空格都算一级、4 空格算二级（原来被 lines() 的 trim 吃掉，永远 0 级）',
      bulletLis.length === 5 &&
        b0.level === 0 &&
        b0.ml === 0 &&
        b1.level === 1 &&
        b1.ml > 5 &&
        bTab.level === 1 &&
        bTab.ml === b1.ml &&
        bFull.level === 1 &&
        bFull.ml === b1.ml &&
        b2.level === 2 &&
        b2.ml > b1.ml &&
        b1.mark !== b0.mark,
      `共 ${bulletLis.length} 条：${[b0, b1, bTab, bFull, b2].map((x) => `L${x.level}/缩进${x.ml}px/符号${x.mark}`).join('；')}`,
    );

    // 编号列表：按级编号 1. → 1.1. → 1.2. → 2.
    if (bulNode) S().updateProps(bulNode, { items: '第一条\n  子条一\n  子条二\n第二条', ordered: true });
    await wait(460);
    const numMarks = [...document.querySelectorAll(`[data-node-id="${bulNode}"] [data-bullet-marker]`)].map(
      (el) => el.textContent ?? '',
    );
    add(
      '要点列表用编号时按级编号（1. → 1.1. → 1.2. → 2.，子级不会把父级编号推进）',
      numMarks.join(' | ') === '1. | 1.1. | 1.2. | 2.',
      `编号=${numMarks.join(' | ')}`,
    );
  }

  /* 文档 ↔ Web 来回切模式：画布尺寸不能被上一种模式的实测值污染（用户 2026-09-23 反馈） */
  {
    S().setMode('document');
    S().clearAll();
    const mNode2 = S().addComponent('paragraph');
    if (mNode2) S().updateProps(mNode2, { text: '模式来回切' });
    await wait(460);
    const layerW = (): number => {
      const el = document.querySelector('[data-pan-layer="1"]') as HTMLElement | null;
      return el ? el.getBoundingClientRect().width : 0;
    };
    const docLayerW1 = layerW();

    S().setMode('web');
    await wait(520);
    const webLayerW = layerW();

    S().setMode('document');
    await wait(560);
    const vpRect = document.getElementById('canvas-viewport')?.getBoundingClientRect();
    const layerEl = document.querySelector('[data-pan-layer="1"]') as HTMLElement | null;
    const lr = layerEl?.getBoundingClientRect();
    const pageW = mmToPx(S().doc.document.page.width);
    const leftGap = lr && vpRect ? lr.x - vpRect.x : -1;
    add(
      '文档 ↔ Web 来回切模式：切回文档模式后 A4 仍居中（实测宽不会被 Web 画布宽度锁死）',
      Math.round(docLayerW1) === Math.round(pageW) &&
        Math.round(webLayerW) === S().doc.web.canvas.width &&
        !!lr &&
        Math.abs(lr.width - pageW) < 2 &&
        leftGap > 20,
      `文档图层宽=${Math.round(docLayerW1)}（期望 ${Math.round(pageW)}）→ Web 图层宽=${Math.round(webLayerW)}（画布 ${S().doc.web.canvas.width}）→ 切回文档图层宽=${Math.round(lr?.width ?? 0)}、左边距=${Math.round(leftGap)}px`,
    );
  }

  /* ── 示例文档（?demo=1）：两种模式**各一页**，且每页覆盖该模式下的全部组件 ── */
  {
    const pages = buildDemoPages();
    const docPage = pages.find((p) => p.mode === 'document');
    const webPage = pages.find((p) => p.mode === 'web');
    const collect = (roots: { type: string; children?: { type: string; children?: unknown[] }[] }[]): Set<string> => {
      const out = new Set<string>();
      const walk = (list: typeof roots): void => {
        list.forEach((n) => {
          out.add(n.type);
          if (n.children?.length) walk(n.children as typeof roots);
        });
      };
      walk(roots);
      return out;
    };
    const docTypes = docPage ? collect(docPage.doc.document.components) : new Set<string>();
    const webTypes = webPage ? collect(webPage.doc.web.root.children ?? []) : new Set<string>();
    const wantFor = (m: 'document' | 'web'): string[] =>
      getAllComponents()
        .filter((d) => !d.type.startsWith('__') && d.supportedModes.includes(m))
        .map((d) => d.type);
    const wantDoc = wantFor('document');
    const wantWeb = wantFor('web');
    const missDoc = wantDoc.filter((t) => !docTypes.has(t));
    const missWeb = wantWeb.filter((t) => !webTypes.has(t));
    add(
      '示例文档：文档模式页覆盖该模式全部组件',
      !!docPage && wantDoc.length >= 20 && missDoc.length === 0,
      `文档模式组件 ${wantDoc.length} 个，缺 ${missDoc.length}${missDoc.length ? `（${missDoc.join(',')}）` : ''}；页内节点类型 ${docTypes.size} 种`,
    );
    add(
      '示例文档：Web 模式页覆盖该模式全部组件（网格摆开、画布随之放大）',
      !!webPage && wantWeb.length >= 20 && missWeb.length === 0 && (webPage?.doc.web.canvas.height ?? 0) > 900,
      `Web 模式组件 ${wantWeb.length} 个，缺 ${missWeb.length}${missWeb.length ? `（${missWeb.join(',')}）` : ''}；画布 ${webPage?.doc.web.canvas.width}×${webPage?.doc.web.canvas.height}`,
    );
    add(
      '示例文档一共两页（文档模式页 + Web 模式页，可直接用分页标签对照）',
      pages.length === 2 && !!docPage && !!webPage && docPage.id !== webPage.id,
      pages.map((p) => `${p.title}（${p.mode}）`).join(' + ') || '无',
    );
  }

  /* ── 新建对话框里的**示例入口**：能看见、能选择、载入后内容正确 ── */
  {
    // 先把当前页弄成"空白首页"，验证"空白页直接承载示例"的策略
    S().setPages([
      {
        id: 'blank-check',
        title: '未命名文档',
        mode: 'document',
        doc: { ...createInitialDocument(), id: 'blank-check' },
      },
    ]);
    await wait(200);
    S().setNewDocOpen(true);
    await wait(260);
    const step1 = document.querySelector('[data-new-doc="1"][data-new-doc-step="1"]');
    const examples = document.querySelectorAll('[data-new-doc-example]');
    add(
      '新建文档：第 1 步能看到两份**示例**入口（文档模式示例 / Web 模式示例）',
      !!step1 && examples.length === 2,
      step1 ? `示例入口 ${examples.length} 个：${[...examples].map((e) => e.getAttribute('data-new-doc-example')).join('、')}` : '对话框未打开',
    );

    (document.querySelector('[data-new-doc-example="document"]') as HTMLButtonElement | null)?.click();
    await wait(620);
    const afterDoc = {
      pages: S().pages.length,
      mode: S().doc.mode,
      title: S().doc.title,
      types: new Set(collectTypes(S().doc.document.components)),
      closed: !document.querySelector('[data-new-doc="1"]'),
    };
    add(
      '新建文档：选「文档模式示例」→ 载入该页（空白首页被直接承载、含全部组件、弹窗关闭）',
      afterDoc.pages === 1 &&
        afterDoc.mode === 'document' &&
        afterDoc.types.size >= 20 &&
        afterDoc.title.includes('文档模式示例') &&
        afterDoc.closed,
      `页数=${afterDoc.pages} 模式=${afterDoc.mode} 标题=「${afterDoc.title}」组件类型 ${afterDoc.types.size} 种；弹窗已关=${afterDoc.closed}`,
    );

    // 再来一次（此时已有内容页）→ 应该是**新增一页**
    S().setNewDocOpen(true);
    await wait(240);
    (document.querySelector('[data-new-doc-example="web"]') as HTMLButtonElement | null)?.click();
    await wait(700);
    const afterWeb = { pages: S().pages.length, mode: S().doc.mode, title: S().doc.title, canvasH: S().doc.web.canvas.height };
    add(
      '新建文档：选「Web 模式示例」→ 新增一页（已有页保持不变，画布按内容放大）',
      afterWeb.pages === 2 && afterWeb.mode === 'web' && afterWeb.canvasH > 900 && afterWeb.title.includes('Web 模式示例'),
      `页数=${afterWeb.pages} 模式=${afterWeb.mode} 标题=「${afterWeb.title}」画布高 ${afterWeb.canvasH}px`,
    );
  }

  return out;
}
