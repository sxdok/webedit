# -*- coding: utf-8 -*-
"""让编辑器支持参考文件（AGV方案 V5.0）里的全部排版特性：
① 修 bug：块级样式下拉的 tabcap/figcap/note 生成合法标签（div.class / p.class）；
② 新增按钮：• 列表 / 1. 列表 / 提示框 / 图文框；
③ 补 CSS：.sub、hr.top、.topo、.cap、b/strong、p.lead、.flow、a；
④ syncBar 能回显带 class 的块级样式。"""
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


# ── ① 补 CSS（与参考文件一致）────────────────────────────────────
rep(""".doc .sel{outline:2px solid var(--ui2);outline-offset:1px;background:rgba(46,116,181,.06)}""",
    """.doc .sel{outline:2px solid var(--ui2);outline-offset:1px;background:rgba(46,116,181,.06)}
/* ── 以下规则对齐参考文件（AGV方案 V5.0）的排版特性 ── */
.doc .sub{font-size:9pt;font-family:"黑体",SimHei,sans-serif;color:#5a5a5a;text-align:center;letter-spacing:2px;text-indent:0;margin:0}
.doc hr.top{margin:6px 0 10px;border:none;border-top:2px solid #1f4e79}
.doc .meta{margin:6pt 0 0;font-size:10.5pt;color:#808080;text-align:center;text-indent:0}
.doc p.lead{color:#12395e;font-weight:600}
.doc b,.doc strong{color:#12395e;font-weight:600}
.doc .flow{margin:5px 0 8px;padding:7px 11px;background:#f5f9fd;border:1px solid #cfe0ef;
           border-left:4px solid var(--ui2);border-radius:3px;text-indent:0}
.doc .topo{text-align:center;margin:5px 0 3px;break-inside:avoid;page-break-inside:avoid}
.doc .topo img{border:1px solid #c8d3de;border-radius:3px;max-width:146.6mm;max-height:200mm;height:auto;margin:0 auto}
.doc .cap{margin-top:3pt;font-size:10.5pt;color:#333;text-align:center;text-indent:0}
.doc a{color:inherit;text-decoration:none}""", "补 CSS")

# ── ② 下拉：块级样式支持 tag.class；并补齐 sub/lead/flow ─────────
rep("""      <option value="tabcap">表题</option><option value="figcap">图题</option><option value="note">提示框</option>""",
    """      <option value="div.tabcap">表题</option><option value="div.figcap">图题</option>
      <option value="div.note">提示框</option><option value="p.sub">副标题</option>
      <option value="p.lead">导语</option><option value="div.flow">示意框</option>""", "下拉补齐")

# ── ③ setBlockTag 支持 "tag.class"（修非法标签 bug）─────────────
rep("""function setBlockTag(tag){
  const b = blockOf(window.getSelection().anchorNode);""",
    """function setBlockTag(spec){
  // ★支持 "tag" 或 "tag.class"：tabcap/figcap/note 必须生成 <div class="…">，
  //   不能 createElement('tabcap')（那是非法自定义元素，样式不生效）。
  const dot = String(spec).indexOf('.');
  const tag = dot < 0 ? spec : spec.slice(0, dot);
  const cls = dot < 0 ? '' : spec.slice(dot + 1);
  const b = blockOf(window.getSelection().anchorNode);""", "setBlockTag 解析 spec")

rep("""  if(b.nodeName.toLowerCase()==='li'){ // 列表项 → 换成标题则脱去 li
    const el = document.createElement(tag); el.innerHTML = b.innerHTML;
    b.parentNode.replaceChild(el, b); return;
  }
  const el = document.createElement(tag);
  el.innerHTML = b.innerHTML;
  b.parentNode.replaceChild(el, b);""",
    """  if(b.nodeName.toLowerCase()==='li'){ // 列表项 → 换成标题则脱去 li
    const el = document.createElement(tag); el.innerHTML = b.innerHTML;
    if(cls) el.className = cls;
    b.parentNode.replaceChild(el, b); return;
  }
  const el = document.createElement(tag);
  el.innerHTML = b.innerHTML;
  if(cls) el.className = cls; else el.removeAttribute('class');
  b.parentNode.replaceChild(el, b);""", "setBlockTag 应用 class")

