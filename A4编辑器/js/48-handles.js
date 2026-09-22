/* ══════════════════════════════════════════════════════════════
   拖拽手柄：选中表格 → 列宽手柄；选中图片（或图文框）→ 宽度手柄
   依赖：00-base(mmPx)、10-inspector(selected)、20-paper(contentW)、70-pagination(reflowSoon)
   对外：showHandles hideHandles refreshHandles
   ★手柄挂在 .paper 上（不是 .body）：syncFromPages 只读 .body 的 innerHTML，
     所以手柄永远不会被抄进文档/导出。
   ══════════════════════════════════════════════════════════════ */

let HANDLE_DRAG = null;                 // 正在拖动的手柄状态

function hideHandles(){
  document.querySelectorAll('.a4handle').forEach(x => x.remove());
}
function showHandles(){
  hideHandles();
  const el = selected;
  if(!el || !document.contains(el)) return;
  const paper = el.closest ? el.closest('.paper') : null;
  if(!paper) return;                    // 只在分页编辑视图里显示手柄
  const tb = el.tagName === 'TABLE' ? el : (el.closest ? el.closest('table') : null);
  if(tb && paper.contains(tb)){ showColHandles(tb, paper); return; }
  const img = el.tagName === 'IMG' ? el : (el.querySelector ? el.querySelector('img') : null);
  if(img && paper.contains(img)) showImgHandle(img, paper);
}
function refreshHandles(){ hideHandles(); if(selected) showHandles(); }

function makeHandle(cls, paper){
  const h = document.createElement('div');
  h.className = 'a4handle ' + cls;
  h.contentEditable = 'false';
  paper.appendChild(h);
  return h;
}
/* 列宽手柄：贴在第 i 与 i+1 列的分界线上 */
function showColHandles(t, paper){
  const rows = [...t.rows]; if(!rows.length) return;
  const n = rows[0].cells.length; if(n < 2) return;
  const pr = paper.getBoundingClientRect(), tr = t.getBoundingClientRect();
  const cells = [...rows[0].cells].map(c => c.getBoundingClientRect());
  for(let i = 0; i < n - 1; i++){
    const h = makeHandle('col', paper);
    h.style.left = (cells[i].right - pr.left - 2) + 'px';
    h.style.top = (tr.top - pr.top) + 'px';
    h.style.height = tr.height + 'px';
    h.dataset.col = i;
    h.title = '拖动调整第 ' + (i + 1) + ' / ' + (i + 2) + ' 列的宽度';
    h.addEventListener('mousedown', e => startColDrag(e, t, i));
  }
}
/* 图片手柄：贴在图片右下角 */
function showImgHandle(img, paper){
  const r = img.getBoundingClientRect(), pr = paper.getBoundingClientRect();
  const h = makeHandle('imgw', paper);
  h.style.left = (r.right - pr.left - 6) + 'px';
  h.style.top = (r.bottom - pr.top - 6) + 'px';
  h.title = '拖动调整图片宽度（当前 ' + img.style.width + '）';
  h.addEventListener('mousedown', e => startImgDrag(e, img));
}

function startColDrag(e, t, i){
  e.preventDefault(); e.stopPropagation();
  const cells = t.rows[0].cells;
  HANDLE_DRAG = {
    kind: 'col', t: t, i: i, x0: e.clientX,
    wA: cells[i].getBoundingClientRect().width,
    wB: cells[i + 1].getBoundingClientRect().width,
    tw: t.getBoundingClientRect().width
  };
  beginDrag('col-resize');
}
function startImgDrag(e, img){
  e.preventDefault(); e.stopPropagation();
  HANDLE_DRAG = { kind: 'img', img: img, x0: e.clientX, w0: img.getBoundingClientRect().width };
  beginDrag('ew-resize');
}
function beginDrag(cursor){
  document.body.style.cursor = cursor;
  document.addEventListener('mousemove', onDragMove, true);
  document.addEventListener('mouseup', onDragEnd, true);
}
function onDragMove(e){
  const d = HANDLE_DRAG; if(!d) return;
  e.preventDefault();
  if(d.kind === 'col'){
    const min = 8 * mmPx;                                     // 最小列宽 8mm
    let dx = e.clientX - d.x0;
    dx = Math.max(min - d.wA, Math.min(d.wB - min, dx));      // 两边都不许小于 8mm
    const a = d.wA + dx, b = d.wB - dx;
    const cg = d.t.querySelector('colgroup') || d.t.insertBefore(document.createElement('colgroup'), d.t.firstChild);
    while(cg.children.length < d.i + 2) cg.appendChild(document.createElement('col'));
    cg.children[d.i].style.width = (a / d.tw * 100).toFixed(2) + '%';
    cg.children[d.i + 1].style.width = (b / d.tw * 100).toFixed(2) + '%';
    const paper = d.t.closest('.paper');
    if(paper){
      const pr = paper.getBoundingClientRect();
      const x = d.t.rows[0].cells[d.i].getBoundingClientRect().right - pr.left;
      document.querySelectorAll('.a4handle.col').forEach(h => {
        if(+h.dataset.col === d.i) h.style.left = (x - 2) + 'px';
      });
    }
  } else if(d.kind === 'img'){
    const min = 15 * mmPx, max = contentW() * mmPx;
    const w = Math.max(min, Math.min(max, d.w0 + (e.clientX - d.x0)));
    d.img.style.width = (w / mmPx).toFixed(1) + 'mm';          // 用 mm，打印口径一致
    const paper = d.img.closest('.paper');
    if(paper){
      const pr = paper.getBoundingClientRect(), r = d.img.getBoundingClientRect();
      const h = document.querySelector('.a4handle.imgw');
      if(h){ h.style.left = (r.right - pr.left - 6) + 'px'; h.style.top = (r.bottom - pr.top - 6) + 'px'; }
    }
  }
}
function onDragEnd(){
  const d = HANDLE_DRAG; if(!d) return;
  HANDLE_DRAG = null;
  document.body.style.cursor = '';
  document.removeEventListener('mousemove', onDragMove, true);
  document.removeEventListener('mouseup', onDragEnd, true);
  DIRTY = true;
  reflowSoon();                     // 重排结束时会 refreshHandles()，把手柄贴到新页面上
}
