/**
 * 阶段三验证：六个域（doc / mode / page / canvas / node / property）端到端。
 *
 *   node scripts/tools-smoke.mjs
 *
 * 全部按**真实 MCP 调用**走一遍（stdio JSON-RPC），不直接 import 内部函数：
 *   建文档 → 加节点 → 改属性 → 页面/画布 → 树/查找/移动/复制/层级/批量 → 摘要 → 删除，
 *   并覆盖三条"不许糊弄"的路径：CONFIRM_REQUIRED、WRITE_DISABLED、DOC_NOT_FOUND。
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeChecker, pkgRoot, startClient } from './mcp-client.mjs';

const { check, failures } = makeChecker();
const DOC_ID = `tools-smoke-${Date.now().toString(36)}`;
const created = [];

try {
  const c = await startClient();
  const toolList = await c.tools();
  const names = toolList.map((t) => t.name);
  const domains = ['doc.', 'mode.', 'page.', 'canvas.', 'node.', 'property.', 'component.', 'plugin.'];
  check(
    'tools/list 覆盖阶段一 + 阶段三的八个域',
    domains.every((d) => names.some((n) => n.startsWith(d))),
    `${names.length} 个 Tool：${domains.map((d) => `${d}${names.filter((n) => n.startsWith(d)).length}`).join(' ')}`,
  );

  /* ── 文档域 ── */
  const doc = await c.call('doc.create', { title: '阶段三验证', docId: DOC_ID, mode: 'document', pageSize: 'A4' });
  check('doc.create', doc.body?.ok === true && doc.body?.data?.docId === DOC_ID, `docId=${doc.body?.data?.docId} degraded=${doc.body?.degraded}`);
  created.push(DOC_ID);

  const list = await c.call('doc.list', {});
  check('doc.list 能看到刚建的文档', list.body?.data?.docs?.some((d) => d.docId === DOC_ID), `${list.body?.data?.docs?.length} 份`);

  /* ── 节点域 ── */
  const h = await c.call('node.add', { type: 'heading', props: { text: '第一章 概述' } });
  const p = await c.call('node.add', { type: 'paragraph', props: { html: '这是正文段落。' } });
  const tbl = await c.call('node.add', { type: 'table' });
  const hId = h.body?.data?.id;
  const pId = p.body?.data?.id;
  const tId = tbl.body?.data?.id;
  check(
    'node.add ×3（heading / paragraph / table）',
    !!hId && !!pId && !!tId && h.body?.data?.index === 0 && p.body?.data?.index === 1,
    `ids=${[hId, pId, tId].join(', ')}`,
  );

  const got = await c.call('node.get', { id: hId });
  check('node.get 返回属性与 childCount', got.body?.data?.props?.text === '第一章 概述' && got.body?.data?.childCount === 0, JSON.stringify(got.body?.data));

  const setText = await c.call('node.setText', { id: pId, text: '改过的正文。' });
  const gotP = await c.call('node.get', { id: pId });
  check('node.setText 自动挑字段并写回', setText.body?.data?.key === 'html' && gotP.body?.data?.props?.html === '改过的正文。', `key=${setText.body?.data?.key}`);

  /* ── 属性域 ── */
  await c.call('property.set', { id: tId, key: 'cellPadding', value: 10 });
  const pg = await c.call('property.get', { id: tId, key: 'cellPadding' });
  check('property.set / get（单个属性）', pg.body?.data?.value === 10, JSON.stringify(pg.body?.data));

  const pb = await c.call('property.batchSet', { id: tId, patch: { borderWidth: 2, cellAlign: 'center' } });
  check('property.batchSet（多属性一次写）', pb.body?.data?.props?.borderWidth === 2 && pb.body?.data?.props?.cellAlign === 'center', JSON.stringify(pb.body?.data?.props));

  const val = await c.call('property.validate', { type: 'table', key: 'cellPadding', value: 999 });
  check('property.validate 没有 schema 时如实返回 valid=null（不假装通过）', val.body?.data?.valid === null, `valid=${JSON.stringify(val.body?.data?.valid)} note=${(val.body?.data?.note ?? '').slice(0, 30)}…`);

  const hint = await c.call('property.hint', { type: 'table', key: 'cellPadding' });
  check('property.hint 没有目录时如实说找不到', hint.body?.data?.found === false, `found=${hint.body?.data?.found}`);

  const reset = await c.call('property.reset', { id: tId, key: 'cellPadding' });
  const afterReset = await c.call('property.get', { id: tId, key: 'cellPadding' });
  check('property.reset 没有默认值目录时删除该属性并说明', afterReset.body?.data?.value === null && reset.body?.data?.source === 'deleted', `source=${reset.body?.data?.source}`);

  /* ── 页面域 ── */
  const p1 = await c.call('page.setSize', { size: 'A3' });
  check('page.setSize A3 → 297×420', p1.body?.data?.width === 297 && p1.body?.data?.height === 420, JSON.stringify(p1.body?.data));

  const p2 = await c.call('page.setOrientation', { orientation: 'landscape' });
  check('page.setOrientation 切换时交换宽高', p2.body?.data?.width === 420 && p2.body?.data?.height === 297, JSON.stringify(p2.body?.data));

  const p3 = await c.call('page.setMargin', { left: 20, top: 15 });
  check('page.setMargin 只改传入的边', p3.body?.data?.margin?.left === 20 && p3.body?.data?.margin?.top === 15 && p3.body?.data?.margin?.right === 31.7, JSON.stringify(p3.body?.data?.margin));

  const p4 = await c.call('page.setStyle', { defaultFont: '黑体', defaultFontSize: 14, lineHeight: 1.8 });
  check('page.setStyle', p4.body?.data?.defaultFont === '黑体' && p4.body?.data?.lineHeight === 1.8, JSON.stringify(p4.body?.data));

  const br = await c.call('page.addBreak', {});
  check('page.addBreak 插入 pageBreak 节点', br.body?.data?.type === 'pageBreak', `id=${br.body?.data?.id} index=${br.body?.data?.index}`);

  /* ── 画布域 ── */
  const d1 = await c.call('canvas.setDevice', { device: 'Mobile' });
  check('canvas.setDevice Mobile → 375×812', d1.body?.data?.width === 375 && d1.body?.data?.height === 812, JSON.stringify(d1.body?.data));
  const d2 = await c.call('canvas.setGrid', { show: true, size: 16, snap: false });
  check('canvas.setGrid', d2.body?.data?.showGrid === true && d2.body?.data?.gridSize === 16 && d2.body?.data?.snapToGrid === false, JSON.stringify(d2.body?.data));
  const d3 = await c.call('canvas.setSafeArea', { enabled: true });
  check('canvas.setSafeArea', d3.body?.data?.safeArea === true, JSON.stringify(d3.body?.data));

  /* ── 树 / 查找 / 移动 / 复制 / 层级 / 批量 ── */
  const tree = await c.call('node.tree', {});
  check('node.tree 返回树形', Array.isArray(tree.body?.data?.tree) && tree.body?.data?.tree?.length === 4, `${tree.body?.data?.tree?.length} 个顶层节点`);

  const col = await c.call('node.add', { type: 'columns', props: { count: 2 } });
  const colId = col.body?.data?.id;
  const moved = await c.call('node.move', { id: pId, newParentId: colId, index: 0 });
  const flat = await c.call('node.list', {});
  const movedRow = flat.body?.data?.nodes?.find((n) => n.id === pId);
  check('node.move 进容器后 parentId 正确', moved.body?.ok === true && movedRow?.parentId === colId, `parentId=${movedRow?.parentId}`);

  const cycle = await c.call('node.move', { id: colId, newParentId: pId });
  check('node.move 拒绝移到自己的子孙里（返回业务错误）', cycle.body?.ok === false, cycle.body?.error?.code ?? '(没有报错)');

  const dup = await c.call('node.duplicate', { id: colId });
  check('node.duplicate 生成新 id', dup.body?.ok === true && dup.body?.data?.id !== colId, `新 id=${dup.body?.data?.id}`);

  const back = await c.call('node.reorder', { id: tId, action: 'back' });
  check('node.reorder back → 下标 0', back.body?.data?.index === 0, JSON.stringify(back.body?.data));

  const bu = await c.call('node.batchUpdate', { ids: [hId, tId], props: { marginTop: 3 } });
  const hAfter = await c.call('node.get', { id: hId });
  check('node.batchUpdate 一次改多个', bu.body?.data?.count === 2 && hAfter.body?.data?.props?.marginTop === 3, `count=${bu.body?.data?.count}`);

  const find = await c.call('node.find', { type: 'heading' });
  check('node.find 按类型查找', find.body?.data?.total === 1 && find.body?.data?.matches?.[0]?.id === hId, JSON.stringify(find.body?.data));

  /* ── 破坏性操作的 confirm 闸门 ── */
  const noConfirm = await c.call('node.batchRemove', { ids: [dup.body?.data?.id], confirm: false });
  check('node.batchRemove 缺 confirm → CONFIRM_REQUIRED 且不执行', noConfirm.body?.ok === false && noConfirm.body?.error?.code === 'CONFIRM_REQUIRED', noConfirm.body?.error?.message);

  const noConfirmDoc = await c.call('doc.delete', { docId: DOC_ID });
  check('doc.delete 缺 confirm → CONFIRM_REQUIRED 且文件还在', noConfirmDoc.body?.error?.code === 'CONFIRM_REQUIRED' && fs.existsSync(path.join(pkgRoot, 'workspace', `${DOC_ID}.editor.json`)), noConfirmDoc.body?.error?.message);

  const rm = await c.call('node.batchRemove', { ids: [dup.body?.data?.id], confirm: true });
  check('node.batchRemove 带 confirm 才真的删', rm.body?.ok === true && rm.body?.data?.count === 1, JSON.stringify(rm.body?.data));

  /* ── 模式域 + 摘要 ── */
  const ms = await c.call('mode.set', { mode: 'web' });
  check('mode.set / mode.get（切到 web 且内容保留）', ms.body?.data?.mode === 'web' && (await c.call('mode.get', {})).body?.data?.mode === 'web', JSON.stringify(ms.body?.data));

  const sum = await c.call('doc.summary', { docId: DOC_ID });
  check(
    'doc.summary 分开统计两套内容（切到 web 后 documentNodes 仍保留、nodes 是当前模式）',
    sum.body?.data?.documentNodes >= 4 && sum.body?.data?.webNodes === 0 && sum.body?.data?.nodes === 0 && sum.body?.data?.words > 0,
    JSON.stringify(sum.body?.data),
  );

  /* ── 写开关（安全，规格 §10 / 验收 10）── */
  const ro = await startClient({ env: { EDITOR_MCP_ALLOW_WRITE: 'false' } });
  const blocked = await ro.call('doc.create', { title: '不该被创建' });
  const blockedDelete = await ro.call('node.remove', { id: 'x' });
  check(
    'ALLOW_WRITE=false 时写操作返回 WRITE_DISABLED（读操作不受影响）',
    blocked.body?.error?.code === 'WRITE_DISABLED' && blockedDelete.body?.error?.code === 'WRITE_DISABLED',
    `doc.create=${blocked.body?.error?.code} node.remove=${blockedDelete.body?.error?.code}`,
  );
  const roList = await ro.call('doc.list', {});
  check('只读模式下 doc.list 仍可用', roList.body?.ok === true, `${roList.body?.data?.docs?.length} 份`);
  ro.close();

  /* ── 找不到文档要如实报错 ── */
  const miss = await c.call('doc.get', { docId: 'no-such-doc-xyz' });
  check('doc.get 不存在的文档 → DOC_NOT_FOUND', miss.body?.ok === false && miss.body?.error?.code === 'DOC_NOT_FOUND', miss.body?.error?.message);

  /* ── 清理 ── */
  const del = await c.call('doc.delete', { docId: DOC_ID, confirm: true });
  check('doc.delete 带 confirm 删除成功', del.body?.ok === true && !fs.existsSync(path.join(pkgRoot, 'workspace', `${DOC_ID}.editor.json`)), JSON.stringify(del.body?.data));

  c.close();
} catch (e) {
  check('阶段三验证流程未抛异常', false, String(e?.stack ?? e));
} finally {
  // 兜底清理（哪怕中途失败也别留垃圾文档）
  for (const id of created) {
    const f = path.join(pkgRoot, 'workspace', `${id}.editor.json`);
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
  process.stdout.write(failures.length ? `\n结果：${failures.length} 条失败\n` : '\n结果：全部通过\n');
  process.exit(failures.length ? 1 : 0);
}
