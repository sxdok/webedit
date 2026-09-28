/**
 * 职责：**视图级动作的单一来源**（菜单与快捷键共用）。
 *
 * 目前只有「全屏」（M-7）。为什么要抽出来：菜单里写 `F11`、快捷键里也要响应 F11，
 * 若各写一份，「菜单标了但按下去没用」和「按下去行为不同」这两类问题迟早出现（§7.4 明确要验这条）。
 */
import { desktopApi } from './desktopChrome';
import { log } from './logger';

/**
 * 切换全屏。
 *   · 桌面版：走 **窗口全屏**（`desktop:toggle-fullscreen`）——网页 Fullscreen API 会把无边框窗口的
 *     标题栏覆盖层一起带走（最小化/最大化/关闭按钮消失），用户会以为程序坏了；
 *   · 浏览器：退回 DOM Fullscreen API（按 Esc 退出由浏览器负责）。
 */
export async function toggleFullscreen(): Promise<boolean> {
  const d = desktopApi();
  if (d) {
    try {
      const on = await d.toggleFullscreen();
      log.info('view', `全屏：${on ? '开' : '关'}（窗口全屏）`);
      return on;
    } catch (e) {
      log.warn('view', `窗口全屏失败，退回网页全屏：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      log.info('view', '全屏：关（网页 Fullscreen API）');
      return false;
    }
    await document.documentElement.requestFullscreen();
    log.info('view', '全屏：开（网页 Fullscreen API）');
    return true;
  } catch (e) {
    log.warn('view', `网页全屏也不可用：${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
