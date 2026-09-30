/* 页面脚本：**二级菜单 hover 断链体检**（用户 2026-09-29：「鼠标放到导出上弹出正常，移到具体导出项时快速消失点不到」）
 *   node tools/cdp/eval.mjs "<url>" tools/cdp/probes/menu-submenu.js
 *   真实指针路径版（推荐，最接近人操作）：
 *   node tools/cdp/eval.mjs "<url>" tools/cdp/probes/menu-submenu.js \
 *        --moves "@[data-menu-sub=<父项>];@[data-menu-sub=<父项>]-60,+40;@[data-menu-panel=<父项>]+0,+20;@[data-menu-item=<目标项>]"
 *   （--moves 的每个点可以写成选择器 `@sel`，也支持偏移 `@sel±dx,±dy`；点之间用分号分隔）
 *
 * ★**自动探测"父项/兄弟子菜单"这一对**（2026-09-30）：菜单会被重排（键位会变），
 *   所以这里不写死 key —— 挑「下面紧跟另一个子菜单行」的那一对：那正是"斜着往下走会掠过兄弟行"的最坏情况。
 *   想指定就传 `--expr`？不行；需要指定时改下面的 PICK（留了覆盖变量）。
 *
 * 量什么：
 *   ① 父行 rect、面板 rect、两者之间那块"死区"（父行下方 + 面板左侧）是谁；
 *   ② 从父行 **mouseout 到死区** 后，面板多久消失（0~40ms = 断链 bug；应当有宽限期）；
 *   ③ 60ms 时面板是否还在、之后是否正常收起（合成事件只能验到这一步）；
 *   ④ 目标项是否可命中（elementFromPoint 落在它自己身上）。
 *   "折回面板后仍可点到"必须用 `--moves` 走真实指针（合成事件会同时打开兄弟面板，结论不可用）。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, type, x, y, related) =>
    el?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, relatedTarget: related ?? null }));
  const rect = (el) => {
    const b = el?.getBoundingClientRect();
    return b ? { left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) } : null;
  };

  /* 打开「文件」菜单 */
  const fileBtn = document.querySelector('[data-menu="文件"]');
  if (!fileBtn) return { 错误: '找不到 [data-menu="文件"]' };
  fileBtn.click();
  await sleep(320);

  /* 自动挑一对：某子菜单行下面**还有**子菜单行 */
  const subs = [...document.querySelectorAll('[data-menu-sub]')];
  if (subs.length === 0) return { 错误: '文件菜单里没有子菜单（data-menu-sub）' };
  let pick = subs.find((el, i) => {
    const next = subs[i + 1];
    if (!next) return false;
    return Math.round(next.getBoundingClientRect().top) > Math.round(el.getBoundingClientRect().bottom) - 2;
  });
  const trigger = pick ?? subs[0];
  const triggerKey = trigger.getAttribute('data-menu-sub');
  const sibKey = (subs[subs.indexOf(trigger) + 1] ?? subs[0]).getAttribute('data-menu-sub');
  const sib = document.querySelector(`[data-menu-sub="${sibKey}"]`);

  const panel = () => document.querySelector(`[data-menu-panel="${triggerKey}"]`);
  const inSubtree = (el, root) => !!el && !!root && (root === el || root.contains(el));

  trigger.click(); // SubMenu 触发器上绑了 onClick={show}
  await sleep(260);
  if (!panel()) return { 错误: `点了 ${triggerKey} 但面板没出来` };

  const wrapper = trigger.parentElement; // SubMenu 的包装 div（挂了 mouseenter/leave）
  const rowR = rect(wrapper);
  const panR = rect(panel());
  /* 死区采样点：父行**下方** 8px、面板**左侧** 12px。这一带可能是普通行，也可能是兄弟子菜单行 —— 两个都记录 */
  const deadPoint = { x: panR.left - 12, y: rowR.bottom + 8 };
  const deadEl = document.elementFromPoint(deadPoint.x, deadPoint.y);
  const deadSiblingSub = deadEl?.closest?.('[data-menu-sub]')?.getAttribute('data-menu-sub') ?? null;
  const target = panel().querySelector('[data-menu-item]');
  const targetR = rect(target);
  const targetCenter = targetR ? { x: Math.round(targetR.left + targetR.w / 2), y: Math.round(targetR.top + targetR.h / 2) } : null;
  const hitAtTarget = targetCenter ? document.elementFromPoint(targetCenter.x, targetCenter.y) : null;

  /* ② 从父行 mouseout 到死区 → 计时面板消失（期望：普通行 ≥280ms、兄弟子菜单行 ≥240ms） */
  fire(trigger, 'mouseout', deadPoint.x, deadPoint.y, deadEl ?? document.body);
  const t0 = performance.now();
  let goneAt = null;
  for (let i = 0; i < 30; i += 1) {
    await sleep(20);
    if (!panel()) { goneAt = Math.round(performance.now() - t0); break; }
  }
  const graceExpected = deadSiblingSub ? 240 : 280;
  const graceOk = goneAt === null || goneAt >= graceExpected - 40;

  /* ③ 参考值：重开 → 再来一次 mouseout → 60ms 时是否还在（合成事件只能验到"宽限存在"） */
  if (!panel()) {
    trigger.click();
    await sleep(260);
  }
  fire(trigger, 'mouseout', deadPoint.x, deadPoint.y, deadEl ?? document.body);
  await sleep(60);
  const stillOpenAt60 = !!panel();
  await sleep(600);
  const closedLater = !panel();

  /* 结束时**保证面板开着**：方便紧接着用 --moves 走真实指针路径（否则路径里的选择器解析不到） */
  if (!panel()) {
    trigger.click();
    await sleep(320);
  }

  return {
    自动选中的父项: triggerKey,
    兄弟子菜单: sibKey,
    父行: rowR,
    面板: panR,
    死区采样点: deadPoint,
    死区处元素: deadEl ? `${deadEl.tagName.toLowerCase()}${deadEl.getAttribute('data-menu-item') ? '[item=' + deadEl.getAttribute('data-menu-item') + ']' : ''}` : 'null',
    死区处是兄弟子菜单: deadSiblingSub ?? '（否，是普通行）',
    死区是否在子菜单内: inSubtree(deadEl, wrapper) || inSubtree(deadEl, panel()),
    离开后多久消失ms: goneAt,
    期望宽限ms: graceExpected,
    宽限是否达标: graceOk,
    判断: goneAt === null ? '一直没消失' : graceOk ? `宽限 ${goneAt}ms（≥${graceExpected}）✅` : `★${goneAt}ms 就消失（断链 bug）`,
    离开父项60ms时面板是否还在: stillOpenAt60,
    之后是否正常收起: closedLater,
    目标项: targetR,
    目标项此刻可点到: !!hitAtTarget && (hitAtTarget === target || target?.contains(hitAtTarget)),
    提示: '「折回面板后仍可点到」请用 --moves 走真实指针（合成事件会同时打开兄弟面板，结论不可用）',
    结束时面板开着: !!panel(),
  };
})()
