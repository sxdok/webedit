# -*- coding: utf-8 -*-
"""修封面页码 bug：
`num==='none'`（封面节）本应"不写页脚"，却落进了旧版兜底分支 `!SECTIONS.length && ...`，
被写了阿拉伯页码并让计数器 +1 → 正文从 2 起。
改为：none 一律不写页脚；"首页不显示页码"勾选只作为**无分节信息文档**的兼容行为。"""
import io

P = r"E:\HikRobot\A4编辑器\a4_editor.html"
s = io.open(P, encoding="utf-8").read()

OLD = """    if(pg.num==='roman'){ ri++; label='第 '+roman(ri)+' 页 / 共 '+total+' 页'; }
    else if(pg.num==='arabic'){ ai++; label='第 '+ai+' 页 / 共 '+total+' 页'; }
    else if(!SECTIONS.length && !(pg===pages[0] && coverNo)){ ai++; label='第 '+ai+' 页 / 共 '+total+' 页'; }"""

NEW = """    if(pg.num==='roman'){ ri++; label='第 '+roman(ri)+' 页 / 共 '+total+' 页'; }
    else if(pg.num==='arabic'){
      // ★兼容旧行为：没有分节信息的文档，且勾选了「首页不显示页码」→ 首页跳过且不计数
      if(pg===pages[0] && coverNo && !SECTIONS.length){ /* 不写页脚 */ }
      else { ai++; label='第 '+ai+' 页 / 共 '+total+' 页'; }
    }
    // ★pg.num==='none'（封面节）→ 一律不写页脚（此前误入兜底分支，给了它阿拉伯页码）"""

n = s.count(OLD)
print("  锚点命中 %d 次" % n)
if n == 1:
    io.open(P, "w", encoding="utf-8", newline="").write(s.replace(OLD, NEW))
    print("  [ok] 已修复")
