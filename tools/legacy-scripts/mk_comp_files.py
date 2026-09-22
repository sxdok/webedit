# -*- coding: utf-8 -*-
"""把编辑器独立成文件夹，并把组件抽成"同级 组件/ 目录下一个组件一个文件"：
  A4编辑器/
    a4_editor.html          主应用（启动时读取 组件/ 目录）
    组件/
      _manifest.js          清单（中文文件名数组）
      标题-一级标题.js       每个组件一个文件，window.A4_COMPONENTS[key] = {...}
      ...
组件用 .js 而不是 .json：浏览器从 file:// 打开时 fetch/XHR 读本地文件会被拦，
而 <script src> 不受限制 —— 双击即可用；中文文件名在注入时做 URL 编码。
"""
import io
import json
import os
import re
import shutil

SRC_EDITOR = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
DST = r"E:\HikRobot\AGV\生成资料\A4编辑器"
CMP = os.path.join(DST, "组件")
os.makedirs(CMP, exist_ok=True)

# ── 组件定义：(key, 显示名, 分组, match, html, props) ─────────────────
P = lambda *a: [dict(zip(("k", "t", "label", "opts"), x)) if len(x) == 4 else dict(zip(("k", "t", "label"), x)) for x in a]
COMPS = [
 ("h1","一级标题","标题","h1","<h1>文档标题</h1>",P(("text","area","文字"),("css:text-align","select","对齐",["center","left","right"]))),
 ("h2","章节标题","标题","h2","<h2>1 章标题</h2>",P(("text","text","文字"))),
 ("h3","小节标题","标题","h3","<h3>1.1 节标题</h3>",P(("text","text","文字"))),
 ("h4","小标题","标题","h4","<h4>要点标题</h4>",P(("text","text","文字"))),
 ("p","正文段落","正文","p:not(.sub):not(.lead):not(.tabcap):not(.figcap)","<p>正文段落内容。</p>",
  P(("text","area","文字"),("css:font-size","text","字号"),("css:color","color","颜色"),
    ("css:text-align","select","对齐",["left","center","right","justify"]),
    ("css:line-height","text","行距"),("css:text-indent","text","首行缩进"))),
 ("ul","项目符号列表","正文","ul","<ul><li>要点一</li><li>要点二</li></ul>",P(("items","area","条目（每行一条）"))),
 ("ol","编号列表","正文","ol","<ol><li>第一步</li><li>第二步</li></ol>",P(("items","area","条目（每行一条）"))),
 ("note","提示框","块","div.note","<div class=\"note\">提示内容（待确认 / 以现场为准）</div>",P(("text","area","文字"))),
 ("flow","示意框","块","div.flow","<div class=\"flow\">流程 / 要点说明</div>",P(("text","area","文字"))),
 ("tabcap","表题","图表","div.tabcap","<div class=\"tabcap\">表 X-Y　说明文字</div>",P(("text","text","题注"))),
 ("table","表格","图表","table","",
  P(("rows","number","数据行数"),("cols","number","列数"),("head","bool","首行为表头"),("width","text","表宽(如 100%)"))),
 ("cap2","两列参数表","图表","table.t2",
  "<table class=\"t2\"><colgroup><col style=\"width:30%\"><col style=\"width:70%\"></colgroup>"
  "<tbody><tr><th>参数</th><td>取值</td></tr><tr><th>说明</th><td>　</td></tr></tbody></table>",P()),
 ("figure","图片 + 图题","图表","div.topo","",
  P(("src","text","图片地址"),("cap","text","图题"),("imgw","text","图宽(如 120mm)"))),
 ("img","图片","图表","img:not(.in-topo)","",P(("attr:src","text","图片地址"),("css:width","text","宽度"))),
 ("cover","封面（含分节）","版式",None,
  "<h1>文档标题</h1>\n"
  "<p class=\"sub\"><b>编制单位</b>：江苏誉创智能科技有限公司　|　<b>版本</b>：V1.0　|　<b>日期</b>：2026 年 9 月</p>\n"
  "<hr class=\"top\">\n<div class=\"pgbreak\" data-num=\"roman\" contenteditable=\"false\"></div>",
  P(("text","area","标题 HTML"))),
 ("toc","目录（含分节）","版式","ol.toc",
  "<h3>目录</h3>\n<ol class=\"toc\"><li>1 第一章</li><li>2 第二章</li><li>3 第三章</li></ol>\n"
  "<div class=\"pgbreak\" data-num=\"arabic\" contenteditable=\"false\"></div>",
  P(("items","area","目录条目（每行一条）"))),
 ("sub","封面副标题","版式","p.sub",
  "<p class=\"sub\"><b>编制单位</b>：…　|　<b>版本</b>：V1.0　|　<b>日期</b>：2026 年 9 月</p>",
  P(("text","area","文字"))),
 ("hrtop","封面色线","版式","hr.top","<hr class=\"top\">",P()),
 ("hr","分隔线","版式","hr:not(.top)","<hr>",P()),
 ("pagebreak","分页符","版式","div.pgbreak","<div class=\"pgbreak\" contenteditable=\"false\"></div>",P()),
 ("coverend","封面结束标记","版式","div.pgbreak[data-num=\"none\"]","<div class=\"pgbreak\" data-num=\"none\" contenteditable=\"false\"></div>",P()),
]

files = []
for key, name, group, match, html, props in COMPS:
    fn = "%s-%s.js" % (group, name)
    body = {
        "key": key, "name": name, "group": group, "match": match, "html": html, "props": props,
    }
    js = ("/* 组件：%s（%s）—— 可自由编辑本文件；改完刷新编辑器即生效 */\n"
          "window.A4_COMPONENTS = window.A4_COMPONENTS || {};\n"
          "window.A4_COMPONENTS[%s] = %s;\n") % (
        name, group, json.dumps(key, ensure_ascii=False), json.dumps(body, ensure_ascii=False, indent=2))
    io.open(os.path.join(CMP, fn), "w", encoding="utf-8", newline="\n").write(js)
    files.append(fn)

man = ("/* 组件清单：主应用按此顺序加载 组件/ 下的文件。\n"
       "   新增组件 = 放一个 .js 文件进 组件/，再把文件名加到这个数组（支持中文名）。 */\n"
       "window.A4_COMPONENT_FILES = %s;\n") % json.dumps(files, ensure_ascii=False, indent=2)
io.open(os.path.join(CMP, "_manifest.js"), "w", encoding="utf-8", newline="\n").write(man)
print("  组件文件：%d 个 + 清单" % len(files))
for f in files:
    print("    " + f)
