/**
 * 阶段五验证：插件域 20 个 Tool（规格 §5.12，重点域）。
 *
 *   node scripts/plugin-smoke.mjs
 *
 * ★用**临时插件目录**（EDITOR_MCP_PLUGIN_DIR 指向 workspace/_plugin-test），
 *   绝不碰编辑器真实的 `web-editor/public/组件/`（那里有 3 个真实插件）。
 *
 * 覆盖：模板/静态校验（语法·契约·live 前缀·禁用依赖）/创建/读取/沙箱 dryRun（含死循环超时）/
 *       覆盖备份（保留最近 5 个）/局部替换/依赖分析/清单增删改查/重命名/导入/导出/删除(confirm)/
 *       重载（编辑器不在线时如实降级）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeChecker, pkgRoot, startClient } from './mcp-client.mjs';

const { check, failures } = makeChecker();
const TMP_DIR = path.join(pkgRoot, 'workspace', '_plugin-test');
const EXPORT_FILE = 'plugin-export-test.js';

try {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // ★必须显式打开写权限：P0 决策 #2 把 `EDITOR_MCP_ALLOW_WRITE` 默认设为 **false**（写操作默认拒绝），
  //   而这套 smoke 全在**本机临时目录**里造插件（不碰编辑器真实组件目录）。
  //   产品默认是"只读"，测试要显式申请写权限 —— 忘了这句话的表现是"整套 smoke 静默全红"。
  const c = await startClient({ env: { EDITOR_MCP_PLUGIN_DIR: TMP_DIR, EDITOR_MCP_ALLOW_WRITE: 'true' } });
  const names = (await c.tools()).map((t) => t.name);
  const pluginTools = names.filter((n) => n.startsWith('plugin.'));
  check(
    'tools/list 有全部 20 个 plugin.* Tool',
    pluginTools.length === 20,
    `${names.length} 个 Tool，其中 plugin.* ${pluginTools.length} 个`,
  );

  /* ── 契约与模板 ── */
  const types = await c.call('plugin.types', {});
  const contract = types.body?.data?.contract ?? '';
  check(
    'plugin.types 返回契约声明（含 ComponentDefinition / live 前缀 / children 说明）',
    contract.includes('interface ComponentDefinition') && contract.includes('live 开头') && contract.includes('children'),
    `${contract.length} 字符，${(types.body?.data?.notes ?? []).length} 条注意事项`,
  );

  for (const kind of ['basic', 'form', 'chart', 'container']) {
    const tpl = await c.call('plugin.template', { kind, name: `demo-${kind}`, label: `演示${kind}` });
    const v = await c.call('plugin.validate', { source: tpl.body?.data?.source });
    check(`plugin.template ${kind} 生成的骨架能通过静态校验`, tpl.body?.ok === true && v.body?.data?.ok === true, `type=${tpl.body?.data?.type}；问题=${(v.body?.data?.problems ?? []).length}`);
  }

  /* ── 静态校验的四类问题 ── */
  const badSyntax = await c.call('plugin.validate', { source: 'this is not js ((( ' });
  const noRegister = await c.call('plugin.validate', { source: "const a = 1; // 没有 register" });
  const badType = await c.call('plugin.validate', {
    source: "(function(){window.EditorKit.register({type:'myWidget',label:'x',category:'通用',supportedModes:['document'],propSchema:[],render:()=>null});})();",
  });
  const badDeps = await c.call('plugin.validate', {
    source: "const fs=require('fs');window.EditorKit.register({type:'liveX',label:'x',category:'通用',supportedModes:['document'],propSchema:[],render:()=>null});",
  });
  const codes = (r) => (r.body?.data?.problems ?? []).map((p) => p.code);
  check('plugin.validate 抓语法错误（PLUGIN_SYNTAX_ERROR）', codes(badSyntax).includes('PLUGIN_SYNTAX_ERROR'), codes(badSyntax).join(','));
  check('plugin.validate 抓"没调用 register"（PLUGIN_CONTRACT_ERROR）', codes(noRegister).includes('PLUGIN_CONTRACT_ERROR'), codes(noRegister).join(','));
  check('plugin.validate 抓非 live 前缀（PLUGIN_TYPE_PREFIX）', codes(badType).includes('PLUGIN_TYPE_PREFIX'), codes(badType).join(','));
  check('plugin.validate 抓沙箱里没有的依赖（require）', codes(badDeps).includes('PLUGIN_DEPS'), codes(badDeps).join(','));

  /* ── 创建 / 读取 / 列表 ── */
  const create = await c.call('plugin.create', { name: 'liveSmokeCard', label: '冒烟卡片', category: '通用', kind: 'basic' });
  const created = create.body?.data;
  check(
    'plugin.create 生成骨架 + 进清单 + 自校验通过',
    create.body?.ok === true && created?.type === 'liveLiveSmokeCard' && created?.addedToManifest === true && created?.validate?.ok === true && fs.existsSync(created?.file),
    `type=${created?.type}；文件=${path.basename(created?.file ?? '')}；${created?.bytes} 字节`,
  );
  const manifestAfterCreate = JSON.parse(fs.readFileSync(path.join(TMP_DIR, '_manifest.json'), 'utf8'));
  check(
    '创建后清单里有它（且是**规范形状** {files:[…]}，不是裸数组 —— §6.4.5）',
    !Array.isArray(manifestAfterCreate) && Array.isArray(manifestAfterCreate?.files) && manifestAfterCreate.files.includes('liveSmokeCard.js'),
    JSON.stringify(manifestAfterCreate),
  );

  const got = await c.call('plugin.get', { name: 'liveSmokeCard' });
  check('plugin.get 返回源码与校验结果', got.body?.data?.bytes > 0 && typeof got.body?.data?.source === 'string' && got.body?.data?.inManifest === true, `${got.body?.data?.bytes} 字节`);

  const list = await c.call('plugin.list', {});
  check('plugin.list 扫到临时目录里的插件', list.body?.data?.total === 1 && list.body?.data?.plugins?.[0]?.name === 'liveSmokeCard', `dir=${path.basename(list.body?.data?.dir)} total=${list.body?.data?.total}`);

  /* ── 沙箱 dryRun ── */
  const dry = await c.call('plugin.dryRun', { name: 'liveSmokeCard' });
  check(
    'plugin.dryRun 在沙箱里执行并 SSR 出 HTML（不开编辑器）',
    dry.body?.ok === true && typeof dry.body?.data?.html === 'string' && dry.body?.data?.html.includes('冒烟卡片') && dry.body?.data?.def?.hasRender === true,
    `${dry.body?.data?.htmlBytes} 字节 HTML；propKeys=${JSON.stringify(dry.body?.data?.def?.propKeys)}`,
  );

  const dryProps = await c.call('plugin.dryRun', { name: 'liveSmokeCard', props: { text: '换一段文字', fontSize: 20 } });
  check('plugin.dryRun 支持传 props 试不同取值', dryProps.body?.data?.html?.includes('换一段文字'), `HTML 含新文字=${dryProps.body?.data?.html?.includes('换一段文字')}`);

  const loop = await c.call('plugin.dryRun', {
    source: "window.EditorKit.register({type:'liveLoop',label:'死循环',category:'通用',supportedModes:['document'],propSchema:[],render:()=>null});while(true){}",
  });
  const afterLoop = await c.call('plugin.template', { kind: 'basic' });
  check(
    'plugin.dryRun 遇到死循环 → 3 秒超时返回 PLUGIN_DRYRUN_FAILED，且服务器没崩',
    loop.body?.error?.code === 'PLUGIN_DRYRUN_FAILED' && /超时/.test(loop.body?.error?.message ?? '') && afterLoop.body?.ok === true,
    `code=${loop.body?.error?.code}；超时后仍能正常调用=${afterLoop.body?.ok}`,
  );

  const broken = await c.call('plugin.dryRun', {
    source: "window.EditorKit.register({type:'liveBoom',label:'渲染抛错',category:'通用',supportedModes:['document'],propSchema:[],defaultProps:{},render(){throw new Error('故意抛错')}});",
  });
  check('plugin.dryRun 渲染抛错也如实返回（不崩）', broken.body?.ok === false && broken.body?.error?.code === 'PLUGIN_DRYRUN_FAILED', broken.body?.error?.message);

  /* ── 覆盖 + 备份保留 ── */
  const original = got.body?.data?.source ?? '';
  const firstUpdate = await c.call('plugin.update', { name: 'liveSmokeCard', source: `${original}\n// 第一次改动` });
  check('plugin.update 覆盖前自动备份', firstUpdate.body?.data?.backup?.includes('.bak.'), path.basename(firstUpdate.body?.data?.backup ?? '（无备份）'));

  for (let i = 2; i <= 7; i += 1) {
    await new Promise((r) => setTimeout(r, 30)); // 备份文件名带秒级时间戳，错开一点避免同名
    await c.call('plugin.update', { name: 'liveSmokeCard', source: `${original}\n// 第 ${i} 次改动` });
  }
  const backups = fs.readdirSync(TMP_DIR).filter((f) => f.startsWith('liveSmokeCard.js.bak.'));
  check('备份数量不超过 5 个（超出的自动清理最旧的）', backups.length <= 5 && backups.length >= 1, `${backups.length} 个备份`);

  /* ── 局部替换 ── */
  // ★锚点要选**唯一且会被渲染**的：`text: '…',` 只出现在 defaultProps（schema 里那行是 defaultValue: '…'）
  const patchOk = await c.call('plugin.patch', { name: 'liveSmokeCard', find: "text: '冒烟卡片 的默认文字',", replace: "text: '改过的默认文字'," });
  const dryAfterPatch = await c.call('plugin.dryRun', { name: 'liveSmokeCard' });
  check(
    'plugin.patch 按唯一锚点替换一处并生效（渲染结果变了）',
    patchOk.body?.ok === true && dryAfterPatch.body?.data?.html?.includes('改过的默认文字'),
    `备份=${path.basename(patchOk.body?.data?.backup ?? '（无）')}；HTML=${(dryAfterPatch.body?.data?.html ?? '').slice(0, 60)}`,
  );
  // 「冒烟卡片」这个词在 label / description / schema 默认值里出现多次 → 必须被拒绝
  const patchDup = await c.call('plugin.patch', { name: 'liveSmokeCard', find: '冒烟卡片', replace: 'x' });
  check('plugin.patch 原文不唯一时拒绝（避免改错位置）', patchDup.body?.ok === false, patchDup.body?.error?.message);

  /* ── 依赖分析 ── */
  const deps = await c.call('plugin.deps', { name: 'liveSmokeCard' });
  check(
    'plugin.deps 列出用到的 EditorKit 助手并给结论',
    deps.body?.ok === true && deps.body?.data?.editorKitHelpers?.length > 0 && deps.body?.data?.verdict?.includes('符合'),
    `助手=${JSON.stringify(deps.body?.data?.editorKitHelpers)}；结论=${deps.body?.data?.verdict}`,
  );

  /* ── 清单操作 ── */
  await c.call('plugin.manifest.remove', { name: 'liveSmokeCard' });
  const removed = JSON.parse(fs.readFileSync(path.join(TMP_DIR, '_manifest.json'), 'utf8'));
  const added = await c.call('plugin.manifest.add', { name: 'liveSmokeCard' });
  const setMf = await c.call('plugin.manifest.set', { list: ['liveSmokeCard.js', 'not-exist.js'] });
  const mfGet = await c.call('plugin.manifest.get', {});
  check(
    'plugin.manifest.add/remove/set/get（含"清单里有但文件不存在"的提示）',
    Array.isArray(removed?.files) && removed.files.length === 0 && added.body?.data?.added === true && setMf.body?.data?.missingFiles?.includes('not-exist.js') && mfGet.body?.data?.files?.length === 2,
    `磁盘清单=${JSON.stringify(removed)}；缺失文件提示=${JSON.stringify(setMf.body?.data?.missingFiles)}`,
  );

  /* ── 导出 / 导入 / 重命名 / 删除 ── */
  const exp = await c.call('plugin.export', { name: 'liveSmokeCard', path: EXPORT_FILE });
  check('plugin.export 导出到工作区', fs.existsSync(path.join(pkgRoot, 'workspace', EXPORT_FILE)), `${exp.body?.data?.bytes} 字节`);

  const imp = await c.call('plugin.import', { source: path.join(pkgRoot, 'workspace', EXPORT_FILE), name: 'liveImported' });
  check('plugin.import 从本地文件导入（先校验契约）', imp.body?.ok === true && fs.existsSync(path.join(TMP_DIR, 'liveImported.js')), `origin=${(imp.body?.data?.origin ?? '').slice(0, 24)}…`);

  // 已存在且没传 overwrite → 拒绝；传了 overwrite → 覆盖成功
  const impExists = await c.call('plugin.import', { source: path.join(pkgRoot, 'workspace', EXPORT_FILE), name: 'liveImported' });
  const impOver = await c.call('plugin.import', { source: path.join(pkgRoot, 'workspace', EXPORT_FILE), name: 'liveImported', overwrite: true });
  check(
    'plugin.import 已存在时需 overwrite: true（否则拒绝）',
    impExists.body?.ok === false && impOver.body?.ok === true,
    `不传=${impExists.body?.error?.code ?? '（竟然成功）'}；传 overwrite 后备份=${path.basename(impOver.body?.data?.backup ?? '（无）')}`,
  );

  // 内容不合格 → 拒绝（先造一个坏文件）
  const badFile = path.join(pkgRoot, 'workspace', 'bad-plugin-test.js');
  fs.writeFileSync(badFile, 'not a plugin', 'utf8');
  const impBad = await c.call('plugin.import', { source: badFile, name: 'liveBadImport' });
  check('plugin.import 拒绝不合格内容（PLUGIN_CONTRACT_ERROR）', impBad.body?.ok === false && impBad.body?.error?.code === 'PLUGIN_CONTRACT_ERROR', impBad.body?.error?.message?.slice(0, 40));
  fs.rmSync(badFile, { force: true });

  const ren = await c.call('plugin.rename', { name: 'liveImported', newName: 'liveRenamed', confirm: true });
  const renNoConfirm = await c.call('plugin.rename', { name: 'liveRenamed', newName: 'liveX' });
  check(
    'plugin.rename 需 confirm 且同步清单',
    ren.body?.ok === true && fs.existsSync(path.join(TMP_DIR, 'liveRenamed.js')) && renNoConfirm.body?.error?.code === 'CONFIRM_REQUIRED',
    `→ ${ren.body?.data?.to}；缺 confirm=${renNoConfirm.body?.error?.code}`,
  );

  const delNoConfirm = await c.call('plugin.delete', { name: 'liveRenamed' });
  const del = await c.call('plugin.delete', { name: 'liveRenamed', confirm: true });
  check(
    'plugin.delete 需 confirm，删后文件消失',
    delNoConfirm.body?.error?.code === 'CONFIRM_REQUIRED' && del.body?.ok === true && !fs.existsSync(path.join(TMP_DIR, 'liveRenamed.js')),
    `缺 confirm=${delNoConfirm.body?.error?.code}；删除后仍在=${fs.existsSync(path.join(TMP_DIR, 'liveRenamed.js'))}`,
  );

  /* ── 重载（编辑器不在线）── */
  const reload = await c.call('plugin.reload', {});
  check(
    'plugin.reload 编辑器不在线时如实降级并说明"需手动重载"',
    reload.body?.ok === true && reload.body?.degraded === true && /重载/.test(reload.body?.data?.note ?? ''),
    reload.body?.data?.note?.slice(0, 46),
  );

  /* ── 日志缓冲 ── */
  const logs = await c.call('plugin.logs', {});
  check('plugin.logs 返回环形缓冲（dryRun 期间的 console 也会进）', logs.body?.ok === true && Array.isArray(logs.body?.data?.entries), `${logs.body?.data?.count} 条`);

  c.close();
} catch (e) {
  check('阶段五验证流程未抛异常', false, String(e?.stack ?? e));
} finally {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(pkgRoot, 'workspace', EXPORT_FILE), { force: true });
  process.stdout.write(failures.length ? `\n结果：${failures.length} 条失败\n` : '\n结果：全部通过\n');
  process.exit(failures.length ? 1 : 0);
}
