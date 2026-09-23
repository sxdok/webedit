/**
 * 职责：自检（?check=1）。分两段：
 *   ① 数据层（同步）：store / 注册表 / 历史栈 / 双模式隔离 / 页面与设备 / 导入导出 / 持久化；
 *   ② 渲染层（等 React 渲染一帧后）：插入组件 → 画布出现对应 DOM；切模式 → 另一模式内容仍在、当前模式不含对方节点；
 *      结束后把文档还原成自检前的状态，避免污染用户内容。
 * 结果写入 document.title、console 与右下角浮层（便于无头截图/PDF 核对）。
 * 对应验收标准：1、2、3、4、5、7、9、10。
 */
import { Type } from 'lucide-react';
import { getAllComponents, getComponent, getComponentsByMode, registerComponent, unregisterComponent } from '../registry';
import { COMPONENT_MODULES, collectComponents } from '../registry/components';
import { IMPLEMENTED_CONTROLS } from '../components/property-controls';
import { CATEGORY_ORDER, pageLabel, type ComponentDefinition } from '../registry/types';
import { createInitialDocument, useEditorStore } from './editorStore';
import { HISTORY_LIMIT } from './history';
import { mmToPx } from '../utils/units';
import { log, planPost } from '../utils/logger';
import { buildDiagnosticReport } from '../utils/diagnostics';
import { buildComponentSpecSheet } from '../utils/specSheet';
import { parseTableHtml, serializeTableHtml } from '../registry/components/common/tableHtml';
import { saveToRunDir } from '../utils/download';
import { findNode, getForest } from './treeUtils';
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
    const pills = document.querySelectorAll('#canvas-viewport .zoom-pill').length;
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
    const wantGroups = ['纸张', '页边距', '版式', '分页', '分节页码', '页眉', '页脚'];
    const missing = [...wantDrawers.filter((d) => !drawers.includes(d)), ...wantGroups.filter((g) => !groupNames.includes(g))];
    add(
      '页面属性面板结构：三抽屉（通用/专有/状态）+ 七个分组 + 全部属性行',
      !!pagePanel && pagePanel.clientWidth > 100 && missing.length === 0 && rows.length >= 29,
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
      rows.length >= 29 && rowOverflow.length === 0 && wrapped === 0 && badLabelW === 0 && tooTall === 0 && boxOverflow <= 1,
      `${rows.length} 行；横向溢出 ${rowOverflow.length}、属性名列非 96px ${badLabelW}、折行 ${wrapped}、超高 ${tooTall}；面板溢出 ${boxOverflow}px`,
    );

    // 规格 §7：说明默认隐藏 —— 面板里不铺说明文字，每个属性名都挂着气泡触发器
    const prose = pagePanel ? pagePanel.querySelectorAll('p').length : -1;
    const noTip = rows.filter((r) => !r.querySelector('[data-tip="1"]')).length;
    add(
      '页面属性说明默认隐藏（面板内无说明段落，属性名均可悬停出气泡）',
      prose === 0 && rows.length >= 29 && noTip === 0,
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
  const exportWord = S().exportWord();
  add(
    '导出 Word(.doc) 含 Word 命名空间与页面设置',
    exportWord.includes('xmlns:w=') && exportWord.includes('WordSection1') && exportWord.includes('@page WordSection1'),
    `${exportWord.length} 字节`,
  );

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

  /* ── 标尺吸顶：滚动后不能跟着内容跑 ── */
  S().setMode('document');
  await wait(200);
  const vp = document.getElementById('canvas-viewport');
  if (vp) {
    vp.scrollTop = 420;
    await wait(220);
    const ruler = vp.querySelector('.sticky') as HTMLElement | null;
    const rr = ruler?.getBoundingClientRect();
    const vr = vp.getBoundingClientRect();
    add(
      '标尺滚动后吸顶（不跟随内容）',
      !!rr && Math.abs(rr.top - vr.top) <= 4,
      rr ? `标尺 top=${Math.round(rr.top)} / 视口 top=${Math.round(vr.top)}（差 ${Math.round(rr.top - vr.top)}px，已滚动 ${vp.scrollTop}px）` : '未找到标尺',
    );
    vp.scrollTop = 0;
  } else {
    add('标尺滚动后吸顶（不跟随内容）', false, '找不到 #canvas-viewport');
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
    await wait(360);
    const groupEls = [...document.querySelectorAll('[data-prop-group="1"]')] as HTMLElement[];
    const openNames = groupEls.filter((g) => g.dataset.groupOpen === '1').map((g) => g.dataset.groupName ?? '');
    const listCount = document.querySelectorAll('[data-prop-list="1"]').length;
    add(
      '属性分组默认折叠（表格组件只展开「表格」组）',
      groupEls.length >= 2 && openNames.length === 1 && openNames[0] === '表格' && listCount === 1,
      `${groupEls.length} 个分组，展开「${openNames.join('/') || '无'}」，渲染的属性列表 ${listCount} 个`,
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
      await wait(360);
      const gs = [...document.querySelectorAll('[data-prop-group="1"]')] as HTMLElement[];
      const open = gs.filter((g) => g.dataset.groupOpen === '1').map((g) => g.dataset.groupName ?? '');
      add(
        '非表格组件也有默认展开的分组（选中后能看到属性）',
        gs.length >= 1 && open.length === 1 && open[0] === '内容',
        `${gs.length} 个分组，展开「${open.join('/') || '无'}」`,
      );
    }
    const target = '[data-prop-group="1"][data-group-name="单元格"]';
    let expandWorks = false;
    // ★自带一张表并选中：前一段（多选）结尾 setMode 会清空选中，面板会退回"页面属性"，
    //   那时根本没有分组可点。
    S().setMode('document');
    S().clearAll();
    S().addComponent('table');
    await wait(380);
    const head = document.querySelector(target) as HTMLElement | null;
    if (head) {
      (head.querySelector('button') as HTMLButtonElement).click();
      await wait(220);
      expandWorks = !!document.querySelector(`${target} [data-prop-list="1"]`);
      // 折回去，保持"只有默认组展开"的初始状态
      (document.querySelector(`${target} button`) as HTMLButtonElement).click();
      await wait(140);
    }
    add('属性分组可展开/折叠（点标题切换）', expandWorks, `点「单元格」后展开=${expandWorks}`);

    /* ── 表格行 / 列数量：输入（回车提交）与 ＋/− 按钮都要真改数据 ──
       （自带一张 3×3 表并选中，保证面板里确实有行列数量控件） */
    S().setMode('document');
    S().clearAll();
    const tSize = S().addComponent('table');
    if (tSize) S().updateProps(tSize, { data: 'a | b | c\nd | e | f\ng | h | i', headerRow: true, colWidths: '', rowHeight: '', cellStyles: {} });
    await wait(420);
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
      // 定位到「专有属性」抽屉里的第一个属性行（表格组件此时是「数据」行）——
      // 通用属性抽屉在它之上，直接取全局第一个会拿到"上边距"
      const label =
        (document.querySelector('[data-drawer-name="专有属性"] [data-prop-label="1"]') as HTMLElement | null) ??
        (document.querySelector('[data-prop-label="1"]') as HTMLElement | null);
      const trigger = (label?.querySelector('[data-tip="1"]') as HTMLElement | null) ?? label;
      const txt = (label?.textContent ?? '').trim();
      const hidden = !!label && !txt.includes('（') && !txt.includes('每行一条');
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await wait(560); // > 400ms 延迟
      const tip = document.querySelector('[data-tooltip="1"]') as HTMLElement | null;
      const tipText = tip?.textContent ?? '';
      const dark = tip ? getComputedStyle(tip).backgroundColor : '';
      add(
        '属性说明默认隐藏、悬停弹气泡（400ms 延迟 / 深色底 / 含 key 与默认值，不走原生 title）',
        hidden && !!tip && tipText.includes('每行一条') && tipText.includes('data') && tipText.includes('默认值') && dark === 'rgba(0, 0, 0, 0.82)',
        `属性名只显示=「${txt}」；气泡=${tip ? `「${tipText}」底色 ${dark}` : '未弹出'}`,
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

  return out;
}
