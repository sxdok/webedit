/**
 * 暗色模式**源码级**审计：找出"编辑器外壳里用到、但 index.css 的暗色重映射清单里没有"的颜色类。
 *
 * 背景：暗色是靠 `html[data-theme='monokai'] .bg-gray-100 {...}` 这样**一条条重映射 Tailwind 工具类**
 * 实现的 —— 漏一个类（尤其是 `bg-amber-50/40` 这种带透明度的独立类名、或 `text-[#374151]` 任意值）
 * 就会在暗色下留下一块浅色底板 / 看不见的文字。这个脚本把漏项一次性列全。
 *
 * 用法：node scripts/audit-dark-classes.mjs        （退出码 1 = 有漏项）
 *
 * 范围：只审**编辑器外壳**（components/layout、panels、canvas 的浮层、layout、App.tsx…）；
 *       `src/registry/components/**` 是**画布内容**（要打印的成品），颜色不跟主题，故意不审。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ★中文路径：必须走 fileURLToPath，直接取 url.pathname 会拿到百分号编码
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8');

/** 画布内容（=要打印的成品）与"生成产物"目录，不参与主题 */
const CONTENT_DIRS = ['registry', 'export'];
/** 颜色相关工具类的形状 */
const COLOR_RE =
  /(?:^|\s)(?:(?:hover|focus|focus-visible|active|disabled|group-hover|peer-checked|placeholder|before|after):)*(bg|text|border|divide|ring|outline|fill|stroke|shadow|from|via|to|placeholder:text)-(white|black|transparent|current|inherit|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary|line|canvasbg|panel)(?:-\d{2,3})?(?:\/\d{1,3})?(?=\s|$|"|'|`)/g;

/** index.css 里被重映射覆盖的类名（从选择器里抠出来，含转义写法 `bg-gray-50\/60`） */
function remappedClasses() {
  const out = new Set();
  for (const m of CSS.matchAll(/html\[data-theme='monokai'\][^{]*\{/g)) {
    const sel = m[0];
    for (const c of sel.matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)) {
      out.add(c[1].replace(/\\/g, '')); // `bg-gray-50\/60` → `bg-gray-50/60`
    }
  }
  // 变量式覆盖：表单控件、语义类等（这些不算"类名漏项"）
  for (const c of CSS.matchAll(/^\.((?:ui|prop|ruler|zoom|thin)[A-Za-z0-9_-]*)/gm)) out.add(c[1]);
  return out;
}

/** 这些类即使没被 remap 也是安全的：透明/继承色、语义类、以及"颜色来自文档配置/遮罩"的 */
const SAFE = new Set([
  'bg-transparent', 'text-transparent', 'border-transparent', 'bg-current', 'text-current', 'border-current',
  'text-inherit', 'bg-inherit', 'border-inherit', 'bg-white', 'text-white', 'border-white',
  'bg-black', 'text-black', 'border-black',
  'bg-black/30', // 对话框遮罩：两套主题下都该是暗的
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (CONTENT_DIRS.includes(name)) continue;
      walk(p, acc);
    } else if (/\.(tsx|ts)$/.test(name)) acc.push(p);
  }
  return acc;
}

const covered = remappedClasses();
const missing = new Map();
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(COLOR_RE)) {
      const cls = m[1] + '-' + m[2] + (m[0].includes('/') ? '' : '');
      const token = m[0].trim();
      const base = token.replace(/\\/g, '');
      if (SAFE.has(base)) continue;
      if (covered.has(base)) continue;
      // 半透明变体：如果同名的"不带 /xx"版本被覆盖了，仍然算漏项（Tailwind 是独立类名）
      const key = `${rel}:${i + 1} ${token}`;
      if (!missing.has(token)) missing.set(token, []);
      missing.get(token).push(key);
      void cls;
    }
  });
}

const arbitrary = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const m of line.matchAll(/\b(?:bg|text|border|divide|ring)-\[#[0-9a-fA-F]{3,8}\]/g)) {
        arbitrary.push(`${rel}:${i + 1} ${m[0]}`);
      }
    });
}

console.log(`重映射覆盖的类：${covered.size} 个`);
if (arbitrary.length) {
  console.log(`\n✗ 任意值颜色类（不在重映射机制里，必须改成语义类 ui-ink/ui-surface… 或普通调色板类）：${arbitrary.length}`);
  for (const a of arbitrary) console.log('   ' + a);
}
if (missing.size) {
  console.log(`\n✗ 未被暗色重映射覆盖的颜色类：${missing.size}`);
  for (const [token, hits] of [...missing.entries()].sort()) {
    console.log(`   ${token}  ← ${hits.slice(0, 3).join(' , ')}${hits.length > 3 ? ` …共 ${hits.length} 处` : ''}`);
  }
}
if (!arbitrary.length && !missing.size) console.log('\n✓ 外壳里没有漏项：所有颜色类都在暗色重映射清单里，也没有任意值颜色类');
process.exit(arbitrary.length + missing.size ? 1 : 0);
