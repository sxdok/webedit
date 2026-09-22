/* ══════════════════════════════════════════════════════════════
   纸张与版心：A4 纵横向、页边距（单位 cm）、版心尺寸
   依赖：00-base
   对外：paper applyPaper contentW contentH
   ══════════════════════════════════════════════════════════════ */

/* ───────── 纸张与页边距 ───────── */
const paper = { ori:'portrait', t:2.54, b:2.54, l:3.17, r:3.17, fd:0.5, hdr:1.5 };
function applyPaper(){
  const w = paper.ori==='portrait' ? 210 : 297;
  const h = paper.ori==='portrait' ? 297 : 210;
  root.style.setProperty('--pw', w); root.style.setProperty('--ph', h);
  root.style.setProperty('--mt', paper.t); root.style.setProperty('--mb', paper.b);
  root.style.setProperty('--ml', paper.l); root.style.setProperty('--mr', paper.r);
  root.style.setProperty('--fd', paper.fd);
  pageStyle.textContent = `@page{size:A4 ${paper.ori};margin:0}`;
  document.querySelectorAll('[data-ori]').forEach(b=>b.classList.toggle('on', b.dataset.ori===paper.ori));
  $('#mgT').value=paper.t; $('#mgB').value=paper.b; $('#mgL').value=paper.l; $('#mgR').value=paper.r;
}
// ★paper.t/b/l/r 单位是 **cm**，这里必须 ×10 换成 mm，否则版心会算大 57mm、
//   页面右侧内容会被 .paper 的 overflow:hidden 整片裁掉（实测踩过）。
const contentW = ()=> (paper.ori==='portrait'?210:297) - (paper.l + paper.r) * 10;   // mm
const contentH = ()=> (paper.ori==='portrait'?297:210) - (paper.t + paper.b) * 10;   // mm

