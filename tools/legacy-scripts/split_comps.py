# -*- coding: utf-8 -*-
"""把编辑器改造成"组件来自同级 组件/ 目录"的主应用：
① 删除硬编码组件表（BUILTIN 置空）；
② 启动时按 _manifest.js 动态注入每个组件文件（中文名 URL 编码）；
③ 新增「选择组件目录」(webkitdirectory，支持 .js/.json 与中文名) 与「导出组件目录」(每个组件一个中文名文件)；
④ 标题写入已加载组件数，便于自动化核验。"""
import io
import re

P = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
s = io.open(P, encoding="utf-8").read()
ok = 0


def rep(old, new, label, regex=False):
    global s, ok
    if regex:
        s2, n = re.subn(old, new, s, flags=re.S)
    else:
        n = s.count(old); s2 = s.replace(old, new)
    if n != 1:
        print("  [!! %s] 命中 %d 次" % (label, n))
        return
    s = s2
    ok += 1
    print("  [ok] %s" % label)


# ① 删除硬编码组件表
rep(r"const BUILTIN = \{.*?\n\};",
    "/* 组件全部来自同级「组件/」目录（见 loadComponentFiles）；BUILTIN 保留为空对象，\n"
    "   仅用于区分「来自文件的组件」与「用户自建组件」。 */\nconst BUILTIN = {};",
    "删除硬编码组件表", regex=True)

# ② 记录"来自文件"的组件，避免它们被当成用户自建写进 localStorage
rep("""let COMPS = Object.assign({}, BUILTIN);
(function loadUserComps(){""",
    """let COMPS = Object.assign({}, BUILTIN);
const FROMFILE = {};                 // 来自 组件/ 目录的组件
(function loadUserComps(){""", "FROMFILE 标记")

rep("""  for(const k in COMPS) if(!BUILTIN[k]) user[k] = COMPS[k];""",
    """  for(const k in COMPS) if(!BUILTIN[k] && !FROMFILE[k]) user[k] = COMPS[k];""", "保存时排除文件组件")

# ③ 启动加载 组件/ 目录
rep("""/* 识别元素的组件类型 */""",
    """/* ── 从同级「组件/」目录加载组件 ──
   浏览器从 file:// 打开时 fetch/XHR 读本地文件会被拦，但 <script src> 不受限制，
   所以组件用 .js 文件（内部给 window.A4_COMPONENTS 赋值），中文文件名做 URL 编码。 */
function loadComponentFiles(cb){
  const done = () => {
    renderPalette();
    document.title = 'A4 编辑器 · 组件 ' + Object.keys(COMPS).length;
    if(cb) cb();
  };
  const list = window.A4_COMPONENT_FILES;
  if(!list || !list.length){ done(); return 0; }      // 清单不在（编辑器被单独拷走）
  let i = 0;
  (function next(){
    if(i >= list.length){ done(); return; }
    const sc = document.createElement('script');
    sc.src = '组件/' + encodeURIComponent(list[i]);   // ★中文文件名
    sc.onload = sc.onerror = () => { i++; next(); };   // 单个失败不阻塞其余
    document.head.appendChild(sc);
  })();
  return list.length;
}

/* 选择组件目录：支持 .js（组件文件）与 .json（组件包），中文名不限 */
function pickComponentDir(files){
  let js = 0, jsn = 0;
  const todo = [...files].filter(f => /\\.(js|json)$/i.test(f.name));
  if(!todo.length){ alert('该目录里没有 .js 或 .json 组件文件。'); return; }
  let left = todo.length;
  todo.forEach(f => {
    const fr = new FileReader();
    fr.onload = () => {
      const txt = fr.result;
      try{
        if(/\\.json$/i.test(f.name)){ const o = JSON.parse(txt); importCompObj(o); jsn++; }
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
    const txt = '/* 组件：' + c.name + '（' + (c.group || '其他') + '） */\\n'
              + 'window.A4_COMPONENTS = window.A4_COMPONENTS || {};\\n'
              + 'window.A4_COMPONENTS[' + JSON.stringify(k) + '] = ' + JSON.stringify(body, null, 2) + ';\\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], {type:'text/javascript;charset=utf-8'}));
    a.download = ((c.group || '其他') + '-' + c.name).replace(/[\\\\/:*?"<>|]/g, '_') + '.js';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
  }, i * 250));
}

/* 识别元素的组件类型 */""", "加载器 + 目录选择/导出")

# ④ 启动流程：先加载组件目录，再渲染组件库
rep("""  renumber(); syncBar(); renderPalette();""",
    """  renumber(); syncBar();
  loadComponentFiles();            // ★启动时读取同级「组件/」目录""", "启动加载组件目录")

# ⑤ 面板按钮 + 清单脚本标签
rep("""    <button class="t" id="cmpReset" title="恢复内置组件（自建组件保留在本地）">恢复内置</button>""",
    """    <button class="t" id="cmpPickDir" title="选择「组件」目录，批量加载其中 .js/.json（支持中文名）">选择组件目录</button>
    <button class="t" id="cmpExportDir" title="每个组件导出一个文件（中文名）">导出组件目录</button>
    <button class="t" id="cmpReset" title="清空自建组件（文件加载的组件不受影响）">清空自建</button>""",
    "面板按钮")

rep("""$('#cmpReset').onclick = () => { COMPS = Object.assign({}, BUILTIN); renderPalette(); alert('已恢复内置组件（自建组件仍在本地，重新加载后可再导入）。'); };""",
    """$('#cmpPickDir').onclick = () => {
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
};""", "按钮绑定")

rep("""<script>
/* ══════════════════════════════════════════════════════════════
   A4 编辑器""",
    """<!-- 组件清单：主应用启动时按它逐个加载 组件/ 下的文件（支持中文文件名） -->
<script src="组件/_manifest.js"></script>
<script>
/* ══════════════════════════════════════════════════════════════
   A4 编辑器""", "引入组件清单")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
