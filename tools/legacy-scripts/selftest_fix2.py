# -*- coding: utf-8 -*-
"""让自测结果可靠可见：
① 标题里直接带**失败项名字**（无需依赖报告页就能定位）；
② 报告页改由 paginate 内部生成（放在 doc 里会被 syncFromPages 冲掉；prevStage 会被 beforeprint 重建，
   只有"在 paginate 里顺带追加"这条路径被验证过能打印出来 —— 与之前的 debugReport 同理）。"""
import io

P = r"E:\HikRobot\A4编辑器\a4_editor.html"
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


# ① 全局报告变量
rep("""let EDITING = true, PAGING = false, DIRTY = false;""",
    """let EDITING = true, PAGING = false, DIRTY = false;
let SELFTEST_REPORT = null;            // 由 ?selftest=1 写入，paginate 负责渲染成末页""", "报告变量")

# ② selfTest 结尾：标题带失败名 + 只登记报告（不再往 doc 里塞）
rep("""  const fails = res.filter(x => x.indexOf('FAIL') === 0).length;
  document.title = 'selftest: ' + (res.length - fails) + '/' + res.length + ' 通过' + (fails ? ' ★有失败' : '');
  const pre = document.createElement('pre');
  pre.style.cssText = 'font:8pt monospace;white-space:pre-wrap;background:#f7fbff;padding:6pt;border:1px solid #cfe0ef';
  pre.textContent = '组件层自测 ' + (res.length - fails) + '/' + res.length + '\\n' + res.join('\\n');
  DIRTY = false;                 // ★先清脏：否则 paginate 开头的 syncFromPages 会把报告冲掉
  doc.appendChild(pre);
  renumber(); paginate();""",
    """  const bad = res.filter(x => x.indexOf('FAIL') === 0).map(x => x.slice(6).split('  →')[0]);
  const good = res.length - bad.length;
  document.title = 'selftest: ' + good + '/' + res.length + (bad.length ? '  失败项: ' + bad.join(' | ') : ' 全部通过');
  SELFTEST_REPORT = '组件层自测 ' + good + '/' + res.length + '\\n' + res.join('\\n');
  paginate();""", "标题带失败名")

# ③ paginate 内部追加报告页
rep("""  prevStage.innerHTML='';
  // ★三段式页码：封面(none) 无页脚 / 目录(roman) 罗马 / 正文(arabic) 阿拉伯从 1 起""",
    """  prevStage.innerHTML='';
  if(SELFTEST_REPORT){                 // ★自测报告页（必须在这里生成，否则会被冲掉）
    const rp=document.createElement('div'); rp.className='paper';
    rp.innerHTML='<div class="body doc" style="position:absolute;left:20mm;top:15mm;width:170mm;'
      + 'font:8pt monospace;white-space:pre-wrap;overflow:visible">'
      + SELFTEST_REPORT.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>';
    prevStage.appendChild(rp);
  }
  // ★三段式页码：封面(none) 无页脚 / 目录(roman) 罗马 / 正文(arabic) 阿拉伯从 1 起""", "报告页由 paginate 生成")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
