/**
 * 外部组件契约的**纯文本**版本（Prompt 与 `plugin.types` 共用）。
 * 与 `web-editor/src/registry/types.ts` 的 ComponentDefinition / PropSchemaItem / RenderContext 一一对应；
 * 另外标注了两处"规格与实现不一致"的坑（reactJsxRuntime、children 第三参）。
 */
export const CONTRACT_TEXT = `外部插件（public/组件/*.js）只能这么写：
(function () {
  const React = window.EditorKit.React;          // 编辑器只暴露 React（没有 reactJsxRuntime！）
  window.EditorKit.register({
    type: 'liveXxx',                              // 必须以 live 开头，否则编辑器拒绝注册
    label: '显示名',
    category: '通用',                              // Word 常用/Excel 表格/PPT 专用/通用/布局分页/Web 控件/Web 容器
    supportedModes: ['document', 'web'],
    icon: ({ className }) => React.createElement('span', { className }, '◆'),  // 不能 import lucide-react
    description: '一句话说明',
    isContainer: false,                           // true 时 render 第三参是 children，必须放进自己的 DOM
    defaultProps: { text: '默认文字' },
    propSchema: [
      { key: 'text', label: '文字', control: 'textarea', group: '内容', defaultValue: '默认文字' },
    ],
    render(props, ctx, children) {                // ctx: { mode, page?, canvas?, isEditing, isSelected, mmToPx, ptToPx }
      return React.createElement('div', null, String(props.text || ''), children ?? null);
    },
  });
})();
可用：React.createElement、K.defaultsOf(schema)、K.boxStyle/typographyStyle/alignOf/spacingCss/edgeCss、
      K.fontProps/boxProps（与内置组件同一套属性片段）、K.asString/asNumber/asBool/asEnum、K.lines/rows、
      K.mmToPx/ptToPx、K.icon('名字')（白名单图标）。
不可用：require / process / fs / fetch / import / JSX / TypeScript / React hooks 里的状态（render 要是纯函数）。`;
