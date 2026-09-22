# -*- coding: utf-8 -*-
"""盘点 AGV方案 V5.0 HTML 里用到的全部排版特性，并与编辑器对照。"""
import io
import re
from collections import Counter

SRC = r"D:\Desktop\誉创\金卫项目\方案\方案文件\江苏誉创_金卫智慧舱_AGV方案_V5.0.html"
ED = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"

h = io.open(SRC, encoding="utf-8").read()
e = io.open(ED, encoding="utf-8").read()

print("=== ① 标签使用统计 ===")
tags = Counter(re.findall(r"<([a-zA-Z][\w-]*)[\s>/]", h))
for t, n in tags.most_common(30):
    print("  %-10s %4d" % (t, n))

print("\n=== ② class 使用统计 ===")
cls = Counter()
for m in re.finditer(r'class="([^"]+)"', h):
    for c in m.group(1).split():
        cls[c] += 1
for c, n in cls.most_common(30):
    print("  %-14s %4d" % (c, n))

print("\n=== ③ 内联样式属性 ===")
props = Counter()
for m in re.finditer(r'style="([^"]+)"', h):
    for p in m.group(1).split(";"):
        if ":" in p:
            props[p.split(":")[0].strip()] += 1
for p, n in props.most_common(20):
    print("  %-18s %4d" % (p, n))

print("\n=== ④ 特殊结构 ===")
checks = [
    ("colgroup（列宽）", r"<colgroup>"),
    ("thead（重复表头）", r"<thead>"),
    ("colspan/rowspan（合并单元格）", r"colspan=|rowspan="),
    ("a 链接", r"<a\s"),
    ("sup/sub（上下标）", r"<su[pb]>"),
    ("br 换行", r"<br\s*/?>"),
    ("span 行内样式", r"<span\s"),
    ("b/strong 加粗", r"<b>|<strong>"),
    ("i/em 斜体", r"<i>|<em>"),
    ("u 下划线", r"<u>"),
    ("img（图片）", r"<img\s"),
    ("base64 内嵌图", r"data:image"),
    ("hr", r"<hr"),
    ("ol 有序列表", r"<ol>"),
    ("ul 无序列表", r"<ul>"),
    ("figure/topo 图文容器", r'class="topo"'),
    ("图注 .cap", r'class="cap"'),
    ("图题 .figcap", r'class="figcap"'),
    ("表题 .tabcap", r'class="tabcap"'),
    ("提示框 .note", r'class="note"'),
    ("页眉 .hdr", r'class="hdr"'),
    ("副标题 .sub", r'class="sub"'),
    ("元信息 .meta", r'class="meta"'),
    ("导语 .lead", r'class="lead"'),
    ("流程图 .flow", r'class="flow"'),
    ("分隔线 hr.top", r'class="top"'),
    ("段首缩进控制 text-indent", r"text-indent"),
    ("居中段落 text-align", r"text-align"),
    ("page-break 控制", r"page-break|break-after|break-inside"),
]
for label, pat in checks:
    print("  %-26s 源=%-4d 编辑器CSS/代码=%s" % (label, len(re.findall(pat, h)), "有" if re.search(pat, e) else "无"))

print("\n=== ⑤ 源文件 CSS 规则（选择器）===")
st = "".join(re.findall(r"<style>(.*?)</style>", h, re.S))
sels = re.findall(r"(?:^|\n)\s*([^{@\n][^{]*)\{", st)
for s2 in sels[:40]:
    print("  " + re.sub(r"\s+", " ", s2.strip())[:96])
