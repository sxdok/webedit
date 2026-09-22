# -*- coding: utf-8 -*-
"""修三处：
① 加 DIRTY 脏标记：**没编辑就不同步**（加载后保真原分页 26 页）；一旦编辑才重排；
② showTab：富文本与预览都渲染分页面（富文本可编辑），不再把编辑面藏起来；
③ 加载完成后直接进"富文本"（可编辑的分页视图），符合"编辑时预览就是分页的"。"""
import io

P = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
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


rep("""let EDITING = true, PAGING = false;""",
    """let EDITING = true, PAGING = false, DIRTY = false;""", "加 DIRTY")

rep("""function syncFromPages(){
  const bs = pageBodies();
  if(!bs.length) return false;                      // 还没分页过，别覆盖数据源""",
    """function syncFromPages(){
  if(!DIRTY) return false;                          // ★没编辑就不同步：加载后保持原分页
  const bs = pageBodies();
  if(!bs.length) return false;                      // 还没分页过，别覆盖数据源""", "同步加脏检查")

rep("""  doc.innerHTML = html;
  return true;
}""",
    """  doc.innerHTML = html;
  DIRTY = false;
  return true;
}""", "同步后清脏")

rep("""document.addEventListener('input', e=>{ if(e.target.closest && e.target.closest('#prevStage')) reflowSoon(); });""",
    """document.addEventListener('input', e=>{
  if(e.target.closest && e.target.closest('#prevStage')){ DIRTY = true; reflowSoon(); }
});""", "输入置脏")

rep("""function showTab(name){
  document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on', x.dataset.tab===name));
  $('#edit-pane').style.display = name==='edit' ? 'block' : 'none';
  $('#prev-pane').style.display = name==='prev' ? 'block' : 'none';
  $('#md-pane').style.display   = name==='md'   ? 'block' : 'none';
  if(name==='md'){ $('#mdBox').value = toMd(); }
  if(name==='prev'){ paginate(); }
}""",
    """function showTab(name){
  document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on', x.dataset.tab===name));
  EDITING = (name !== 'prev');                 // ★富文本=可编辑分页；预览=只读分页
  const md = (name === 'md');
  $('#edit-pane').style.display = md ? 'none' : 'block';
  $('#md-pane').style.display   = md ? 'block' : 'none';
  if(md){ syncFromPages(); $('#mdBox').value = toMd(); }
  else { paginate(); }                         // 两个视图都渲染分页面
}""", "showTab 重写")

rep("""          setTimeout(()=>{ document.querySelector('#tabs button[data-tab="prev"]').click(); }, 200);""",
    """          setTimeout(()=>{ document.querySelector('#tabs button[data-tab="edit"]').click(); }, 200);""",
    "加载后进可编辑分页")

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("  完成 %d 处" % ok)
