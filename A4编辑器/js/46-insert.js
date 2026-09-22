/* ══════════════════════════════════════════════════════════════
   按组件插入与拖放落点：插到光标/落点所在块的后面、拖放高亮、把落点换算成光标
   依赖：00-base、35-numbering(renumber)、40-components(COMPS)、44-palette(DRAG_KEY)、70-pagination(reflowSoon)
   对外：caretBlock insertComponent insertHtmlBlock placeCaretAt blockAt markDropTarget bindDropZone
   ══════════════════════════════════════════════════════════════ */

/* ── 拖动插入：把卡片拖进文档 → 落点所在块之后 ── */
function placeCaretAt(x, y){
  let r = null;
  if(document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
  else if(document.caretPositionFromPoint){
    const p = document.caretPositionFromPoint(x, y);
    if(p){ r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
  }
  if(!r) return false;
  if(!pageBodies().some(b => b.contains(r.startContainer))) return false;   // 落点不在页内
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return true;
}
function blockAt(el){
  const host = pageBodies().find(b => b.contains(el));
  if(!host) return null;
  let b = el;
  while(b && b !== host && !/^(P|H1|H2|H3|H4|LI|DIV|TD|TH|BLOCKQUOTE|TABLE|PRE|UL|OL|DL|FIGURE)$/.test(b.nodeName))
    b = b.parentNode;
  return (b && b !== host) ? b : host;
}
function markDropTarget(el){
  document.querySelectorAll('.dropmark').forEach(x => x.classList.remove('dropmark'));
  if(!el) return;
  const blk = blockAt(el);
  if(blk) blk.classList.add('dropmark');
}
function bindDropZone(){
  const zone = document.getElementById('view'); if(!zone) return;
  zone.addEventListener('dragover', e => {
    if(!DRAG_KEY) return;
    e.preventDefault();
    if(e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    markDropTarget(document.elementFromPoint(e.clientX, e.clientY));
  });
  zone.addEventListener('drop', e => {
    const key = DRAG_KEY ||
      String((e.dataTransfer && e.dataTransfer.getData('text/plain')) || '').replace('A4COMP:', '');
    if(!key || !COMPS[key]) return;
    e.preventDefault();
    markDropTarget(null);
    placeCaretAt(e.clientX, e.clientY);      // 落点能定位就把光标放过去 → 插到"落点所在容器之后"
    insertComponent(key);                    // 落点不在页内时按当前光标位置插入
    DRAG_KEY = null;
  });
}

/* 光标所在的页体与块（用于「插入组件」定位）。
   ★不能用 blockOf()：它会优先返回 selected，而且会在 doc 上停下、认不出页体边界。 */
function caretBlock(){
  const sel = getSelection();
  if(!sel || !sel.rangeCount) return null;
  const a = sel.anchorNode; if(!a) return null;
  const n0 = a.nodeType === 3 ? a.parentNode : a;
  const host = pageBodies().find(b => n0 && b.contains(n0));
  if(!host) return null;
  let b = n0;
  while(b && b !== host && !/^(P|H1|H2|H3|H4|LI|DIV|TD|TH|BLOCKQUOTE)$/.test(b.nodeName)) b = b.parentNode;
  if(!b || b === host) return { host: host, blk: null };
  if(/^(TD|TH)$/.test(b.nodeName)) b = b.closest('table') || b;   // 表格内：整表之后插入
  return { host: host, blk: b };
}

/* 把一段 HTML 作为**独立块**插到光标所在块的后面 —— 全编辑器唯一的插入底层。
   ★以前有三条路（组件插入 / insertBlock / 直接 execCommand），产出一样但行为不一致：
     光标在段落里时 execCommand 会把新块并进当前段落（实测块数 2→2、字符 28→91）。现在只有这一条。 */
function insertHtmlBlock(html){
  const cb = caretBlock();
  let placed = false, nodes = null;
  if(cb){
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    nodes = [...tmp.childNodes];
    const frag = document.createDocumentFragment();
    nodes.forEach(nd => frag.appendChild(nd));
    if(cb.blk) cb.host.insertBefore(frag, cb.blk.nextSibling);
    else       cb.host.appendChild(frag);
    const last = nodes[nodes.length - 1];
    const sel = getSelection();
    if(last && sel){                       // 光标落到新块之后，便于连续插入
      const r = document.createRange(); r.setStartAfter(last); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
    placed = nodes.length > 0;
  }
  if(!placed) document.execCommand('insertHTML', false, html);   // 光标不在页体内时的兜底
  renumber(); DIRTY = true; reflowSoon();
  return nodes;
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
  return insertHtmlBlock(html);
}
