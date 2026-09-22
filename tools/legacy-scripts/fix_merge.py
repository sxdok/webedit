# -*- coding: utf-8 -*-
"""修主应用两件事：
① **补上漏掉的合并步骤** —— 组件文件把定义挂在 window.A4_COMPONENTS，之前没并进 COMPS，
   所以出现"清单21 / 成功21 / 组件0"；
② 走本地 HTTP 服务时先请求 /__components **自动发现组件目录**（新增文件即自动出现），
   file:// 时回退到 组件/_manifest.js 清单。"""
import io
import re

P = r"E:\HikRobot\AGV\生成资料\A4编辑器\a4_editor.html"
s = io.open(P, encoding="utf-8").read()

NEW = """function loadComponentFiles(cb){
  const merge = () => {
    const got = window.A4_COMPONENTS || {};
    let n = 0;
    for(const k in got){ COMPS[k] = got[k]; FROMFILE[k] = 1; n++; }
    return n;
  };
  const done = (src) => {
    const n = merge();                     // ★必须合并：组件文件只写了 window.A4_COMPONENTS
    renderPalette();
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
}"""

pat = re.compile(r"function loadComponentFiles\(cb\)\{.*?\n\}", re.S)
s2, n = pat.subn(NEW, s, count=1)
print("  替换 loadComponentFiles：%d 处" % n)
if n == 1:
    io.open(P, "w", encoding="utf-8", newline="").write(s2)
    print("  [ok] 已写入")
