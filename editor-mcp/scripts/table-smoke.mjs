/**
 * 阶段四验证：表格域（16 个）+ 组件注册表域 + 历史 / 选择 / 导出域。
 *
 *   node scripts/table-smoke.mjs
 *
 * 关键点：
 *   · 表格按 A1 记法操作，插删行列要**同步平移格式**（与编辑器同一规则）；
 *   · 注册表缺失时**不编造**：先断言"如实报错"，再放一个 component-catalog.json 进工作区，
 *     断言 list/get/schema/categories/defaults/search + property.validate/reset 全都活了；
 *   · 导出：json 无头可用；html/react/pdf 只有编辑器里实现 → 必须报 BRIDGE_OFFLINE，不许假装成功。
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeChecker, pkgRoot, startClient } from './mcp-client.mjs';

const { check, failures } = makeChecker();
const DOC_ID = `table-smoke-${Date.now().toString(36)}`;
const CATALOG = path.join(pkgRoot, 'workspace', 'component-catalog.json');
const hadCatalog = fs.existsSync(CATALOG);

try {
  const c = await startClient();
  const names = (await c.tools()).map((t) => t.name);
  const domains = ['table.', 'component.', 'history.', 'selection.', 'export.'];
  check(
    'tools/list 覆盖阶段四的五个域',
    domains.every((d) => names.some((n) => n.startsWith(d))),
    `${names.length} 个 Tool：${domains.map((d) => `${d}${names.filter((n) => n.startsWith(d)).length}`).join(' ')}`,
  );

  await c.call('doc.create', { title: '表格域验证', docId: DOC_ID, mode: 'document' });
  const tbl = await c.call('node.add', { type: 'table', props: { headerRow: true } });
  const id = tbl.body?.data?.id;

  /* ── 数据读写 ── */
  const setData = await c.call('table.setData', {
    id,
    data: [
      ['项目', '取值', '说明'],
      ['纸张', 'A4', '含 A3/A5'],
      ['版心', '25.4mm', '上下左右'],
    ],
  });
  const got = await c.call('table.getData', { id });
  check(
    'table.setData / getData（二维数组）',
    setData.body?.data?.rowCount === 3 && got.body?.data?.colCount === 3 && got.body?.data?.dataRowCount === 2 && got.body?.data?.headerRow === true,
    JSON.stringify({ ...got.body?.data, rows: undefined }),
  );

  const text = await c.call('table.setData', { id, data: '甲 | 乙\n丙 | 多行\\n第二行 | 含竖线\\|的格' });
  const gotText = await c.call('table.getData', { id, asText: true });
  const parsed = (await c.call('table.getData', { id })).body?.data?.rows;
  check(
    'table.setData 支持文本 + 转义（\\n 格内换行、\\| 格内竖线）',
    text.body?.ok === true && parsed?.[1]?.[1] === '多行\n第二行' && parsed?.[1]?.[2] === '含竖线|的格',
    `第2行=「${JSON.stringify(parsed?.[1])}」`,
  );

  await c.call('table.setData', { id, data: [['项目', '取值'], ['纸张', 'A4'], ['版心', '25.4mm']] });
  await c.call('table.setCell', { id, row: 1, col: 1, value: 'A3' });
  const cellNow = (await c.call('table.getData', { id })).body?.data?.rows?.[1]?.[1];
  check('table.setCell 写单个格子', cellNow === 'A3', `(1,1)=「${cellNow}」`);

  /* ── 插删行列 + 格式平移 ── */
  await c.call('table.setCellStyle', { id, range: 'B2', style: { background: '#fff2cc', fontWeight: 700 } });
  const beforeIns = await c.call('table.getData', { id });
  await c.call('table.insertRow', { id, at: 1 });
  const afterIns = await c.call('table.getData', { id });
  const stylesAfter = (await c.call('node.get', { id })).body?.data?.props?.cellStyles ?? {};
  check(
    'table.insertRow 插空行且把 B2 的格式平移到 B3',
    afterIns.body?.data?.rowCount === beforeIns.body?.data?.rowCount + 1 && !!stylesAfter.B3 && !stylesAfter.B2,
    `行 ${beforeIns.body?.data?.rowCount}→${afterIns.body?.data?.rowCount}；格式键=${Object.keys(stylesAfter).join(',')}`,
  );

  await c.call('table.deleteRow', { id, at: 1 });
  const backRows = (await c.call('table.getData', { id })).body?.data?.rowCount;
  const stylesBack = (await c.call('node.get', { id })).body?.data?.props?.cellStyles ?? {};
  check('table.deleteRow 之后行数与格式键都回到原样', backRows === beforeIns.body?.data?.rowCount && !!stylesBack.B2, `行数=${backRows}；键=${Object.keys(stylesBack).join(',')}`);

  const colsBefore = (await c.call('table.getData', { id })).body?.data?.colCount;
  await c.call('table.insertCol', { id, at: 1 });
  const afterColIns = await c.call('table.getData', { id });
  const widthsAfterIns = afterColIns.body?.data?.colWidths ?? [];
  const sumPct = widthsAfterIns.reduce((n, w) => n + (Number.parseFloat(w) || 0), 0);
  check(
    'table.insertCol 加列且列宽合计仍为 100%',
    afterColIns.body?.data?.colCount === colsBefore + 1 && Math.abs(sumPct - 100) < 1.5,
    `列 ${colsBefore}→${afterColIns.body?.data?.colCount}；列宽=${widthsAfterIns.join('/')} 合计=${sumPct.toFixed(1)}%`,
  );
  await c.call('table.deleteCol', { id, at: 1 });
  check('table.deleteCol 回到原列数', (await c.call('table.getData', { id })).body?.data?.colCount === colsBefore, `列数=${(await c.call('table.getData', { id })).body?.data?.colCount}`);

  const tooMany = await c.call('table.deleteRow', { id, at: 0, count: 9 });
  check('table.deleteRow 删过头 → 业务错误（至少留一行）', tooMany.body?.ok === false && tooMany.body?.error?.code === 'INVALID_PROP_VALUE', tooMany.body?.error?.message);

  /* ── 合并 / 拆分 / 格式 / 风格 / 列宽 ── */
  const merge = await c.call('table.mergeCells', { id, range: 'A2:B3' });
  const stylesMerged = (await c.call('node.get', { id })).body?.data?.props?.cellStyles ?? {};
  check(
    'table.mergeCells 写 A1 范围键（A2:B3）并给出 colSpan/rowSpan',
    merge.body?.data?.key === 'A2:B3' && merge.body?.data?.colSpan === 2 && merge.body?.data?.rowSpan === 2 && !!stylesMerged['A2:B3'],
    `键=${merge.body?.data?.key} colSpan=${merge.body?.data?.colSpan} rowSpan=${merge.body?.data?.rowSpan}`,
  );

  const split = await c.call('table.splitCells', { id, range: 'A2:B3' });
  const stylesSplit = (await c.call('node.get', { id })).body?.data?.props?.cellStyles ?? {};
  check('table.splitCells 去掉合并键', split.body?.ok === true && !stylesSplit['A2:B3'], `移除=${JSON.stringify(split.body?.data?.removed)}`);

  await c.call('table.setCellStyle', { id, range: 'A1:B1', style: { background: '#e8f1f9', align: 'center' } });
  const styled = (await c.call('node.get', { id })).body?.data?.props?.cellStyles ?? {};
  check('table.setCellStyle 逐格写（范围 → 多个单格键）', !!styled.A1 && !!styled.B1 && styled.A1.align === 'center', `键=${Object.keys(styled).join(',')}`);

  await c.call('table.clearCellStyle', { id, range: 'A1:B1' });
  const cleared = (await c.call('node.get', { id })).body?.data?.props?.cellStyles ?? {};
  check('table.clearCellStyle 清掉该范围的格式', !cleared.A1 && !cleared.B1, `剩余键=${Object.keys(cleared).join(',') || '（空）'}`);

  const variant = await c.call('table.setVariant', { id, variant: 'threeLine' });
  check('table.setVariant', variant.body?.data?.variant === 'threeLine', JSON.stringify(variant.body?.data));

  const colw = await c.call('table.setColWidths', { id, widths: '20,50,30' });
  check('table.setColWidths 纯数字按百分比', JSON.stringify(colw.body?.data?.colWidths) === JSON.stringify(['20%', '50%', '30%']), JSON.stringify(colw.body?.data?.colWidths));

  const fit = await c.call('table.autoFit', { id });
  check('table.autoFit 给出列宽并说明"无头按内容估算"', Array.isArray(fit.body?.data?.colWidths) && !!fit.body?.data?.note, `列宽=${(fit.body?.data?.colWidths ?? []).join('/')}`);

  const sel = await c.call('table.setCellSelection', { id, range: 'A2:B3' });
  const selGet = await c.call('table.getCellSelection', { id });
  check('table.setCellSelection / getCellSelection', sel.body?.data?.cells === 4 && selGet.body?.data?.cells?.length === 4, `选区 ${selGet.body?.data?.cells?.length} 格`);

  /* ── 注册表域：没有目录时必须如实报错 ── */
  if (!hadCatalog) {
    const noCat = await c.call('component.schema', { type: 'table' });
    check(
      'component.schema 没有组件目录 → BRIDGE_OFFLINE（不编造 schema）',
      noCat.body?.ok === false && noCat.body?.error?.code === 'BRIDGE_OFFLINE',
      noCat.body?.error?.message,
    );
  }

  /* ── 放一份组件目录进工作区，验证注册表域 + 属性校验全活 ── */
  fs.mkdirSync(path.dirname(CATALOG), { recursive: true });
  fs.writeFileSync(
    CATALOG,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        components: [
          { type: 'table', label: '表格', category: 'Excel 表格', supportedModes: ['document', 'web'], description: '真实 table 元素' },
          { type: 'heading', label: '标题', category: 'Word 常用', supportedModes: ['document', 'web'], description: 'h1–h6' },
        ],
        defaults: { table: { cellPadding: 6, variant: 'normal' }, heading: { text: '标题文字', level: '2' } },
        schemas: {
          table: [
            { key: 'cellPadding', label: '内边距（默认值）', control: 'number', group: '表格', defaultValue: 6, min: 0, max: 24 },
            { key: 'variant', label: '线条风格', control: 'select', group: '表格', defaultValue: 'normal', options: [{ label: '全框线', value: 'normal' }] },
          ],
          heading: [{ key: 'level', label: '级别', control: 'select', group: '内容', defaultValue: '2', options: [{ label: 'H1', value: '1' }, { label: 'H2', value: '2' }] }],
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const cat = await c.call('component.list', {});
  check('component.list 读到目录（内置组件来自 catalog）', cat.body?.data?.sources?.some((s) => s.startsWith('catalog')), `sources=${JSON.stringify(cat.body?.data?.sources)} total=${cat.body?.data?.total}`);

  const one = await c.call('component.get', { type: 'table' });
  check('component.get 给出默认属性与 schema 项数', one.body?.data?.label === '表格' && one.body?.data?.defaults?.cellPadding === 6 && one.body?.data?.schemaCount === 2, JSON.stringify({ label: one.body?.data?.label, schemaCount: one.body?.data?.schemaCount }));

  const schema = await c.call('component.schema', { type: 'table' });
  check('component.schema 返回属性项', schema.body?.data?.count === 2 && schema.body?.data?.schema?.[0]?.key === 'cellPadding', `count=${schema.body?.data?.count}`);

  const cats = await c.call('component.categories', {});
  check('component.categories 按分类计数', cats.body?.data?.categories?.length === 2, JSON.stringify(cats.body?.data?.categories));

  const defs = await c.call('component.defaults', { type: 'heading' });
  check('component.defaults', defs.body?.data?.defaults?.text === '标题文字', JSON.stringify(defs.body?.data?.defaults));

  const search = await c.call('component.search', { query: '表' });
  check('component.search 模糊搜索', search.body?.data?.hits?.some((h) => h.type === 'table'), `命中 ${search.body?.data?.total}`);

  const bad = await c.call('property.validate', { type: 'table', key: 'cellPadding', value: 99 });
  const good = await c.call('property.validate', { type: 'table', key: 'cellPadding', value: 8 });
  const badOpt = await c.call('property.validate', { type: 'heading', key: 'level', value: '9' });
  check(
    'property.validate 有 schema 时真的校验（越界/非法枚举都拦下来）',
    bad.body?.data?.valid === false && good.body?.data?.valid === true && badOpt.body?.data?.valid === false,
    `99→${bad.body?.data?.valid}（${bad.body?.data?.problems?.[0] ?? ''}）、8→${good.body?.data?.valid}、level=9→${badOpt.body?.data?.valid}`,
  );

  const hint = await c.call('property.hint', { type: 'table', key: 'cellPadding' });
  check('property.hint 有目录时给出 label/控件/范围', hint.body?.data?.found === true && hint.body?.data?.control === 'number', JSON.stringify(hint.body?.data));

  /* ── 历史域 ── */
  const stack0 = await c.call('history.stack', {});
  const undo1 = await c.call('history.undo', { steps: 1 });
  check('history.undo 走快照栈并落盘', stack0.body?.data?.size > 0 && undo1.body?.ok === true, `栈 ${stack0.body?.data?.size} 步，游标 ${stack0.body?.data?.cursor} → ${undo1.body?.data?.cursor}`);
  const redo1 = await c.call('history.redo', { steps: 1 });
  check('history.redo 回到下一条快照', redo1.body?.ok === true && redo1.body?.data?.cursor === undo1.body?.data?.cursor + 1, `游标 ${undo1.body?.data?.cursor} → ${redo1.body?.data?.cursor}`);
  const snap = await c.call('history.snapshot', { label: '手动' });
  const restore = await c.call('history.restore', { snapshotId: 0 });
  check('history.snapshot / restore', snap.body?.ok === true && restore.body?.data?.restored === 0, `快照 ${snap.body?.data?.size} 步；恢复到 #0`);
  const noConfirm = await c.call('history.clear', {});
  check('history.clear 缺 confirm → CONFIRM_REQUIRED', noConfirm.body?.error?.code === 'CONFIRM_REQUIRED', noConfirm.body?.error?.message);

  /* ── 选择域 ── */
  const setSel = await c.call('selection.set', { ids: [id] });
  const getSel = await c.call('selection.get', {});
  check('selection.set / get（无头只记录在服务端并如实说明）', setSel.body?.ok === true && getSel.body?.data?.ids?.[0] === id, JSON.stringify(getSel.body?.data?.ids));
  const focus = await c.call('selection.focus', { id });
  check('selection.focus 需要编辑器在线 → BRIDGE_OFFLINE', focus.body?.error?.code === 'BRIDGE_OFFLINE', focus.body?.error?.message);
  await c.call('selection.clear', {});

  /* ── 导出域 ── */
  const jsonNoPath = await c.call('export.json', {});
  const jsonPath = await c.call('export.json', { path: `${DOC_ID}-export.json` });
  check(
    'export.json：不给 path 返回内容、给 path 写到工作区',
    jsonNoPath.body?.data?.bytes > 0 && !!jsonPath.body?.data?.path && fs.existsSync(jsonPath.body?.data?.path),
    `${jsonNoPath.body?.data?.bytes} 字节；落盘 ${path.basename(jsonPath.body?.data?.path ?? '')}`,
  );
  const html = await c.call('export.html', {});
  const react = await c.call('export.react', {});
  const pdf = await c.call('export.pdf', {});
  check(
    'export.html / react / pdf 无编辑器时如实报 BRIDGE_OFFLINE（不假装成功）',
    [html, react, pdf].every((r) => r.body?.error?.code === 'BRIDGE_OFFLINE'),
    [html, react, pdf].map((r) => r.body?.error?.code).join(' / '),
  );
  const spec = await c.call('export.spec', { path: `${DOC_ID}-spec.md` });
  check(
    'export.spec 无编辑器时用组件目录生成精简版并标注差异',
    spec.body?.ok === true && spec.body?.data?.source === 'catalog' && fs.existsSync(spec.body?.data?.path),
    `${spec.body?.data?.bytes} 字节 source=${spec.body?.data?.source}`,
  );

  /* ── 清理 ── */
  await c.call('doc.delete', { docId: DOC_ID, confirm: true });
  for (const f of [`${DOC_ID}-export.json`, `${DOC_ID}-spec.md`]) fs.rmSync(path.join(pkgRoot, 'workspace', f), { force: true });
  c.close();
} catch (e) {
  check('阶段四验证流程未抛异常', false, String(e?.stack ?? e));
} finally {
  fs.rmSync(path.join(pkgRoot, 'workspace', `${DOC_ID}.editor.json`), { force: true });
  if (!hadCatalog) fs.rmSync(CATALOG, { force: true }); // 我放的测试目录要收走
  process.stdout.write(failures.length ? `\n结果：${failures.length} 条失败\n` : '\n结果：全部通过\n');
  process.exit(failures.length ? 1 : 0);
}
