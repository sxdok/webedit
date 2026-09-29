/**
 * 契约生成器（ARCHITECTURE §5.1 / §10.3，P1 子项③）。
 *
 *   node tools/sync-contracts.mjs            # 生成（幂等）
 *   node tools/sync-contracts.mjs --check    # 只校验：与磁盘不一致就退出码 1（进闸门用）
 *
 * 生成的五处（**都不要手改**）：
 *   · `contracts/version.json`            —— 版本 + 桥接协议 + MCP 协议号（对外版本的机器可读投影）
 *   · `contracts/bridge-methods.json`     —— MCP 工具名清单 + 编辑器 live 方法清单
 *   · `editor-mcp/src/version.ts`         —— 供 MCP 直接 `import { VERSION }`
 *   · `web-editor/src/version.ts`         —— 供页面直接 `import { VERSION }`
 *   · `apps/desktop/src/version.js`       —— 供桌面壳直接 `import { VERSION }`（P3-M9 起）
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

/** 递归列出目录下的文件绝对路径（用于扫环境变量） */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

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

/**
 * ★P3-M9：MCP 协议修订号也**单一来源**。
 * 它是我们"说的那版 MCP 规范"，三端必须一模一样（编辑器在 hello 里报、MCP 在 initialize 里报、
 * 桌面壳连 MCP 时也要声明）；以前这个字符串在 `config.ts` / `bridgeClient.ts` / `mcpSupervisor.js`
 * 三处各写一遍 —— 升级时漏一处就会出现"工具表飘忽"的怪问题。这里钉一次，写进三个生成物。
 */
const MCP_PROTOCOL = '2025-06-18';
const generatedBanner = (source) =>
  `/**\n * ★本文件由 \`tools/sync-contracts.mjs\` 生成，**不要手改**。\n` +
  ` * 版本源 = 根 \`package.json\`；桥接协议源 = \`editor-mcp/src/bridge/protocolGate.ts\`；\n` +
  ` * MCP 协议号 = 生成器里钉的 MCP_PROTOCOL（${MCP_PROTOCOL}）。\n * 改完跑 \`node tools/sync-contracts.mjs\`。\n */\n`;

const outputs = {
  'contracts/version.json': `${JSON.stringify({ version: VERSION, protocol: PROTOCOL, mcpProtocol: MCP_PROTOCOL }, null, 2)}\n`,
  'contracts/bridge-methods.json': `${JSON.stringify({ tools: uniq(tools), bridgeMethods: uniq(bridgeMethods) }, null, 2)}\n`,
  'editor-mcp/src/version.ts':
    generatedBanner() +
    `export const VERSION = '${VERSION}';\n` +
    `/** 桥接协议版本（与 web-editor/src/mcp/protocol.ts 一致，verify 有断言） */\n` +
    `export const EDITOR_PROTOCOL = ${PROTOCOL};\n` +
    `/** 我们说的那版 MCP 规范（initialize 里上报） */\n` +
    `export const MCP_PROTOCOL_VERSION = '${MCP_PROTOCOL}';\n`,
  'web-editor/src/version.ts':
    generatedBanner() +
    `export const VERSION = '${VERSION}';\n` +
    `/** 桥接协议版本（页面在 bridge.hello 里上报，MCP 据此判 Live） */\n` +
    `export const EDITOR_PROTOCOL = ${PROTOCOL};\n` +
    `/** 我们说的那版 MCP 规范（页面把 MCP 版本一并上报，便于诊断） */\n` +
    `export const MCP_PROTOCOL_VERSION = '${MCP_PROTOCOL}';\n`,
  /* 桌面壳是纯 JS（没有 TS 构建），所以给它一份 `.js`；否则 `mcpSupervisor.js` 只能写死版本号。 */
  'apps/desktop/src/version.js':
    generatedBanner() +
    `export const VERSION = '${VERSION}';\n` +
    `export const MCP_PROTOCOL_VERSION = '${MCP_PROTOCOL}';\n`,
};

/* ── 表格内核同源（P1④）：MCP 侧那份改为**从 web 的规范模块复制生成** ──
   原来两份手写（web 版用 asString/asMatrix，MCP 版内联重写），语义靠 65 例一致性测试人工守着。
   现在只有一份手写源：`web-editor/.../tableKit.pure.ts`（零依赖，两侧都能编译）。 */
const tableKitPure = read(path.join('web-editor', 'src', 'registry', 'components', 'common', 'tableKit.pure.ts'));
if (/^\s*import\s/m.test(tableKitPure.replace(/^\/\*\*[\s\S]*?\*\/\n/, ''))) {
  console.error('✗ tableKit.pure.ts 里出现了 import —— 它必须保持零依赖（MCP 侧要能直接编译）');
  process.exit(1);
}
outputs['editor-mcp/src/engine/tableKit.ts'] =
  `/**\n * ★本文件由 \`tools/sync-contracts.mjs\` **从编辑器侧的规范模块复制**生成，不要手改：\n` +
  ` *   源文件 = \`web-editor/src/registry/components/common/tableKit.pure.ts\`\n` +
  ` *   改语义请改源文件，然后跑 \`node tools/sync-contracts.mjs\`；\n` +
  ` *   \`--check\` 会比对两边内容（机械护栏），65 例一致性测试是语义护栏。\n */\n\n` +
  tableKitPure;

/* ── 环境变量契约（P2②）：MCP 认哪些 `EDITOR_MCP_*` 键，从源码里扫出来（别手抄） ──
   谁在用：桌面壳启动 MCP 子进程时注入这些键；agent/运维排查时也要照着这份清单查。 */
const envVars = new Set();
for (const rel of walk(path.join(repo, 'editor-mcp', 'src'))) {
  if (!/\.ts$/.test(rel)) continue;
  for (const m of read(path.relative(repo, rel)).matchAll(/EDITOR_MCP_[A-Z0-9_]+/g)) envVars.add(m[0]);
}
outputs['contracts/env-vars.json'] = `${JSON.stringify({ vars: [...envVars].sort() }, null, 2)}\n`;

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
