# -*- coding: utf-8 -*-
"""核对三件事：
① 启动即渲染：直接打开编辑器（file:// 与 HTTP 启动器，都不带 ?load=）打印出的页数 > 0，
   且正文里能看到示例文档的标题；
② 加载回归：?load= 主方案仍是 18 页、正文含「金卫智慧舱」；
③ 打印不夹带界面：三份 PDF 里都不应出现「组件箱 / 对象检查器 / 属性编辑器 / 文档设置」。
"""
import re
import pymupdf as fitz

CASES = [
    ("_ui_plain.pdf", "直接打开(file://)"),
    ("_ui_http.pdf",  "启动器打开(HTTP)"),
    ("_chk_reg.pdf",  "启动器 ?load=主方案"),
]
CHROME = ["组件箱", "对象检查器", "属性编辑器", "文档设置", "筛选组件", "格式与插入"]

for fn, label in CASES:
    p = r"E:\HikRobot\_萃取\newdoc\%s" % fn
    try:
        d = fitz.open(p)
    except Exception as e:
        print("== %-18s 打不开：%s" % (label, e)); continue
    txt = re.sub(r"[ \t]+", " ", "".join(pg.get_text("text") for pg in d))
    flat = re.sub(r"\s+", "", txt)
    hit = [c for c in CHROME if c in flat]
    print("== %-18s 页数 %-3d 字符 %-6d 夹带界面元素：%s"
          % (label, d.page_count, len(flat), ("有 " + ",".join(hit)) if hit else "无"))
    print("   首段：" + " ".join(txt.split())[:110])
    d.close()
