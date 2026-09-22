# -*- coding: utf-8 -*-
"""建立 幻灯片 → 图片 的映射（含像素尺寸），用于挑选"图解"插图。
并输出 V3.2 方案的小标题清单与 PDF 各页首行（上一次输出被截断）。"""
import io
import os
import re
import zipfile

from PIL import Image

OUT = r"E:\HikRobot\_萃取\newdoc"
AST = os.path.join(OUT, "assets")
PPTX = r"E:\HikRobot\AGV\解决方案\01 LMR-XXXX搬运项目方案V1.4.pptx"

z = zipfile.ZipFile(PPTX)
# rels: slide -> media
rels = {}
for n in z.namelist():
    m = re.match(r"ppt/slides/_rels/(slide\d+)\.xml\.rels$", n)
    if not m:
        continue
    xml = z.read(n).decode("utf-8", "ignore")
    rels[m.group(1)] = re.findall(r'Target="\.\./media/([^"]+)"', xml)

def size(fn):
    p = os.path.join(AST, "pptx_" + fn)
    try:
        im = Image.open(p)
        return "%dx%d" % im.size
    except Exception:
        return "n/a"

print("=== 幻灯片 → 图片映射（34 页起，即方案正文部分）===")
txt = io.open(os.path.join(OUT, "src_pptx.txt"), encoding="utf-8").read()
blocks = re.split(r"\n===== (slide\d+\.xml) =====\n", txt)
for i in range(1, len(blocks), 2):
    name, body = blocks[i], blocks[i + 1]
    num = int(re.findall(r"\d+", name)[0])
    if num < 34:
        continue
    title = ""
    for x in body.split("\n"):
        if x.strip():
            title = x.strip()
            break
    media = rels.get(name, [])
    imgs = ["%s(%s)" % (m, size(m)) for m in media if not m.lower().endswith((".mp4", ".wmv", ".emf"))]
    print("  %-12s %-16s %s" % (name.replace(".xml", ""), title[:16], " ".join(imgs[:4])))

print("\n=== V3.2 方案：疑似标题的段落 ===")
v = io.open(os.path.join(OUT, "src_v32.txt"), encoding="utf-8").read().split("\n")
for ln in v:
    s = ln.strip()
    if not s or len(s) > 34:
        continue
    if re.match(r"^(\d+(\.\d+)*[\s、.]|[一二三四五六七八九十]+[、.])", s) or re.search(r"(概述|需求|方案|架构|流程|实施|服务|清单|计算|要求|规划|设计|说明|总结)$", s):
        print("  " + s)

print("\n=== 工控机手册 PDF：各页首行 ===")
p = io.open(os.path.join(OUT, "src_pdf.txt"), encoding="utf-8").read()
parts = re.split(r"\n===== 第 (\d+) 页 =====\n", p)
for i in range(1, len(parts), 2):
    lines = [x.strip() for x in parts[i + 1].split("\n") if x.strip()]
    print("  p%-3s %s" % (parts[i], (lines[0][:52] if lines else "")))
