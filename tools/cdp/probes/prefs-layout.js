/* 页面脚本：**首选项布局体检 + 悬浮气泡是否真弹出**（2026-09-29 用户"提示类内容改悬浮气泡、别太乱"的验收探针）
 *   node tools/cdp/eval.mjs "<url>/?prefs=1" tools/cdp/probes/prefs-layout.js
 *   想拍下气泡的样子：再加 `--hover "[data-pref='autoSave'] [data-pref-tip]" --shot var/shots/prefs.png`
 *     （`--hover` 用 CDP 派发**受信任**鼠标事件；合成 MouseEvent 委托层不认，别用）
 * 量的东西对应那条要求：
 *   · 行内提示长度（>16 字就该进气泡）；
 *   · 气泡（data-pref-tip）数量与内容是否为空；
 *   · 有没有原生 title（D16 禁止）；
 *   · 控件列右边缘是否对齐（行对齐）；
 *   · 悬浮后 [data-tooltip] 是否真的出现、内容对不对。
 * 正常的样子（2026-09-29 实测）：17 行、控件右边缘**只有一个取值**、行高统一 32px、行内超长 0、
 * 气泡 23 个非空、原生 title 0、行内溢出 0、悬浮后气泡出现。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [...document.querySelectorAll('[data-pref]')];
  const ctrl = rows.map((r) => r.lastElementChild).filter(Boolean);
  const rights = [...new Set(ctrl.map((c) => Math.round(c.getBoundingClientRect().right)))];
  const inline = rows
    .map((r) => ({ key: r.getAttribute('data-pref'), text: ((r.querySelector('[data-pref-hint="1"]') || {}).textContent || '').trim() }))
    .filter((x) => x.text.length > 16);
  const tips = [...document.querySelectorAll('[data-pref-tip]')];
  const tipsEmpty = tips.filter((t) => !(t.getAttribute('data-tip-text') || '').trim()).length;
  const nativeTitle = [...document.querySelectorAll('[data-pref], [data-pref-tip], [data-pref-select], [data-reload-live], [data-pref-restore]')].filter((el) => el.hasAttribute('title')).length;
  const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height));
  const rowBox = document.querySelector('[data-pref="compPreview"]');
  const overflow = rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length;

  /* 模拟 hover：事件委托层监听 document 上的 mouseover/mousemove */
  let tipShown = false;
  let tipText = '';
  if (tips[0]) {
    const b = tips[0].getBoundingClientRect();
    const x = Math.round(b.left + b.width / 2);
    const y = Math.round(b.top + b.height / 2);
    for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
      tips[0].dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
    await sleep(900);
    const box = document.querySelector('[data-tooltip="1"]');
    tipShown = !!box;
    tipText = (box?.textContent ?? '').trim().slice(0, 60);
  }

  return {
    行数: rows.length,
    控件右边缘取值: rights,
    行高范围: heights.length ? `${Math.min(...heights)}~${Math.max(...heights)}` : '—',
    行内超长说明: inline,
    气泡数: tips.length,
    气泡内容为空: tipsEmpty,
    原生title数: nativeTitle,
    行内溢出: overflow,
    首行高: rowBox ? Math.round(rowBox.getBoundingClientRect().height) : null,
    悬浮后出现气泡: tipShown,
    气泡内容片段: tipText,
  };
})()
