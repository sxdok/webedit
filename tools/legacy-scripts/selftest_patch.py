# -*- coding: utf-8 -*-
"""① 修标题竞态（组件加载完成时不再覆盖"已加载 N 页"）；
② 加页面内自测 ?selftest=1：把"组件模板/识别、属性读写、表格行列、元素识别"做成断言，
   覆盖无头浏览器点不了的那些环节，结果写入标题并打印成一页报告。"""
import io
import re

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


# ── ① 标题竞态 ────────────────────────────────────────────────────
rep("""    document.title = 'A4 编辑器 · 组件 ' + Object.keys(COMPS).length + '（' + src + '）';""",
    """    if(document.title.indexOf('已加载') < 0)      // 别覆盖加载器写的"已加载 N 页"
      document.title = 'A4 编辑器 · 组件 ' + Object.keys(COMPS).length + '（' + src + '）';""",
    "标题竞态")

# ── ② 自测函数 ────────────────────────────────────────────────────
SELFTEST = r'''/* ───────── ★组件层自测（?selftest=1）─────────
   无头浏览器点不了按钮、打不了字，所以把"组件模板/识别、属性读写、表格行列、元素识别"
   做成页面内断言，结果写进标题并打印成一页，便于自动化回归。 */
function selfTest(){
  const res = [];
  const ok = (name, cond, extra) => res.push((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  → ' + extra : ''));
  const keys = Object.keys(COMPS);
  ok('组件已从目录加载', keys.length >= 15, keys.length + ' 个');

  // ① 模板可解析 + 能被 compOf 识别
  const probe = document.createElement('div');
  let tmpl = 0, rec = 0, noMatch = [];
  keys.forEach(k => {
    const c = COMPS[k];
    if(!c || !c.html) return;                      // table/figure/img 的 html 为空是设计如此
    probe.innerHTML = c.html;
    const el = probe.firstElementChild;
    if(!el) return;
    tmpl++;
    if(c.match){
      let hit = false;
      try{ hit = el.matches(c.match); }catch(e){}
      if(hit) rec++; else noMatch.push(k);
    }
  });
  ok('组件模板可解析出元素', tmpl >= 15, tmpl + ' 个');
  ok('模板与 match 选择器自洽', noMatch.length === 0, noMatch.join(',') || '全部自洽');

  // ② 属性读写往返（正文文字 / 颜色 / 列表条目）
  const el = document.createElement('p');
  doc.appendChild(el);
  const fT = {k:'text', t:'area'}, fC = {k:'css:color', t:'color'};
  writeProp(el, fT, 'p', '测试文字');
  ok('writeProp(text)', el.innerHTML === '测试文字', el.innerHTML);
  ok('readProp(text) 往返', readProp(el, fT, 'p') === '测试文字', readProp(el, fT, 'p'));
  writeProp(el, fC, 'p', 'rgb(18, 52, 86)');
  ok('writeProp(css:color)', /52/.test(el.getAttribute('style') || ''), el.getAttribute('style') || '');
  const ul = document.createElement('ul');
  doc.appendChild(ul);
  writeProp(ul, {k:'items'}, 'ul', 'A\nB\nC');
  ok('writeProp(items) 生成 3 条', ul.children.length === 3, ul.children.length + ' 条');
  el.remove(); ul.remove();

  // ③ 表格行列与表头
  const tb = document.createElement('table');
  tb.innerHTML = '<thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';
  doc.appendChild(tb);
  resizeTable(tb, 'cols', 4);
  ok('表格加列 → 4 列', tb.rows[0].cells.length === 4, tb.rows[0].cells.length + ' 列');
  resizeTable(tb, 'rows', 3);
  ok('表格加行 → 3 行', tb.tBodies[0].rows.length === 3, tb.tBodies[0].rows.length + ' 行');
  resizeTable(tb, 'head', false);
  ok('取消表头', !tb.tHead);
  resizeTable(tb, 'head', true);
  ok('恢复表头', !!tb.tHead);
  tb.remove();

  // ④ 真实元素能被识别成组件
  const real = doc.querySelector('h1,h2,h3,p,table,div.note');
  ok('compOf 识别真实元素', !!compOf(real), real ? real.nodeName : '无元素');

  // ⑤ 三节页码结构（有分节标记的文档）
  const modes = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || '?');
  ok('分页已生成', modes.length > 0, modes.length + ' 页');
  ok('含封面节(none)', modes.indexOf('none') >= 0, modes.join(','));

  const fails = res.filter(x => x.indexOf('FAIL') === 0).length;
  document.title = 'selftest: ' + (res.length - fails) + '/' + res.length + ' 通过' + (fails ? ' ★有失败' : '');
  const pre = document.createElement('pre');
  pre.style.cssText = 'font:8pt monospace;white-space:pre-wrap;background:#f7fbff;padding:6pt;border:1px solid #cfe0ef';
  pre.textContent = '组件层自测 ' + (res.length - fails) + '/' + res.length + '\n' + res.join('\n');
  doc.appendChild(pre);
  DIRTY = true; renumber(); paginate();
}

'''
rep("/* ───────── 纸张与页边距 ───────── */", SELFTEST + "/* ───────── 纸张与页边距 ───────── */", "插入 selfTest")

# ── ③ 启动回调：支持 selftest ─────────────────────────────────────
rep("""    if(!new URLSearchParams(location.search).get('comptest')) return;""",
    """    const _q = new URLSearchParams(location.search);
    if(_q.get('selftest')){ selfTest(); return; }
    if(!_q.get('comptest')) return;""", "启动回调支持 selftest")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
