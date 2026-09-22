/* ══════════════════════════════════════════════════════════════
   事件绑定：页签、纸张/页边距、层级/字体/段落、表格、插入、加载保存按钮、
             快捷键、点击选中、打印前自动分页
   依赖：以上全部模块（只做绑定，不承载业务逻辑）
   对外：无（顶层即执行）
   ══════════════════════════════════════════════════════════════ */

/* ───────── 事件绑定 ───────── */
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{
  // ★从源码切走时自动应用，避免改动丢失
  const cur = document.querySelector('#tabs button.on');
  if(cur && cur.dataset.tab==='md' && b.dataset.tab!=='md') applyMd();
  showTab(b.dataset.tab);
});
$('#mdApply').onclick = ()=>applyMd(true);
$('#mdReload').onclick = ()=>{ $('#mdBox').value = toMd(); };
document.querySelectorAll('[data-ori]').forEach(b=>b.onclick=()=>{ paper.ori=b.dataset.ori; applyPaper(); });
['mgT','mgB','mgL','mgR'].forEach((id,i)=>$('#'+id).onchange=e=>{
  const v=Math.max(0,+e.target.value||0); ['t','b','l','r'][i] && (paper[['t','b','l','r'][i]]=v); applyPaper(); });
$('#mgReset').onclick=()=>{ Object.assign(paper,{t:2.54,b:2.54,l:3.17,r:3.17}); applyPaper(); };
$('#btnUp').onclick=()=>shiftLevel(+1);
$('#btnDown').onclick=()=>shiftLevel(-1);
$('#blk').onchange=e=>{ setBlockTag(e.target.value); syncBar(); };
$('#fname').onchange=e=>applyInline('font-family', `"${e.target.value}",${e.target.value==='Times New Roman'?'serif':'"宋体",SimSun,serif'}`);
$('#fsize').onchange=e=>{ if(e.target.value){ applyInline('font-size', e.target.value+'pt'); $('#fpt').value=e.target.value; } };
$('#fpt').onchange=e=>{ if(e.target.value) applyInline('font-size', e.target.value+'pt'); };
$('#fcolor').oninput=e=>applyInline('color', e.target.value);
$('#bB').onclick=()=>document.execCommand('bold');
$('#bI').onclick=()=>document.execCommand('italic');
$('#bU').onclick=()=>document.execCommand('underline');
$('#align').onchange=e=>{ const b=blockOf(window.getSelection().anchorNode); if(b) b.style.textAlign=e.target.value; };
$('#lh').onchange=e=>{ const b=blockOf(window.getSelection().anchorNode); if(b) b.style.lineHeight=e.target.value; };
$('#bInd').onclick=()=>{ const b=blockOf(window.getSelection().anchorNode); if(!b) return;
  b.style.textIndent = (b.style.textIndent==='2em') ? '0' : '2em'; };
$('#tNew').onclick=()=>$('#dlgTable').showModal();
$('#dlgTable').addEventListener('close',e=>{ if($('#dlgTable').returnValue==='ok')
  insertTable(+$('#twCols').value||3, +$('#twRows').value||3, $('#twHead').checked, $('#twFirst').checked); });
$('#tRowAdd').onclick=()=>tableCmd('rowAdd');
$('#tRowDel').onclick=()=>tableCmd('rowDel');
$('#tColAdd').onclick=()=>tableCmd('colAdd');
$('#tColDel').onclick=()=>tableCmd('colDel');
$('#tCap').onclick=()=>tableCmd('cap');
$('#tAutoW').onclick=()=>autoWidth(currentTable());
$('#tColW').onchange=e=>{ const t=currentTable(); if(!t) return alert('先把光标放到表格里（或选中表格）。');
  if(setColWidths(t, e.target.value)){ DIRTY=true; reflowSoon(); } };
$('#tRowH').onchange=e=>{ const t=currentTable(); if(!t) return alert('先把光标放到表格里（或选中表格）。');
  if(setRowHeight(t, e.target.value)){ DIRTY=true; reflowSoon(); } };
$('#iImg').onclick=()=>$('#fileImg').click();
$('#fileImg').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const fr=new FileReader();
  fr.onload=()=>{ insertHtmlBlock(`<img src="${fr.result}" alt="图片">`); }; fr.readAsDataURL(f); e.target.value=''; };
