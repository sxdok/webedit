# -*- coding: utf-8 -*-
"""修正键名 bug，列出每页幻灯片引用的媒体及其格式（判断图解是位图还是 EMF 矢量）。"""
import io
import os
import re
import zipfile

PPTX = r"E:\HikRobot\AGV\解决方案\01 LMR-XXXX搬运项目方案V1.4.pptx"
z = zipfile.ZipFile(PPTX)
rels = {}
for n in z.namelist():
    m = re.match(r"ppt/slides/_rels/(slide\d+)\.xml\.rels$", n)
    if not m:
        continue
    xml = z.read(n).decode("utf-8", "ignore")
    rels[m.group(1)] = re.findall(r'Target="\.\./media/([^"]+)"', xml)

txt = io.open(r"E:\HikRobot\_萃取\newdoc\src_pptx.txt", encoding="utf-8").read()
blocks = re.split(r"\n===== (slide\d+\.xml) =====\n", txt)
from collections import Counter
ext = Counter()
print("=== 每页幻灯片的媒体（含格式）===")
for i in range(1, len(blocks), 2):
    name, body = blocks[i], blocks[i + 1]
    key = name.replace(".xml", "")
    num = int(re.findall(r"\d+", key)[0])
    media = rels.get(key, [])
    for mm in media:
        ext[os.path.splitext(mm)[1].lower()] += 1
    if num >= 34:
        title = next((x.strip() for x in body.split("\n") if x.strip()), "")
        print("  %-8s %-14s %s" % (key, title[:14], " ".join(media[:5]) if media else "（无媒体 → 可能是 SmartArt/组合形状）"))
print("\n=== 全部媒体格式统计 ===")
print("  " + "  ".join("%s=%d" % kv for kv in ext.most_common()))
print("\n=== 幻灯片引用的 EMF/WMF（矢量图解）数量 ===")
emf = [k for k, v in rels.items() if any(x.lower().endswith((".emf", ".wmf")) for x in v)]
print("  %d 页含矢量图：%s" % (len(emf), ", ".join(sorted(emf, key=lambda s: int(re.findall(r'\d+', s)[0]))[:20])))
