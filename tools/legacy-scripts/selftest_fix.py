# -*- coding: utf-8 -*-
"""修自测自身的三处问题：
① 报告被 syncFromPages 冲掉 → 追加报告前置 DIRTY=false；
② match 自洽检查过严：复合组件（如目录模板以 <h3> 开头）首个元素本就不该匹配 → 改为"首元素或任一后代匹配"；
③ 封面节断言对无分节标记的示例文档不适用 → 仅当文档含分节标记时才断言。"""
import io

P = r"E:\HikRobot\A4编辑器\a4_editor.html"
s = io.open(P, encoding="utf-8").read()
ok = 0


def rep(old, new, label):
    global s, ok
    n = s.count(old)
    if n != 1:
        print("  [!! %s] 命中 %d 次" % (label, n))
        return
    s = s.replace(old, new)
    ok += 1
    print("  [ok] %s" % label)


rep("""      let hit = false;
      try{ hit = el.matches(c.match); }catch(e){}""",
    """      let hit = false;
      try{ hit = el.matches(c.match) || !!(el.querySelector && el.querySelector(c.match)); }catch(e){}""",
    "放宽 match 自洽检查")

rep("""  ok('含封面节(none)', modes.indexOf('none') >= 0, modes.join(','));""",
    """  if(doc.querySelector('.pgbreak[data-num]'))
    ok('含封面节(none)', modes.indexOf('none') >= 0, modes.join(','));
  else
    ok('无分节标记时不做封面节断言（示例文档）', true, modes.join(','));""",
    "封面节断言加条件")

rep("""  doc.appendChild(pre);
  DIRTY = true; renumber(); paginate();""",
    """  DIRTY = false;                 // ★先清脏：否则 paginate 开头的 syncFromPages 会把报告冲掉
  doc.appendChild(pre);
  renumber(); paginate();""", "报告不再被冲掉")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
