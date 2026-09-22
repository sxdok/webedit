# -*- coding: utf-8 -*-
"""组件化构建（第一版）：
① 组件库：数据驱动（JSON 可导出/导入），点一下即插入到光标处；
② 组件属性：选中元素 → 自动识别组件类型 → 生成属性表单（文本/下拉/颜色/数值/布尔），
   改动直接作用于该元素；
③ 新建组件：把当前选中元素存成可复用组件（存 localStorage）；
④ 导入/导出组件包：加载外部组件 JSON。
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


# ── ① 左侧面板：组件库 + 组件属性 ─────────────────────────────────
rep("""<div class="grp" id="inspector">
  <label>当前选中元素</label>
  <div id="inspInfo">未选中 —— 点右侧任意标题/段落/表格/图片即可选中，左侧所有控件都会作用到它。</div>
</div>""",
    """<div class="grp" id="inspector">
  <label>当前选中元素</label>
  <div id="inspInfo">未选中 —— 点右侧任意标题/段落/表格/图片即可选中，左侧所有控件都会作用到它。</div>
</div>
<div class="grp" id="grpPalette">
  <label>组件库（点一下插入到光标处）</label>
  <div id="palette" style="display:flex;flex-wrap:wrap;gap:4px"></div>
  <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">
    <button class="t" id="cmpNew" title="把当前选中的元素存成可复用组件">新建组件</button>
    <button class="t" id="cmpExport" title="导出组件包 JSON">导出组件包</button>
    <button class="t" id="cmpImport" title="加载外部组件包 JSON">加载组件包</button>
    <button class="t" id="cmpReset" title="恢复内置组件（自建组件保留在本地）">恢复内置</button>
  </div>
</div>
<div class="grp" id="grpProps">
  <label>组件属性 <span id="propWho" style="font-weight:400;color:#89a"></span></label>
  <div id="props"><span style="color:#89a;font-size:12px">先在右侧点选一个组件</span></div>
</div>""", "面板：组件库 + 组件属性")

rep("""#inspector{background:#f7fafd}""",
    """#inspector{background:#f7fafd}
#grpPalette{background:#fbfdff}
#palette button.t{font-size:12px;height:26px}
#props label{display:flex;align-items:center;gap:6px;margin:5px 0;font-size:12px;color:#567}
#props label>span.f{width:66px;flex:none;color:#789}
#props input[type=text],#props select,#props textarea{flex:1;min-width:0;height:26px;border:1px solid var(--bd);border-radius:4px;padding:0 5px;font:inherit;font-size:12px}
#props textarea{height:56px;padding:4px 5px;resize:vertical}
#props input[type=color]{width:34px;flex:none}
#props .hintx{color:#9aa;font-size:11px;margin:2px 0 6px}""", "组件面板样式")

