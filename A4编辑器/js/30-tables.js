/* ══════════════════════════════════════════════════════════════
   表格：光标定位到单元格/表格、插入表格、列宽自适应、行列增删、属性表单驱动的改行列
   依赖：00-base、10-inspector(selected)、20-paper(contentW)、25-blocks(blockOf)、35-numbering(renumber)
   对外：currentCell currentTable insertTable autoWidth tableCmd resizeTable
         readColWidths setColWidths readRowHeight setRowHeight
   ══════════════════════════════════════════════════════════════ */

/* ───────── 表格 ───────── */
function currentCell(){
  if(selected && selected.closest){ const c = selected.closest('td,th'); if(c) return c; }
  let n = window.getSelection().anchorNode;
  n = n && n.nodeType===3 ? n.parentNode : n;
  while(n && n!==doc && !/^(TD|TH)$/.test(n.nodeName)) n=n.parentNode;
  return (n && n!==doc) ? n : null;
}
function currentTable(){
  if(selected && selected.closest){ const t = selected.closest('table'); if(t) return t; }
  const c=currentCell(); return c ? c.closest('table') : null;
}
function insertTable(cols, rows, head, firstBold){
  let h = '<table><colgroup>'+Array.from({length:cols},()=>`<col style="width:${(100/cols).toFixed(1)}%">`).join('')+'</colgroup>';
  if(head){ h += '<thead><tr>'+Array.from({length:cols},(_,i)=>`<th>列${i+1}</th>`).join('')+'</tr></thead>'; }
  h += '<tbody>';
  const n = head ? rows : rows;
  for(let r=0;r<n;r++){
    h += '<tr>'+Array.from({length:cols},(_,c)=>`<td>${r===0&&c===0&&firstBold?'<b>　</b>':'　'}</td>`).join('')+'</tr>';
  }
  h += '</tbody></table><p>　</p>';
  const nodes = insertHtmlBlock(h);                 // ★统一插入路径（不再直接 execCommand）
  const last = nodes && nodes.length ? nodes[nodes.length - 1] : null;
  const tb = last && last.previousElementSibling;
  if(tb && tb.tagName === 'TABLE') autoWidth(tb);
}
function autoWidth(t){
  if(!t) return;
  const rows=[...t.rows]; if(!rows.length) return;
  const n=rows[0].cells.length;
  const eff = s => [...String(s)].reduce((a,ch)=>a+(ch.codePointAt(0)>0x2000?1:0.55),0);
  const need=[];
  for(let c=0;c<n;c++){
    let mx=4; rows.forEach(r=>{ if(r.cells[c]) mx=Math.max(mx, eff(r.cells[c].textContent)); });
    need.push(Math.min(Math.max(mx,6),24));
  }
  const total=need.reduce((a,b)=>a+b,0);
  let pct=need.map(x=>x/total*100);
  const cw=contentW(), minPct=13/ (cw/10) *100;         // 13mm 保底
  pct=pct.map(p=>Math.max(p,minPct));
  const s=pct.reduce((a,b)=>a+b,0); pct=pct.map(p=>p/s*100);
  const cg=t.querySelector('colgroup');
  if(cg) [...cg.children].forEach((col,i)=>col.style.width=pct[i].toFixed(1)+'%');
}
function tableCmd(cmd){
  const t=currentTable(), c=currentCell(); if(!t||!c) return alert('请先把光标放进表格里');
  const row=c.parentNode, ti=row.rowIndex, ci=c.cellIndex;
  if(cmd==='rowAdd'){ const nr=row.cloneNode(true); [...nr.cells].forEach(x=>x.innerHTML='　'); row.after(nr); }
  if(cmd==='rowDel'){ if(t.rows.length<=1) return; row.remove(); }
  if(cmd==='colAdd'){ [...t.rows].forEach(r=>{ const nc=r.cells[ci].cloneNode(false); nc.innerHTML='　'; r.cells[ci].after(nc); });
    const cg=t.querySelector('colgroup'); if(cg){ const nc=cg.children[ci].cloneNode(); cg.children[ci].after(nc); } autoWidth(t); }
  if(cmd==='colDel'){ if(t.rows[0].cells.length<=1) return; [...t.rows].forEach(r=>r.cells[ci].remove());
    const cg=t.querySelector('colgroup'); if(cg && cg.children[ci]) cg.children[ci].remove(); autoWidth(t); }
  if(cmd==='cap'){
    const d=document.createElement('div'); d.className='tabcap'; d.textContent='表 X-Y　说明文字';
    t.parentNode.insertBefore(d,t); renumber();
  }
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

/* ── 列宽 / 行高（属性表单与工具栏共用）──
   列宽：逗号分隔，纯数字按百分比（"20,50,30" → 20%/50%/30%），也可写 mm；
   行高：纯数字按毫米（"9" → 9mm），设置到每个单元格的 height 上（表头+数据行一起）。 */
function readColWidths(t){
  const cg = t.querySelector('colgroup');
  if(!cg || !cg.children.length) return '';
  return [...cg.children].map(c => c.style.width || '').join(',');
}
function setColWidths(t, spec){
  const parts = String(spec).split(/[,，\s]+/).filter(x => x !== '');
  if(!parts.length) return false;
  let cg = t.querySelector('colgroup');
  if(!cg){
    cg = document.createElement('colgroup');
    const n = t.rows[0] ? t.rows[0].cells.length : parts.length;
    for(let i = 0; i < n; i++) cg.appendChild(document.createElement('col'));
    t.insertBefore(cg, t.firstChild);
  }
  while(cg.children.length < parts.length) cg.appendChild(document.createElement('col'));
  parts.forEach((w, i) => {
    const c = cg.children[i]; if(!c) return;
    c.style.width = /^\d+(\.\d+)?$/.test(w) ? w + '%' : w;
  });
  for(let i = parts.length; i < cg.children.length; i++) cg.children[i].style.width = '';
  return true;
}
function readRowHeight(t){
  const c = t.rows && t.rows[0] && t.rows[0].cells[0];
  return c ? (c.style.height || '') : '';
}
function setRowHeight(t, spec){
  const v = String(spec).trim();
  if(!v) return false;
  const h = /^\d+(\.\d+)?$/.test(v) ? v + 'mm' : v;
  [...t.rows].forEach(r => [...r.cells].forEach(c => { c.style.height = h; }));
  return true;
}

/* 新建 / 导出 / 导入 组件包 */
