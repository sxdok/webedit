/* 页面脚本（配合 tools/cdp/eval.mjs 使用）：
 * **分页标签条几何探针** —— 连点「＋ → 选模式 → 创建」到 N 页，逐页量标签条的几何，
 * 用来复现/回归"标签多到出横向滚动条时，标签被压扁"这类布局 bug。
 *
 *   node tools/cdp/eval.mjs "<url>" tools/cdp/probes/pagetabs-geometry.js
 *
 * 关注三项：
 *   · 标签行高（`[data-page-tab-row]`）—— 出滚动条时**不该变小**（bug 时从 32px 掉到 16px）；
 *   · 滚动容器（`[data-page-tabs-scroll]`）是否真的溢出（`scrollWidth > clientWidth`）；
 *   · 容器整体高（`[data-page-tabs]`）—— 修复后是"标签行 + 滚动条"，滚动条长在行下面而不是压住它。
 *
 * 来历：用户报告「新建文档到第 6 页时预览窗顶部的分页变形」——
 * 根因是标签条把 32px 固定高度与 `overflow-x-auto` 放在同一个元素上（详见 REFACTORING §15.29）。
 * 自检里也有一条等价的挤压断言（`临时压窄标签条`），不必真造 6 个标签就能拦。
 */
(async () => {
  const TARGET = 6; // 截图里出现变形时的页数
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const tabs = () => [...document.querySelectorAll('[data-page-tab]')];

  const measure = () => {
    const box = q('[data-page-tabs="1"]');
    const scroll = q('[data-page-tabs-scroll="1"]');
    const row = q('[data-page-tab-row="1"]');
    if (!box || !scroll || !row) return { 错误: '找不到标签条（选择器变了？）' };
    const t = tabs();
    const first = t[0]?.getBoundingClientRect();
    return {
      标签数: t.length,
      标签行高: Math.round(row.getBoundingClientRect().height),
      容器高: Math.round(box.getBoundingClientRect().height),
      滚动区: {
        出现横向滚动条: scroll.scrollWidth > scroll.clientWidth + 1,
        滚动条占高: scroll.offsetHeight - scroll.clientHeight,
      },
      首个标签高: first ? Math.round(first.height) : null,
      溢出: box.scrollWidth > box.clientWidth + 1,
    };
  };

  const out = { 开始: measure() };
  for (let i = tabs().length; i < TARGET; i += 1) {
    const add = q('[data-page-add]');
    if (!add) {
      out[`第${i + 1}页`] = { 错误: '找不到 ＋ 按钮' };
      break;
    }
    add.click();
    await sleep(260);
    /* 新建对话框是**两步**：① 选模式（data-new-doc-mode）→ ② 参数页才有 data-new-doc-create */
    q('[data-new-doc-mode="document"]')?.click();
    await sleep(220);
    const create = q('[data-new-doc-create]');
    if (!create) {
      out[`第${i + 1}页`] = {
        错误: '找不到创建按钮',
        对话框: !!q('[data-new-doc]'),
        步骤: q('[data-new-doc]')?.getAttribute('data-new-doc-step'),
      };
      break;
    }
    create.click();
    await sleep(320);
    out[`第${i + 1}页`] = measure();
  }
  out['最终'] = measure();
  return out;
})()
