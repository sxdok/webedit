# -*- coding: utf-8 -*-
"""探针：把"清单是否加载/清单长度/成功注入数/失败数"写进标题，定位中文名加载失败点。"""
import io

P = r"E:\HikRobot\AGV\生成资料\A4编辑器\a4_editor.html"
s = io.open(P, encoding="utf-8").read()

OLD = """  const done = () => {
    renderPalette();
    document.title = 'A4 编辑器 · 组件 ' + Object.keys(COMPS).length;
    if(cb) cb();
  };"""
NEW = """  const done = () => {
    renderPalette();
    document.title = 'A4 · 清单' + (window.A4_COMPONENT_FILES ? window.A4_COMPONENT_FILES.length : '无')
                   + ' · 成功' + window.__okN + ' 失败' + window.__badN + ' · 组件' + Object.keys(COMPS).length;
    if(cb) cb();
  };"""
n = s.count(OLD)
if n != 1:
    print("  [!! done() 锚点命中 %d 次" % n)
else:
    s = s.replace(OLD, NEW)
    print("  [ok] done() 探针")

OLD2 = """    sc.onload = sc.onerror = () => { i++; next(); };   // 单个失败不阻塞其余"""
NEW2 = """    window.__okN = window.__okN || 0; window.__badN = window.__badN || 0;
    sc.onload = () => { window.__okN++; i++; next(); };
    sc.onerror = () => { window.__badN++; console.warn('组件加载失败：' + sc.src); i++; next(); };"""
n2 = s.count(OLD2)
if n2 != 1:
    print("  [!! onload 锚点命中 %d 次" % n2)
else:
    s = s.replace(OLD2, NEW2)
    print("  [ok] onload/onerror 计数")

io.open(P, "w", encoding="utf-8", newline="").write(s)
