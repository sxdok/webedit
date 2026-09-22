/* ══════════════════════════════════════════════════════════════
   组件注册表与识别：COMPS 注册表、用户组件持久化、match 选择器认领元素
   依赖：00-base
   对外：BUILTIN COMPS FROMFILE saveUserComps selScore compOf
   ══════════════════════════════════════════════════════════════ */

/* ───────── ★组件化构建 ───────── */
/* 组件定义（数据驱动，可导出/导入）：
   html      : 插入时的模板
   match     : 识别页面上元素属于哪个组件（选择器）
   props     : 属性表单字段。k 支持 text / css:xxx / attr:xxx / 自定义（rows/cols 等） */
/* 组件全部来自同级「组件/」目录（见 loadComponentFiles）；BUILTIN 保留为空对象，
   仅用于区分「来自文件的组件」与「用户自建组件」。 */
const BUILTIN = {};
let COMPS = Object.assign({}, BUILTIN);
const FROMFILE = {};                 // 来自 组件/ 目录的组件
(function loadUserComps(){
  try{
    const t = localStorage.getItem('a4editor.comps');
    if(t) Object.assign(COMPS, JSON.parse(t));
  }catch(e){}
})();
function saveUserComps(){
  const user = {};
  for(const k in COMPS) if(!BUILTIN[k] && !FROMFILE[k]) user[k] = COMPS[k];   // 文件组件不入本地库
  try{ localStorage.setItem('a4editor.comps', JSON.stringify(user)); }catch(e){}
}
/* 选择器"具体度"：有 # 最高、有 class/属性/伪类次之、纯标签最低。
   ★必须按具体度挑，否则 table.t3 会被 match="table" 的"表格"抢走、p.kw 会被 p 抢走。 */
function selScore(sel){
  const a = (sel.match(/#/g) || []).length;
  const b = (sel.match(/\./g) || []).length;
  const c = (sel.match(/\[|:/g) || []).length;
  const tag = /^[a-zA-Z]/.test(sel) ? 1 : 0;
  return a * 1000 + b * 100 + c * 10 + tag;
}
function compOf(el){
  if(!el || el.nodeType !== 1) return null;
  // 图文框（.topo）里的图片归 figure —— 这条必须在循环之前，否则会被 img 组件抢先
  if(el.nodeName === 'IMG' && el.closest('.topo')) return 'figure';
  let best = null, bestScore = -1;
  for(const k in COMPS){
    const c = COMPS[k];
    if(!c.match) continue;
    let hit = false;
    try{ hit = el.matches(c.match); }catch(e){ hit = false; }
    if(!hit) continue;
    const sc = selScore(c.match);
    if(sc > bestScore){ best = k; bestScore = sc; }
  }
  return best;
}
