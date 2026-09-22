/* ══════════════════════════════════════════════════════════════
   图表按章编号：图 X-Y / 表 X-Y（遇 H2 进新章，序号归零）
   依赖：00-base(doc)
   对外：renumber
   ══════════════════════════════════════════════════════════════ */

/* ───────── 图表按章编号 ───────── */
/* 编号口径与方案工具一致：**h2 = 章**（h1 是文档标题），图/表按章编号 图 X-Y / 表 X-Y */
function renumber(){
  let chap=0, tf=0, tt=0;
  [...doc.children].forEach(el=>{
    if(el.nodeName==='H2'){ chap++; tf=0; tt=0; }      // 进新章 → 图/表序号归零
    const isCap = el.classList && el.classList.contains('tabcap');
    const isFig = el.classList && el.classList.contains('figcap');
    if(isCap) tt++;
    if(isFig) tf++;
    if(isCap || isFig){
      const pre = isCap ? `表 ${chap}-${tt}　` : `图 ${chap}-${tf}　`;
      el.textContent = el.textContent.replace(/^[图表][\s　]*\S*[\s　]*/, pre);
    }
  });
}