$('#iFigCap').onclick=()=>{ const im=[...doc.querySelectorAll('img')].filter(i=>{ const s=window.getSelection();
  return s.anchorNode && (i.contains(s.anchorNode) || i===s.anchorNode); })[0];
  const d=document.createElement('div'); d.className='figcap'; d.textContent='图 X-Y　说明文字';
  (im?im.nextSibling?im.parentNode.insertBefore(d,im.nextSibling):im.parentNode.appendChild(d):doc.appendChild(d)); renumber(); };
$('#reno').onclick=()=>{ renumber(); alert('已按章重排图/表编号。'); };
$('#pnIns').onclick=()=>{ const v=prompt('页脚内容（{page} 当前页，{total} 总页数）', ($('#ftrText').value||'金卫智慧舱方案')+'　|　第 {page} 页 / 共 {total} 页');
  if(v!==null) $('#ftrText').value=v; };
$('#btnSave').onclick=()=>{ const n=prompt('保存文件名', ($('#hdrText').value||'A4文档')+'.html'); if(n) download(n, buildHTML()); };
$('#btnPdf').onclick=()=>{ document.querySelector('#tabs button[data-tab="prev"]').click();
  setTimeout(()=>window.print(), 350); };
$('#cmpNew').onclick = newComponent;
const _palF = $('#palFilter'); if(_palF) _palF.addEventListener('input', renderPalette);
$('#palAllOpen').onclick = () => setAllPal(true);
bindDropZone();
$('#cmpExport').onclick = exportComps;
$('#cmpImport').onclick = () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => { const f = inp.files[0]; if(!f) return; const fr = new FileReader();
    fr.onload = () => importComps(fr.result); fr.readAsText(f, 'utf-8'); };
  inp.click();
};
$('#cmpPickDir').onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.webkitdirectory = true; inp.multiple = true;
  inp.onchange = () => { if(inp.files && inp.files.length) pickComponentDir(inp.files); };
  inp.click();
};
$('#cmpExportDir').onclick = exportComponentDir;
$('#cmpReset').onclick = () => {
  for(const k in COMPS) if(!FROMFILE[k]) delete COMPS[k];
  try{ localStorage.removeItem('a4editor.comps'); }catch(e){}
  renderPalette(); alert('已清空自建组件；来自「组件/」目录的组件不受影响。');
};
$('#keepBrk').onchange=e=>{ KEEP=e.target.checked; paginate(); };
/* 列表转换：把选中的行转成 ul/ol（插入类内容统一走左侧组件选择器） */
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
$('#btnOpen').onclick=()=>$('#fileHtml').click();
$('#fileHtml').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const fr=new FileReader();
  fr.onload=()=>loadHTML(fr.result, f.name); fr.readAsText(f,'utf-8'); e.target.value=''; };
$('#btnDemo').onclick=()=>{ if(doc.textContent.trim() && !confirm('将覆盖当前内容，继续？')) return; doc.innerHTML=DEMO; renumber(); save(); };
const PICKABLE = 'h1,h2,h3,h4,p,li,ul,ol,dl,dt,dd,table,tr,td,th,img,blockquote,pre,a,b,span.badge,span.kbd,'
  + 'div.note,div.tabcap,div.figcap,div.abs,div.fn,div.fig2,div.warn,div.pcard,div.cols2,div.cols3,div.flow,div.topo';
function onPick(e){
  const el = e.target.closest && e.target.closest(PICKABLE);
  if(el && document.contains(el) && el !== doc && !el.closest('#panel,#side')) selEl(el);
}
document.addEventListener('click', onPick);
document.addEventListener('input', e=>{
  if(e.target.closest && e.target.closest('#prevStage')){ DIRTY = true; reflowSoon(); }
});
doc.addEventListener('keyup', syncBar);
doc.addEventListener('mouseup', syncBar);
doc.addEventListener('input', ()=>{ clearTimeout(doc._t); doc._t=setTimeout(save, 700); });
document.addEventListener('keydown', e=>{
  if(e.ctrlKey && e.altKey && e.key==='ArrowLeft'){ e.preventDefault(); shiftLevel(+1); }
  if(e.ctrlKey && e.altKey && e.key==='ArrowRight'){ e.preventDefault(); shiftLevel(-1); }
  if(e.ctrlKey && e.key==='s'){ e.preventDefault(); $('#btnSave').click(); }
});
window.addEventListener('beforeunload', ()=>{ try{ localStorage.setItem('a4editor.doc', doc.innerHTML); localStorage.setItem('a4editor.paper', JSON.stringify(paper)); }catch(e){} });
/* ★直接按 Ctrl+P 也要能打：打印前自动分页，否则预览区为空会打出空白页 */
window.addEventListener('beforeprint', ()=>{ try{ paginate(); }catch(e){} });
