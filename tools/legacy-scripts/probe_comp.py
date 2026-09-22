# -*- coding: utf-8 -*-
"""让 ?comptest=1 把"分节标记数 / 各页页码模式"写进标题，便于定位封面未生效的原因。"""
import io

P = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
s = io.open(P, encoding="utf-8").read()
OLD = """    DIRTY = true; renumber(); paginate();
    document.title = 'comptest: ' + doc.children.length + ' 块 -> ' + pageHost().querySelectorAll('.paper').length + ' 页';"""
NEW = """    DIRTY = true; renumber();
    const nmk1 = doc.querySelectorAll('.pgbreak[data-num]').length;
    paginate();
    const modes = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || '?');
    const nmk2 = doc.querySelectorAll('.pgbreak[data-num]').length;
    document.title = 'comptest: 块' + doc.children.length + ' 标记(前' + nmk1 + '/后' + nmk2 + ') 页' + modes.length + ' [' + modes.join(',') + ']';"""
n = s.count(OLD)
print("  锚点命中 %d 次" % n)
if n == 1:
    io.open(P, "w", encoding="utf-8", newline="").write(s.replace(OLD, NEW))
    print("  [ok] 探针已加")
