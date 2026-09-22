/**
 * 职责：组件注册表。新增组件只需在 registry/components/ 下写一个文件并调用 registerComponent，
 *       左侧面板与属性面板都会自动支持（面板代码不感知具体组件）。
 */
import {
  CATEGORY_ORDER,
  type ComponentDefinition,
  type EditorMode,
} from './types';

const registry = new Map<string, ComponentDefinition>();

/**
 * 规范化属性 schema：**所有组件统一具备"上边距 / 下边距"**（用户要求），
 * 并去掉各组件原本的四边 `margin`（避免与上下边距重复；左右缩进由各组件自己的属性负责）。
 * 由 NodeView 在文档模式下统一应用（见 NodeView.tsx），组件自身不需要改渲染代码。
 */
function normalizeSchema(def: ComponentDefinition): ComponentDefinition {
  const schema = def.propSchema ?? [];
  const has = (k: string) => schema.some((i) => i.key === k);
  let next = schema.filter((i) => i.key !== 'margin');
  if (!has('marginTop')) {
    next = [
      ...next,
      { key: 'marginTop', label: '上边距(mm)', control: 'unit', group: '尺寸', defaultValue: 0, unit: 'mm', min: 0, max: 100 },
      { key: 'marginBottom', label: '下边距(mm)', control: 'unit', group: '尺寸', defaultValue: 0, unit: 'mm', min: 0, max: 100 },
    ];
  }
  const defaultProps = { marginTop: 0, marginBottom: 0, ...def.defaultProps };
  return { ...def, propSchema: next, defaultProps };
}

export function registerComponent(def: ComponentDefinition): void {
  if (registry.has(def.type)) {
    console.warn(`[registry] 组件 type 重复注册，后者覆盖前者：${def.type}`);
  }
  registry.set(def.type, normalizeSchema(def));
}

export function registerComponents(defs: ComponentDefinition[]): void {
  defs.forEach(registerComponent);
}

/** 卸载组件（运行时热重载用：同名组件先卸载再注册即可生效） */
export function unregisterComponent(type: string): boolean {
  return registry.delete(type);
}

export function getComponent(type: string): ComponentDefinition | undefined {
  return registry.get(type);
}

export function getAllComponents(): ComponentDefinition[] {
  return [...registry.values()];
}

export function getComponentsByMode(mode: EditorMode): ComponentDefinition[] {
  return [...registry.values()].filter((d) => d.supportedModes.includes(mode));
}

export interface ComponentCategory {
  name: string;
  items: ComponentDefinition[];
}

/** 按分组归类（顺序：CATEGORY_ORDER 优先，其余按出现顺序），供左侧面板抽屉展示 */
export function getCategoriesByMode(mode: EditorMode): ComponentCategory[] {
  const items = getComponentsByMode(mode);
  const buckets = new Map<string, ComponentDefinition[]>();
  items.forEach((d) => {
    const list = buckets.get(d.category) ?? [];
    list.push(d);
    buckets.set(d.category, list);
  });
  const names = [...buckets.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
    const ib = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
    return (ia < 0 ? CATEGORY_ORDER.length : ia) - (ib < 0 ? CATEGORY_ORDER.length : ib);
  });
  return names.map((name) => ({ name, items: buckets.get(name) ?? [] }));
}

export function registrySize(): number {
  return registry.size;
}
