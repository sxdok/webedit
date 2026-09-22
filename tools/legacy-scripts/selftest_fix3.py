# -*- coding: utf-8 -*-
"""修自测自身最后两处：
① 分页相关断言要在 paginate() **之后**做（原来跑在末尾那次分页之前，容器是空的）；
② 多根复合组件（封面=标题+副标题+色线+标记；目录=标题+条目+标记）不适用"首元素匹配"检查 → 显式豁免。"""
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


# ① 多根复合组件豁免
rep("""  const probe = document.createElement('div');
  let tmpl = 0, rec = 0, noMatch = [];
  keys.forEach(k => {
    const c = COMPS[k];
    if(!c || !c.html) return;                      // table/figure/img 的 html 为空是设计如此""",
    """  const probe = document.createElement('div');
  let tmpl = 0, rec = 0, noMatch = [];
  const MULTI = ['cover', 'toc'];                  // 多根复合组件：由"标题+内容+分节标记"组成
  keys.forEach(k => {
    const c = COMPS[k];
    if(!c || !c.html) return;                      // table/figure/img 的 html 为空是设计如此
    if(MULTI.indexOf(k) >= 0) return;              // 多根组件不做"首元素匹配"检查""", "多根组件豁免")

# ② 分页断言移到 paginate 之后
rep("""  // ⑤ 三节页码结构（有分节标记的文档）
  const modes = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || '?');
  ok('分页已生成', modes.length > 0, modes.length + ' 页');
  if(doc.querySelector('.pgbreak[data-num]'))
    ok('含封面节(none)', modes.indexOf('none') >= 0, modes.join(','));
  else
    ok('无分节标记时不做封面节断言（示例文档）', true, modes.join(','));
""",
    """  // ⑤ 先分页，再断言分页结果（顺序很重要：原来在 paginate 之前取容器，永远是空的）
  paginate();
  const modes = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || '?');
  ok('分页已生成', modes.length > 0, modes.length + ' 页');
  if(doc.querySelector('.pgbreak[data-num]'))
    ok('含封面节(none)', modes.indexOf('none') >= 0, modes.join(','));
  else
    ok('无分节标记时不做封面节断言（示例文档）', true, modes.join(','));
""", "分页断言顺序")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
