# -*- coding: utf-8 -*-
"""把图解 PNG 转 JPEG(q90) 并把 MD 里的引用改成 .jpg —— 21.9MB 的 HTML 在编辑器里会卡。
幻灯片整页导出是 1600px 宽，JPEG q90 下 300dpi 打印宽仍为 13.5cm，视觉无损。"""
import io
import os
import re

from PIL import Image

DOC = r"E:\HikRobot\_萃取\newdoc\doc"
AST = os.path.join(DOC, "assets")
MD = os.path.join(DOC, "金卫智慧舱_总体方案_V1.0.md")

before = sum(os.path.getsize(os.path.join(AST, f)) for f in os.listdir(AST) if f.endswith(".png")) / 1048576
conv = 0
for f in sorted(os.listdir(AST)):
    if not f.endswith(".png"):
        continue
    src = os.path.join(AST, f)
    dst = os.path.join(AST, f[:-4] + ".jpg")
    im = Image.open(src)
    if im.mode in ("RGBA", "P", "LA"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im.convert("RGBA"), mask=im.convert("RGBA").split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    im.save(dst, "JPEG", quality=90, optimize=True, dpi=(300, 300))
    os.remove(src)
    conv += 1
after = sum(os.path.getsize(os.path.join(AST, f)) for f in os.listdir(AST) if f.endswith(".jpg")) / 1048576
print("  转换 %d 张：PNG %.1f MB → JPEG %.1f MB（省 %.0f%%）" % (conv, before, after, (1 - after / before) * 100))

t = io.open(MD, encoding="utf-8").read()
n = len(re.findall(r"assets/fig_[\w]+\.png", t))
t2 = re.sub(r"(assets/fig_[\w]+)\.png", r"\1.jpg", t)
io.open(MD, "w", encoding="utf-8", newline="").write(t2)
print("  MD 引用改写 %d 处" % n)
print("  剩余 .png 引用 %d 处" % len(re.findall(r"assets/.*\.png", t2)))
