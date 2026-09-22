/* ══════════════════════════════════════════════════════════════
   分页引擎：把 #doc 按 A4 版心切成 .paper 分页、编辑回写、重排后恢复光标
   依赖：00-base、20-paper（save 也定义在本文件：原先它在 80-io，而 reflowSoon 要调它，形成 70↔80 循环）
   对外：syncFromPages caretPath restoreCaret reflowSoon paginate debugReport save
   ══════════════════════════════════════════════════════════════ */


function syncFromPages(){
  if(!DIRTY) return false;                          // ★没编辑就不同步：加载后保持原分页
  const bs = pageBodies();
  if(!bs.length) return false;                      // 还没分页过，别覆盖数据源
  // ★手柄与落点虚线只是屏幕上的临时标记，绝不能被子页面同步抄进文档
  document.querySelectorAll('.a4handle').forEach(x => x.remove());
  document.querySelectorAll('.dropmark').forEach(x => x.classList.remove('dropmark'));
  let html = '';
  const nums = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || 'arabic');
  bs.forEach((b, i) => {
    // 只在**分节边界**插标记：节内允许自由回流
    if(i > 0 && nums[i] !== nums[i-1])
      html += '<div class="pgbreak" data-num="' + nums[i] + '" contenteditable="false"></div>\n';
    html += b.innerHTML + '\n';
  });
  doc.innerHTML = html;
  DIRTY = false;
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

/* ───────── 分页 ───────── */
function debugReport(){
  const key = el => el.nodeName + '|' + (el.textContent||'').replace(/\s+/g,'').slice(0,26);
  const src = [...doc.children];
  const seen = new Set();
  prevStage.querySelectorAll('.paper .body').forEach(b=>{
    [...b.children].forEach(c=>{
      seen.add(key(c));
      if(c.nodeName==='TABLE') [...c.rows].forEach(r=>seen.add('TR|'+r.textContent.replace(/\s+/g,'').slice(0,26)));
    });
  });
  const miss = src.filter(el=>!seen.has(key(el)));
  const lines = src.map((el,i)=>{
    const k = key(el);
    const st = seen.has(k) ? '在页内' : (el.nodeName==='TABLE' && seen.has('TR|'+el.textContent.replace(/\s+/g,'').slice(0,26)) ? '表已拆入页' : '*** 丢失 ***');
    return String(i).padStart(3) + '  <' + el.nodeName + '>  ' + (el.textContent||'').replace(/\s+/g,' ').trim().slice(0,34) + '   ' + st;
  });
  const box = document.createElement('div');
  box.className = 'paper';
  box.innerHTML = '<div class="body doc" style="position:absolute;left:31.7mm;top:20mm;width:146.6mm;font:9pt monospace;white-space:pre-wrap;overflow:visible">'
    + '源块=' + src.length + '  页内识别=' + seen.size + '  丢失=' + miss.length + '\n\n'
    + lines.join('\n') + '</div>';
  prevStage.appendChild(box);
}

