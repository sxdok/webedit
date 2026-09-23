/**
 * 阶段六验证：Resources（含 Templates 与 Subscriptions）+ Prompts。
 *
 *   node scripts/rpc-smoke.mjs
 *
 * 用原始 JSON-RPC 直接打 resources/* 与 prompts/*（不走 Tool 封装），
 * 这样才能验证"协议层"是否正确暴露：
 *   resources/list、resources/templates/list、resources/read（静态 + 带变量）、
 *   resources/subscribe + 写操作后收到 notifications/resources/updated、
 *   prompts/list、prompts/get（检查 messages 里确实带上了工具编排与约束）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeChecker, pkgRoot, startClient } from './mcp-client.mjs';

const { check, failures } = makeChecker();
const DOC_ID = `rpc-smoke-${Date.now().toString(36)}`;

try {
  const c = await startClient({ env: { EDITOR_MCP_PLUGIN_DIR: path.join(pkgRoot, 'workspace', '_plugin-test-rpc') } });

  /* ── resources/list ── */
  const list = await c.raw('resources/list', {});
  const uris = (list.result?.resources ?? []).map((r) => r.uri);
  check(
    'resources/list 暴露静态资源（文档/页面/画布/组件/规格/插件/状态）',
    ['editor://document/current', 'editor://page/config', 'editor://canvas/config', 'editor://component/catalog', 'editor://spec/components', 'editor://spec/contract', 'editor://plugin/list', 'editor://plugin/manifest', 'editor://selection/current', 'editor://bridge/status'].every((u) => uris.includes(u)),
    `${uris.length} 个静态资源：${uris.slice(0, 6).join(', ')}…`,
  );
  check(
    'resources/list 也列出 4 个插件模板',
    ['basic', 'form', 'chart', 'container'].every((k) => uris.includes(`editor://plugin/template/${k}`)),
    uris.filter((u) => u.includes('template')).join(', '),
  );

  /* ── resources/templates/list ── */
  const tpl = await c.raw('resources/templates/list', {});
  const tplUris = (tpl.result?.resourceTemplates ?? []).map((t) => t.uriTemplate);
  check(
    'resources/templates/list 暴露带变量的资源（文档/组件/插件）',
    ['editor://document/{docId}', 'editor://document/{docId}/tree', 'editor://component/{type}/schema', 'editor://plugin/{name}/source'].every((u) => tplUris.includes(u)),
    `${tplUris.length} 个模板：${tplUris.join(', ')}`,
  );

  /* ── 建一份文档，再读各种资源 ── */
  await c.call('doc.create', { title: '资源验证', docId: DOC_ID, mode: 'document' });
  await c.call('node.add', { type: 'heading', props: { text: '资源验证标题' } });

  const read = (uri) => c.raw('resources/read', { uri });
  const docCur = await read('editor://document/current');
  const docText = docCur.result?.contents?.[0]?.text ?? '';
  check('resources/read editor://document/current 返回文档 JSON', docText.includes('资源验证') && docText.includes('"document"'), `${docText.length} 字符`);

  const tree = await read(`editor://document/${DOC_ID}/tree`);
  check('带变量的资源可读：document/{docId}/tree', (tree.result?.contents?.[0]?.text ?? '').includes('heading'), (tree.result?.contents?.[0]?.text ?? '').slice(0, 80).replace(/\n/g, ' '));

  const pageCfg = await read('editor://page/config');
  check('editor://page/config 返回页面配置（含纸张尺寸）', (pageCfg.result?.contents?.[0]?.text ?? '').includes('A4'), (pageCfg.result?.contents?.[0]?.text ?? '').slice(0, 60).replace(/\n/g, ' '));

  const bridge = await read('editor://bridge/status');
  const bridgeText = bridge.result?.contents?.[0]?.text ?? '';
  check('editor://bridge/status 如实报告未连桥接 + 降级原因', bridgeText.includes('"mode": "headless"') && bridgeText.includes('hint'), bridgeText.slice(0, 100).replace(/\n/g, ' '));

  const contract = await read('editor://spec/contract');
  const contractText = contract.result?.contents?.[0]?.text ?? '';
  check('editor://spec/contract 是 Markdown（含 ts 代码块与注意事项）', contract.result?.contents?.[0]?.mimeType === 'text/markdown' && contractText.includes('ComponentDefinition'), `${contractText.length} 字符`);

  const tplRead = await read('editor://plugin/template/container');
  check('editor://plugin/template/container 返回可用的骨架源码', (tplRead.result?.contents?.[0]?.text ?? '').includes('isContainer'), (tplRead.result?.contents?.[0]?.text ?? '').slice(0, 50).replace(/\n/g, ' '));

  const badRead = await read('editor://document/no-such-doc');
  check('读不存在的文档资源 → 返回 error 正文而不是崩', (badRead.result?.contents?.[0]?.text ?? '').includes('DOC_NOT_FOUND'), (badRead.result?.contents?.[0]?.text ?? '').slice(0, 60).replace(/\n/g, ' '));

  /* ── 订阅：subscribe 后写操作应推送 resources/updated ── */
  const sub = await c.raw('resources/subscribe', { uri: 'editor://document/current' });
  check('resources/subscribe 被接受（自己注册的 handler）', sub.result !== undefined || sub.error === undefined, JSON.stringify(sub.result ?? sub.error));
  const before = c.notifications().length;
  await c.call('node.add', { type: 'paragraph', props: { html: '触发一次写操作' } });
  await new Promise((r) => setTimeout(r, 400));
  const notes = c.notifications().slice(before).filter((n) => n.method === 'notifications/resources/updated');
  check(
    '写操作后推送 notifications/resources/updated（订阅生效）',
    notes.length > 0 && notes.some((n) => n.params?.uri === 'editor://document/current'),
    `${notes.length} 条更新通知：${notes.map((n) => n.params?.uri).join(', ')}`,
  );
  await c.raw('resources/unsubscribe', { uri: 'editor://document/current' });

  /* ── prompts ── */
  const prompts = await c.raw('prompts/list', {});
  const pNames = (prompts.result?.prompts ?? []).map((p) => p.name);
  const want = ['create_document', 'html_to_document', 'create_slide', 'build_web_page', 'add_table', 'fill_table', 'format_document', 'register_plugin', 'debug_plugin', 'iterate_plugin', 'export_all', 'spec_to_component'];
  check('prompts/list 暴露规格要求的 11 个 Prompt（+ 后加的 html_to_document，共 12）', want.every((n) => pNames.includes(n)) && pNames.length === want.length, `${pNames.length} 个：${pNames.join(', ')}`);

  const p1 = await c.raw('prompts/get', { name: 'register_plugin', arguments: { description: '状态卡片', name: 'liveStatusCard' } });
  const m1 = (p1.result?.messages ?? []).map((m) => m.content?.text ?? '').join('\n');
  check(
    'prompts/get register_plugin 带上工具编排与插件约束',
    m1.includes('plugin.create') && m1.includes('plugin.dryRun') && m1.includes('live 开头') && m1.includes('React.createElement'),
    len(m1),
  );

  const p2 = await c.raw('prompts/get', { name: 'create_document', arguments: { title: '测试文档', outline: '一、甲\n二、乙' } });
  const m2 = (p2.result?.messages ?? []).map((m) => m.content?.text ?? '').join('\n');
  check('prompts/get create_document 串起 doc.create → node.add → export.json', m2.includes('doc.create') && m2.includes('node.add') && m2.includes('export.json') && m2.includes('测试文档'), len(m2));

  const p3 = await c.raw('prompts/get', { name: 'add_table', arguments: { rows: '4', cols: '3' } });
  const m3 = (p3.result?.messages ?? []).map((m) => m.content?.text ?? '').join('\n');
  check('prompts/get add_table 说明 A1 记法与转义规则', m3.includes('table.setData') && m3.includes('A1') && m3.includes('\\n'), len(m3));

  /* ── 清理 ── */
  await c.call('doc.delete', { docId: DOC_ID, confirm: true });
  c.close();
} catch (e) {
  check('阶段六验证流程未抛异常', false, String(e?.stack ?? e));
} finally {
  fs.rmSync(path.join(pkgRoot, 'workspace', `${DOC_ID}.editor.json`), { force: true });
  fs.rmSync(path.join(pkgRoot, 'workspace', '_plugin-test-rpc'), { recursive: true, force: true });
  process.stdout.write(failures.length ? `\n结果：${failures.length} 条失败\n` : '\n结果：全部通过\n');
  process.exit(failures.length ? 1 : 0);
}

function len(s) {
  return `${s.length} 字符`;
}
