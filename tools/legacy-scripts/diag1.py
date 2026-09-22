# -*- coding: utf-8 -*-
"""① 诊断"14 表题 / 13 表"的错配；② 读工控机手册 PDF，提炼型号与规格。"""
import io
import os
import re

DOC = r"E:\HikRobot\_萃取\newdoc\doc"
MD = os.path.join(DOC, "金卫智慧舱_总体方案_V1.0.md")

print("=== ① 表题 / 表格 错配诊断 ===")
lines = io.open(MD, encoding="utf-8").read().split("\n")
caps, tbls = [], []
for i, s in enumerate(lines):
    t = s.strip()
    if t.startswith("[[表:"):
        # 往后找最近的表格行
        nxt = None
        for j in range(i + 1, min(i + 6, len(lines))):
            if lines[j].strip().startswith("|"):
                nxt = j + 1
                break
            if lines[j].strip() and not lines[j].strip().startswith("<!--"):
                break
        caps.append((i + 1, t, nxt))
    if t.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:\-\|]+\|$", lines[i + 1].strip()):
        tbls.append(i + 1)
print("  MD 中表题 %d 条，表格 %d 张" % (len(caps), len(tbls)))
for ln, c, nxt in caps:
    if nxt is None:
        print("  ★ 表题 L%d 后面没有表格：%s" % (ln, c[:44]))

print("\n=== ② 工控机手册：目录与页面结构 ===")
p = io.open(r"E:\HikRobot\_萃取\newdoc\src_pdf.txt", encoding="utf-8").read()
parts = re.split(r"\n===== 第 (\d+) 页 =====\n", p)
for i in range(1, min(len(parts), 9), 2):
    lines2 = [x.strip() for x in parts[i + 1].split("\n") if x.strip()][:26]
    print("  --- 第 %s 页 ---" % parts[i])
    for x in lines2:
        print("     " + x[:86])