# 无块时也按 spec 插入
rep("""  if(!b){ // 无块：直接插入一个
    document.execCommand('insertHTML', false, `<${tag}>${tag[0]==='p'?'':'　'}</${tag}>`); return; }""",
    """  if(!b){ // 无块：直接插入一个
    document.execCommand('insertHTML', false,
      `<${tag}${cls?' class="'+cls+'"':''}>${tag==='p'?'　':'　'}</${tag}>`); return; }""",
    "setBlockTag 无块插入")

# ── ④ syncBar 回显带 class 的块级样式 ───────────────────────────
rep("""  $('#blk').value = ['p','h1','h2','h3','h4','tabcap','figcap','note'].includes(tag) ? tag : 'p';""",
    """  const c0 = b ? String(b.className||'').replace(/\\bsel\\b/g,'').trim().split(/\\s+/)[0] : '';
  const guess = c0 ? tag + '.' + c0 : tag;
  const opts = [...$('#blk').options].map(o=>o.value);
  $('#blk').value = opts.includes(guess) ? guess : (opts.includes(tag) ? tag : 'p');""",
    "syncBar 回显")

# ── ⑤ 新增按钮：列表 / 提示框 / 图文框 ──────────────────────────
rep("""  <div class="grp">
    <label>插入</label>""",
    """  <div class="grp">
    <label>列表 / 块</label>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      <button class="t" id="bUl" title="项目符号列表">• 列表</button>
      <button class="t" id="bOl" title="编号列表">1. 列表</button>
      <button class="t" id="bNote" title="插入提示框（绿色左边框）">提示框</button>
      <button class="t" id="bFlow" title="插入示意框（浅蓝左边框）">示意框</button>
      <button class="t" id="bTopo" title="把选中的图片包成图文框（.topo + .cap）">图文框</button>
    </div>
  </div>
  <div class="grp">
    <label>插入</label>""", "新增按钮组")

rep("""$('#btnOpen').onclick=()=>$('#fileHtml').click();""",
    """/* 列表 / 提示框 / 示意框 / 图文框 */
function insertBlock(html){ document.execCommand('insertHTML', false, html); DIRTY = true; reflowSoon(); }
$('#bUl').onclick=()=>{
  const b = blockOf(window.getSelection().anchorNode);
  if(b && b.nodeName==='UL'){ setBlockTag('p'); return; }
  const items = b ? [b] : [];
  let inner = '';
  if(b && b.nodeName==='OL'){ inner = b.innerHTML; }
  else { inner = '<li>' + (b ? b.innerHTML : '列表项') + '</li>'; }
  document.execCommand('insertHTML', false, '<ul>'+inner+'</ul>');
  if(b && b.parentNode) b.remove();
  DIRTY = true; reflowSoon();
};
$('#bOl').onclick=()=>{
  const b = blockOf(window.getSelection().anchorNode);
  let inner;
  if(b && b.nodeName==='OL'){ setBlockTag('p'); return; }
  if(b && b.nodeName==='UL'){ inner = b.innerHTML; }
  else { inner = '<li>' + (b ? b.innerHTML : '列表项') + '</li>'; }
  document.execCommand('insertHTML', false, '<ol>'+inner+'</ol>');
  if(b && b.parentNode && b.nodeName!=='UL') b.remove();
  DIRTY = true; reflowSoon();
};
$('#bNote').onclick=()=>insertBlock('<div class="note">提示内容（待确认 / 以现场为准）</div>');
$('#bFlow').onclick=()=>insertBlock('<div class="flow">流程 / 要点说明</div>');
$('#bTopo').onclick=()=>{
  const sel = selected && selected.nodeName==='IMG' ? selected
            : [...(selected ? [selected] : [])].find(x=>x.nodeName==='IMG');
  const img = sel || [...doc.querySelectorAll('img')].pop();
  if(!img){ alert('请先插入或选中一张图片，再用「图文框」。'); return; }
  const cap = prompt('图题文字（编号会按章自动生成）', '说明文字');
  const wrap = document.createElement('div'); wrap.className = 'topo';
  wrap.innerHTML = '<div class="cap">图 X-Y　' + (cap || '说明文字') + '</div>';
  img.parentNode.insertBefore(wrap, img);
  wrap.insertBefore(img, wrap.firstChild);
  renumber(); DIRTY = true; reflowSoon();
  alert('已生成图文框（.topo + .cap），已按章重排图号。');
};
$('#btnOpen').onclick=()=>$('#fileHtml').click();""", "按钮逻辑")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
