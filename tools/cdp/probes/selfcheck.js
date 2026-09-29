/* 页面脚本（配合 tools/cdp/eval.mjs 使用）：
 * 轮询 `?check=1` 的自检报告，直到**稳定**，返回结论（好/总数/失败清单/耗时）。
 *
 *   node tools/cdp/eval.mjs "<url>?check=1" tools/cdp/probes/selfcheck.js
 *
 * ★为什么要"直到稳定"：自检靠一串 setTimeout 链 + 异步交互，全程约 3 分钟；
 *   用 `--dump-dom --virtual-time-budget` 会在**第一段 finish()** 就取到「17/17 全部通过」的假结果。
 * ★为什么不用 DOM 行去筛 FAIL：报告会把多行拼进一个块（曾因此把 2 条失败报成 0 条）——
 *   这里直接对报告文本做 `FAIL ` 匹配。只读 DOM，不改文档。
 */
(async () => {
  const host = () => document.querySelector('[data-check-report]');
  const rows = () => {
    const h = host();
    return h ? [...h.children].slice(1).map((el) => (el.textContent || '').trim()) : [];
  };
  const parse = (t) => {
    const m = /check: (\d+)\/(\d+)/.exec(t || '');
    return m ? { good: Number(m[1]), total: Number(m[2]) } : null;
  };
  const t0 = Date.now();
  let last = '';
  let stable = 0;
  let seen = 0;
  while (Date.now() - t0 < 330000) {
    await new Promise((r) => setTimeout(r, 700));
    const t = document.title;
    const p = parse(t);
    const n = rows().length;
    if (n > seen) seen = n;
    if (t === last && p && p.total > 200 && n === p.total && stable >= 4) break;
    if (t !== last || n !== seen) stable = 0;
    else stable += 1;
    last = t;
  }
  const list = rows();
  const reportText = (host()?.textContent ?? '').replace(/\s+/g, ' ');
  const fails = reportText.match(/FAIL [^]{0,140}/g) ?? [];
  return {
    标题: document.title,
    行数: list.length,
    最多见过: seen,
    失败数: fails.length,
    失败: fails.slice(0, 25),
    耗时秒: Math.round((Date.now() - t0) / 100) / 10,
  };
})()
