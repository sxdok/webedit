/* ══════════════════════════════════════════════════════════════
   组件层自测（?selftest=1）：24 条断言 + 末页报告
   依赖：00/10/20/25/30/35/40/50/70/80 各模块（自测要覆盖全部公开函数）
   对外：selfTest
   ══════════════════════════════════════════════════════════════ */

/* ───────── ★组件层自测（?selftest=1）─────────
   无头浏览器点不了按钮、打不了字，所以把"组件模板/识别、属性读写、表格行列、元素识别"
   做成页面内断言，结果写进标题并打印成一页，便于自动化回归。 */
function selfTest(){
  const res = [];
  const docKeep = doc.innerHTML;          // ★自测会改到分页内容，结尾统一还原（否则重排会把测试数据写回文档）
  const ok = (name, cond, extra) => res.push((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  → ' + extra : ''));
  const keys = Object.keys(COMPS);
  ok('组件已从目录加载', keys.length >= 15, keys.length + ' 个');
  // ⓪ 启动即分页：boot() 必须自己调 paginate()，不能等用户切页签
  //    （原来靠 ?load= 路径里「200ms 后替用户点一次富文本页签」侥幸渲染，慢加载即白屏）
  const bootPages = pageHost().querySelectorAll('.paper').length;
  ok('启动即已完成分页（无需切页签）', bootPages > 0, bootPages + ' 页');
  setAllPal(true);          // 自测要求所有分类展开（抽屉状态会记在 localStorage，用户可能收起了某些分类）

  // ① 模板可解析 + 能被 compOf 识别
  const probe = document.createElement('div');
  let tmpl = 0, rec = 0, noMatch = [];
  const MULTI = ['cover', 'toc'];                  // 多根复合组件：由"标题+内容+分节标记"组成
  keys.forEach(k => {
    const c = COMPS[k];
    if(!c || !c.html) return;                      // table/figure/img 的 html 为空是设计如此
    if(MULTI.indexOf(k) >= 0) return;              // 多根组件不做"首元素匹配"检查
    probe.innerHTML = c.html;
    const el = probe.firstElementChild;
    if(!el) return;
    tmpl++;
    if(c.match){
      let hit = false;
      try{ hit = el.matches(c.match) || !!(el.querySelector && el.querySelector(c.match)); }catch(e){}
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
  // ④b 页面上（#prevStage 的分页克隆体）点选的元素也必须认得出组件，
  //     否则"选中元素 → 属性表"在真实操作路径上是空的（自测原来只查了隐藏的 #doc，漏掉这条）
  const pel = pageHost().querySelector('h1,h2,h3,p,table,div.note');
  const pkey = compOf(pel);
  ok('compOf 认识页面上点选的元素', !!pkey, pel ? pel.nodeName + ' → ' + pkey : '页内无元素');

  // ⑥ A4 纵横向版心
  const w0 = contentW(), h0 = contentH();
  paper.ori = 'landscape'; applyPaper();
  const w1 = contentW(), h1 = contentH();
  paper.ori = 'portrait'; applyPaper();
  ok('纵向 A4 版心 146.6×246.2mm', Math.abs(w0-146.6) < 0.1 && Math.abs(h0-246.2) < 0.1,
     w0.toFixed(1) + '×' + h0.toFixed(1));
  ok('横向 A4 版心 233.6×159.2mm', Math.abs(w1-233.6) < 0.1 && Math.abs(h1-159.2) < 0.1,
     w1.toFixed(1) + '×' + h1.toFixed(1));

  // ⑦ 组件包导入往返（导入 → 进组件表 → 导出/清理，不留痕）
  const nImp = importCompObj({ zz_selftest: {
    name: '自测组件', group: '自测', match: 'p.zzc',
    html: '<p class="zzc">x</p>', props: [{ k:'text', t:'text', label:'文字' }] } });
  ok('导入组件包（含中文组件名）', nImp === 1 && !!COMPS.zz_selftest, '共 ' + Object.keys(COMPS).length + ' 个');
  delete COMPS.zz_selftest; saveUserComps(); renderPalette();
  ok('导入后可干净移除', !COMPS.zz_selftest);

  // ⑧ 导出 HTML（含分页 .sheet 与页脚）
  const outHtml = buildHTML();
  ok('导出 HTML 含 .sheet 与页脚',
     outHtml.indexOf('<div class="sheet">') >= 0 && outHtml.indexOf('class="footer"') >= 0,
     Math.round(outHtml.length/1024) + ' KB');

  // ⑨ 组件模板搭出三段式 → 断言页码模式顺序 none → roman → arabic
  const keep = doc.innerHTML;
  doc.innerHTML = ['cover','toc','h2','p'].map(k => (COMPS[k] && COMPS[k].html) || '').join('\n');
  DIRTY = false; renumber(); paginate();
  const m3 = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || '?');
  ok('三段式：封面 none → 目录 roman → 正文 arabic',
     m3[0] === 'none' && m3.indexOf('roman') > 0 && m3.indexOf('arabic') > m3.indexOf('roman'),
     m3.join(','));
  // ⑩ 单击卡片 = 选中（不插入）；插入改由双击/拖动触发（见 ⑮⑯）
  const btnP = [...document.querySelectorAll('#palette .comp')].find(b => b.dataset.key === 'p');
  const host = pageBodies().pop();
  let insOK = false, insNote = btnP ? '未取到页体' : '未找到 p 卡片';
  if(btnP && host){
    const len0 = host.innerHTML.length, n0 = host.children.length;
    btnP.click();
    const selOn = btnP.classList.contains('on') && PAL_SEL === 'p';
    const noIns = host.children.length === n0 && host.innerHTML.length === len0;
    insOK = selOn && noIns;
    insNote = '选中高亮 ' + (selOn ? '有' : '无') + '，未插入 ' + (noIns ? '是' : '否')
            + '（块 ' + n0 + '→' + host.children.length + '）';
  }
  ok('单击组件卡片=选中且不插入（真实 click 事件）', insOK, insNote);

  // ⑪ 属性表单改值 → 真实 input 事件 → 写回元素
  const tgt = pageBodies().pop().querySelector('p');
  let prOK = false, prNote = '页体内无 <p>';
  if(tgt){
    selected = tgt; renderProps();
    const inp = document.querySelector('#props label input[type="text"], #props label textarea, #props label input[type="number"]');
    if(inp){
      const before = tgt.outerHTML;
      inp.value = (inp.type === 'number') ? '3' : '自测改值';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      prOK = tgt.outerHTML !== before;
      prNote = '字段「' + ((inp.previousElementSibling && inp.previousElementSibling.textContent) || inp.type) + '」→ ' + (prOK ? '已写回' : '未变化');
    } else prNote = '表单未渲染出可编辑字段';
    selected = null;
  }
  ok('属性表单改值写回元素（真实 input 事件）', prOK, prNote);

  // ⑫ 表格列宽 / 行高：函数路径 + 属性表单路径
  const t2 = document.createElement('table');
  t2.innerHTML = '<thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>'
               + '<tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody>';
  doc.appendChild(t2);
  const okc = setColWidths(t2, '20,50,30');
  const cg2 = t2.querySelector('colgroup');
  const w2 = cg2 ? [...cg2.children].map(c => c.style.width).join(',') : '';
  ok('setColWidths(20,50,30) → 20%/50%/30%', okc && w2 === '20%,50%,30%', w2 || '无 colgroup');
  ok('readColWidths 读回一致', readColWidths(t2) === '20%,50%,30%', readColWidths(t2));
  const okr = setRowHeight(t2, '9');
  const rh = t2.rows[1].cells[0].style.height;
  ok('setRowHeight(9) → 9mm 落到单元格', okr && rh === '9mm', rh || '未设置');
  let formOK = false, formNote = '属性表里没有「列宽」字段';
  selected = t2; renderProps();
  const cin = [...document.querySelectorAll('#props label input')]
    .find(i => i.closest('label') && i.closest('label').textContent.trim().indexOf('列宽') === 0);
  if(cin){
    cin.value = '25,25,50';
    cin.dispatchEvent(new Event('input', { bubbles: true }));
    formOK = readColWidths(t2) === '25%,25%,50%';
    formNote = '表单输入 → ' + readColWidths(t2);
  }
  ok('属性表单改列宽（真实 input 事件）', formOK, formNote);
  selected = null; t2.remove();

  // ⑬ 组件箱渲染缩略图卡片
  const cards = [...document.querySelectorAll('#palette .comp')];
  const thumbs = cards.filter(b => b.querySelector('.thumb .thumbIn'));
  ok('组件箱每张卡片都渲染缩略图',
     cards.length === Object.keys(COMPS).length && thumbs.length === cards.length,
     cards.length + ' 张卡片 / ' + thumbs.length + ' 张有缩略图');

  // ⑭ 组件箱：抽屉式分类
  const drawers = [...document.querySelectorAll('#palette .drawer')];
  const dBodies = [...document.querySelectorAll('#palette .drawerBody')];
  ok('组件箱是抽屉式分类（可折叠）', drawers.length >= 5 && dBodies.length === drawers.length,
     drawers.length + ' 个分类：' + drawers.map(d => (d.querySelector('.dname') || {}).textContent).join('/'));

  // ⑮ 双击卡片即插入（真实 dblclick 事件）
  const pCard = document.querySelector('#palette .comp[data-key="p"]');
  const host2 = pageBodies().pop();
  let dbOK = false, dbNote = pCard ? '未取到页体' : '没有 p 卡片';
  if(pCard && host2){
    if(!host2.isContentEditable) host2.contentEditable = 'true';
    host2.focus();
    const rg2 = document.createRange(); rg2.selectNodeContents(host2); rg2.collapse(false);
    const sl2 = getSelection(); sl2.removeAllRanges(); sl2.addRange(rg2);
    const nb = host2.children.length;
    pCard.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    dbOK = host2.children.length === nb + 1;
    dbNote = '块 ' + nb + '→' + host2.children.length;
  }
  ok('双击组件卡片即插入（真实 dblclick 事件）', dbOK, dbNote);

  // ⑯ 拖动卡片插入到落点所在块之后（真实 dragstart/dragover/drop）
  const nCard = document.querySelector('#palette .comp[data-key="note"]');
  const host3 = pageBodies().pop();
  let drOK = false, drNote = nCard ? '未取到页体' : '没有 note 卡片';
  if(nCard && host3){
    nCard.dispatchEvent(new MouseEvent('dragstart', { bubbles: true }));
    const rc = host3.getBoundingClientRect();
    const px = rc.left + Math.max(20, rc.width / 2), py = rc.top + 30;
    const view = document.getElementById('view');
    view.dispatchEvent(new MouseEvent('dragover', { bubbles: true, clientX: px, clientY: py }));
    const marked = !!document.querySelector('.dropmark');
    const nb2 = host3.children.length;
    view.dispatchEvent(new MouseEvent('drop', { bubbles: true, clientX: px, clientY: py }));
    drOK = host3.children.length === nb2 + 1;
    drNote = '落点高亮 ' + (marked ? '有' : '无') + '，块 ' + nb2 + '→' + host3.children.length;
  }
  ok('拖动组件到文档里即插入（真实拖放事件）', drOK, drNote);

  // ⑰ 属性编辑器：分组（常改的在前）+ 过滤框
  const pel2 = pageBodies().pop().querySelector('p');
  let pgOK = false, pgNote = '页内无 <p>';
  if(pel2){
    selected = pel2; renderProps();
    const gs = [...document.querySelectorAll('#props .pgroup')];
    const names = gs.map(g => g.dataset.group);
    const fi2 = document.getElementById('propFilter');
    let filtOK = false;
    if(fi2){
      fi2.value = '字号'; fi2.dispatchEvent(new Event('input', { bubbles: true }));
      const vis = [...document.querySelectorAll('#props .pgrid label')].filter(l => l.style.display !== 'none');
      filtOK = vis.length >= 1 && vis.every(l => ((l.querySelector('span.f') || {}).textContent || '').indexOf('字号') >= 0);
      fi2.value = ''; fi2.dispatchEvent(new Event('input', { bubbles: true }));
    }
    pgOK = gs.length >= 2 && names.indexOf('文字内容') === 0 && filtOK;
    pgNote = names.join('/') + '｜过滤生效 ' + (filtOK ? '是' : '否');
    selected = null;
  }
  ok('属性编辑器：分组(常改在前) + 过滤框', pgOK, pgNote);

  // ⑱ 表格列宽拖拽手柄（真实 mousedown/mousemove/mouseup）
  const hostT = pageBodies().pop();
  const tb2 = document.createElement('table');
  tb2.innerHTML = '<colgroup><col style="width:50%"><col style="width:50%"></colgroup>'
                + '<thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';
  hostT.appendChild(tb2);
  selected = tb2; refreshInspector();
  const colHs = [...document.querySelectorAll('#prevStage .a4handle.col')];
  let hOK = false, hNote = '没生成列宽手柄';
  if(colHs.length === 1){
    const h = colHs[0], r = h.getBoundingClientRect();
    const y = r.top + r.height / 2, x0 = r.left + 1;
    const w0 = tb2.rows[0].cells[0].getBoundingClientRect().width;
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: y }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + 40, clientY: y }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 + 40, clientY: y }));
    const w1 = tb2.rows[0].cells[0].getBoundingClientRect().width;
    hOK = w1 > w0 + 10;
    hNote = '第1列 ' + Math.round(w0) + '→' + Math.round(w1) + 'px（colgroup ' + readColWidths(tb2) + '）';
  }
  ok('表格列宽拖拽手柄（真实 mousedown/move/up）', hOK, hNote);

  // ⑲ 图片宽度拖拽手柄
  const im2 = document.createElement('img');
  im2.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  im2.style.width = '60mm';
  hostT.appendChild(im2);
  selected = im2; refreshInspector();
  const imH = document.querySelector('#prevStage .a4handle.imgw');
  let iOK = false, iNote = '没生成图片手柄';
  if(imH){
    const r2 = imH.getBoundingClientRect();
    const w0 = im2.getBoundingClientRect().width;
    imH.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r2.left + 2, clientY: r2.top + 2 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r2.left + 42, clientY: r2.top + 2 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r2.left + 42, clientY: r2.top + 2 }));
    const w1 = im2.getBoundingClientRect().width;
    iOK = w1 > w0 + 10 && /mm$/.test(im2.style.width);
    iNote = '宽 ' + Math.round(w0) + '→' + Math.round(w1) + 'px（' + im2.style.width + '）';
  }
  ok('图片宽度拖拽手柄（真实 mousedown/move/up）', iOK, iNote);

  // ⑳ 插入路径已合并：insertTable 也走 insertHtmlBlock（插入后是独立块，不被并进段落）
  const hostI = pageBodies().pop();
  const nb3 = hostI.children.length;
  insertTable(2, 2, true, false);
  const tblNew = [...hostI.children].find(x => x.tagName === 'TABLE' && !x.dataset.seen);
  if(tblNew) tblNew.dataset.seen = '1';
  ok('insertTable 走统一插入路径（独立块）', hostI.children.length > nb3,
     '块 ' + nb3 + '→' + hostI.children.length);

  selected = null; hideHandles(); tb2.remove(); im2.remove();

  // 收尾：还原文档、取消待触发的重排（reflowSoon 的 650ms 回调会 save() 把测试数据写回）
  clearTimeout(_reflowT);
  doc.innerHTML = docKeep; DIRTY = false; renumber(); syncBar(); paginate();
  ok('自测后文档已还原', doc.innerHTML === docKeep);

  // ⑤ 先分页，再断言分页结果（顺序很重要：原来在 paginate 之前取容器，永远是空的）
  paginate();
  const modes = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || '?');
  ok('分页已生成', modes.length > 0, modes.length + ' 页');
  if(doc.querySelector('.pgbreak[data-num]'))
    ok('含封面节(none)', modes.indexOf('none') >= 0, modes.join(','));
  else
    ok('无分节标记时不做封面节断言（示例文档）', true, modes.join(','));

  const bad = res.filter(x => x.indexOf('FAIL') === 0).map(x => x.slice(6).split('  →')[0]);
  const good = res.length - bad.length;
  document.title = 'selftest: ' + good + '/' + res.length + (bad.length ? '  失败项: ' + bad.join(' | ') : ' 全部通过');
  SELFTEST_REPORT = '组件层自测 ' + good + '/' + res.length + '\n' + res.join('\n');
  paginate();
}

