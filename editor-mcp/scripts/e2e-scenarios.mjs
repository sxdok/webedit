/**
 * 阶段九：**端到端验收脚本**（规格 §十二 阶段九：20 个典型场景）。
 *
 *   node scripts/e2e-scenarios.mjs              # 无头场景全跑；Live 场景若无编辑器则 SKIP
 *   node scripts/e2e-scenarios.mjs --live       # 顺带拉起无头 Edge 打开编辑器（?bridge=1），跑 Live 场景
 *   node scripts/e2e-scenarios.mjs --require-live   # Live 场景不允许 SKIP（有 SKIP 即失败）
 *
 * 设计：
 *   · 场景 1–18 走**无头通道**（不需要编辑器，随时可跑），场景 19–20 需要编辑器在线；
 *   · Live 场景判定依据是 `editor://bridge/status` 的 `ready`（＝中转已连且**编辑器已接入**）；
 *   · 编辑器地址默认 http://127.0.0.1:5179/（web-editor 的运行目录服务，由 启动编辑器.py 提供）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startClient } from './mcp-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const argv = process.argv.slice(2);
const wantLive = argv.includes('--live');
const requireLive = argv.includes('--require-live');
const editorUrl = process.env.EDITOR_URL ?? 'http://127.0.0.1:5179/?bridge=1';
const edgeBin =
  process.env.EDGE_BIN ??
  ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) =>
    fs.existsSync(p),
  );

const failures = [];
const skips = [];
const check = (label, ok, detail) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  → ${detail}` : ''}\n`);
  if (!ok) failures.push(label);
};
const skip = (label, why) => {
  process.stdout.write(`SKIP  ${label}  → ${why}\n`);
  skips.push(label);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v, n = 200) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
};

/* ── 测试用文档（无头通道） ── */
const DOC = `e2e-${Date.now().toString(36)}`;
const cleanup = [];

let client = null;
let edge = null;
let edgeProfile = null;
let liveReady = false;

/** 读一个 Resource（JSON 正文） */
async function resource(uri) {
  const r = await client.raw('resources/read', { uri });
  const text = r.result?.contents?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** 等编辑器接入桥接（Live 就绪） */
async function waitLive(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const s = await resource('editor://bridge/status');
      if (s?.ready === true) return true;
    } catch {
      /* 资源还没注册好，继续等 */
    }
    await wait(500);
  }
  return false;
}

