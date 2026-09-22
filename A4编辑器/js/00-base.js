/* ══════════════════════════════════════════════════════════════
   基础：DOM 句柄 / 单位换算 / 字号表 / 全局编辑状态
   依赖：无（必须最先加载）
   对外：$ doc prevStage measure root pageStyle mmPx SIZES roman
         SECTIONS ORIG_TOTAL KEEP
         EDITING PAGING DIRTY SELFTEST_REPORT pageHost pageBodies download
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   A4 编辑器 —— 与 a4-printable-html-doc 的令牌保持一致
   ══════════════════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const doc = $('#doc'), prevStage = $('#prevStage'), measure = $('#measure');

/* ★原分页支持：SECTIONS 记录源文件每页的页码模式；KEEP=true 时按标记分页 */
const SECTIONS = [];
let ORIG_TOTAL = null;
let KEEP = true;
function roman(n){
  const T=[[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let s=''; for(const [v,c] of T){ while(n>=v){ s+=c; n-=v; } } return s;
}
const root = document.documentElement;

/* 中文字号 ↔ pt */
const SIZES = [['初号',42],['小初',36],['一号',26],['小一',24],['二号',22],['小二',18],
  ['三号',16],['小三',15],['四号',14],['小四',12],['五号',10.5],['小五',9],['六号',7.5],['小六',6.5]];
(function initSizes(){
  const sel = $('#fsize');
  sel.innerHTML = '<option value="">字号</option>' +
    SIZES.map(([n,p])=>`<option value="${p}">${n} / ${p}pt</option>`).join('');
})();

/* 单位换算：1mm 多少 px */
const mmPx = (()=>{ const d=document.createElement('div'); d.style.cssText='width:100mm;position:absolute;left:-9999px';
  document.body.appendChild(d); const v=d.getBoundingClientRect().width/100; d.remove(); return v; })();

/* 打印方向必须动态：静态 @page 无法随纸张方向变化 */
const pageStyle = document.createElement('style');
document.head.appendChild(pageStyle);

/* ───────── ★分页编辑：同步 / 重排 / 光标恢复 ───────── */
let EDITING = true, PAGING = false, DIRTY = false;
let SELFTEST_REPORT = null;            // 由 ?selftest=1 写入，paginate 负责渲染成末页
const pageHost = () => document.getElementById('prevStage');
const pageBodies = () => [...pageHost().querySelectorAll('.paper .body')];
function download(name, text, mime){
  const b=new Blob([text],{type:mime||'text/html;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

