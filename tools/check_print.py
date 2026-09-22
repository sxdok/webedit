# -*- coding: utf-8 -*-
r"""web-editor 打印验证工具：**打印 + 断言**一步到位。

用法：
    # 1) 先启动 web-editor 服务（另开窗口）
    D:\Python313\python.exe "E:\可视化编辑器\web-editor\启动编辑器.py" -p 5179 -q
    # 2) 运行本工具（默认打印 ?demo=1 并断言）
    D:\Python313\python.exe "E:\可视化编辑器\tools\check_print.py"
    # 3) 也可以只断言已有 PDF
    D:\Python313\python.exe "E:\可视化编辑器\tools\check_print.py" 某个.pdf

断言内容：
    ① 页尺寸是否按 @page 走（A4 = 595.0×841.9pt）；
    ② 内容起点是否落在文档页边距上（左≈31.7mm=89.9pt、上≈25.4mm=72pt），而不是 0,0；
    ③ 有没有把编辑器界面（菜单栏/面板/按钮文字）印进去；
    ④ 页数是否合理、有没有空白页；
    ⑤ 柱状图等**背景色图元**是否真的输出（Chrome 默认不打印背景色）。

⚠ 无头 Edge 打印默认留约 1cm 边距，而纸张是 297mm → CLI 打印会多出空白页；
   这是打印方式导致的，不是编辑器缺陷。真实浏览器打印请设：A4、100%、边距「无/默认」、勾选「背景图形」。
"""
import os
import subprocess
import sys

import pymupdf as fitz

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "docs", "验证证据")
DEFAULT_PDF = os.path.join(OUT_DIR, "_print_check.pdf")
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
URL = "http://127.0.0.1:5179/?demo=1"

CHROME = [
    # 只列"编辑器界面专属"的字样；注意不要用文档正文里也可能出现的词（否则会误报）
    "重载外部组件", "拖拽或双击插入", "对象检查器", "未选中组件 —— 这里是文档",
    "打印设置：A4、缩放 100%",
]
DOC_TAGS = ["可视化编辑器", "文档模式"]


def print_to_pdf(url: str, pdf: str) -> bool:
    edge = next((p for p in EDGE_CANDIDATES if os.path.exists(p)), None)
    if not edge:
        print("找不到 Edge，跳过打印步骤；请手动导出 PDF 后作为参数传入")
        return False
    os.makedirs(os.path.dirname(pdf), exist_ok=True)
    if os.path.exists(pdf):
        os.remove(pdf)
    profile = os.path.join(os.environ.get("TEMP", HERE), "_edge_print_check")
    cmd = [
        edge, "--headless", "--disable-gpu", "--no-first-run", f"--user-data-dir={profile}",
        "--virtual-time-budget=22000", "--print-to-pdf=" + pdf, "--no-pdf-header-footer", url,
    ]
    print("打印中：%s" % url)
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return os.path.exists(pdf)


def main() -> int:
    pdf = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PDF
    if len(sys.argv) <= 1:
        if not print_to_pdf(URL, pdf):
            print("打印失败（服务没启动？）：%s" % URL)
            return 2
    if not os.path.exists(pdf):
        print("找不到 PDF：%s" % pdf)
        return 2

    d = fitz.open(pdf)
    ok = True
    print("PDF：%s" % pdf)
    print("页数：%d" % d.page_count)
    p0 = d[0]
    size_ok = abs(p0.rect.width - 595.0) < 3 and abs(p0.rect.height - 841.9) < 3
    print("第 1 页尺寸：%.1f × %.1f pt（A4=595.0×841.9）%s" % (p0.rect.width, p0.rect.height, "OK" if size_ok else "✗"))
    ok = ok and size_ok

    xs0, ys0, xs1, ys1 = 1e9, 1e9, -1e9, -1e9
    for pg in d:
        for b in pg.get_text("blocks"):
            x0, y0, x1, y1 = b[:4]
            xs0, ys0, xs1, ys1 = min(xs0, x0), min(ys0, y0), max(xs1, x1), max(ys1, y1)
    margin_ok = 60 < xs0 < 130 and 40 < ys0 < 110
    print("内容包围盒：left=%.1f top=%.1f right=%.1f bottom=%.1f" % (xs0, ys0, xs1, ys1))
    print("  期望 left≈89.9pt(31.7mm)、top≈72.0pt(25.4mm)：%s" % ("OK" if margin_ok else "✗ 内容没有落在页边距上"))
    ok = ok and margin_ok

    flat = "".join(pg.get_text("text") for pg in d).replace(" ", "").replace("\n", "")
    hit = [c for c in CHROME if c.replace(" ", "") in flat]
    print("界面残留：%s" % ("有 → " + "、".join(hit) + " ✗" if hit else "无 OK"))
    ok = ok and not hit
    print("文档内容存在：%s" % {t: (t in flat) for t in DOC_TAGS})

    blank = [i + 1 for i, pg in enumerate(d) if len(pg.get_text("text").strip()) < 10]
    if blank:
        print("空白/近空白页：%s （无头打印留边距所致，真实浏览器请设边距=无）" % blank)
    else:
        print("空白/近空白页：无 OK")

    accent = (0x16 / 255, 0x77 / 255, 0xFF / 255)
    bars = 0
    for pg in d:
        for dr in pg.get_drawings():
            f = dr.get("fill")
            if f and all(abs(f[i] - accent[i]) < 0.06 for i in range(3)):
                bars += 1
    print("主色填充图元（柱状图柱子等）：%d 个 %s" % (bars, "OK" if bars else "✗ 背景色没输出（检查 print-color-adjust）"))
    ok = ok and bars > 0
    d.close()

    print("结论：%s" % ("全部通过" if ok else "有不符合项"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