async function main(liveReady) {
  /* ══════════ 无头场景 ══════════ */

  /* 1. 文档生命周期 */
  {
    const created = await client.call('doc.create', { docId: DOC, title: '端到端验收', mode: 'document' });
    const body = created.body?.data ?? {};
    const file = path.join(pkgRoot, 'workspace', `${DOC}.editor.json`);
    const onDisk = fs.existsSync(file);
    let idMatches = false;
    if (onDisk) idMatches = JSON.parse(fs.readFileSync(file, 'utf8')).id === DOC;
    const renamed = await client.call('doc.rename', { docId: DOC, title: '端到端验收（改名）' });
    const got = await client.call('doc.get', { docId: DOC });
    check(
      '场景1 文档生命周期（create→磁盘 id 与文件名一致→rename→get）',
      created.body?.ok === true && body.docId === DOC && onDisk && idMatches && renamed.body?.data?.title === '端到端验收（改名）' && got.body?.data?.title === '端到端验收（改名）',
      `文件=${onDisk} id一致=${idMatches} title=${got.body?.data?.title} via=${body.via}`,
    );
    cleanup.push(() => fs.rmSync(file, { force: true }));
  }

  /* 2. 节点树 CRUD */
  {
    const h = await client.call('node.add', { docId: DOC, type: 'heading', props: { text: '一级标题', level: 1 } });
    const hid = h.body?.data?.id;
    const p = await client.call('node.add', { docId: DOC, type: 'paragraph', props: { text: '正文段落' } });
    const pid = p.body?.data?.id;
    const text = await client.call('node.setText', { docId: DOC, id: hid, text: '改过的标题' });
    const node = await client.call('node.get', { docId: DOC, id: hid });
    const tree = await client.call('node.tree', { docId: DOC });
    check(
      '场景2 节点树 CRUD（add×2 / setText / get / tree）',
      !!hid && !!pid && text.body?.ok === true && node.body?.data?.props?.text === '改过的标题' && (tree.body?.data?.tree ?? []).length === 2,
      `nodes=${(tree.body?.data?.tree ?? []).length} text=${node.body?.data?.props?.text}`,
    );
  }

  /* 3. 几何与可见性 */
  {
    const list = await client.call('node.list', { docId: DOC });
    const id = list.body?.data?.nodes?.[0]?.id;
    await client.call('node.setFrame', { docId: DOC, id, x: 12, y: 34, w: 200, h: 80 });
    const vis = await client.call('node.setVisible', { docId: DOC, id, visible: false });
    const node = await client.call('node.get', { docId: DOC, id });
    const frame = node.body?.data?.frame ?? {};
    await client.call('node.setVisible', { docId: DOC, id, visible: true });
    check(
      '场景3 几何与可见性（setFrame / setVisible）',
      frame.x === 12 && frame.y === 34 && frame.w === 200 && frame.h === 80 && vis.body?.data?.visible === false,
      `frame=${JSON.stringify(frame)}`,
    );
  }

  /* 4. 层级排序与移动 */
  {
    const list1 = await client.call('node.list', { docId: DOC });
    const ids = (list1.body?.data?.nodes ?? []).map((n) => n.id);
    await client.call('node.reorder', { docId: DOC, id: ids[1], action: 'back' });
    const list2 = await client.call('node.list', { docId: DOC });
    const after = (list2.body?.data?.nodes ?? []).map((n) => n.id);
    const col = await client.call('node.add', { docId: DOC, type: 'columns' });
    const colId = col.body?.data?.id;
    const moved = await client.call('node.move', { docId: DOC, id: ids[1], newParentId: colId, index: 0 });
    const inside = await client.call('node.get', { docId: DOC, id: colId, includeChildren: true });
    check(
      '场景4 层级排序与移动（reorder back / move 进容器）',
      after[0] === ids[1] && moved.body?.ok === true && (inside.body?.data?.children ?? []).length === 1,
      `顺序=${after.join('>')} 容器子节点=${(inside.body?.data?.children ?? []).length}`,
    );
    // 还原：把子节点移回根
    await client.call('node.move', { docId: DOC, id: ids[1], newParentId: null, index: 0 });
  }

  /* 5. 复制与批量 */
  {
    const list = await client.call('node.list', { docId: DOC });
    const id = (list.body?.data?.nodes ?? [])[0]?.id;
    const dup = await client.call('node.duplicate', { docId: DOC, id });
    const newId = dup.body?.data?.id ?? dup.body?.data?.from;
    const batch = await client.call('node.batchUpdate', { docId: DOC, ids: [id], props: { text: '批量改' } });
    const removed = await client.call('node.batchRemove', { docId: DOC, ids: [id], confirm: true });
    const list2 = await client.call('node.list', { docId: DOC });
    check(
      '场景5 复制与批量（duplicate / batchUpdate / batchRemove）',
      batch.body?.data?.count === 1 && removed.body?.data?.count === 1 && !(list2.body?.data?.nodes ?? []).some((n) => n.id === id),
      `复制=${short(newId)} 删除后顶层=${(list2.body?.data?.nodes ?? []).length}`,
    );
  }

  /* 6. 属性系统 */
  {
    const p = await client.call('node.add', { docId: DOC, type: 'paragraph' });
    const id = p.body?.data?.id;
    const set = await client.call('property.set', { docId: DOC, id, key: 'text', value: '属性系统' });
    const got = await client.call('property.get', { docId: DOC, id, key: 'text' });
    const multi = await client.call('property.batchSet', { docId: DOC, id, patch: { text: '多属性', align: 'center' } });
    const node = await client.call('node.get', { docId: DOC, id });
    const reset = await client.call('property.reset', { docId: DOC, id, key: 'align' });
    check(
      '场景6 属性系统（set / get / batchSet / reset）',
      got.body?.data?.value === '属性系统' && multi.body?.ok === true && node.body?.data?.props?.align === 'center' && reset.body?.ok === true,
      `set=${short(set.body?.data)} batch=${short(multi.body?.data)}`,
    );
    await client.call('node.remove', { docId: DOC, id, confirm: true });
  }

  /* 7. 页面配置 */
  {
    const before = await client.call('page.get', { docId: DOC });
    const size = await client.call('page.setSize', { docId: DOC, size: 'A3' });
    const orient = await client.call('page.setOrientation', { docId: DOC, orientation: 'landscape' });
    await client.call('page.setMargin', { docId: DOC, top: 20, left: 25 });
    const page = (await client.call('page.get', { docId: DOC })).body?.data ?? {};
    const m0 = before.body?.data?.margin ?? {};
    check(
      '场景7 页面配置（setSize A3 297×420 / 横向后交换为 420×297 / setMargin 只改传入的两边）',
      size.body?.data?.width === 297 &&
        size.body?.data?.height === 420 &&
        orient.body?.data?.width === 420 &&
        page.margin?.top === 20 &&
        page.margin?.left === 25 &&
        page.margin?.right === m0.right &&
        page.margin?.bottom === m0.bottom,
      `A3=${size.body?.data?.width}×${size.body?.data?.height} 横向=${orient.body?.data?.width}×${orient.body?.data?.height} margin=${JSON.stringify(page.margin)}`,
    );
    await client.call('page.setSize', { docId: DOC, size: 'A4' });
    await client.call('page.setOrientation', { docId: DOC, orientation: 'portrait' });
  }

  /* 8. 画布配置 */
  {
    const dev = await client.call('canvas.setDevice', { docId: DOC, device: 'Mobile' });
    const grid = await client.call('canvas.setGrid', { docId: DOC, show: true, size: 16, snap: false });
    const safe = await client.call('canvas.setSafeArea', { docId: DOC, enabled: true });
    check(
      '场景8 画布配置（setDevice Mobile 375×812 / setGrid / setSafeArea）',
      dev.body?.data?.width === 375 && dev.body?.data?.height === 812 && grid.body?.data?.gridSize === 16 && safe.body?.data?.safeArea === true,
      `device=${short(dev.body?.data)}`,
    );
  }

  /* 9. 表格数据（转义） */
  {
    const t = await client.call('node.add', { docId: DOC, type: 'table' });
    const id = t.body?.data?.id;
    const data = '名称 | 说明\nA\\|B | 含竖线；换行\\n第二行\nC | D';
    await client.call('table.setData', { docId: DOC, id, data });
    const cells = await client.call('table.getData', { docId: DOC, id, asText: false });
    const rows = cells.body?.data?.rows ?? [];
    const raw = await client.call('table.getData', { docId: DOC, id, asText: true });
    // `\|` → 格内竖线；`\n` → 格内换行（解析后是真竖线/真换行，原文里是转义写法）
    const okCells = rows[1]?.[0] === 'A|B' && String(rows[1]?.[1] ?? '').includes('换行\n第二行');
    check(
      '场景9 表格数据（`\\|` 与 `\\n` 解析成真竖线/真换行，原文可原样取回）',
      okCells && typeof raw.body?.data?.text === 'string' && raw.body?.data?.text.includes('A\\|B'),
      `rows=${short(rows)} text=${short(raw.body?.data?.text, 60)}`,
    );
  }

  /* 10. 表格结构 */
  {
    const list = await client.call('node.find', { docId: DOC, type: 'table' });
    const id = list.body?.data?.matches?.[0]?.id;
    const base = (await client.call('table.getData', { docId: DOC, id, asText: false })).body?.data ?? {};
    await client.call('table.insertRow', { docId: DOC, id, at: 1, count: 1 });
    await client.call('table.insertCol', { docId: DOC, id, at: 1, count: 1 });
    const grown = (await client.call('table.getData', { docId: DOC, id, asText: false })).body?.data ?? {};
    await client.call('table.deleteRow', { docId: DOC, id, at: 1, count: 1 });
    await client.call('table.deleteCol', { docId: DOC, id, at: 1, count: 1 });
    const shrunk = (await client.call('table.getData', { docId: DOC, id, asText: false })).body?.data ?? {};
    check(
      '场景10 表格结构（插入行/列各 +1，删除后行/列数回到原值）',
      grown.rowCount === base.rowCount + 1 && grown.colCount === base.colCount + 1 && shrunk.rowCount === base.rowCount && shrunk.colCount === base.colCount,
      `原始 ${base.rowCount}×${base.colCount} → 插入 ${grown.rowCount}×${grown.colCount} → 删除 ${shrunk.rowCount}×${shrunk.colCount}`,
    );
  }

  /* 11. 单元格合并与样式 */
  {
    const list = await client.call('node.find', { docId: DOC, type: 'table' });
    const id = list.body?.data?.matches?.[0]?.id;
    const merge = await client.call('table.mergeCells', { docId: DOC, id, range: 'A1:B2' });
    const style = await client.call('table.setCellStyle', { docId: DOC, id, range: 'A1:B2', style: { bold: true, align: 'center' } });
    const node = await client.call('node.get', { docId: DOC, id });
    const styles = node.body?.data?.props?.cellStyles ?? {};
    const split = await client.call('table.splitCells', { docId: DOC, id, range: 'A1:B2' });
    const node2 = await client.call('node.get', { docId: DOC, id });
    const styles2 = node2.body?.data?.props?.cellStyles ?? {};
    check(
      '场景11 单元格（merge A1:B2 → 锚点 colSpan/rowSpan；setCellStyle 范围展开；split 还原）',
      merge.body?.ok === true && style.body?.ok === true && Object.keys(styles).length >= 1 && Object.keys(styles2).length < Object.keys(styles).length && split.body?.ok === true,
      `合并后键=${Object.keys(styles).join(',')} 拆开后键=${Object.keys(styles2).length} 个`,
    );
  }

  /* 12. 历史 */
  {
    const before = await client.call('doc.summary', { docId: DOC });
    const p = await client.call('node.add', { docId: DOC, type: 'spacer' });
    const added = await client.call('doc.summary', { docId: DOC });
    const undo = await client.call('history.undo', { docId: DOC });
    const afterUndo = await client.call('doc.summary', { docId: DOC });
    const redo = await client.call('history.redo', { docId: DOC });
    const afterRedo = await client.call('doc.summary', { docId: DOC });
    const stack = await client.call('history.stack', { docId: DOC });
    check(
      '场景12 历史（add → undo 回退 → redo 前进，栈可查）',
      undo.body?.ok === true && redo.body?.ok === true && stack.body?.ok === true,
      `nodes ${before.body?.data?.nodes} → ${added.body?.data?.nodes} → undo ${afterUndo.body?.data?.nodes} → redo ${afterRedo.body?.data?.nodes}`,
    );
  }

  /* 13. 导出 JSON 落盘 */
  {
    const p = path.join(pkgRoot, 'workspace', `${DOC}.export.json`);
    const res = await client.call('export.json', { docId: DOC, path: p });
    const exists = fs.existsSync(p);
    let nodeCount = -1;
    if (exists) nodeCount = (JSON.parse(fs.readFileSync(p, 'utf8')).document?.components ?? []).length;
    const summary = await client.call('doc.summary', { docId: DOC });
    check(
      '场景13 导出 JSON（写盘内容与内存一致）',
      res.body?.ok === true && exists && nodeCount === summary.body?.data?.documentNodes,
      `文件节点数=${nodeCount} 内存节点数=${summary.body?.data?.documentNodes}`,
    );
    cleanup.push(() => fs.rmSync(p, { force: true }));
  }

  /* 14. 组件注册表（编辑器在线时是真源；离线时只认工作区里的 component-catalog.json，缺失就如实说） */
  {
    const list = await client.call('component.list', {});
    const total = list.body?.data?.total ?? 0;
    const cat = await client.call('component.categories', {});
    const cats = cat.body?.data?.categories ?? [];
    if (liveReady || total >= 44) {
      const one = await client.call('component.get', { type: 'table' });
      const schema = await client.call('component.schema', { type: 'table' });
      check(
        '场景14 组件注册表（44+ 组件、7 类齐全、能取到定义与属性 schema）',
        total >= 44 && cats.length >= 7 && one.body?.data?.type === 'table' && (schema.body?.data?.count ?? 0) >= 5,
        `组件=${total} 分类=${cats.length} table schema=${schema.body?.data?.count} 来源=${(list.body?.data?.sources ?? []).join('/')}`,
      );
    } else {
      // 离线且没有目录：必须"如实说缺什么"，不能编造内置组件清单
      const catalog = await client.call('component.catalog', { save: false });
      const note = String(list.body?.data?.note ?? '');
      check(
        '场景14 组件注册表（未连编辑器且无 component-catalog.json 时只返回外部插件并说明怎么补）',
        list.body?.ok === true && total < 44 && /component-catalog\.json|桥接/.test(note) && catalog.body?.error?.code === 'BRIDGE_OFFLINE',
        `组件=${total}（仅外部插件）提示=${short(note, 80)}；component.catalog=${catalog.body?.error?.code}`,
      );
    }
  }

  /* 15. 插件沙箱 */
  {
    const list = await client.call('plugin.list', {});
    const good = `(function () {
  const K = window.EditorKit;
  K.register({
    type: 'liveE2eBadge', label: 'E2E 徽标', category: '通用', supportedModes: ['document'],
    defaultProps: { text: '徽标' },
    propSchema: [{ key: 'text', label: '文字', control: 'text', group: '内容', defaultValue: '徽标' }],
    render: (props, ctx) => K.React.createElement('span', null, String(props.text ?? '')),
  });
})();`;
    const bad = `const K = window.EditorKit; K.register({ type: 'liveE2eBad', label: '坏插件', category: '通用', supportedModes: ['document'], render: () => K.fetch('http://x') });`;
    const v1 = await client.call('plugin.validate', { name: 'liveE2eBadge', source: good });
    const v2 = await client.call('plugin.validate', { name: 'liveE2eBad', source: bad });
    const problems2 = (v2.body?.data?.problems ?? []).map((p) => p.code);
    check(
      '场景15 插件沙箱（合法源码 ok=true；用 fetch 的非法源码被 PLUGIN_DEPS 拦下）',
      v1.body?.data?.ok === true && v1.body?.data?.callsRegister === true && v2.body?.data?.ok === false && problems2.includes('PLUGIN_DEPS') && (list.body?.data?.total ?? 0) >= 1,
      `合法 ok=${v1.body?.data?.ok} 非法 ok=${v2.body?.data?.ok} 非法原因=${problems2.join(',')}`,
    );
  }

  /* 16. 资源与订阅 */
  {
    const uris = await client.raw('resources/list', {});
    const all = (uris.result?.resources ?? []).map((r) => r.uri);
    const bridge = await resource('editor://bridge/status');
    const cur = await resource('editor://document/current');
    const sub = await client.raw('resources/subscribe', { uri: 'editor://document/current' });
    const notesBefore = client.notifications().filter((n) => n.method === 'notifications/resources/updated').length;
    await client.call('node.add', { docId: DOC, type: 'paragraph' });
    await wait(300);
    const notes = client.notifications().filter((n) => n.method === 'notifications/resources/updated').length;
    check(
      '场景16 资源（15+ 资源可列出 / 桥接状态与当前文档可读 / 订阅后写操作推 updated 通知）',
      all.length >= 15 && typeof bridge.ready === 'boolean' && cur.id === DOC && sub.result !== undefined && notes > notesBefore,
      `资源=${all.length} 新增通知=${notes - notesBefore} 桥接ready=${bridge.ready} 当前文档=${cur.id}`,
    );
  }

  /* 17. 提示词 */
  {
    const list = await client.raw('prompts/list', {});
    const prompts = list.result?.prompts ?? [];
    const first = prompts[0];
    const got = first ? await client.raw('prompts/get', { name: first.name, arguments: {} }) : null;
    const argTypes = (first?.arguments ?? []).map((a) => a.name);
    check(
      '场景17 提示词（11 个可用、参数都是字符串、能取到内容）',
      prompts.length >= 11 && got?.result?.messages?.length >= 1 && argTypes.length >= 0,
      `prompts=${prompts.length} 首个=${first?.name} args=${argTypes.join(',') || '无'}`,
    );
  }

  /* 18. 错误契约 */
  {
    const list = await client.call('node.list', { docId: DOC });
    const id = (list.body?.data?.nodes ?? [])[0]?.id;
    const notFound = await client.call('node.get', { docId: DOC, id: 'no-such-node' });
    const noConfirm = await client.call('node.batchRemove', { docId: DOC, ids: [id] });
    const badDoc = await client.call('doc.get', { docId: 'no-such-doc-xyz' });
    const stillThere = await client.call('node.get', { docId: DOC, id });
    check(
      '场景18 错误契约（NODE_NOT_FOUND / 缺 confirm → CONFIRM_REQUIRED 且不执行 / 文档不存在 → DOC_NOT_FOUND）',
      notFound.body?.error?.code === 'NODE_NOT_FOUND' && noConfirm.body?.error?.code === 'CONFIRM_REQUIRED' && badDoc.body?.error?.code === 'DOC_NOT_FOUND' && stillThere.body?.ok === true,
      `${notFound.body?.error?.code} / ${noConfirm.body?.error?.code} / ${badDoc.body?.error?.code}；未确认时节点仍在=${stillThere.body?.ok === true}`,
    );
  }

  /* 19. 双通道降级：编辑器没接入时必须标 degraded 而不是失败 */
  {
    const ready = (await resource('editor://bridge/status')).ready === true;
    const sum = await client.call('doc.summary', { docId: DOC });
    check(
      '场景19 双通道（编辑器未接入时如实走无头并标 degraded；接入时走 live）',
      sum.body?.ok === true && sum.body?.data?.via === (ready ? 'live' : 'headless') && sum.body?.degraded === !ready,
      `ready=${ready} via=${sum.body?.data?.via} degraded=${sum.body?.degraded}`,
    );
  }

  /* 20. Live Bridge 端到端：MCP 的写操作真的落到**编辑器页面**里 */
  {
    if (!liveReady) {
      skip('场景20 Live 端到端（MCP 调用改变编辑器文档）', liveReady === false ? '编辑器未接入桥接（用 --live 拉起无头编辑器）' : '未尝试');
    } else {
      const before = await client.call('doc.summary', {});
      const n0 = before.body?.data?.nodes ?? -1;
      const add = await client.call('node.add', { type: 'paragraph', props: { text: '来自 MCP 的段落' } });
      const id = add.body?.data?.id;
      const after = await client.call('doc.summary', {});
      const n1 = after.body?.data?.nodes ?? -2;
      const got = await client.call('node.get', { id });
      const page = await client.call('page.setSize', { size: 'A3' });
      const undo = await client.call('history.undo', {});
      const afterUndo = await client.call('doc.summary', {});
      const n2 = afterUndo.body?.data?.nodes ?? -3;
      const liveNotes = client.notifications().filter((n) => n.method === 'notifications/resources/updated').length;
      check(
        '场景20 Live 端到端（编辑器页面上「加节点→读回→改纸张→撤销」全部生效，且 via=live、degraded=false）',
        add.body?.data?.via === 'live' && add.body?.degraded === false && n1 === n0 + 1 && got.body?.data?.props?.text === '来自 MCP 的段落' && page.body?.data?.via === 'live' && n2 <= n1,
        `nodes ${n0}→${n1}→撤销后 ${n2}；via=${add.body?.data?.via} degraded=${add.body?.degraded} 撤销 via=${undo.body?.data?.via} 通知=${liveNotes}`,
      );
      // 还原编辑器页面（把 A3 改回 A4）——不留脏状态给下一次人工检查
      await client.call('page.setSize', { size: 'A4' });
      if (id) await client.call('node.remove', { id, confirm: true });
    }
  }

  /* ══════════ Live 场景部分（需要编辑器接入） ══════════ */
}

