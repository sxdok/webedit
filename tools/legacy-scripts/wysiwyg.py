# -*- coding: utf-8 -*-
"""所见即所得：编辑时就是分页的 A4 页面。
要点：
① 编辑面改为可编辑的 .paper 页（#doc 退居后台，作为唯一数据源）；
② 打字后在 idle 时 同步→重排，并**按"块序号+块内偏移"恢复光标**；
③ 回写时只在**分节边界**插分页标记（封面/目录/正文三段结构不丢，节内可自由回流）；
④ 导出的 Markdown / 保存 / 打印 前都先同步。
"""
import io

P = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
s = io.open(P, encoding="utf-8").read()
ok = 0


def rep(old, new, label):
    global s, ok
    n = s.count(old)
    if n != 1:
        print("  [!! %s] 命中 %d 次" % (label, n))
        return
    s = s.replace(old, new)
    ok += 1
    print("  [ok] %s" % label)


# ── ① CSS：后台数据源 + 编辑态样式 ────────────────────────────────
rep("#prev-pane{display:none}",
    """#prev-pane{display:none}
#docHost{position:absolute;left:-99999px;top:0;width:210mm;visibility:hidden}
.paper.editing .body{outline:none}
.paper.editing{box-shadow:0 0 0 2px var(--ui2),0 3px 14px rgba(0,0,0,.16)}
.paper.editing .body:focus{background:#fff}""", "CSS：后台数据源/编辑态")

# ── ② HTML：编辑面 = 分页容器；#doc 移入后台 ──────────────────────
rep("""  <div id="edit-pane"><div id="stage"><div id="doc" class="doc" contenteditable="true" spellcheck="false"></div></div></div>
  <div id="prev-pane"><div id="prevStage"></div></div>""",
    """  <div id="edit-pane"><p class="hint" style="margin:0 0 10px">所见即所得：下面是 A4 分页，直接在上面改；打字停下后会自动重排。</p><div id="prevStage"></div></div>
  <div id="prev-pane" style="display:none"></div>
  <div id="docHost"><div id="doc" class="doc" contenteditable="true" spellcheck="false"></div></div>""",
    "HTML：编辑面改分页")

# ── ③ 打印：打印分页面，隐藏后台与源码 ───────────────────────────
rep("""  #edit-pane{display:none!important}
  #prev-pane{display:block!important}""",
    """  #edit-pane{display:block!important}
  #prev-pane{display:none!important}
  #docHost,#md-pane{display:none!important}""", "打印规则")

# ── ④ 编辑态开关 + 同步 + 光标保存/恢复 ───────────────────────────
rep("""/* ───────── 纸张与页边距 ───────── */""",
    """/* ───────── ★分页编辑：同步 / 重排 / 光标恢复 ───────── */
let EDITING = true, PAGING = false;
const pageHost = () => document.getElementById('prevStage');
const pageBodies = () => [...pageHost().querySelectorAll('.paper .body')];

function syncFromPages(){
  const bs = pageBodies();
  if(!bs.length) return false;                      // 还没分页过，别覆盖数据源
  let html = '';
  const nums = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || 'arabic');
  bs.forEach((b, i) => {
    // 只在**分节边界**插标记：节内允许自由回流
    if(i > 0 && nums[i] !== nums[i-1])
      html += '<div class="pgbreak" data-num="' + nums[i] + '" contenteditable="false"></div>\\n';
    html += b.innerHTML + '\\n';
  });
  doc.innerHTML = html;
  return true;
}

function caretPath(){
  const sel = window.getSelection();
  if(!sel.rangeCount || !sel.anchorNode) return null;
  const r = sel.getRangeAt(0), n = r.startContainer;
  let el = n.nodeType === 3 ? n.parentNode : n;
  const body = el.closest ? el.closest('.paper .body') : null;
  if(!body) return null;
  let top = el; while(top && top.parentNode !== body) top = top.parentNode;
  const locals = [...body.children];
  const bi = locals.indexOf(top);
  if(bi < 0) return null;
  let gi = bi;
  for(const b of pageBodies()){ if(b === body) break; gi += b.children.length; }
  let cnt = 0, node; const w = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
  while((node = w.nextNode())){
    if(node === n){ cnt += r.startOffset; break; }
    cnt += node.textContent.length;
  }
  return {gi: gi, cnt: cnt};
}

function restoreCaret(path){
  if(!path) return;
  const bs = pageBodies(); if(!bs.length) return;
  let gi = path.gi, target = null;
  for(const b of bs){
    if(gi < b.children.length){ target = b.children[gi]; break; }
    gi -= b.children.length;
  }
  if(!target) return;
  const w = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let node, acc = 0, done = false;
  while((node = w.nextNode())){
    if(acc + node.textContent.length >= path.cnt){
      try{
        const r = document.createRange();
        r.setStart(node, Math.max(0, Math.min(path.cnt - acc, node.textContent.length)));
        r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        done = true;
      }catch(e){}
      break;
    }
    acc += node.textContent.length;
  }
  if(!done){
    try{
      const r = document.createRange(); r.selectNodeContents(target); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }catch(e){}
  }
}

let _reflowT = null;
function reflowSoon(){
  if(!EDITING || PAGING) return;
  clearTimeout(_reflowT);
  _reflowT = setTimeout(()=>{
    if(!EDITING) return;
    const path = caretPath();
    PAGING = true;
    try{ paginate(); restoreCaret(path); } finally { PAGING = false; save(); }
  }, 650);
}

/* ───────── 纸张与页边距 ───────── */""", "编辑态/同步/光标")

