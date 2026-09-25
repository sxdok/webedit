/**
 * 外部（热加载）组件目录的落地策略。
 *
 * 问题：`web-editor/public/组件` 在安装包里是**只读**的（Program Files 下普通用户没权限），
 * 而编辑器有两条会**写**组件目录的路径：界面「导入组件包」（POST `/__savePlugin`）与 MCP 的插件工具。
 * 如果直接用随包目录，这两条在安装版上必然失败。
 *
 * 所以分发版这么做：**首次运行把随包的组件"种子"拷进 userData/组件，之后一律用用户目录**。
 *   · 每个文件只在"目标不存在"时拷贝 —— 用户改过的组件不会被升级覆盖掉；
 *   · 应用升级带来的**新**组件会自动出现（目标不存在 → 拷进去）；
 *   · dev 模式**不拷贝**：继续直接读写仓库里的 `public/组件`（现有的热加载开发流程不变）。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {object} o
 * @param {string} o.mode                 'dev' | 'packaged'
 * @param {string|null} o.bundledDir      随包的组件目录（可能不存在）
 * @param {string} o.userDir              userData 下的可写组件目录
 * @param {object} [o.logger]
 * @returns {{ dir: string, mode: 'repo'|'user', seeded: number, kept: number, bundled: number }}
 */
export function resolveComponentsDir({ mode, bundledDir, userDir, logger } = {}) {
  if (mode !== 'packaged') {
    logger?.info?.(`组件目录（dev，直接用仓库源目录，改动即热加载）：${bundledDir ?? '(不存在)'}`);
    return { dir: bundledDir ?? null, mode: 'repo', seeded: 0, kept: 0, bundled: 0 };
  }

  mkdirSync(userDir, { recursive: true });
  let seeded = 0;
  let kept = 0;
  let bundled = 0;
  if (bundledDir && existsSync(bundledDir)) {
    for (const f of readdirSync(bundledDir)) {
      if (!f.endsWith('.js') && f !== '_manifest.json') continue;
      bundled += 1;
      const dst = join(userDir, f);
      if (existsSync(dst)) {
        kept += 1;
        continue;
      }
      try {
        copyFileSync(join(bundledDir, f), dst);
        seeded += 1;
      } catch (e) {
        logger?.warn?.(`组件种子拷贝失败：${f} → ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  logger?.info?.(`组件目录（分发版，可写）：${userDir}　随包 ${bundled} 个 → 本次补入 ${seeded} 个、保留用户已有 ${kept} 个`);
  return { dir: userDir, mode: 'user', seeded, kept, bundled };
}
