/* ══════════════════════════════════════════════════════════════
   组件文件与组件包：从「组件/」目录加载 .js / 选择目录 / 导入导出组件包 / 新建组件
   依赖：00-base、10-inspector(selEl)、40-components(COMPS/FROMFILE)、44-palette(renderPalette)
   对外：loadComponentFiles pickComponentDir importCompObj exportComponentDir
         newComponent exportComps importComps
   ══════════════════════════════════════════════════════════════ */

/* ── 从同级「组件/」目录加载组件 ──
   浏览器从 file:// 打开时 fetch/XHR 读本地文件会被拦，但 <script src> 不受限制，
   所以组件用 .js 文件（内部给 window.A4_COMPONENTS 赋值），中文文件名做 URL 编码。 */
function loadComponentFiles(cb){
  const merge = () => {
    const got = window.A4_COMPONENTS || {};
    let n = 0;
    for(const k in got){ COMPS[k] = got[k]; FROMFILE[k] = 1; n++; }
    return n;
  };
  const done = (src) => {
    const n = merge();                     // ★必须合并：组件文件只写了 window.A4_COMPONENTS
    renderPalette();
    if(document.title.indexOf('已加载') < 0)      // 别覆盖加载器写的"已加载 N 页"
      document.title = 'A4 编辑器 · 组件 ' + Object.keys(COMPS).length + '（' + src + '）';
    if(cb) cb();
  };
  const inject = (list, src) => {
    if(!list || !list.length){ done(src + '·空'); return; }
    let i = 0;
    (function next(){
      if(i >= list.length){ done(src); return; }
      const sc = document.createElement('script');
      sc.src = '组件/' + encodeURIComponent(list[i]);   // ★中文文件名 → URL 编码
      sc.onload = sc.onerror = () => { i++; next(); };   // 单个失败不阻塞其余
      document.head.appendChild(sc);
    })();
  };
  // ① 由本地服务提供时：直接问组件目录（新增组件文件即自动生效，无需改清单）
  if(location.protocol === 'http:' || location.protocol === 'https:'){
    try{
      const x = new XMLHttpRequest();
      x.open('GET', '/__components', true);
      x.onload = () => {
        let list = null;
        try{ list = JSON.parse(x.responseText).files; }catch(e){}
        if(list && list.length) inject(list, '目录');
        else inject(window.A4_COMPONENT_FILES, '清单');
      };
      x.onerror = () => inject(window.A4_COMPONENT_FILES, '清单');
      x.send();
    }catch(e){ inject(window.A4_COMPONENT_FILES, '清单'); }
    return;
  }
  // ② file:// 打开时：用清单（<script src> 不受本地文件限制）
  inject(window.A4_COMPONENT_FILES, '清单');
}

/* 选择组件目录：支持 .js（组件文件）与 .json（组件包），中文名不限 */
function pickComponentDir(files){
  let js = 0, jsn = 0;
  const todo = [...files].filter(f => /\.(js|json)$/i.test(f.name));
  if(!todo.length){ alert('该目录里没有 .js 或 .json 组件文件。'); return; }
  let left = todo.length;
  todo.forEach(f => {
    const fr = new FileReader();
    fr.onload = () => {
      const txt = fr.result;
      try{
        if(/\.json$/i.test(f.name)){ const o = JSON.parse(txt); importCompObj(o); jsn++; }
        else {
          const before = Object.keys(window.A4_COMPONENTS || {}).length;
          (new Function(txt))();                        // 组件文件内部自行挂到 window.A4_COMPONENTS
          const after = window.A4_COMPONENTS || {};
          for(const k in after){ if(!FROMFILE[k] || before !== Object.keys(after).length){ COMPS[k] = after[k]; FROMFILE[k] = 1; } }
          js++;
        }
      }catch(e){ console.warn('组件文件加载失败：' + f.name, e); }
      if(--left === 0){
        if(window.A4_COMPONENTS) for(const k in window.A4_COMPONENTS){ COMPS[k] = window.A4_COMPONENTS[k]; FROMFILE[k] = 1; }
        renderPalette();
        document.title = 'A4 编辑器 · 组件 ' + Object.keys(COMPS).length;
        alert('已从目录加载：组件文件 ' + js + ' 个、组件包 ' + jsn + ' 个；当前可用组件 ' + Object.keys(COMPS).length + ' 个。');
      }
    };
    fr.readAsText(f, 'utf-8');
  });
}
function importCompObj(o){
  let n = 0;
  for(const k in o){
    const c = o[k];
    if(!c || !c.name || typeof c.html !== 'string') continue;
    COMPS[k] = { name:c.name, group:c.group || '导入', match:c.match || null, html:c.html, props:c.props || [] };
    n++;
  }
  saveUserComps();
  return n;
}
/* 导出组件目录：每个组件一个中文名 .js 文件 */
function exportComponentDir(){
  const keys = Object.keys(COMPS);
  if(!keys.length){ alert('当前没有组件可导出。'); return; }
  keys.forEach((k, i) => setTimeout(() => {
    const c = COMPS[k];
    const body = { key:k, name:c.name, group:c.group || '其他', match:c.match || null, html:c.html || '', props:c.props || [] };
    const txt = '/* 组件：' + c.name + '（' + (c.group || '其他') + '） */\n'
              + 'window.A4_COMPONENTS = window.A4_COMPONENTS || {};\n'
              + 'window.A4_COMPONENTS[' + JSON.stringify(k) + '] = ' + JSON.stringify(body, null, 2) + ';\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], {type:'text/javascript;charset=utf-8'}));
    a.download = ((c.group || '其他') + '-' + c.name).replace(/[\\/:*?"<>|]/g, '_') + '.js';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
  }, i * 250));
}

/* 识别元素的组件类型 */
function newComponent(){
  if(!selected){ alert('先在右侧点选一个元素，再「新建组件」。'); return; }
  const name = prompt('新组件名称', '自定义组件'); if(!name) return;
  const key = 'u_' + Date.now().toString(36);
  COMPS[key] = {
    name: name, group: '自建', match: null,
    html: selected.outerHTML.replace(/ class="sel"/g, '').replace(/\bsel\b/g, '').replace(/ data-num="[^"]*"/g, ''),
    props: [{k:'html',t:'area',label:'HTML'}]
  };
  saveUserComps(); renderPalette();
  alert('已保存为组件「' + name + '」，出现在左侧「组件库 · 自建」里。');
}
function exportComps(){
  const user = {};
  for(const k in COMPS) if(!BUILTIN[k]) user[k] = COMPS[k];
  const blob = new Blob([JSON.stringify(user, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'a4components.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
}
function importComps(text){
  let o;
  try{ o = JSON.parse(text); }catch(e){ alert('组件包不是合法 JSON：' + e.message); return; }
  let n = 0;
  for(const k in o){
    const c = o[k];
    if(!c || !c.name || typeof c.html !== 'string') continue;
    COMPS[k] = { name:c.name, group:c.group || '导入', match:c.match || null, html:c.html, props:c.props || [] };
    n++;
  }
  saveUserComps(); renderPalette();
  alert('已加载 ' + n + ' 个组件。');
}

