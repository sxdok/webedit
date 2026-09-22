# -*- coding: utf-8 -*-
"""md_to_html 支持**三节**：封面（无页脚）→ 目录（罗马）→ 正文（阿拉伯从 1）。
新增标记 `<!-- coverend -->`：它之前属于封面节，之后到第一个 `# 章` 之间属于目录节。
与参考版（AGV方案 V5.0 手改排版）的分节一致。"""
import ast
import io

P = r"D:\DSHClient\user\.dsh\skills\a4-printable-html-doc\tools\md_to_html.py"
s = io.open(P, encoding="utf-8").read()
ok = 0


def rep(old, new, label):
    global s, ok
    n = s.count(old)
    if n != 1:
        print("  [!! %s] 命中 %d 次" % (label, n))
        return
    s = s.replace(old, new)
    ok += 1
    print("  [ok] %s" % label)


# 1) parse()：识别 coverend 标记
rep("""        m = re.match(r'^<!--\\s*pagebreak\\s*-->$', s, re.I):
            out.append(('', 0.0, True, False)); i += 1; continue""",
    """        m = re.match(r'^<!--\\s*pagebreak\\s*-->$', s, re.I):
            out.append(('', 0.0, True, False)); i += 1; continue""",
    "（定位 pagebreak，占位）")

rep("""        if re.match(r'^<!--\\s*pagebreak\\s*-->$', s, re.I):
            out.append(('', 0.0, True, False)); i += 1; continue""",
    """        if re.match(r'^<!--\\s*coverend\\s*-->$', s, re.I):
            out.append(('@@SECTION_FRONT@@', 0.0, False, False)); i += 1; continue
        if re.match(r'^<!--\\s*pagebreak\\s*-->$', s, re.I):
            out.append(('', 0.0, True, False)); i += 1; continue""",
    "parse: 支持 coverend")

# 2) 切分：支持三节
rep("""    sections, cur_sec = [], []
    for b in blocks:
        if b[0] == '@@SECTION_BODY@@':
            sections.append(cur_sec); cur_sec = []
            continue
        cur_sec.append(b)
    sections.append(cur_sec)
    if len(sections) == 1:
        sections = [[], sections[0]]        # 没有目录时也要有"正文节\"""",
    """    # ★支持三节：封面（无页脚）→ 目录（罗马）→ 正文（阿拉伯从 1）
    #   `<!-- coverend -->` 之前 = 封面；其后到第一个 `# 章` = 目录/前言节。
    sections, cur_sec = [], []
    for b in blocks:
        if b[0] == '@@SECTION_FRONT@@':
            sections.append(cur_sec); cur_sec = []
            continue
        if b[0] == '@@SECTION_BODY@@':
            sections.append(cur_sec); cur_sec = []
            continue
        cur_sec.append(b)
    sections.append(cur_sec)
    if len(sections) == 1:
        sections = [[], sections[0]]        # 没有分节标记时：空目录节 + 正文节""",
    "切分支持三节")

# 3) 输出：封面无页脚 / 目录罗马 / 正文阿拉伯
rep("""    for si, pgs in enumerate(sec_pages):
        roman_sec = (si == 0 and len(pgs) and total > len(pgs))     # 首节=目录 → 罗马数字
        for k, pg in enumerate(pgs, 1):
            o.append('<div class="sheet">')
            o.extend(pg)
            label = roman(k) if roman_sec else str(k)               # ★正文从 1 重新起算
            o.append('<div class="footer">%s　|　第 %s 页 / 共 %d 页</div>'
                     % (esc(footer_name), label, total))
            o.append('</div>')""",
    """    nsec = len(sec_pages)
    for si, pgs in enumerate(sec_pages):
        is_cover = (nsec >= 3 and si == 0)                          # ★封面：不写页脚
        is_front = (si == (1 if nsec >= 3 else 0)) and not is_cover  # 目录/前言：罗马数字
        for k, pg in enumerate(pgs, 1):
            o.append('<div class="sheet">')
            o.extend(pg)
            if is_cover:
                o.append('</div>')
                continue
            label = roman(k) if is_front else str(k)                 # ★正文从 1 重新起算
            o.append('<div class="footer">%s　|　第 %s 页 / 共 %d 页</div>'
                     % (esc(footer_name), label, total))
            o.append('</div>')""",
    "输出三节页码")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
ast.parse(io.open(P, encoding="utf-8").read())
print("  AST OK")
