# -*- coding: utf-8 -*-
"""补抽网络方案文本，并列出各源资料的结构骨架（用于定新方案章节）。"""
import io
import os
import re

OUT = r"E:\HikRobot\_萃取\newdoc"

# ── 补抽 网络解决方案（无 .sheet，取 body 全文）──
h = io.open(r"D:\Desktop\誉创\金卫项目\方案\方案文件\江苏誉创_金卫智慧舱_网络解决方案.html", encoding="utf-8").read()
b = re.sub(r"<style.*?</style>", "", h, flags=re.S)
b = re.sub(r"<script.*?</script>", "", b, flags=re.S)
b = re.sub(r"</(p|div|tr|h1|h2|h3|li|table)>", "\n", b, flags=re.I)
b = re.sub(r"<[^>]+>", "", b)
b = re.sub(r"\n{2,}", "\n", b).strip()
io.open(os.path.join(OUT, "src_net.txt"), "w", encoding="utf-8").write(b)
print("=== 网络方案：抽出 %d 字符 ===" % len(b))
print("\n".join(b.split("\n")[:26]))

print("\n\n=== LMR 方案 PPTX：107 页标题 ===")
t = io.open(os.path.join(OUT, "src_pptx.txt"), encoding="utf-8").read()
blocks = re.split(r"\n===== (slide\d+\.xml) =====\n", t)
for i in range(1, len(blocks), 2):
    name, body = blocks[i], blocks[i + 1]
    first = [x.strip() for x in body.split("\n") if x.strip()]
    print("  %-14s %s" % (name, (first[0][:40] if first else "")))

print("\n\n=== V3.2 方案：前 60 个非空段落 ===")
v = io.open(os.path.join(OUT, "src_v32.txt"), encoding="utf-8").read().split("\n")
n = 0
for ln in v:
    s = ln.strip()
    if s:
        print("  " + s[:88])
        n += 1
        if n >= 60:
            break

print("\n\n=== 工控机手册 PDF：各页首行 ===")
p = io.open(os.path.join(OUT, "src_pdf.txt"), encoding="utf-8").read()
for blk in re.split(r"\n===== 第 (\d+) 页 =====\n", p)[1:]:
    pass
parts = re.split(r"\n===== 第 (\d+) 页 =====\n", p)
for i in range(1, len(parts), 2):
    no = parts[i]
    lines = [x.strip() for x in parts[i + 1].split("\n") if x.strip()]
    print("  p%-3s %s" % (no, (lines[0][:56] if lines else "")))
