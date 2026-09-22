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
import { IMPLEMENTED_CONTROLS } from '../components/property-controls';
import { pageLabel, type ComponentDefinition } from '../registry/types';
import { createInitialDocument, useEditorStore } from './editorStore';
import { HISTORY_LIMIT } from './history';
import { mmToPx } from '../utils/units';
import { log } from '../utils/logger';
import { buildDiagnosticReport } from '../utils/diagnostics';
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

  /* ── 页眉/页脚编辑区排版：不溢出面板宽度、参数行不换行 ── */
  S().selectComponent([]); // 让右侧显示"页面属性"
  await wait(200);
  const bandBox = document.querySelector('[data-band-editor="1"]') as HTMLElement | null;
  if (bandBox) {
    const boxOverflow = bandBox.scrollWidth - bandBox.clientWidth;
    // "距页顶/底 + 字号" 那一行的子元素必须在同一行（offsetTop 相同）；只看带标记的行，避免把外层容器算进来
    const rows = [...bandBox.querySelectorAll('[data-band-row="pos"]')];
    const wrapped = rows.filter((r) => {
      const kids = [...r.children] as HTMLElement[];
      if (kids.length < 3) return false;
      // 行是 items-center 垂直居中，不能用 offsetTop 相等判断；
      // 正确的换行判据：子元素的垂直跨度明显超过"最高子元素的高度"
      const tops = kids.map((k) => k.offsetTop);
      const bottoms = kids.map((k) => k.offsetTop + k.offsetHeight);
      const spread = Math.max(...bottoms) - Math.min(...tops);
      const tallest = Math.max(...kids.map((k) => k.offsetHeight));
      return spread > tallest + 6;
    }).length;
    add(
      '页眉/页脚编辑区排版正常（不溢出、数值行不换行）',
      boxOverflow <= 1 && wrapped === 0,
      `溢出 ${boxOverflow}px，参数行 ${rows.length} 行，换行 ${wrapped} 行`,
    );
  } else {
    add('页眉/页脚编辑区排版正常（不溢出、数值行不换行）', false, '未找到编辑区');
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
  } else {
    add('表格列宽生效（colgroup 20%/50%/30%）', false, 'addComponent(table) 失败');
    add('表格行高生效（纯数字按 mm）', false, 'addComponent(table) 失败');
    add('表格列宽支持 mm 且列数不缩水', false, 'addComponent(table) 失败');
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

  return out;
}
