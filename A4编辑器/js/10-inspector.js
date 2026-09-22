/* ══════════════════════════════════════════════════════════════
   选中与「对象检查器」：记录当前选中元素并显示它的标签/字号/对齐等
   依赖：00-base、50-props(renderProps)
   对外：selected selEl refreshInspector
   ══════════════════════════════════════════════════════════════ */

/* ───────── ★元素/容器级编辑 ───────── */
let selected = null;
function selEl(el){
  if(selected && selected !== el) selected.classList.remove('sel');
  selected = (el && el !== doc && document.contains(el) && !el.closest('#panel,#side')) ? el : null;
  if(selected) selected.classList.add('sel');
  refreshInspector();
}
function refreshInspector(){
  const inp = document.getElementById('inspInfo'); if(!inp) return;
  if(!selected){
    inp.innerHTML = '未选中 —— 在中间文档里点任意标题/段落/表格/图片即可选中，右侧属性与左侧格式按钮都会作用到它。';
    return;
  }
  const cs = getComputedStyle(selected);
  const cls = (selected.className || '').replace(/\bsel\b/g, '').trim();
  let draggable = '';
  if(selected.tagName === 'TABLE' || selected.closest('table')) draggable = '　<span style="color:#2e74b5">← 拖表格竖线可调列宽</span>';
  else if(selected.tagName === 'IMG' || selected.querySelector('img')) draggable = '　<span style="color:#2e74b5">← 拖右下角可调图片宽度</span>';
  inp.innerHTML = '<b>&lt;' + selected.tagName.toLowerCase() + '&gt;</b>' +
    (cls ? ' .' + cls.split(/\s+/).join(' .') : '') + draggable +
    '<br>字号 ' + cs.fontSize + '　行高 ' + cs.lineHeight + '　对齐 ' + cs.textAlign +
    '<br><span class="txt">' + (selected.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 46) + '</span>' +
    '<br><button class="t" id="desel" style="margin-top:5px">取消选中</button>';
  const b = document.getElementById('desel'); if(b) b.onclick = () => selEl(null);
  renderProps();                                   // ★选中即生成组件属性表单
  refreshHandles();                                // ★选中表格/图片时贴上拖拽手柄
  // ★选中时把「属性编辑器」滚进视野并闪一下：以前它埋在左栏最底部，选中后要自己滚动去找
  const gp = document.getElementById('grpProps');
  if(gp){
    try{ gp.scrollIntoView({ block: 'nearest' }); }catch(e){}
    gp.classList.remove('flash'); void gp.offsetWidth; gp.classList.add('flash');
  }
  const pt = parseFloat(cs.fontSize);
  if(!isNaN(pt)) $('#fpt').value = Math.round(pt * 2) / 2;
  const m = cs.color.match(/\d+/g);
  if(m) $('#fcolor').value = '#' + m.slice(0,3).map(x => (+x).toString(16).padStart(2,'0')).join('');
}