# ── ⑤ paginate：标页码模式 + 编辑态可编辑 ─────────────────────────
rep("""    const lbl=document.createElement('div'); lbl.className='hint';
    lbl.textContent='第 '+shown+' 页 / 共 '+total+' 页（'+(paper.ori==='portrait'?'纵向':'横向')+' A4）';
    prevStage.appendChild(p);""",
    """    p.dataset.num = pg.num || 'arabic';
    if(EDITING){
      p.classList.add('editing');
      const bd = p.querySelector('.body');
      if(bd){ bd.setAttribute('contenteditable','true'); bd.setAttribute('spellcheck','false'); }
    }
    const lbl=document.createElement('div'); lbl.className='hint';
    lbl.textContent='第 '+shown+' 页 / 共 '+total+' 页（'+(paper.ori==='portrait'?'纵向':'横向')+' A4）';
    prevStage.appendChild(p);""", "paginate：编辑态")

# paginate 开头先同步（用户可能正在分页面上编辑）
rep("""function paginate(){
  const cwPx = contentW()*mmPx, chPx = contentH()*mmPx;""",
    """function paginate(){
  if(!PAGING) syncFromPages();          // ★先把分页面上的编辑回写数据源
  const cwPx = contentW()*mmPx, chPx = contentH()*mmPx;""", "paginate：先同步")

# ── ⑥ 选取/块命令：允许选中"分页面里的元素" ───────────────────────
rep("""  if(selected && doc.contains(selected)) return selected;""",
    """  if(selected && document.contains(selected) && !selected.closest('#panel')) return selected;""",
    "blockOf：允许页内元素")
rep("""  selected = (el && el !== doc && doc.contains(el)) ? el : null;""",
    """  selected = (el && el !== doc && document.contains(el) && !el.closest('#panel')) ? el : null;""",
    "selEl：允许页内元素")
rep("""doc.addEventListener('click', e=>{
  const el = e.target.closest && e.target.closest(
    'h1,h2,h3,h4,p,li,ul,ol,table,tr,td,th,img,div.note,div.tabcap,div.figcap');
  if(el && doc.contains(el) && el !== doc) selEl(el);
});""",
    """function onPick(e){
  const el = e.target.closest && e.target.closest(
    'h1,h2,h3,h4,p,li,ul,ol,table,tr,td,th,img,div.note,div.tabcap,div.figcap');
  if(el && document.contains(el) && el !== doc && !el.closest('#panel')) selEl(el);
}
document.addEventListener('click', onPick);
document.addEventListener('input', e=>{ if(e.target.closest && e.target.closest('#prevStage')) reflowSoon(); });""",
    "选取绑定 + 输入触发重排")

# ── ⑦ 导出/保存/MD 前同步 ─────────────────────────────────────────
rep("""function buildHTML(){
  const total = paginate();""",
    """function buildHTML(){
  syncFromPages();
  const total = paginate();""", "导出前同步")
rep("""function toMd(){
  imgMap = {}; let n = 0; const L = [];""",
    """function toMd(){
  syncFromPages();
  imgMap = {}; let n = 0; const L = [];""", "MD 前同步")
rep("""function save(){ try{ localStorage.setItem('a4editor.doc', doc.innerHTML);""",
    """function save(){ try{ syncFromPages(); localStorage.setItem('a4editor.doc', doc.innerHTML);""",
    "保存前同步")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
