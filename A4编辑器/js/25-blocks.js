/* ══════════════════════════════════════════════════════════════
   块级与行内格式：块标签转换、层级升降、行内样式、工具栏状态回填
   依赖：00-base、10-inspector(selected)、20-paper(paper)
   对外：blockOf setBlockTag LADDER shiftLevel wrapSelection applyInline syncBar
   ══════════════════════════════════════════════════════════════ */

/* ───────── 选区与块级操作 ───────── */
function blockOf(node){
  // ★有选中元素时，块级命令一律作用于它（元素/容器级编辑）
  if(selected && document.contains(selected) && !selected.closest('#panel,#side')) return selected;
  let n = node && node.nodeType===3 ? node.parentNode : node;
  while(n && n!==doc && !/^(P|H1|H2|H3|H4|LI|DIV|TD|TH|BLOCKQUOTE)$/.test(n.nodeName)) n=n.parentNode;
  return (n && n!==doc) ? n : null;
}
function setBlockTag(spec){
  // ★支持 "tag" 或 "tag.class"：tabcap/figcap/note 必须生成 <div class="…">，
  //   不能 createElement('tabcap')（那是非法自定义元素，样式不生效）。
  const dot = String(spec).indexOf('.');
  const tag = dot < 0 ? spec : spec.slice(0, dot);
  const cls = dot < 0 ? '' : spec.slice(dot + 1);
  const b = blockOf(window.getSelection().anchorNode);
    if(!b){ // 无块：插入一个（走统一插入路径）
      insertHtmlBlock(`<${tag}${cls ? ' class="' + cls + '"' : ''}>　</${tag}>`); return; }
  if(b.nodeName.toLowerCase()==='li'){ // 列表项 → 换成标题则脱去 li
    const el = document.createElement(tag); el.innerHTML = b.innerHTML;
    if(cls) el.className = cls;
    b.parentNode.replaceChild(el, b); return;
  }
  const el = document.createElement(tag);
  el.innerHTML = b.innerHTML;
  if(cls) el.className = cls; else el.removeAttribute('class');
  b.parentNode.replaceChild(el, b);
  if(selected === b){ selected = el; el.classList.add('sel'); }   // ★换标签后保持选中
  const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
}
/* 层级升降：正文 < h4 < h3 < h2 < h1 */
const LADDER = ['p','h4','h3','h2','h1'];
function shiftLevel(dir){
  const b = blockOf(window.getSelection().anchorNode);
  if(!b) return;
  let i = LADDER.indexOf(b.nodeName.toLowerCase());
  if(i<0) i=0;
  i = Math.max(0, Math.min(LADDER.length-1, i + dir));
  setBlockTag(LADDER[i]);
  syncBar();
}
/* 行内格式：字号/颜色/字体 —— 用 span 包裹选区 */
function wrapSelection(style){
  const sel = window.getSelection();
  if(!sel.rangeCount || sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.setAttribute('style', style);
  try{ span.appendChild(r.extractContents()); r.insertNode(span); }
  catch(e){ return false; }
  sel.removeAllRanges(); const nr=document.createRange(); nr.selectNodeContents(span); sel.addRange(nr);
  return true;
}
function applyInline(prop, val){
  if(!wrapSelection(`${prop}:${val}`)){                    // 无选区 → 作用于整个块
    const b = blockOf(window.getSelection().anchorNode);
    if(b) b.style[ prop.replace(/-(\w)/g,(m,c)=>c.toUpperCase()) ] = val;
  }
}
/* 工具栏状态回显 */
function syncBar(){
  const b = blockOf(window.getSelection().anchorNode);
  const tag = b ? b.nodeName.toLowerCase() : 'p';
  const c0 = b ? String(b.className||'').replace(/\bsel\b/g,'').trim().split(/\s+/)[0] : '';
  const guess = c0 ? tag + '.' + c0 : tag;
  const opts = [...$('#blk').options].map(o=>o.value);
  $('#blk').value = opts.includes(guess) ? guess : (opts.includes(tag) ? tag : 'p');
  $('#bB').classList.toggle('on', document.queryCommandState('bold'));
  $('#bI').classList.toggle('on', document.queryCommandState('italic'));
  $('#bU').classList.toggle('on', document.queryCommandState('underline'));
}

