# -*- coding: utf-8 -*-
"""回退上一步的 `.sheet` 重写：它把源文件 `.sheet{padding:25.4mm 31.7mm}` 套到了
已按页边距定位好的 .body 上 → 页边距叠加两次，版心从 143.6mm 压到 116.3mm，换行全变。
恢复为"丢弃 .sheet/.footer/.tip 等页面级规则"（页面几何由编辑器自己负责），
其余内容级规则照旧注入（这才是封面表格等样式真正依赖的）。"""
import io

E = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
s = io.open(E, encoding="utf-8").read()

OLD_START = "  // ★页面在编辑器里的真实结构： #prevStage > .paper > .body(.doc)"
OLD_END = "    .join('\\n');"
i = s.find(OLD_START)
j = s.find(OLD_END, i)
if i < 0 or j < 0:
    print("  [!!] 未找到待回退片段（i=%d j=%d）" % (i, j))
    raise SystemExit

NEW = """  // 页面级规则（@page/.sheet/.footer/.tip/body/html/*）一律丢弃：纸张尺寸、页边距、
  // 页脚位置都由编辑器自己负责；把它们套到已定位好的 .body 上会导致"页边距叠加两次"。
  // 其余**内容级**规则（h1~h4/p/table/th/td/.tabcap/.figcap/.note/.topo/.cap/img…）
  // 照旧注入并加 `.doc ` 前缀 —— 封面表格底色这类样式正是靠它们生效。
  _sc.textContent = st.split('}')
    .map(x=>x.trim())
    .filter(x=>x)
    .filter(x=>!/^@(page|media|charset|import)/i.test(x))
    .filter(x=>!/\\.(sheet|footer|tip|no-print|hdr)\\b/.test(x))
    .filter(x=>!/^(body|html|\\*)\\s*[,{]/.test(x))
    .map(x=>x+'}')
    .join('\\n')
    .replace(/(^|\\n)([^@\\n][^{]*)\\{/g, (m, pre, sel) => pre + sel.split(',').map(t=>{
        t = t.trim(); if(!t) return t;
        return t.startsWith('.doc') ? t : '.doc ' + t;
      }).join(',') + '{');"""

s = s[:i] + NEW + s[j + len(OLD_END):]
io.open(E, "w", encoding="utf-8", newline="").write(s)
print("  [ok] 已回退为「丢弃页面级规则、注入内容级规则」")
