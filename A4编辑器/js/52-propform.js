/* ══════════════════════════════════════════════════════════════
   属性编辑器 UI（对齐 Qt Designer 的 Property Editor）：
   两列表格「属性 | 值」+ 分组折叠 + 顶部过滤框；只负责渲染与交互，读写规则在 50-props
   依赖：00-base、10-inspector(selected)、35-numbering(renumber)、40-components(compOf/COMPS)、
         50-props(读分组)、70-pagination(reflowSoon)
   对外：makePropInput renderProps
   ══════════════════════════════════════════════════════════════ */

function makePropInput(f, cur){
  let inp;
  if(f.t === 'select'){
    inp = document.createElement('select');
    (f.opts || []).forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; inp.appendChild(op); });
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
  return inp;
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
    box.innerHTML = el
      ? '<span style="color:#89a;font-size:12px">已选中 <b>&lt;' + el.tagName.toLowerCase() + '&gt;</b>，但它没被任何组件识别（组件靠 match 选择器认领元素）。<br>可用左侧「格式与插入」改字号/对齐，或点「新建组件」把它存成组件。</span>'
      : '<span style="color:#89a;font-size:12px">未选中元素。下面是「文档设置」（纸张 / 页边距 / 页眉页脚）；'
        + '在中间文档里点选一个元素（标题 / 段落 / 表格 / 图片…），这里就换成该组件的属性表。</span>';
    return;
  }
  const c = COMPS[key];
  if(who) who.textContent = '· ' + c.name;
  const fields = c.props || [];
  if(!fields.length){
    box.innerHTML = '<div class="none">组件「' + c.name + '」没有声明可编辑属性（对应的组件文件里 <b>props</b> 为空）。<br>'
      + '临时改样式可用左侧「格式与插入」；要让它出现在这张表里，就在 <b>组件/</b> 目录对应的 .js 里补 props。</div>';
    return;
  }

  // 顶部过滤框（Qt 的属性表也有）
  const fw = document.createElement('div'); fw.className = 'pfilter';
  const fi = document.createElement('input');
  fi.type = 'text'; fi.id = 'propFilter'; fi.placeholder = '过滤属性…';
  fw.appendChild(fi); box.appendChild(fw);

  const groups = {};
  fields.forEach(f => { const g = groupOfProp(f); (groups[g] = groups[g] || []).push(f); });
  const order = PROP_GROUP_ORDER.concat(Object.keys(groups).filter(g => PROP_GROUP_ORDER.indexOf(g) < 0));

  order.forEach(g => {
    const list = groups[g]; if(!list) return;
    const open = propGroupOpen(g);
    const gEl = document.createElement('div');
    gEl.className = 'pgroup' + (open ? ' open' : '');
    gEl.dataset.group = g;
    const gh = document.createElement('div'); gh.className = 'pgh';
    gh.innerHTML = '<span class="arw">' + (open ? '▾' : '▸') + '</span>'
                 + '<span class="gn">' + g + '</span><span class="gc">' + list.length + '</span>';
    gh.onclick = () => {
      const now = gEl.classList.toggle('open');
      gh.querySelector('.arw').textContent = now ? '▾' : '▸';
      PROP_OPEN[g] = now; savePropOpen();
    };
    gEl.appendChild(gh);
    const grid = document.createElement('div'); grid.className = 'pgrid';
    list.forEach(f => {
      const lab = document.createElement('label');
      const s = document.createElement('span'); s.className = 'f'; s.textContent = f.label || f.k;
      if(f.hint) s.title = f.hint;
      lab.appendChild(s);
      const inp = makePropInput(f, readProp(el, f, key));
      inp.onchange = inp.oninput = () => {
        writeProp(el, f, key, f.t === 'bool' ? inp.checked : inp.value);
        renumber(); DIRTY = true; reflowSoon();
      };
      lab.appendChild(inp);
      grid.appendChild(lab);
    });
    gEl.appendChild(grid);
    box.appendChild(gEl);
  });

  const tip = document.createElement('div');
  tip.className = 'hintx';
  tip.textContent = '改动即时生效；「文字」支持简单标签（如 <b>加粗</b>）。组头可点开/收起，上面可过滤属性。';
  box.appendChild(tip);

  // 过滤：只隐藏行、不重绘（保住输入焦点）
  fi.addEventListener('input', () => {
    const q = fi.value.trim().toLowerCase();
    box.querySelectorAll('.pgroup').forEach(g => {
      let shown = 0;
      g.querySelectorAll('label').forEach(l => {
        const name = (l.querySelector('span.f') || {}).textContent || '';
        const ed = l.querySelector('input,select,textarea');
        const val = ed ? String(ed.value || '') : '';
        const hit = !q || name.toLowerCase().indexOf(q) >= 0 || val.toLowerCase().indexOf(q) >= 0;
        l.style.display = hit ? '' : 'none';
        if(hit) shown++;
      });
      g.style.display = shown ? '' : 'none';
      if(q && shown){ g.classList.add('open'); const a = g.querySelector('.arw'); if(a) a.textContent = '▾'; }
    });
  });
}
