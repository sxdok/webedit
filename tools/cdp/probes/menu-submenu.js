/* 页面脚本：**二级菜单 hover 断链体检**（用户 2026-09-29：「鼠标放到导出上弹出正常，移到具体导出项时快速消失点不到」）
 *   node tools/cdp/eval.mjs "<url>" tools/cdp/probes/menu-submenu.js
 *   真实指针路径版（推荐，最接近人操作）：
 *   node tools/cdp/eval.mjs "<url>" tools/cdp/probes/menu-submenu.js \
 *        --moves "<导出行右下角>;<死区点>;<目标项中心>"
 *   （--moves 用 CDP 派发受信任鼠标事件；点用 `x,y` 分号分隔）
 *
 * 量什么：
 *   ① 父行 rect、面板 rect、两者之间的"死区"（父行下方 + 面板左侧）是否存在；
 *   ② 从父行 **mouseout 到死区** 后，面板多久消失（0ms = 断链 bug，应当有宽限期）；
 *   ③ mouseout → 在宽限期内进入面板 → 面板是否仍开着；
 *   ④ 目标项是否可命中（elementFromPoint 落在它自己身上 = 点得到）。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, type, x, y, related) =>
    el?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, relatedTarget: related ?? null }));
  const rect = (el) => {
    const b = el?.getBoundingClientRect();
    return b ? { left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) } : null;
  };
  const panel = () => document.querySelector('[data-menu-panel="export-sub"]');
  const inSubtree = (el, root) => !!el && !!root && (root === el || root.contains(el));

  /* 打开「文件」菜单 */
  const fileBtn = document.querySelector('[data-menu="文件"]');
  if (!fileBtn) return { 错误: '找不到 [data-menu="文件"]' };
  fileBtn.click();
  await sleep(320);

  const trigger = document.querySelector('[data-menu-sub="export-sub"]');
  if (!trigger) return { 错误: '文件菜单里找不到 [data-menu-sub="export-sub"]（可能菜单没打开）' };
  const wrapper = trigger.parentElement; // SubMenu 的包装 div（挂了 mouseenter/leave）
  trigger.click(); // onClick={show}：最稳的展开方式
  await sleep(260);
  if (!panel()) return { 错误: '点了导出但面板没出来' };

  const rowR = rect(wrapper);
  const panR = rect(panel());
  /* 死区采样点：父行**下方** 8px、面板**左侧** 12px。
     ★注意这一带可能是**普通菜单行**，也可能是**兄弟子菜单行**（实测「导出」下面就是「组件包」），
     两者的期望不同：普通行 → 本面板应保留宽限；兄弟子菜单行 → 兄弟会被打开 -->
     面板要在切换宽限内保留。这里两个都量，并记录针尖下是谁。 */
  const deadPoint = { x: panR.left - 12, y: rowR.bottom + 8 };
  const deadEl = document.elementFromPoint(deadPoint.x, deadPoint.y);
  const deadSiblingSub = deadEl?.closest?.('[data-menu-sub]')?.getAttribute('data-menu-sub') ?? null;
  const target = panel().querySelector('[data-menu-item="docx"]') ?? panel().querySelectorAll('[data-menu-item]')[3] ?? panel().querySelector('[data-menu-item]');
  const targetR = rect(target);
  const targetCenter = targetR ? { x: Math.round(targetR.left + targetR.w / 2), y: Math.round(targetR.top + targetR.h / 2) } : null;
  const hitAtTarget = targetCenter ? document.elementFromPoint(targetCenter.x, targetCenter.y) : null;

  /* ② 从父行 mouseout 到死区 → 计时面板消失（期望：普通行 ≥CLOSE_DELAY、兄弟子菜单 ≥SWITCH_DELAY） */
  fire(trigger, 'mouseout', deadPoint.x, deadPoint.y, deadEl ?? document.body);
  const t0 = performance.now();
  let goneAt = null;
  for (let i = 0; i < 30; i += 1) {
    await sleep(20);
    if (!panel()) { goneAt = Math.round(performance.now() - t0); break; }
  }
  const graceExpected = deadSiblingSub ? 240 : 280;
  const graceOk = goneAt === null || goneAt >= graceExpected - 40;

  /* ③ 参考值：mouseout 后 60ms 时面板是否还在（**合成事件只能验到"宽限存在"**）。
     ★不要用合成 mouseover 去验"折回面板后不关"：合成 mouseout 的 relatedTarget 落在兄弟子菜单行上时，
     React 会同时打开那个兄弟面板（并盖住目标项），与真人路径不是一回事 ——
     "折回后仍可点到"必须用 `--moves` 走真实指针（见文件头）。 */
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
    父行: rowR,
    面板: panR,
    死区采样点: deadPoint,
    死区处元素: deadEl ? `${deadEl.tagName.toLowerCase()}${deadEl.getAttribute('data-menu-item') ? '[item=' + deadEl.getAttribute('data-menu-item') + ']' : ''}` : 'null',
    死区处是兄弟子菜单: deadSiblingSub ?? '（否，是普通行）',
    死区是否在子菜单内: inSubtree(deadEl, wrapper) || inSubtree(deadEl, panEl),
    离开后多久消失ms: goneAt,
    期望宽限ms: graceExpected,
    宽限是否达标: graceOk,
    判断: goneAt === null ? '一直没消失' : graceOk ? `宽限 ${goneAt}ms（≥${graceExpected}）✅` : `★${goneAt}ms 就消失（断链 bug）`,
    离开父项60ms时面板是否还在: stillOpenAt60,
    之后是否正常收起: closedLater,
    目标项: targetR,
    目标项中心命中元素: hitAtTarget ? `${hitAtTarget.tagName.toLowerCase()}${hitAtTarget.getAttribute('data-menu-item') ? '[item=' + hitAtTarget.getAttribute('data-menu-item') + ']' : ''}` : 'null',
    目标项此刻可点到: !!hitAtTarget && (hitAtTarget === target || target?.contains(hitAtTarget)),
    提示: '「折回面板后仍可点到」请用 --moves 走真实指针（合成事件会同时打开兄弟面板，结论不可用）',
    /* 结束时保持面板打开，方便紧接着用 --moves 走真实指针路径 */
    结束时面板开着: !!panel(),
  };
})()
