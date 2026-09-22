# -*- coding: utf-8 -*-
"""修 CSS 注入：不再丢弃/破坏"按页面结构定位"的规则。
原来：带 .sheet 的规则被整条丢掉；其余统一加 `.doc ` 前缀 —— 于是
      `.sheet:first-child table th{…}` 这类"封面页专用样式"永远匹配不上，被默认样式覆盖。
现在：把 .sheet 家族**重写到编辑器的真实结构**（页面是 #prevStage > .paper > .body），
      并保留其结构化伪类（:first-child / :last-child），使"封面页/末页专用样式"仍然生效。
"""
import ast
import io

P = r"D:\DSHClient\user\.dsh\skills\a4-printable-html-doc\tools\md_to_html.py"
E = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
s = io.open(E, encoding="utf-8").read()

OLD = """  let _sc=document.getElementById('srcCss');
  if(!_sc){ _sc=document.createElement('style'); _sc.id='srcCss'; document.head.appendChild(_sc); }
  _sc.textContent = st.split('}')
    .map(x=>x.trim())
    .filter(x=>x)
    .filter(x=>!/^@(page|media|charset|import)/i.test(x))
    .filter(x=>!/\\.(sheet|footer|tip|no-print|hdr)\\b/.test(x))
    .filter(x=>!/^(body|html|\\*)\\s*[,{]/.test(x))
    .map(x=>x+'}')
    .join('\\n')
    // 把选择器限制在编辑区/纸张内容里，避免影响界面
    .replace(/(^|\\n)([^@\\n][^{]*)\\{/g, (m, pre, sel) => pre + sel.split(',').map(t=>{
        t=t.trim(); if(!t) return t;
        return t.startsWith('.doc') ? t : '.doc ' + t;
      }).join(',') + '{');"""

NEW = """  let _sc=document.getElementById('srcCss');
  if(!_sc){ _sc=document.createElement('style'); _sc.id='srcCss'; document.head.appendChild(_sc); }
  // ★页面在编辑器里的真实结构： #prevStage > .paper > .body(.doc)
  //   源文件的 .sheet 家族要**重写**（不能丢），否则"封面/末页专用样式"会失效。
  const mapSel = t => {
    t = t.trim();
    if(!t) return t;
    // .sheet 家族 → 编辑器页面结构；保留 :first-child/:last-child 等伪类
    if(/\\.sheet\\b/.test(t)){
      t = t.replace(/\\.sheet\\s*:\\s*first-child/g, '#prevStage .paper:first-child .body')
           .replace(/\\.sheet\\s*:\\s*last-child/g,  '#prevStage .paper:last-child .body')
           .replace(/\\.sheet\\s*:\\s*nth-child\\(([^)]*)\\)/g, '#prevStage .paper:nth-child($1) .body')
           .replace(/\\.sheet\\b/g, '#prevStage .paper .body');
      return t;                                   // 已是绝对选择器，不再加前缀
    }
    if(/^\\.(footer|tip|no-print)\\b/.test(t)) return null;   // 这几个由编辑器自己管
    if(/^(body|html|\\*)\\b/.test(t)) return null;
    return t.startsWith('.doc') ? t : '.doc ' + t;
  };
  _sc.textContent = st.split('}')
    .map(x=>x.trim())
    .filter(x=>x)
    .filter(x=>!/^@(page|media|charset|import)/i.test(x))
    .map(x=>{
      // 拆出选择器部分（丢掉规则体由后续补回 '}'）
      const i = x.indexOf('{');
      if(i < 0) return '';
      const sels = x.slice(0, i).split(',').map(mapSel).filter(Boolean);
      if(!sels.length) return '';
      return sels.join(',') + '{' + x.slice(i + 1) + '}';
    })
    .filter(Boolean)
    .join('\\n');"""

n = s.count(OLD)
print("  锚点命中 %d 次" % n)
if n == 1:
    io.open(E, "w", encoding="utf-8", newline="").write(s.replace(OLD, NEW))
    print("  [ok] 注入规则已改为「重写 .sheet 家族 + 保留结构伪类」")
else:
    # 打印实际片段帮助定位
    i = s.find("let _sc=document.getElementById('srcCss')")
    print("  实际片段：")
    print(s[i:i+900])