# ── ② JS：组件注册表 + 渲染 + 插入 + 属性表单 ────────────────────
rep("""/* ───────── 纸张与页边距 ───────── */""",
    """/* ───────── ★组件化构建 ───────── */
/* 组件定义（数据驱动，可导出/导入）：
   html      : 插入时的模板
   match     : 识别页面上元素属于哪个组件（选择器）
   props     : 属性表单字段。k 支持 text / css:xxx / attr:xxx / 自定义（rows/cols 等） */
const BUILTIN = {
  h1:  { name:'一级标题', group:'标题', match:'h1', html:'<h1>文档标题</h1>',
         props:[{k:'text',t:'area',label:'文字'},{k:'css:text-align',t:'select',label:'对齐',opts:['center','left','right']}] },
  h2:  { name:'章节标题', group:'标题', match:'h2', html:'<h2>1 章标题</h2>',
         props:[{k:'text',t:'text',label:'文字'}] },
  h3:  { name:'小节标题', group:'标题', match:'h3', html:'<h3>1.1 节标题</h3>',
         props:[{k:'text',t:'text',label:'文字'}] },
  h4:  { name:'小标题',   group:'标题', match:'h4', html:'<h4>要点标题</h4>',
         props:[{k:'text',t:'text',label:'文字'}] },
  p:   { name:'正文段落', group:'正文', match:'p:not(.sub):not(.lead):not(.tabcap):not(.figcap)',
         html:'<p>正文段落内容。</p>',
         props:[{k:'text',t:'area',label:'文字'},
                {k:'css:font-size',t:'text',label:'字号'},{k:'css:color',t:'color',label:'颜色'},
                {k:'css:text-align',t:'select',label:'对齐',opts:['left','center','right','justify']},
                {k:'css:line-height',t:'text',label:'行距'},
                {k:'css:text-indent',t:'text',label:'首行缩进'}] },
  ul:  { name:'项目符号列表', group:'正文', match:'ul', html:'<ul><li>要点一</li><li>要点二</li></ul>',
         props:[{k:'items',t:'area',label:'条目（每行一条）'}] },
  ol:  { name:'编号列表', group:'正文', match:'ol', html:'<ol><li>第一步</li><li>第二步</li></ol>',
         props:[{k:'items',t:'area',label:'条目（每行一条）'}] },
  note:{ name:'提示框', group:'块', match:'div.note', html:'<div class="note">提示内容（待确认 / 以现场为准）</div>',
         props:[{k:'text',t:'area',label:'文字'}] },
  flow:{ name:'示意框', group:'块', match:'div.flow', html:'<div class="flow">流程 / 要点说明</div>',
         props:[{k:'text',t:'area',label:'文字'}] },
  tabcap:{ name:'表题', group:'图表', match:'div.tabcap', html:'<div class="tabcap">表 X-Y　说明文字</div>',
         props:[{k:'text',t:'text',label:'题注'}] },
  table:{ name:'表格', group:'图表', match:'table', html:'',
         props:[{k:'rows',t:'number',label:'数据行数'},{k:'cols',t:'number',label:'列数'},
                {k:'head',t:'bool',label:'首行为表头'},{k:'width',t:'text',label:'表宽(如 100%)'}] },
  figure:{ name:'图片 + 图题', group:'图表', match:'div.topo', html:'',
         props:[{k:'src',t:'text',label:'图片地址'},{k:'cap',t:'text',label:'图题'},
                {k:'imgw',t:'text',label:'图宽(如 120mm)'}] },
  img: { name:'图片', group:'图表', match:'img:not(.in-topo)', html:'',
         props:[{k:'attr:src',t:'text',label:'图片地址'},{k:'css:width',t:'text',label:'宽度'}] },
  hr:  { name:'分隔线', group:'版式', match:'hr:not(.top)', html:'<hr>', props:[] },
  hrtop:{ name:'封面色线', group:'版式', match:'hr.top', html:'<hr class="top">', props:[] },
  sub: { name:'封面副标题', group:'版式', match:'p.sub', html:'<p class="sub"><b>编制单位</b>：…　|　<b>版本</b>：V1.0　|　<b>日期</b>：2026 年 9 月</p>',
         props:[{k:'text',t:'area',label:'文字'}] },
  pagebreak:{ name:'分页符', group:'版式', match:'div.pgbreak', html:'<div class="pgbreak" contenteditable="false"></div>', props:[] },
  coverend:{ name:'封面结束标记', group:'版式', match:'div.pgbreak[data-num="none"]', html:'<div class="pgbreak" data-num="none" contenteditable="false"></div>', props:[] },
};
let COMPS = Object.assign({}, BUILTIN);
(function loadUserComps(){
  try{
    const t = localStorage.getItem('a4editor.comps');
    if(t) Object.assign(COMPS, JSON.parse(t));
  }catch(e){}
})();
function saveUserComps(){
  const user = {};
  for(const k in COMPS) if(!BUILTIN[k]) user[k] = COMPS[k];
  try{ localStorage.setItem('a4editor.comps', JSON.stringify(user)); }catch(e){}
}

function renderPalette(){
  const box = document.getElementById('palette'); if(!box) return;
  box.innerHTML = '';
  const groups = {};
  for(const k in COMPS) (groups[COMPS[k].group || '其他'] = groups[COMPS[k].group || '其他'] || []).push(k);
  for(const g in groups){
    const t = document.createElement('div');
    t.style.cssText = 'width:100%;color:#89a;font-size:11px;margin:4px 0 1px';
    t.textContent = g;
    box.appendChild(t);
    groups[g].forEach(k=>{
      const b = document.createElement('button');
      b.className = 't'; b.textContent = COMPS[k].name; b.title = '插入「' + COMPS[k].name + '」';
      b.onclick = () => insertComponent(k);
      box.appendChild(b);
    });
  }
}

function insertComponent(key){
  const c = COMPS[key]; if(!c) return;
  let html = c.html;
  if(key === 'table') html = '<table><colgroup><col style="width:50%"><col style="width:50%"></colgroup>'
      + '<thead><tr><th>列1</th><th>列2</th></tr></thead><tbody><tr><td>　</td><td>　</td></tr></tbody></table>';
  if(key === 'figure'){
    const src = prompt('图片地址（可用 data: 或相对路径）', '');
    if(src === null) return;
    html = '<div class="topo"><img src="' + src + '" alt=""><div class="cap">图 X-Y　说明文字</div></div>';
  }
  if(key === 'img'){
    const src = prompt('图片地址', ''); if(src === null) return;
    html = '<img src="' + src + '" alt="">';
  }
  if(key === 'pagebreak') html = '<div class="pgbreak" contenteditable="false"></div>';
  document.execCommand('insertHTML', false, html);
  renumber(); DIRTY = true; reflowSoon();
}

/* 识别元素的组件类型 */
function compOf(el){
  if(!el || el.nodeType !== 1) return null;
  for(const k in COMPS){
    const c = COMPS[k];
    if(!c.match) continue;
    try{ if(el.matches(c.match)) return k; }catch(e){}
  }
  // 图片在图框里 → 归到 figure
  if(el.nodeName === 'IMG' && el.closest('.topo')) return 'figure';
  return null;
}

/* 生成属性表单 */
function renderProps(){
  const box = document.getElementById('props'); if(!box) return;
  const who = document.getElementById('propWho');
  box.innerHTML = '';
  const el = selected;
  const key = compOf(el);
  if(!el || !key){
    if(who) who.textContent = '';
    box.innerHTML = '<span style="color:#89a;font-size:12px">先在右侧点选一个组件（标题/段落/表格/图片…）</span>';
    return;
  }
  const c = COMPS[key];
  if(who) who.textContent = '· ' + c.name;
  (c.props || []).forEach(f=>{
    const lab = document.createElement('label');
    const s = document.createElement('span'); s.className = 'f'; s.textContent = f.label || f.k;
    lab.appendChild(s);
    let inp;
    const cur = readProp(el, f, key);
    if(f.t === 'select'){
      inp = document.createElement('select');
      (f.opts || []).forEach(o=>{ const op = document.createElement('option'); op.value = o; op.textContent = o; inp.appendChild(op); });
      inp.value = cur || (f.opts || [])[0];
    } else if(f.t === 'area'){
      inp = document.createElement('textarea'); inp.value = cur;
    } else if(f.t === 'color'){
      inp = document.createElement('input'); inp.type = 'color'; inp.value = /^#/.test(cur) ? cur : '#000000';
    } else if(f.t === 'number'){
      inp = document.createElement('input'); inp.type = 'number'; inp.value = cur;
    } else if(f.t === 'bool'){
      inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!cur;
    } else {
      inp = document.createElement('input'); inp.type = 'text'; inp.value = cur;
    }
    inp.onchange = inp.oninput = () => {
      if(f.t === 'area' && inp === document.activeElement && f.k === 'text'){ /* 输入中不重排 */ }
      writeProp(el, f, key, f.t === 'bool' ? inp.checked : inp.value);
      renumber(); DIRTY = true; reflowSoon();
      if(f.k === 'text' || f.k === 'items' || f.k === 'cap') { /* 文本变化重绘表单以外保持不变 */ }
    };
    lab.appendChild(inp);
    box.appendChild(lab);
  });
  const tip = document.createElement('div');
  tip.className = 'hintx';
  tip.textContent = '改动即时生效；「文字」支持简单标签（如 <b>加粗</b>）。';
  box.appendChild(tip);
}

function readProp(el, f, key){
  const k = f.k;
  if(k === 'text') return el.innerHTML.replace(/<br\\s*\\/?>/gi, '\\n');
  if(k === 'items') return [...el.children].map(li=>li.innerHTML).join('\\n');
  if(k === 'cap'){ const c = el.querySelector('.cap'); return c ? c.textContent : ''; }
  if(k === 'src'){ const i = el.querySelector('img'); return i ? (i.getAttribute('src') || '') : ''; }
  if(k === 'imgw'){ const i = el.querySelector('img'); return i ? (i.style.width || '') : ''; }
  if(k === 'rows') return el.rows ? Math.max(0, el.rows.length - (el.tHead ? el.tHead.rows.length : 0)) : 0;
  if(k === 'cols') return el.rows && el.rows[0] ? el.rows[0].cells.length : 0;
  if(k === 'head') return !!(el.tHead && el.tHead.rows.length);
  if(k === 'width') return el.style.width || '100%';
  if(k.indexOf('css:') === 0){ const p = k.slice(4); return el.style.getPropertyValue(p) || ''; }
  if(k.indexOf('attr:') === 0) return el.getAttribute(k.slice(5)) || '';
  return '';
}

function writeProp(el, f, key, v){
  const k = f.k;
  if(k === 'text'){ el.innerHTML = String(v).replace(/\\n/g, '<br>'); return; }
  if(k === 'items'){
    const lines = String(v).split('\\n').filter(x=>x.trim() !== '');
    el.innerHTML = lines.map(x=>'<li>' + x + '</li>').join('');
    return;
  }
  if(k === 'cap'){ const c = el.querySelector('.cap'); if(c) c.textContent = v; return; }
  if(k === 'src'){ const i = el.querySelector('img'); if(i) i.setAttribute('src', v); return; }
  if(k === 'imgw'){ const i = el.querySelector('img'); if(i) i.style.width = v; return; }
  if(k === 'width'){ el.style.width = v; return; }
  if(k === 'rows' || k === 'cols' || k === 'head'){ resizeTable(el, k, v); return; }
  if(k.indexOf('css:') === 0){ el.style.setProperty(k.slice(4), v); return; }
  if(k.indexOf('attr:') === 0){ el.setAttribute(k.slice(5), v); return; }
}

function resizeTable(t, what, v){
  if(!t.rows || !t.rows.length) return;
  if(what === 'cols'){
    const want = Math.max(1, +v || 1), has = t.rows[0].cells.length;
    for(let i = has; i < want; i++) [...t.rows].forEach(r=>{ const c = r.cells[r.cells.length-1].cloneNode(false); c.innerHTML = '　'; r.appendChild(c); });
    for(let i = has; i > want; i--) [...t.rows].forEach(r=>{ if(r.cells.length > 1) r.deleteCell(r.cells.length - 1); });
    const cg = t.querySelector('colgroup');
    if(cg){ cg.innerHTML = ''; for(let i = 0; i < want; i++){ const c = document.createElement('col'); c.style.width = (100 / want).toFixed(1) + '%'; cg.appendChild(c); } }
    return;
  }
  if(what === 'rows'){
    const want = Math.max(1, +v || 1);
    const head = t.tHead ? t.tHead.rows.length : 0;
    const body = t.tBodies[0] || t.appendChild(document.createElement('tbody'));
    let has = body.rows.length;
    const cols = t.rows[0].cells.length;
    while(has < want){ const tr = body.insertRow(); for(let c = 0; c < cols; c++){ const td = tr.insertCell(); td.innerHTML = '　'; } has++; }
    while(has > want && body.rows.length > 1){ body.deleteRow(body.rows.length - 1); has--; }
    return;
  }
  if(what === 'head'){
    const on = !!v;
    if(on && !t.tHead){
      const body = t.tBodies[0], first = body && body.rows[0];
      if(first){
        const th = document.createElement('thead'), tr = document.createElement('tr');
        [...first.cells].forEach(c=>{ const h = document.createElement('th'); h.innerHTML = c.innerHTML; tr.appendChild(h); });
        th.appendChild(tr); t.insertBefore(th, t.firstChild); first.remove();
      }
    } else if(!on && t.tHead){
      const th = t.tHead, tr = th.rows[0];
      const body = t.tBodies[0] || t.appendChild(document.createElement('tbody'));
      const nr = body.insertRow(0);
      [...tr.cells].forEach(c=>{ const td = nr.insertCell(); td.innerHTML = c.innerHTML; });
      th.remove();
    }
  }
}

/* 新建 / 导出 / 导入 组件包 */
function newComponent(){
  if(!selected){ alert('先在右侧点选一个元素，再「新建组件」。'); return; }
  const name = prompt('新组件名称', '自定义组件'); if(!name) return;
  const key = 'u_' + Date.now().toString(36);
  COMPS[key] = {
    name: name, group: '自建', match: null,
    html: selected.outerHTML.replace(/ class="sel"/g, '').replace(/\\bsel\\b/g, '').replace(/ data-num="[^"]*"/g, ''),
    props: [{k:'html',t:'area',label:'HTML'}]
  };
  saveUserComps(); renderPalette();
  alert('已保存为组件「' + name + '」，出现在左侧「组件库 · 自建」里。');
}
function exportComps(){
  const user = {};
  for(const k in COMPS) if(!BUILTIN[k]) user[k] = COMPS[k];
  const blob = new Blob([JSON.stringify(user, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'a4components.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
}
function importComps(text){
  let o;
  try{ o = JSON.parse(text); }catch(e){ alert('组件包不是合法 JSON：' + e.message); return; }
  let n = 0;
  for(const k in o){
    const c = o[k];
    if(!c || !c.name || typeof c.html !== 'string') continue;
    COMPS[k] = { name:c.name, group:c.group || '导入', match:c.match || null, html:c.html, props:c.props || [] };
    n++;
  }
  saveUserComps(); renderPalette();
  alert('已加载 ' + n + ' 个组件。');
}

/* ───────── 纸张与页边距 ───────── */""", "组件化构建 JS")

