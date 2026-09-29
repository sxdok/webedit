/**
 * 契约生成器（ARCHITECTURE §5.1 / §10.3，P1 子项③）。
 *
 *   node tools/sync-contracts.mjs            # 生成（幂等）
 *   node tools/sync-contracts.mjs --check    # 只校验：与磁盘不一致就退出码 1（进闸门用）
 *
 * 生成的四处（**都不要手改**）：
 *   · `contracts/version.json`            —— 版本 + 桥接协议（对外版本的机器可读投影）
 *   · `contracts/bridge-methods.json`     —— MCP 工具名清单 + 编辑器 live 方法清单
 *   · `editor-mcp/src/version.ts`         —— 供 MCP 直接 `import { VERSION }`
 *   · `web-editor/src/version.ts`         —— 供页面直接 `import { VERSION }`
 * 同步的三处 `package.json` 版本号（三个包必须与根一致，否则发行物/诊断/更新会各说各话）。
 *
 * ★为什么用"生成 + --check 断言"而不是现在就把版本搬进共享包：
 *   P1 的结论是**先不改目录**，用生成物 + 断言消除漂移；等 P2 的 `contracts/` 编排落地后再谈共享包。
 * ★为什么不写时间戳：生成物带时间戳会让 `--check` 永远失败（每次生成都不同），也会让 diff 噪音满屏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

/** 唯一版本源 */
const rootPkg = readJson('package.json');
const VERSION = String(rootPkg.version);

/** 桥接协议版本：从 MCP 的判据模块里读（那里是唯一权威，页面侧由 verify 断言一致） */
const protocolSrc = read(path.join('editor-mcp', 'src', 'bridge', 'protocolGate.ts'));
const PROTOCOL = Number(/export const EDITOR_PROTOCOL = (\d+)/.exec(protocolSrc)?.[1] ?? 0);
if (!PROTOCOL) {
  console.error('✗ 读不到 EDITOR_PROTOCOL（editor-mcp/src/bridge/protocolGate.ts）');
  process.exit(1);
}

/** MCP 工具名：从注册调用里取（`reg(server, 'doc.create', …)`） */
const mcpIndex = read(path.join('editor-mcp', 'src', 'tools', 'index.ts'));
const tools = [...mcpIndex.matchAll(/reg\(server,\s*'([^']+)'/g)].map((m) => m[1]);

/** 编辑器 live 方法：从 `case 'doc.get':` 里取（页面侧真正实现的那批） */
const liveSrc = read(path.join('web-editor', 'src', 'mcp', 'liveMethods.ts'));
const bridgeMethods = [...liveSrc.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]);

const uniq = (a) => [...new Set(a)].sort();
const outputs = {
  'contracts/version.json': `${JSON.stringify({ version: VERSION, protocol: PROTOCOL }, null, 2)}\n`,
  'contracts/bridge-methods.json': `${JSON.stringify({ tools: uniq(tools), bridgeMethods: uniq(bridgeMethods) }, null, 2)}\n`,
  'editor-mcp/src/version.ts':
    `/**\n * ★本文件由 \`tools/sync-contracts.mjs\` 生成，**不要手改**。\n` +
    ` * 唯一版本源是根 \`package.json\` 的 version；改完跑 \`node tools/sync-contracts.mjs\`。\n */\n` +
    `export const VERSION = '${VERSION}';\n` +
    `/** 桥接协议版本（与 web-editor/src/mcp/protocol.ts 一致，verify 有断言） */\n` +
    `export const EDITOR_PROTOCOL = ${PROTOCOL};\n`,
  'web-editor/src/version.ts':
    `/**\n * ★本文件由 \`tools/sync-contracts.mjs\` 生成，**不要手改**。\n` +
    ` * 唯一版本源是根 \`package.json\` 的 version；协议源是 \`editor-mcp/src/bridge/protocolGate.ts\`。\n */\n` +
    `export const VERSION = '${VERSION}';\n` +
    `/** 桥接协议版本（页面在 bridge.hello 里上报，MCP 据此判 Live） */\n` +
    `export const EDITOR_PROTOCOL = ${PROTOCOL};\n`,
};

/* 三个包的 package.json 版本必须与根一致（同步而不是"断言失败后让人手改"） */
const pkgPaths = ['editor-mcp/package.json', 'web-editor/package.json', 'apps/desktop/package.json'];
for (const rel of pkgPaths) {
  const text = read(rel);
  const fixed = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${VERSION}$2`);
  if (fixed !== text) outputs[rel] = fixed;
}

let drift = 0;
for (const [rel, want] of Object.entries(outputs)) {
  const abs = path.join(repo, rel);
  const cur = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (cur === want) continue;
  drift += 1;
  if (checkOnly) {
    console.error(`✗ ${rel} 与生成结果不一致${cur === null ? '（文件不存在）' : ''}`);
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, want, 'utf8');
    console.log(`✓ 已写入 ${rel}`);
  }
}

console.log(
  `版本源：${VERSION}（根 package.json）｜协议 ${PROTOCOL}｜工具 ${uniq(tools).length} 个｜live 方法 ${uniq(bridgeMethods).length} 个`,
);
if (checkOnly && drift) {
  console.error(`\n✗ 有 ${drift} 处需要重新生成：node tools/sync-contracts.mjs`);
  process.exit(1);
}
if (checkOnly) console.log('✓ 契约与磁盘一致');