function paginate(){
  if(!PAGING) syncFromPages();          // ★先把分页面上的编辑回写数据源
  const cwPx = contentW()*mmPx, chPx = contentH()*mmPx;
  // ★6mm 容差：内容区底边到页脚之间还有约 21mm 空隙，源文件常排到接近满页，
  //   不留容差会因 1mm 级渲染差异凭空多出一页（实测踩过）。
  const LIMIT = chPx + 6*mmPx;
  const pages=[];
  // ★有分节标记的文档 → 首页按"封面"处理（无页码）；否则常规阿拉伯页码
  const _sect = !!doc.querySelector('.pgbreak[data-num]');
  let body=null, curNum = SECTIONS[0] || (_sect ? 'none' : 'arabic');
  const newPage=(num)=>{ if(num) curNum=num;
    body=document.createElement('div'); body.className='body doc';
    body.style.cssText=`position:absolute;left:${paper.l*10}mm;top:${paper.t*10}mm;width:${contentW()}mm;height:${contentH()}mm;overflow:hidden`;
    const p=document.createElement('div'); p.className='paper'; p.appendChild(body);
    /* ★必须挂到常驻的 #measure 上再量：元素不在文档里时 scrollHeight 恒为 0，
       会导致所有内容都塞进第 1 页、其余被 overflow:hidden 裁掉。 */
    measure.appendChild(p);
    pages.push({el:p, num:curNum}); return body; };
  newPage(curNum);
  let full=false;                 // ★本页已确定超高（放了单个超大块）
  const hdr=$('#hdrText').value.trim(), ftr=$('#ftrText').value.trim(), coverNo=$('#coverNo').checked;

  [...doc.children].forEach(src=>{
    const el = src.cloneNode(true);
    // ★原分页标记：KEEP 时在此强制换页，并切换该页的页码模式
    if(el.classList && el.classList.contains('pgbreak')){
      if(KEEP && body.children.length) body = newPage(el.getAttribute('data-num') || 'arabic');
      return;                                   // 标记本身不渲染
    }
    body.appendChild(el);
    if(full || body.scrollHeight > LIMIT){
      if(el.nodeName==='TABLE' && el.rows.length>1){         // 长表：按行拆页、续页重复表头
        const rows=[...el.rows];
        const isHead = el.tHead && el.tHead.rows.length;
        const keep = isHead ? rows.slice(0,isHead) : [];
        const data = isHead ? rows.slice(isHead) : rows;
        let cur = el.cloneNode(false);
        if(el.querySelector('colgroup')) cur.appendChild(el.querySelector('colgroup').cloneNode(true));
        if(keep.length){ const th=document.createElement('thead');
          keep.forEach(r=>th.appendChild(r.cloneNode(true))); cur.appendChild(th); }
        let tb=document.createElement('tbody'); cur.appendChild(tb);
        body.replaceChild(cur, el);
        let placed=0;
        for(const r of data){
          tb.appendChild(r.cloneNode(true));
          if(body.scrollHeight > LIMIT && tb.rows.length > 1){
            tb.removeChild(tb.lastChild);
            body=newPage();
            const cont=cur.cloneNode(false);
            if(keep.length){ const h2=document.createElement('thead'); keep.forEach(x=>h2.appendChild(x.cloneNode(true))); cont.appendChild(h2); }
            const tb2=document.createElement('tbody'); cont.appendChild(tb2); body.appendChild(cont);
            tb2.appendChild(r.cloneNode(true)); tb=tb2;
          } else placed++;
        }
        full = body.scrollHeight > LIMIT;
        return;
      }
      body.removeChild(el);
      if(!body.children.length){ body.appendChild(el); full = body.scrollHeight > LIMIT; return; }
      body = newPage(); full = false; body.appendChild(el);
      full = body.scrollHeight > LIMIT;      // 这一块自己就超页 → 后续块另起一页
    }
  });

  prevStage.innerHTML='';
  if(SELFTEST_REPORT){                 // ★自测报告页（必须在这里生成，否则会被冲掉）
    const rp=document.createElement('div'); rp.className='paper';
    rp.innerHTML='<div class="body doc" style="position:absolute;left:20mm;top:15mm;width:170mm;'
      + 'font:8pt monospace;white-space:pre-wrap;overflow:visible">'
      + SELFTEST_REPORT.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>';
    prevStage.appendChild(rp);
  }
  // ★三段式页码：封面(none) 无页脚 / 目录(roman) 罗马 / 正文(arabic) 阿拉伯从 1 起
  const total = ORIG_TOTAL || pages.filter(p=>p.num!=='none').length;
  let ri=0, ai=0;
  pages.forEach(pg=>{
    const p=pg.el;
    if(hdr){ const h=document.createElement('div'); h.className='hdr'; h.textContent=hdr; p.appendChild(h); }
    let label='';
    if(pg.num==='roman'){ ri++; label='第 '+roman(ri)+' 页 / 共 '+total+' 页'; }
    else if(pg.num==='arabic'){
      // ★兼容旧行为：没有分节信息的文档，且勾选了「首页不显示页码」→ 首页跳过且不计数
      if(pg===pages[0] && coverNo && !SECTIONS.length){ /* 不写页脚 */ }
      else { ai++; label='第 '+ai+' 页 / 共 '+total+' 页'; }
    }
    // ★pg.num==='none'（封面节）→ 一律不写页脚（此前误入兜底分支，给了它阿拉伯页码）
    if(label){ const f=document.createElement('div'); f.className='ftr';
      f.textContent=(ftr?ftr+'　|　':'')+label; p.appendChild(f); }
    const shown = pg.num==='roman' ? roman(ri) : (pg.num==='none' ? '封面' : ai);
    p.dataset.num = pg.num || 'arabic';
    if(EDITING){
      p.classList.add('editing');
      const bd = p.querySelector('.body');
      if(bd){ bd.setAttribute('contenteditable','true'); bd.setAttribute('spellcheck','false'); }
    }
    const lbl=document.createElement('div'); lbl.className='hint';
    lbl.textContent='第 '+shown+' 页 / 共 '+total+' 页（'+(paper.ori==='portrait'?'纵向':'横向')+' A4）';
    prevStage.appendChild(p);
  });
  refreshHandles();                                 // 页面重建后把手柄贴回来（无选中则不动）
  return pages.length;
}
function save(){ try{ syncFromPages(); localStorage.setItem('a4editor.doc', doc.innerHTML);
  localStorage.setItem('a4editor.paper', JSON.stringify(paper)); }catch(e){} }