# ── ③ 绑定按钮 + 把属性表单挂到选中回调 ──────────────────────────
rep("""$('#keepBrk').onchange=e=>{ KEEP=e.target.checked; paginate(); };""",
    """$('#cmpNew').onclick = newComponent;
$('#cmpExport').onclick = exportComps;
$('#cmpImport').onclick = () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => { const f = inp.files[0]; if(!f) return; const fr = new FileReader();
    fr.onload = () => importComps(fr.result); fr.readAsText(f, 'utf-8'); };
  inp.click();
};
$('#cmpReset').onclick = () => { COMPS = Object.assign({}, BUILTIN); renderPalette(); alert('已恢复内置组件（自建组件仍在本地，重新加载后可再导入）。'); };
$('#keepBrk').onchange=e=>{ KEEP=e.target.checked; paginate(); };""", "绑定组件按钮")

rep("""  const b = document.getElementById('desel'); if(b) b.onclick = () => selEl(null);""",
    """  const b = document.getElementById('desel'); if(b) b.onclick = () => selEl(null);
  renderProps();                                   // ★选中即生成组件属性表单""", "选中即出属性表单")

rep("""  doc.innerHTML = saved || DEMO;
  renumber(); syncBar();""",
    """  doc.innerHTML = saved || DEMO;
  renumber(); syncBar(); renderPalette();""", "启动渲染组件库")

# props 里 html 字段（自建组件）
rep("""  if(k.indexOf('css:') === 0){ const p = k.slice(4); return el.style.getPropertyValue(p) || ''; }""",
    """  if(k === 'html') return el.innerHTML;
  if(k.indexOf('css:') === 0){ const p = k.slice(4); return el.style.getPropertyValue(p) || ''; }""", "readProp 支持 html")

rep("""  if(k.indexOf('css:') === 0){ el.style.setProperty(k.slice(4), v); return; }""",
    """  if(k === 'html'){ el.innerHTML = v; return; }
  if(k.indexOf('css:') === 0){ el.style.setProperty(k.slice(4), v); return; }""", "writeProp 支持 html")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
