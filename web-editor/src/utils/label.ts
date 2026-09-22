/**
 * 职责：标签解析 —— 把 schema 里的长标签拆成「主名 + 说明」。
 *
 *   『数据（每行一条，用 | 分列）』→ short=数据、hint=每行一条，用 | 分列
 *
 * 界面上**只显示主名**（说明默认隐藏，靠悬停气泡展示）。独立成文件是为了让
 * `panels/PropertyRow`（渲染）与 `utils/specSheet`（生成清单）共用同一套拆解规则，
 * 且避免"面板 ← 控件集"的循环 import。
 */
export function splitLabel(label: string): { short: string; hint: string } {
  const m = label.match(/^([^（(]+)[（(]([^）)]*)[）)]\s*$/);
  if (m) return { short: m[1].trim(), hint: m[2].trim() };
  return { short: label.trim(), hint: '' };
}
