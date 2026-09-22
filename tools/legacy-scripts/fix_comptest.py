# -*- coding: utf-8 -*-
"""把 ?comptest=1 自测挪到「组件加载完成之后」，否则：
① 它跑在 `doc.innerHTML = saved || DEMO` 之前，被示例文档覆盖；
② 组件是异步加载的，自测执行时 COMPS 还是空的。"""
import io
import re

P = r"E:\HikRobot\A4编辑器\a4_editor.html"
s = io.open(P, encoding="utf-8").read()

# ① 删掉旧的 comptest 块
pat = re.compile(r"  if\(new URLSearchParams\(location\.search\)\.get\('comptest'\)\)\{.*?\n  \}\n", re.S)
s2, n1 = pat.subn("", s, count=1)
print("  删除旧自测块：%d 处" % n1)

# ② 启动流程改为"组件加载完成 → 若带 comptest 参数则跑自测"
OLD = "  loadComponentFiles();            // ★启动时读取同级「组件/」目录"
NEW = """  loadComponentFiles(() => {         // ★读组件目录（异步）→ 完成后才可跑自测
    if(!new URLSearchParams(location.search).get('comptest')) return;
    const seq = ['cover','toc','h2','p','p','table','note','h3','ul','figure','hr','pagebreak','h2','p'];
    doc.innerHTML = seq.map(k => (COMPS[k] && COMPS[k].html) || ('<!-- ' + k + ' -->')).join('\\n');
    DIRTY = true; renumber(); paginate();
    const modes = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || '?');
    document.title = 'comptest: 块' + doc.children.length + ' 页' + modes.length + ' [' + modes.join(',') + ']';
  });"""
n2 = s2.count(OLD)
print("  启动钩子锚点：%d 处" % n2)
if n1 == 1 and n2 == 1:
    io.open(P, "w", encoding="utf-8", newline="").write(s2.replace(OLD, NEW))
    print("  [ok] 已写入")
