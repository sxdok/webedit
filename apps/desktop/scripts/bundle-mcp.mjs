/**
 * 把 `editor-mcp` 打成**单文件**（esbuild，无需额外依赖）。
 *
 * 为什么必须打（本机实测的原因，不是洁癖）：
 *   `editor-mcp/node_modules` 是**手工拼出来的**——`chokidar`/`ws`/`zod`/`react`/`react-dom`/`typescript`
 *   都是**符号链接**，指向 `D:\DSHClient\user\server\node_modules\.pnpm\...`（DSH 服务器自带的那份）。
 *   这种目录**装不进安装包**：electron-builder 拷过去要么跟着链接跑出包外、要么拷成一对空壳，
 *   装到别人机器上必然 `ERR_MODULE_NOT_FOUND`。打成单文件后 `resources/editor-mcp/` 里只有**一个 .mjs**，
 *   与开发机上的 pnpm store 彻底无关。
 *
 * 实现要点：
 *   · 入口用**已编译**的 `editor-mcp/dist/index.js`（不再走 TS：`src/*.ts` 里是 NodeNext 风格的
 *     `./config.js` 相对导入，交给 esbuild 猜 `.ts` 属于额外风险，编好的 dist 是干这活的）；
 *   · `format=esm`，动态 `import('./http.js')` 在没有 splitting 时会被**内联**进同一个文件；
 *   · `ws` 的两个可选原生加速包（bufferutil / utf-8-validate）标记为 external —— 它们本来就是可选依赖，
 *     运行时拿不到会自己降级（不标的话打包阶段会报解析失败）；
 *   · 顶部注入 `createRequire`：被内联的 CJS 依赖里若出现运行时 `require()`，ESM 产物里得有它。
 *
 * 用法：
 *   node scripts/bundle-mcp.mjs                    # 写到 dist-mcp/editor-mcp.bundle.mjs
 *   node scripts/bundle-mcp.mjs --out <路径>        # 指定输出（验证脚本用它打到临时目录）
 *   node scripts/bundle-mcp.mjs --print            # 只打印会写到哪里
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, '..');
const REPO_ROOT = resolve(APP_DIR, '..', '..');
const MCP_ROOT = join(REPO_ROOT, 'editor-mcp');
const ESBUILD = join(REPO_ROOT, 'web-editor', 'node_modules', 'esbuild', 'lib', 'main.js');
export const DEFAULT_OUT = join(APP_DIR, 'dist-mcp', 'editor-mcp.bundle.mjs');

/** ws 的可选原生加速包：装了就用、没装自己降级，所以不进包 */
const OPTIONAL_NATIVE = ['bufferutil', 'utf-8-validate'];

/**
 * @param {object} [o]
 * @param {string} [o.outfile]   输出文件（默认 dist-mcp/editor-mcp.bundle.mjs）
 * @param {string} [o.entry]     入口（默认 editor-mcp/dist/index.js）
 * @param {boolean} [o.quiet]
 * @returns {Promise<{ outfile: string, bytes: number, entry: string, metafile?: object }>}
 */
export async function bundleMcp({ outfile = DEFAULT_OUT, entry = join(MCP_ROOT, 'dist', 'index.js'), quiet = false } = {}) {
  if (!existsSync(entry)) throw new Error(`入口不存在：${entry}（先在 editor-mcp 下跑 npx tsc -b / npm run build）`);
  if (!existsSync(ESBUILD)) {
    throw new Error(
      `找不到 esbuild：${ESBUILD}\n` +
        '它随 web-editor 一起安装（web-editor/node_modules/esbuild）。若那台机器上没有，' +
        '请先在 web-editor 下 npm install，或改用 `npx esbuild` 手动打。',
    );
  }
  const { build } = await import(pathToFileURL(ESBUILD).href);
  mkdirSync(dirname(outfile), { recursive: true });
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: OPTIONAL_NATIVE,
    metafile: true,
    legalComments: 'none',
    banner: {
      js: "import { createRequire as __dshCreateRequire } from 'node:module';\nconst require = __dshCreateRequire(import.meta.url);",
    },
    logLevel: quiet ? 'warning' : 'info',
  });
  const bytes = statSync(outfile).size;
  if (!quiet) {
    process.stdout.write(`已打包 editor-mcp：${entry}\n              → ${outfile}（${(bytes / 1024 / 1024).toFixed(1)} MB，单文件）\n`);
  }
  return { outfile, bytes, entry, metafile: result.metafile };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  const args = process.argv.slice(2);
  const argOf = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = argOf('--out') ?? DEFAULT_OUT;
  if (args.includes('--print')) {
    process.stdout.write(`${out}\n`);
    process.exit(0);
  }
  try {
    await bundleMcp({ outfile: out });
  } catch (e) {
    process.stderr.write(`打包失败：${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
