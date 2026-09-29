/* 页面脚本（配合 tools/cdp/eval.mjs 使用）：
 * 快速体检 —— 返回编辑器界面的关键结构信息（标题、面板、组件项、纸张尺寸、节点数、菜单栏）。
 *
 *   node tools/cdp/eval.mjs "<url>" tools/cdp/probes/summary.js
 *
 * 它是"最早该跑的那条探针"：既验证页面真的渲染出来了，又给出继续排查需要的坐标。
 * ★选择器用的是界面**真实存在**的 data 属性（`data-comp-item` / `data-category-name` /
 *   `data-node-id` / `data-menu-btn`…）—— 第一版我按想象写选择器，结果"组件按钮/菜单栏"都报 0，
 *   等于给自己一个假信号。改探针时请照这条：**先确认属性真的存在**。
 */
(() => {
  const q = (s) => document.querySelector(s);
  const n = (s) => document.querySelectorAll(s).length;
  const paper = q('[data-paper]') || q('.paper') || q('[class*="paper"]');
  const r = paper?.getBoundingClientRect?.();
  return {
    标题: document.title,
    就绪: document.readyState,
    有根挂载点: !!q('#root'),
    左面板: n('[data-panel="left"], [data-comp-grid], [data-component-panel]'),
    组件项: n('[data-comp-item]'),
    组件分类: n('[data-category-name]'),
    画布: n('[data-canvas], .canvas, [class*="canvas"]'),
    纸张: paper ? { 宽: Math.round(r.width), 高: Math.round(r.height) } : null,
    节点数: n('[data-node-id]'),
    标题节点: n('[data-node-id][data-node-type="heading"], h1,h2,h3,h4,h5,h6'),
    菜单按钮: n('[data-menu-btn], [data-menu-bar] button'),
    /* 注意：菜单栏由**桌面壳**注入（preload/main），所以浏览器里看这个数字就是 0——
       这不是探针坏了，而是"跑在哪里"的差异。要验菜单请用桌面版（`npm run selftest` 里有 3 条断言）。 */
    说明: '菜单数为 0 属正常（浏览器里没有桌面壳注入的菜单栏）',
    正文长度: (document.body.innerText || '').length,
  };
})()
