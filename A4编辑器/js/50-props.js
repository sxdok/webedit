/* ══════════════════════════════════════════════════════════════
   属性词汇表：属性字段的读（readProp）/写（writeProp）、字段分组规则
   依赖：00-base、30-tables(resizeTable/readColWidths/setColWidths/readRowHeight/setRowHeight)
   对外：PROP_GROUP_ORDER PROP_OPEN savePropOpen groupOfProp propGroupOpen readProp writeProp
   ══════════════════════════════════════════════════════════════ */

/* ── 属性编辑器（对齐 Qt Designer 的 Property Editor）──
   两列表格「属性 | 值」+ 分组折叠 + 顶部过滤框；
   分组顺序按"常改的排前面"：文字内容 → 表格与尺寸 → 样式 → 高级（默认收起）。 */
const PROP_GROUP_ORDER = ['文字内容', '表格与尺寸', '样式', '高级', '其他'];
let PROP_OPEN = {};
try{ PROP_OPEN = JSON.parse(localStorage.getItem('a4editor.propOpen') || '{}') || {}; }catch(e){ PROP_OPEN = {}; }
function savePropOpen(){ try{ localStorage.setItem('a4editor.propOpen', JSON.stringify(PROP_OPEN)); }catch(e){} }
function groupOfProp(f){
  if(f.group) return f.group;
  const k = f.k;
  if(k === 'text' || k === 'items' || k === 'cap' || k === 'src' || k === 'imgw'
     || k === 'imgs' || k === 'pairs' || k === 'title' || k === 'html') return '文字内容';
  if(k === 'rows' || k === 'cols' || k === 'head' || k === 'colw' || k === 'rowh' || k === 'width') return '表格与尺寸';
  if(k.indexOf('css:') === 0) return '样式';
  if(k.indexOf('attr:') === 0) return '高级';
  return '其他';
}
function propGroupOpen(g){ return PROP_OPEN[g] !== undefined ? !!PROP_OPEN[g] : (g !== '高级'); }
function readProp(el, f, key){
  const k = f.k;
  if(k === 'text') return el.innerHTML.replace(/<br\s*\/?>/gi, '\n');
  if(k === 'items') return [...el.children].map(li=>li.innerHTML).join('\n');
  if(k === 'cap'){ const c = el.querySelector('.cap'); return c ? c.textContent : ''; }
  if(k === 'src'){ const i = el.querySelector('img'); return i ? (i.getAttribute('src') || '') : ''; }
  if(k === 'imgw'){ const i = el.querySelector('img'); return i ? (i.style.width || '') : ''; }
  if(k === 'imgs') return [...el.querySelectorAll('img')].map(i => i.getAttribute('src') || '').join('\n');
  if(k === 'title'){ const t = el.querySelector('.pch,.ttl,.cap'); return t ? t.textContent : ''; }
  if(k === 'pairs') return [...el.querySelectorAll('dt')].map(dt => {
    const dd = dt.nextElementSibling;
    return (dt.textContent || '') + '|' + (dd && dd.tagName === 'DD' ? dd.textContent : '');
  }).join('\n');
  if(k === 'rows') return el.rows ? Math.max(0, el.rows.length - (el.tHead ? el.tHead.rows.length : 0)) : 0;
  if(k === 'cols') return el.rows && el.rows[0] ? el.rows[0].cells.length : 0;
  if(k === 'head') return !!(el.tHead && el.tHead.rows.length);
  if(k === 'width') return el.style.width || '100%';
  if(k === 'colw') return readColWidths(el);
  if(k === 'rowh') return readRowHeight(el);
  if(k === 'html') return el.innerHTML;
  if(k.indexOf('css:') === 0){ const p = k.slice(4); return el.style.getPropertyValue(p) || ''; }
  if(k.indexOf('attr:') === 0) return el.getAttribute(k.slice(5)) || '';
  return '';
}

function writeProp(el, f, key, v){
  const k = f.k;
  if(k === 'text'){ el.innerHTML = String(v).replace(/\n/g, '<br>'); return; }
  if(k === 'items'){
    const lines = String(v).split('\n').filter(x=>x.trim() !== '');
    el.innerHTML = lines.map(x=>'<li>' + x + '</li>').join('');
    return;
  }
  if(k === 'cap'){ const c = el.querySelector('.cap'); if(c) c.textContent = v; return; }
  if(k === 'src'){ const i = el.querySelector('img'); if(i) i.setAttribute('src', v); return; }
  if(k === 'imgw'){ const i = el.querySelector('img'); if(i) i.style.width = v; return; }
  if(k === 'imgs'){
    // 多图：按行依次写进每个 .cell（没有 .cell 就写进元素本身）
    const urls = String(v).split('\n').map(s => s.trim());
    const slots = el.querySelectorAll('.cell').length ? [...el.querySelectorAll('.cell')] : [el];
    slots.forEach((slot, i) => {
      let img = slot.querySelector('img');
      if(!urls[i]){ if(img) img.remove(); return; }
      if(!img){ img = document.createElement('img'); slot.insertBefore(img, slot.firstChild); }
      img.setAttribute('src', urls[i]);
    });
    return;
  }
  if(k === 'width'){ el.style.width = v; return; }
  if(k === 'rows' || k === 'cols' || k === 'head'){ resizeTable(el, k, v); return; }
  if(k === 'colw'){ setColWidths(el, v); return; }
  if(k === 'rowh'){ setRowHeight(el, v); return; }
  if(k === 'title'){ const t = el.querySelector('.pch,.ttl,.cap'); if(t) t.textContent = v; return; }
  if(k === 'pairs'){
    el.innerHTML = String(v).split('\n').filter(x => x.trim() !== '').map(line => {
      const p = line.split('|');
      return '<dt>' + (p[0] || '').trim() + '</dt><dd>' + (p[1] || '').trim() + '</dd>';
    }).join('');
    return;
  }
  if(k === 'html'){ el.innerHTML = v; return; }
  if(k.indexOf('css:') === 0){ el.style.setProperty(k.slice(4), v); return; }
  if(k.indexOf('attr:') === 0){ el.setAttribute(k.slice(5), v); return; }
}

