/**
 * 职责：组件注册入口 —— **按目录自动发现，不维护清单**。
 *
 * 为什么这么做（用户要求）：加/改一个组件时**只动它自己的文件**，不碰框架。
 * 以前这里是"import 45 个组件 + 手写 ALL_COMPONENTS 数组"，加一个组件就要改这个文件，
 * 既容易漏、又让"改组件"变成"改框架"。
 *
 * 现在的机制：
 *   · `import.meta.glob` 把 `components/**\/*.tsx` 全部静态导入（eager，构建期就确定，无运行时成本）；
 *   · 对每个模块，挑出**看起来是组件定义**的导出（有 string 的 `type` + function 的 `render`）自动注册；
 *     所以 `tableKit.tsx` / `shared.ts` 这类工具模块不会被误注册，不需要维护排除清单；
 *   · 文件名以 `_` 开头会被忽略（放组件私有辅助文件用）；
 *   · 面板里的同一分类内按**文件路径字母序**排列 —— 想固定顺序就给文件名加数字前缀（如 `10-table.tsx`）。
 *
 * 新增组件 = 在 common/ document/ ppt/ web/ 下加一个 `.tsx`，导出 `xxxComponent: ComponentDefinition`。
 * 外部（热加载）组件走另一条链：`public/组件/*.js` + `/__components`（见 registry/live.ts）。
 *
 * ★去重记录（功能重复的组件已合并/删除，避免"同一个能力两条路"）：
 *   · 独立「题注」组件已删除 —— 图题由 image 的 caption 属性承载，表题由 table 的 caption 属性承载；
 *   · 独立「富文本」组件已删除 —— paragraph 的 html 属性本身就是富文本（rich 开关控制按 HTML 还是纯文本渲染）；
 *   · 页眉页脚已是**页面属性**（不是组件）；页码/日期是否收进页面属性见 README「未做项」的待定项。
 */
import { registerComponents } from '../index';
import type { ComponentDefinition } from '../types';
import { log } from '../../utils/logger';

/** 判定"这个导出是不是一个组件定义"（够用且宽松：type 是字符串 + render 是函数） */
function isComponentDefinition(v: unknown): v is ComponentDefinition {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return typeof d.type === 'string' && d.type !== '' && typeof d.render === 'function';
}

/** 目录里发现的所有组件模块（自检用它证明"注册表由目录驱动"，而不是手写清单） */
export const COMPONENT_MODULES: Record<string, unknown> = import.meta.glob('./**/*.tsx', {
  eager: true,
  import: '*',
});

/** 从模块集合里挑出全部组件定义（保持 glob 的文件路径顺序，便于定位） */
export function collectComponents(modules: Record<string, unknown>): ComponentDefinition[] {
  const out: ComponentDefinition[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const file = path.split('/').pop() ?? path;
    if (file.startsWith('_')) continue; // 组件私有辅助文件
    const found = Object.values(mod as Record<string, unknown>).filter(isComponentDefinition);
    if (found.length === 0) {
      // 工具模块（如 tableKit.tsx）本来就不导出组件定义，属正常；用 debug 级别留痕、不刷警告。
      // 想彻底跳过：文件名以 `_` 开头。
      log.debug('registry', `组件目录里的文件没有导出组件定义（按工具模块跳过）：${path}`);
      continue;
    }
    out.push(...found);
  }
  return out;
}

export const ALL_COMPONENTS: ComponentDefinition[] = collectComponents(COMPONENT_MODULES);

export function registerAllComponents(): void {
  registerComponents(ALL_COMPONENTS);
}

registerAllComponents();
