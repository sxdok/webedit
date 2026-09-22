# -*- coding: utf-8 -*-
"""从 ?selftest=1 打印出的 PDF 里取出自测报告页并逐条打印。"""
import io, re, fitz

pdf = r"E:\HikRobot\_萃取\newdoc\_selftest.pdf"
d = fitz.open(pdf)
lines = []
for i, pg in enumerate(d):
    t = pg.get_text("text")
    if "组件层自测" in t or "PASS" in t or "FAIL" in t:
        for ln in t.splitlines():
            ln = ln.strip()
            if re.match(r"^(PASS|FAIL)", ln) or ln.startswith("组件层自测"):
                lines.append((i + 1, ln))
print("PDF 共 %d 页，报告页命中 %d 条：" % (d.page_count, len(lines)))
for pno, ln in lines:
    print("  p%-3d %s" % (pno, ln))
d.close()