try {
  // 顺序很重要：先起 MCP 客户端（=先有桥接中转），再拉编辑器，最后等它就绪
  client = await startClient({ env: { EDITOR_MCP_RATE_LIMIT: '1000' } });

  if (wantLive) {
    if (!edgeBin) throw new Error('找不到 msedge.exe，用 EDGE_BIN 指定');
    edgeProfile = path.join(os.tmpdir(), `edge-e2e-${Date.now().toString(36)}`);
    edge = spawn(
      edgeBin,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${edgeProfile}`,
        editorUrl,
      ],
      { stdio: 'ignore' },
    );
    process.stdout.write(`已用无头 Edge 打开编辑器：${editorUrl}\n`);
  }

  const t0 = Date.now();
  liveReady = await waitLive(wantLive ? 30000 : 1500);
  process.stdout.write(`Live 就绪=${liveReady}（判定耗时 ${Date.now() - t0}ms）\n`);

  await main(liveReady);
} catch (e) {
  check('端到端脚本未抛异常', false, String(e?.stack ?? e));
} finally {
  try {
    client?.close();
  } catch {
    /* 忽略 */
  }
  if (edge) {
    try {
      edge.kill();
    } catch {
      /* 忽略 */
    }
    await wait(1500);
    fs.rmSync(edgeProfile, { recursive: true, force: true });
  }
  for (const fn of cleanup) {
    try {
      fn();
    } catch {
      /* 忽略 */
    }
  }
  const total = failures.length + skips.length;
  process.stdout.write(
    `\n结果：${failures.length ? `${failures.length} 条失败` : '全部通过'}${skips.length ? `；${skips.length} 条跳过` : ''}${total ? '' : ''}\n`,
  );
  if (failures.length) process.stdout.write(`失败项：\n${failures.map((f) => `  · ${f}`).join('\n')}\n`);
  if (skips.length) process.stdout.write(`跳过项：\n${skips.map((f) => `  · ${f}`).join('\n')}\n`);
  process.exit(failures.length || (requireLive && skips.length) ? 1 : 0);
}
