/* ══════════════════════════════════════════════════════════════
   加载 / 保存 / 导出：载入已有 HTML、导出可打印 HTML、写 localStorage
   依赖：00-base、20-paper(applyPaper)、35-numbering(renumber)、70-pagination(paginate/syncFromPages/save)
   对外：loadHTML buildHTML
   ══════════════════════════════════════════════════════════════ */

/* ───────── 加载 / 保存 / 打印 ───────── */
function loadHTML(text, name, quiet){
  const d=new DOMParser().parseFromString(text,'text/html');
  const sheets=[...d.querySelectorAll('.sheet')];
  const box=document.createElement('div');
  SECTIONS.length = 0;
  if(sheets.length){
    sheets.forEach((s, si)=>{
      // ① 读这一页原有的页码模式与文档总页数
      const f=[...s.children].find(c=>c.classList && c.classList.contains('footer'));
      let mode='arabic';
      if(!f){ mode='none'; }                       // 无页脚 → 封面页
      else {
        const t=f.textContent||'';
        const m=/第\s*([IVXLC]+|\d+)\s*页/.exec(t);
        if(m) mode=/^[IVXLC]+$/.test(m[1]) ? 'roman' : 'arabic';
        const tot=/共\s*(\d+)\s*页/.exec(t);
        if(tot && !ORIG_TOTAL) ORIG_TOTAL=+tot[1];
      }
      SECTIONS.push(mode);
      // ② 页间插入显式分页标记（KEEP 模式下会被遵守）
      if(si>0){
        const br=document.createElement('div');
        br.className='pgbreak'; br.setAttribute('data-num', mode);
        br.setAttribute('contenteditable','false');
        box.appendChild(br);
      }
      [...s.children].forEach(ch=>{ if(!ch.classList.contains('footer')) box.appendChild(ch.cloneNode(true)); });
    });
  } else { box.innerHTML = d.body ? d.body.innerHTML : text; SECTIONS.push('arabic'); }
  // 去掉外层遗留的分页/提示元素
  [...box.children].forEach(c=>{ if(c.classList.contains('tip')||c.classList.contains('no-print')) c.remove(); });
  doc.innerHTML = box.innerHTML;
  // 读页边距 / 方向 / 页脚
  const st=[...d.querySelectorAll('style')].map(s=>s.textContent).join('\n');
  // ★把源文件的样式规则注入进来（保证渲染一致）：
  //   剥掉编辑器自己管理的 @page/@media/.sheet/.footer/.tip，以及 body/html/* 全局规则，
  //   只留下 .doc 内容会用到的规则（h1~h4/p/table/th/td/.tabcap/.figcap/.note/img/.topo…）。
  let _sc=document.getElementById('srcCss');
  if(!_sc){ _sc=document.createElement('style'); _sc.id='srcCss'; document.head.appendChild(_sc); }
  // 页面级规则（@page/.sheet/.footer/.tip/body/html/*）一律丢弃：纸张尺寸、页边距、
  // 页脚位置都由编辑器自己负责；把它们套到已定位好的 .body 上会导致"页边距叠加两次"。
  // 其余**内容级**规则（h1~h4/p/table/th/td/.tabcap/.figcap/.note/.topo/.cap/img…）
  // 照旧注入并加 `.doc ` 前缀 —— 封面表格底色这类样式正是靠它们生效。
  _sc.textContent = st.split('}')
    .map(x=>x.trim())
    .filter(x=>x)
    .filter(x=>!/^@(page|media|charset|import)/i.test(x))
    .filter(x=>!/\.(sheet|footer|tip|no-print|hdr)\b/.test(x))
    .filter(x=>!/^(body|html|\*)\s*[,{]/.test(x))
    .map(x=>x+'}')
    .join('\n')
    .replace(/(^|\n)([^@\n][^{]*)\{/g, (m, pre, sel) => pre + sel.split(',').map(t=>{
        t = t.trim(); if(!t) return t;
        return t.startsWith('.doc') ? t : '.doc ' + t;
      }).join(',') + '{');
  const pm=/padding:\s*([\d.]+)mm\s+([\d.]+)mm/.exec(st);
  if(pm){ paper.t=paper.b=(+pm[1])/10; paper.l=paper.r=(+pm[2])/10; }
  // ★若 URL 显式带了 ?ori=，则**保持用户指定的方向**，不被源文件的 @page 覆盖
  const _ov = new URLSearchParams(location.search).get('ori');
  if(_ov !== 'landscape' && _ov !== 'portrait'){
    if(/size:\s*A4\s+landscape/i.test(st) || /width:\s*297mm/.test(st)) paper.ori='landscape';
    else if(/size:\s*A4|width:\s*210mm/.test(st)) paper.ori='portrait';
  }
  const f=d.querySelector('.footer'); if(f){ const t=f.textContent.split('　|　')[0].trim(); if(t) $('#ftrText').value=t; }
  applyPaper(); renumber();
  // ★加载完必须立刻分页渲染：
  //   ① 原先这里没有 paginate()，只靠 boot 里「200ms 后替用户点一次富文本页签」间接渲染；
  //      加载一旦慢于 200ms（HTTP 挂载大文件 + DOMParser），那次分页发生在内容就位之前 → 白屏。
  //   ② DIRTY 必须清零：否则紧接着的 save() 会走 syncFromPages()，用**加载前的旧分页**覆盖刚载入的正文。
  DIRTY = false;
  paginate();
  save();
  if(!quiet) alert('已加载：'+(name||'HTML')+`\n共识别 ${sheets.length||1} 页内容，已合并为可编辑流。\n点「分页预览」可重新分页。`);
  return sheets.length;
}
/* 把编辑器里所有 .doc 前缀的文档样式抽出来（去掉 .doc 前缀）→ 导出 HTML 直接复用。
   ★这样"编辑器里加了样式的组件"导出的 PDF 一定也有样式，不必再维护第二份 CSS 列表。 */
function docCssText(){
  let out = '';
  for(const sheet of document.styleSheets){
    let rules;
    try{ rules = sheet.cssRules; }catch(e){ continue; }
    for(const r of rules){
      const sel = r.selectorText;
      if(!sel || sel.indexOf('.doc') < 0) continue;
      const parts = sel.split(',').map(x => x.trim().replace(/^\.doc\s+/, '').replace(/^\.doc$/, '')).filter(Boolean);
      if(!parts.length) continue;
      let body = '';
      try{ body = r.style.cssText; }catch(e){ body = ''; }
      if(!body) continue;
      out += parts.join(',') + '{' + body + '}\n';
    }
  }
  return out;
}

function buildHTML(){
  syncFromPages();
  const total = paginate();
  const pages=[...prevStage.querySelectorAll('.paper')].map(p=>{
    const b=p.querySelector('.body'), h=p.querySelector('.hdr'), f=p.querySelector('.ftr');
    return `<div class="sheet">\n${h?`<div class="hdr">${h.textContent}</div>\n`:''}${b.innerHTML}\n${f&&f.textContent?`<div class="footer">${f.textContent}</div>\n`:''}</div>`;
  }).join('\n');
  const size = `A4 ${paper.ori==='portrait'?'portrait':'landscape'}`;
  const css = `@page{size:${size};margin:0}
*{box-sizing:border-box}
body{margin:0;background:#eceff3;font-family:"宋体",SimSun,"Times New Roman",serif;font-size:12pt;line-height:1.5;color:#000}
.sheet{position:relative;width:${paper.ori==='portrait'?210:297}mm;height:${paper.ori==='portrait'?297:210}mm;padding:${paper.t*10}mm ${paper.r*10}mm ${paper.b*10}mm ${paper.l*10}mm;overflow:hidden;background:#fff;margin:0 auto 8mm;box-shadow:0 2px 10px rgba(0,0,0,.14)}
.sheet:last-child{margin-bottom:0}
p{margin:0;text-indent:2em}p.noind{text-indent:0}
h1{font:700 22pt/1.3 "黑体",SimHei,sans-serif;text-align:center;text-indent:0;margin:0 0 6pt;color:#1f4e79}
h2{font:700 16pt/1.3 "黑体",SimHei,sans-serif;text-indent:0;margin:12pt 0 6pt;color:#1f4e79;border-left:4px solid #2e74b5;border-bottom:1px solid #dce7f2;padding:0 0 3px 8px}
h3{font:700 14pt/1.3 "黑体",SimHei,sans-serif;text-indent:0;margin:6pt 0;color:#2e74b5}
h4{font:700 12pt/1.3 "黑体",SimHei,sans-serif;text-indent:0;margin:6pt 0;color:#2e74b5}
ul,ol{margin:0 0 6pt;padding-left:2em}li{text-indent:0;margin:2pt 0}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5pt;line-height:1.2;margin:3pt 0 6pt}
th,td{border:1px solid #c9d6e2;padding:3pt;vertical-align:middle;text-indent:0;overflow-wrap:break-word}
th{background:#e8f1f9;color:#1f4e79;font-weight:600;text-align:left}
thead{display:table-header-group}
.tabcap,.figcap{font-size:10.5pt;text-align:center;text-indent:0;color:#333;margin:6pt 0 3pt}
.figcap{margin:3pt 0 12pt}
.note{border-left:4px solid #3a9d5d;background:#f6fbf7;padding:5pt 8pt;margin:5pt 0 8pt;text-indent:0}
img{max-width:100%;height:auto;display:block;margin:6pt auto 0}
hr{border:none;border-top:2px solid #1f4e79;margin:6pt 0 10pt}
.hdr{position:absolute;left:${paper.l*10}mm;right:${paper.r*10}mm;top:15mm;font:10.5pt "宋体",SimSun,serif;color:#333;text-align:center;border-bottom:1px solid #ddd;padding-bottom:2pt}
.footer{position:absolute;left:0;right:0;bottom:${paper.fd*10}mm;padding:0 ${paper.l*10}mm;font:10.5pt "宋体",SimSun,serif;color:#333;text-align:center;border-top:1px dashed #bbb;padding-top:2pt;background:#fff}
@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto}}`
    + '\n/* ── 以下为编辑器内的文档样式（自动同步）── */\n' + docCssText();
  return `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>${($('#hdrText').value||'A4 文档')}</title>\n<style>\n${css}\n</style>\n</head>\n<body>\n${pages}\n</body>\n</html>`;
}
