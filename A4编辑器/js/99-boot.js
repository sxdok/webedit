/* ══════════════════════════════════════════════════════════════
   启动：恢复上次内容（否则放示例）→ 分页渲染 → 加载组件目录 → 处理 ?selftest/?comptest/?load/?pick
   依赖：以上全部模块（必须最后加载）
   对外：无（顶层即执行）
   ══════════════════════════════════════════════════════════════ */

/* ───────── 启动：恢复上次内容，否则放示例 ───────── */
(function boot(){
  applyPaper();
  const saved = localStorage.getItem('a4editor.doc');
  const sp = localStorage.getItem('a4editor.paper');
  if(sp){ try{ Object.assign(paper, JSON.parse(sp)); applyPaper(); }catch(e){} }
  doc.innerHTML = saved || DEMO;
  renumber(); syncBar();
  // ★启动就必须分页渲染一次：原先 boot 里没有 paginate()，直接打开编辑器（不经 ?load=/自测）
  //   时「富文本」页是空的，要切到「预览」再切回来才由 showTab() 补上分页。
  paginate();
  loadComponentFiles(() => {         // ★读组件目录（异步）→ 完成后才可跑自测
    const _q = new URLSearchParams(location.search);
    // ?pick=<css 选择器>：组件就绪后自动选中一个元素（便于验证/截图属性编辑器）。
    //   ★必须放在这里而不是 boot 开头：组件表没加载完时 compOf() 认不出任何元素，
    //     属性表会显示"没被组件识别"，而且之后没有人再刷新它。
    const _pk = _q.get('pick');
    if(_pk){ const t = pageHost().querySelector(_pk); if(t) selEl(t); }
    if(_q.get('selftest')){ selfTest(); return; }
    if(!_q.get('comptest')) return;
    const seq = ['cover','toc','h2','p','p','table','note','h3','ul','figure','hr','pagebreak','h2','p'];
    doc.innerHTML = seq.map(k => (COMPS[k] && COMPS[k].html) || ('<!-- ' + k + ' -->')).join('\n');
    DIRTY = true; renumber(); paginate();
    const modes = [...pageHost().querySelectorAll('.paper')].map(p => p.dataset.num || '?');
    document.title = 'comptest: 块' + doc.children.length + ' 页' + modes.length + ' [' + modes.join(',') + ']';
  });
  // ?load=<url> 直接打开一份已生成的 HTML（例如 ?load=file:///D:/x.html）
  const q = new URLSearchParams(location.search).get('load');
  if(q){
    // 用 XHR 而不是 fetch：Chromium 对 file:// 的 fetch 拦截更严；
    // 无论哪种方式被拦，都降级提示用户改用「加载 HTML」按钮（File API 不受限制）。
    const tip = msg => { document.title = '加载失败 · A4 文档编辑器';
      const p = document.createElement('p'); p.className = 'hint';
      p.style.color = '#b06'; p.textContent = msg;
      const bar = document.querySelector('#bar'); if(bar) bar.after(p); };
    try{
      const xhr = new XMLHttpRequest();
      xhr.open('GET', q, true);
      xhr.onload = () => {
        if(xhr.status === 0 || xhr.status === 200){
          const n = loadHTML(xhr.responseText, decodeURIComponent(q.split('/').pop()||'HTML'), true);
          document.title = '已加载 ' + n + ' 页 · A4 文档编辑器';
          // ★自测：源码往返（?mdtest=1）并列出丢失的块
          if(new URLSearchParams(location.search).get('mdtest')){
            const key = el => el.nodeName + (el.className ? '.' + String(el.className).replace(/\bsel\b/g,'').trim().split(/\s+/).filter(Boolean).join('.') : '')
                             + '|' + (el.textContent || '').replace(/\s+/g,'').slice(0,22);
            const before = [...doc.children].map(key);
            const md = toMd();
            doc.innerHTML = fromMd(md); renumber();
            const after = new Set([...doc.children].map(key));
            const miss = before.filter(k => !after.has(k));
            document.title = '往返: ' + before.length + ' → ' + doc.children.length + ' 丢失 ' + miss.length;
            const pre = document.createElement('pre');
            pre.style.cssText = 'font:8pt monospace;white-space:pre-wrap;background:#fffbe6;padding:6pt;border:1px solid #e0c97f';
            pre.textContent = '往返丢失 ' + miss.length + ' / ' + before.length + ' 块：\n' + miss.join('\n');
            doc.appendChild(pre);
          }
          setTimeout(()=>{ document.querySelector('#tabs button[data-tab="edit"]').click(); }, 200);
        } else { tip('自动加载失败（HTTP ' + xhr.status + '）。请点右上角「加载 HTML」选择文件，功能完全一样。'); }
      };
      xhr.onerror = () => tip('浏览器拦截了本地文件自动加载。请点右上角「加载 HTML」选择文件，功能完全一样。');
      xhr.send();
    }catch(e){ tip('自动加载失败：' + e.message + '。请改用「加载 HTML」按钮。'); }
  }
  if(new URLSearchParams(location.search).get('debug')) setTimeout(()=>{ try{ paginate(); debugReport(); }catch(e){ console.warn(e); } }, 900);
  const _ori = new URLSearchParams(location.search).get('ori');
  if(_ori==='landscape' || _ori==='portrait'){ paper.ori = _ori; applyPaper(); }
})();
