/* ══════════════════════════════════════════════════════════════
   组件选择器（对齐 Qt Designer 的 Widget Box）：
   抽屉式分类（记住展开状态）、缩略图卡片、单击选中 / 双击插入 / 拖动、筛选与全展开
   依赖：00-base、40-components(COMPS)、46-insert(insertComponent/markDropTarget 运行时)
   对外：PAL_ORDER renderPalette palCard markPal setAllPal palGroupOpen DRAG_KEY
   ══════════════════════════════════════════════════════════════ */

/* ── 组件箱：抽屉式分类（对齐 Qt Designer 的 Widget Box）──
   分类顺序固定；展开状态记在 localStorage；搜索时命中的分类强制展开；标签页可全展开/全收起。
   交互：单击 = 选中该组件，双击 = 插入，拖动 = 插到落点所在块之后。 */
const PAL_ORDER = ['标题', '正文', '块', '表格', '图表', '版式', '通用', '其他'];
let PAL_OPEN = {};
try{ PAL_OPEN = JSON.parse(localStorage.getItem('a4editor.palOpen') || '{}') || {}; }catch(e){ PAL_OPEN = {}; }
let PAL_SEL = null;            // 单击选中的组件 key
let DRAG_KEY = null;           // 正在拖动的组件 key
function savePalOpen(){ try{ localStorage.setItem('a4editor.palOpen', JSON.stringify(PAL_OPEN)); }catch(e){} }
function palGroupOpen(g){ return PAL_OPEN[g] !== false; }          // 默认展开
function palGroupOrder(g){
  const i = PAL_ORDER.indexOf(g);
  return i < 0 ? PAL_ORDER.length : i;
}
function setAllPal(open){
  for(const k in COMPS) PAL_OPEN[COMPS[k].group || '其他'] = open;
  savePalOpen(); renderPalette();
}
function markPal(k){
  PAL_SEL = k;
  document.querySelectorAll('#palette .comp').forEach(b => b.classList.toggle('on', b.dataset.key === k));
  const tip = document.getElementById('palTip');
  if(tip){ const c = COMPS[k];
    tip.textContent = c ? ('已选中「' + c.name + '」：双击插入到光标所在块之后，或直接拖到文档里。') : ''; }
}
function renderPalette(){
  const box = document.getElementById('palette'); if(!box) return;
  const pf = document.getElementById('palFilter');
  const q = ((pf && pf.value) || '').trim().toLowerCase();
  box.innerHTML = '';
  const groups = {};
  for(const k in COMPS){
    const c = COMPS[k];
    if(q && (k + ' ' + (c.name || '') + ' ' + (c.group || '') + ' ' + (c.desc || '')).toLowerCase().indexOf(q) < 0) continue;
    const g = c.group || '其他';
    (groups[g] = groups[g] || []).push(k);
  }
  Object.keys(groups).sort((a, b) => palGroupOrder(a) - palGroupOrder(b) || a.localeCompare(b, 'zh'))
    .forEach(g => {
      const open = q ? true : palGroupOpen(g);                 // 搜索时强制展开
      const hd = document.createElement('div');
      hd.className = 'drawer' + (open ? ' open' : '');
      hd.dataset.group = g;
      hd.innerHTML = '<span class="arw">' + (open ? '▾' : '▸') + '</span>'
                   + '<span class="dname">' + g + '</span><span class="dnum">' + groups[g].length + '</span>';
      hd.onclick = () => {
        const now = !palGroupOpen(g);
        PAL_OPEN[g] = now; savePalOpen();
        hd.classList.toggle('open', now);
        hd.querySelector('.arw').textContent = now ? '▾' : '▸';
        const body = hd.nextElementSibling;
        if(body) body.style.display = now ? '' : 'none';
      };
      box.appendChild(hd);
      const wrap = document.createElement('div');
      wrap.className = 'drawerBody';
      if(!open) wrap.style.display = 'none';
      groups[g].forEach(k => wrap.appendChild(palCard(k)));
      box.appendChild(wrap);
    });
  if(!Object.keys(groups).length){
    const e = document.createElement('div'); e.className = 'cat';
    e.textContent = '没有匹配「' + q + '」的组件'; box.appendChild(e);
  }
}
function palCard(k){
  const c = COMPS[k];
  const b = document.createElement('button');
  b.className = 'comp' + (PAL_SEL === k ? ' on' : '');
  b.dataset.key = k;
  b.title = c.name + (c.desc ? '：' + c.desc : '') + '\n单击选中 · 双击插入 · 可拖到文档里';
  const th = document.createElement('div'); th.className = 'thumb';
  const inner = document.createElement('div'); inner.className = 'thumbIn doc';
  // 模板为空的组件（table/figure/img 由插入函数现场生成）显示占位图
  inner.innerHTML = c.html || '<div class="thumbPh">' + c.name + '</div>';
  th.appendChild(inner);
  const nm = document.createElement('div'); nm.className = 'compName'; nm.textContent = c.name;
  b.appendChild(th); b.appendChild(nm);
  b.onclick = () => markPal(k);                                  // 单击 = 选中
  b.ondblclick = () => insertComponent(k);                       // 双击 = 插入
  b.draggable = true;
  b.addEventListener('dragstart', e => {
    DRAG_KEY = k; markPal(k);
    try{ e.dataTransfer.setData('text/plain', 'A4COMP:' + k); e.dataTransfer.effectAllowed = 'copy'; }catch(err){}
  });
  b.addEventListener('dragend', () => { DRAG_KEY = null; markDropTarget(null); });
  return b;
}
