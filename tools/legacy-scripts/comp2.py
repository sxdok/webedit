# -*- coding: utf-8 -*-
"""补齐组件化构建的两块关键组件：**封面**、**目录**（目标里点名要求的），
并让"新建文档"也能得到三段式分节（封面无页码 / 目录罗马 / 正文阿拉伯）。
另加 ?comptest=1 自测：按顺序铺一遍组件模板，用于无人值守验证组件层。"""
import io

P = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
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


# ── ① 新增 封面 / 目录 组件（自带分节标记）────────────────────────
rep("""  coverend:{ name:'封面结束标记', group:'版式', match:'div.pgbreak[data-num="none"]', html:'<div class="pgbreak" data-num="none" contenteditable="false"></div>', props:[] },""",
    """  coverend:{ name:'封面结束标记', group:'版式', match:'div.pgbreak[data-num="none"]', html:'<div class="pgbreak" data-num="none" contenteditable="false"></div>', props:[] },
  /* ★封面：标题 + 副标题 + 色线，末尾带分节标记 → 下一页进入"目录节"（罗马数字） */
  cover:{ name:'封面（含分节）', group:'版式', match:null,
    html:'<h1>文档标题</h1>\\n'
       + '<p class="sub"><b>编制单位</b>：江苏誉创智能科技有限公司　|　<b>版本</b>：V1.0　|　<b>日期</b>：2026 年 9 月</p>\\n'
       + '<hr class="top">\\n'
       + '<div class="pgbreak" data-num="roman" contenteditable="false"></div>',
    props:[{k:'text',t:'area',label:'标题 HTML'}] },
  /* ★目录：标题 + 条目，末尾带分节标记 → 下一页进入"正文节"（阿拉伯从 1 起） */
  toc:{ name:'目录（含分节）', group:'版式', match:'ol.toc',
    html:'<h3>目录</h3>\\n<ol class="toc"><li>1 第一章</li><li>2 第二章</li><li>3 第三章</li></ol>\\n'
       + '<div class="pgbreak" data-num="arabic" contenteditable="false"></div>',
    props:[{k:'items',t:'area',label:'目录条目（每行一条）'}] },
  /* 常用复合块 */
  cap2:{ name:'两列参数表', group:'图表', match:'table.t2',
    html:'<table class="t2"><colgroup><col style="width:30%"><col style="width:70%"></colgroup>'
       + '<tbody><tr><th>参数</th><td>取值</td></tr><tr><th>说明</th><td>　</td></tr></tbody></table>',
    props:[] },""", "新增 封面/目录/两列表 组件")

# ── ② 新建文档也能三段式：有分节标记时首页=封面（无页码）─────────
rep("""  let body=null, curNum = SECTIONS[0] || 'arabic';""",
    """  // ★有分节标记的文档 → 首页按"封面"处理（无页码）；否则常规阿拉伯页码
  const _sect = !!doc.querySelector('.pgbreak[data-num]');
  let body=null, curNum = SECTIONS[0] || (_sect ? 'none' : 'arabic');""",
    "首页模式判定")

# ── ③ ?comptest=1 自测：顺序铺组件模板并分页 ─────────────────────
rep("""  const _ori = new URLSearchParams(location.search).get('ori');""",
    """  if(new URLSearchParams(location.search).get('comptest')){
    const seq = ['cover','toc','h2','p','p','table','note','h3','ul','figure','hr','pagebreak','h2','p'];
    doc.innerHTML = seq.map(k=>COMPS[k].html || ('<!-- '+k+' -->')).join('\\n');
    DIRTY = true; renumber(); paginate();
    document.title = 'comptest: ' + doc.children.length + ' 块 -> ' + pageHost().querySelectorAll('.paper').length + ' 页';
  }
  const _ori = new URLSearchParams(location.search).get('ori');""", "自测开关")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
