/* ══════════════════════════════════════════════════════════════
   源码(MD)视图：文档 ↔ Markdown 互转、页签切换、应用回文档
   依赖：00-base(EDITING)、10-inspector、25-blocks(syncBar)、35-numbering、70-pagination(paginate/syncFromPages/save)
   对外：imgMap toMd fromMd showTab applyMd
   ══════════════════════════════════════════════════════════════ */

/* ───────── ★Markdown 式源码编辑 ───────── */
let imgMap = {};
function toMd(){
  syncFromPages();
  imgMap = {}; let n = 0; const L = [];
  const inl = el => {
    let o = '';
    el.childNodes.forEach(nd=>{
      if(nd.nodeType===3) o += nd.textContent;
      else if(nd.nodeName==='B'||nd.nodeName==='STRONG') o += '**'+nd.textContent+'**';
      else if(nd.nodeName==='BR') o += ' ';
      else o += nd.textContent;
    });
    return o.replace(/\s+/g,' ').trim();
  };
  const pushTbl = t => {
    const cg = t.querySelector('colgroup');
    const pcts = cg ? [...cg.children].map(c=>parseFloat(c.style.width)||0) : [];
    const rows = [...t.rows].map(r=>[...r.cells].map(c=>c.textContent.replace(/\s+/g,' ').trim().replace(/\|/g,'\\|')));
    if(!rows.length) return;
    if(pcts.length && pcts.some(x=>x))
      L.push('<!-- cols: '+pcts.map(x=>x.toFixed(1)).join(',')+' -->');
    L.push('| '+rows[0].join(' | ')+' |');
    L.push('|'+rows[0].map(()=>' --- ').join('|')+'|');
    rows.slice(1).forEach(r=>L.push('| '+r.join(' | ')+' |'));
  };
  [...doc.children].forEach(el=>{
    const tag = el.nodeName, cls = el.classList;
    if(cls.contains('pgbreak')){                       // ★分页标记要能往返
      L.push('<!-- pagebreak: ' + (el.getAttribute('data-num') || 'arabic') + ' -->');
      L.push(''); return;
    }
    if(tag==='H1' || tag==='H2') L.push('# '+el.textContent.trim());
    else if(tag==='H3') L.push('## '+el.textContent.trim());
    else if(tag==='H4') L.push('### '+el.textContent.trim());
    else if(tag==='P'){
      const t=inl(el);
      if(t){
        const c=String(el.className||'').replace(/\bsel\b/g,'').trim();
        L.push((el.style.textAlign==='center'?'-> ':'') + (c?'{.'+c.split(/\s+/).join('.')+'} ':'') + t);
      }
    }
    else if(tag==='UL'||tag==='OL'){
      [...el.children].forEach((li,i)=>L.push((tag==='OL'?(i+1)+'. ':'- ')+inl(li)));
    }
    else if(cls.contains('note')) L.push('> '+el.textContent.trim());
    else if(cls.contains('tabcap')) L.push('[[表: '+el.textContent.trim()+']]');
    else if(cls.contains('figcap')) L.push('[[图: '+el.textContent.trim()+']]');
    else if(cls.contains('topo')){
      const im=el.querySelector('img'); if(im){ n++; imgMap['img:'+n]=im.getAttribute('src');
        const cp=el.querySelector('.cap'); L.push('!['+(cp?cp.textContent.trim():'')+'](img:'+n+')'); }
    }
    else if(tag==='IMG'){ n++; imgMap['img:'+n]=el.getAttribute('src'); L.push('![](img:'+n+')'); }
    else if(tag==='TABLE') pushTbl(el);
    else if(tag==='HR') L.push((el.className ? '{.'+String(el.className).trim()+'} ' : '') + '---');
    else if(el.textContent.trim()) L.push(el.textContent.trim());
    L.push('');
  });
  return L.join('\n').replace(/\n{3,}/g,'\n\n').trim()+'\n';
}
function fromMd(text){
  const lines = text.split('\n'); const out = []; let i = 0, firstH = true, pendCols = null;
  const esc = x => x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inl = x => esc(x).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  const src = x => /^img:\d+$/.test(x) && imgMap[x] ? imgMap[x] : x;
  while(i < lines.length){
    const s = lines[i].trim();
    if(!s){ i++; continue; }
    let m;
    if((m=/^<!--\s*cols\s*:\s*([\d.,\s]+?)\s*-->$/.exec(s))){ pendCols = m[1].split(',').map(x=>parseFloat(x)||0); i++; continue; }
    if((m=/^<!--\s*pagebreak\s*:\s*([a-z]+)\s*-->$/.exec(s))){
      out.push('<div class="pgbreak" data-num="'+m[1]+'" contenteditable="false"></div>'); i++; continue;
    }
    if(/^#\s+/.test(s)){
      const t=s.replace(/^#\s+/,''), tag=firstH?'h1':'h2'; firstH=false;
      out.push('<'+tag+'>'+inl(t)+'</'+tag+'>'); i++; continue;
    }
    if(/^##\s+/.test(s)){ out.push('<h3>'+inl(s.replace(/^##\s+/,''))+'</h3>'); i++; continue; }
    if(/^###\s+/.test(s)){ out.push('<h4>'+inl(s.replace(/^###\s+/,''))+'</h4>'); i++; continue; }
    if((m=/^\[\[表[:：]\s*(.+?)\]\]$/.exec(s))){ out.push('<div class="tabcap">'+esc(m[1])+'</div>'); i++; continue; }
    if((m=/^\[\[图[:：]\s*(.+?)\]\]$/.exec(s))){ out.push('<div class="figcap">'+esc(m[1])+'</div>'); i++; continue; }
    if((m=/^!\[(.*?)\]\((.*?)\)$/.exec(s))){
      const alt=m[1], im=src(m[2]);
      out.push(alt ? '<div class="topo"><img src="'+im+'" alt="'+esc(alt)+'"><div class="cap">'+esc(alt)+'</div></div>'
                   : '<img src="'+im+'">');
      i++; continue;
    }
    if(/^>\s?/.test(s)){ out.push('<div class="note">'+inl(s.replace(/^>\s?/,''))+'</div>'); i++; continue; }
    if(/^->\s?/.test(s)){
      let body=s.replace(/^->\s?/,''), cl='';
      const cm=/^\{\.([\w\-. ]+)\}\s*/.exec(body);
      if(cm){ cl=' class="'+cm[1].split('.').join(' ')+'"'; body=body.replace(cm[0],''); }
      out.push('<p style="text-align:center;text-indent:0"'+cl+'>'+inl(body)+'</p>'); i++; continue;
    }
    if(/^-\s+/.test(s)){
      const it=[]; while(i<lines.length && /^\s*-\s+/.test(lines[i])){ it.push('<li>'+inl(lines[i].trim().replace(/^-\s+/,''))+'</li>'); i++; }
      out.push('<ul>'+it.join('')+'</ul>'); continue;
    }
    if(/^\d+\.\s+/.test(s)){
      const it=[]; while(i<lines.length && /^\s*\d+\.\s+/.test(lines[i])){ it.push('<li>'+inl(lines[i].trim().replace(/^\d+\.\s+/,''))+'</li>'); i++; }
      out.push('<ol>'+it.join('')+'</ol>'); continue;
    }
    if(s.startsWith('|') && i+1<lines.length && /^\|[\s:\-\|]+\|$/.test(lines[i+1].trim())){
      const cells = ln => ln.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
      const hdr = cells(lines[i]); i += 2; const rows = [];
      while(i<lines.length && lines[i].trim().startsWith('|')){ rows.push(cells(lines[i])); i++; }
      const use = (pendCols && pendCols.length===hdr.length) ? pendCols : null; pendCols = null;
      let h = '<table><colgroup>'+hdr.map((_,c)=>'<col'+(use?' style="width:'+use[c].toFixed(1)+'%"':'')+'>').join('')+'</colgroup>';
      h += '<thead><tr>'+hdr.map(x=>'<th>'+inl(x)+'</th>').join('')+'</tr></thead><tbody>';
      rows.forEach(r=>{ h += '<tr>'+hdr.map((_,c)=>'<td>'+inl(r[c]||'')+'</td>').join('')+'</tr>'; });
      out.push(h+'</tbody></table>'); continue;
    }
    if((m=/^(?:\{\.([\w\-. ]+)\}\s*)?-{3,}$/.exec(s))){
      out.push('<hr'+(m[1]?' class="'+m[1].split('.').join(' ')+'"':'')+'>'); i++; continue;
    }
    let cl2='', body2=s;
    const cm2=/^\{\.([\w\-. ]+)\}\s*/.exec(s);
    if(cm2){ cl2=' class="'+cm2[1].split('.').join(' ')+'"'; body2=s.replace(cm2[0],''); }
    out.push('<p'+cl2+'>'+inl(body2)+'</p>'); i++;
  }
  return out.join('\n');
}

function showTab(name){
  document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on', x.dataset.tab===name));
  EDITING = (name !== 'prev');                 // ★富文本=可编辑分页；预览=只读分页
  const md = (name === 'md');
  $('#edit-pane').style.display = md ? 'none' : 'block';
  $('#md-pane').style.display   = md ? 'block' : 'none';
  if(md){ syncFromPages(); $('#mdBox').value = toMd(); }
  else { paginate(); }                         // 两个视图都渲染分页面
}
function applyMd(alertIt){
  const t = $('#mdBox').value;
  doc.innerHTML = fromMd(t);
  selEl(null); renumber(); save(); refreshInspector(); syncBar();
  if(alertIt) alert('已应用到文档。');
}
