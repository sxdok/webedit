# -*- coding: utf-8 -*-
"""查清参考文件里"封面页表格背景不同"是用什么机制实现的。"""
import io
import re

SRC = r"D:\Desktop\誉创\金卫项目\方案\方案文件\江苏誉创_金卫智慧舱_AGV方案_V5.0.html"
h = io.open(SRC, encoding="utf-8").read()

# 第一张 sheet（封面）
sheets = re.findall(r'<div class="sheet">(.*?)(?=<div class="sheet">|</body>)', h, re.S)
cover = sheets[0]
print("=== 封面页 HTML（去掉 base64，前 1400 字符）===")
print(re.sub(r'data:image/[^"]+', '«base64»', cover)[:1400])

print("\n=== 全文件里带 class 的表格 / 单元格 ===")
for m in re.finditer(r'<table[^>]*>', h):
    print("  " + m.group(0)[:120])
for m in re.finditer(r'<(th|td|tr|table)[^>]*class="[^"]*"[^>]*>', h):
    print("  " + m.group(0)[:120])

print("\n=== CSS 里提到 .sheet 的规则 ===")
st = "".join(re.findall(r"<style>(.*?)</style>", h, re.S))
for m in re.finditer(r"([^{}\n]*\.sheet[^{}]*)\{([^}]*)\}", st):
    print("  %s { %s }" % (re.sub(r"\s+", " ", m.group(1).strip()), re.sub(r"\s+", " ", m.group(2).strip())))

print("\n=== CSS 里所有 > / :first / :last / :nth 等结构化选择器 ===")
for m in re.finditer(r"(?:^|\n)\s*([^{@\n][^{]*)\{", st):
    sel = m.group(1).strip()
    if re.search(r"[>:]|first|last|nth", sel):
        print("  " + re.sub(r"\s+", " ", sel)[:110])

print("\n=== 内联 style 用在非 col 的元素上 ===")
for m in re.finditer(r'<(?!col)\w+[^>]*style="([^"]+)"[^>]*>', h):
    print("  " + m.group(0)[:150])
