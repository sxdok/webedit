/**
 * 职责：外部组件示例——提示条。这是**运行时热加载**的组件：
 *   把本文件放在 public/组件/ 下（构建后会复制到 dist/组件/），改完保存，
 *   在编辑器里点「视图 → 重载外部组件」即可生效，**不需要 npm run build**。
 *
 * 可用的全局对象 window.EditorKit（见 src/registry/live.ts）：
 *   React             React 本体（用 React.createElement 写渲染）
 *   register(def)     注册组件定义（type 重复会覆盖，便于热重载）
 *   fontProps/boxProps ... 通用属性片段，与内置组件同一套词汇（属性面板行为一致）
 *   defaultsOf(schema)     由 schema 推导 defaultProps
 *   boxStyle/typographyStyle/alignOf/spacingCss/edgeCss  属性 → CSS
 *   asString/asNumber/asBool/asEnum/lines/rows           取值守卫
 *   icon(name)        按名字取图标（白名单见 live.ts）
 */
(function () {
  const K = window.EditorKit;
  if (!K) return;
  const { React, defaultsOf, fontProps, boxProps, boxStyle, alignOf, asEnum, asString, asBool } = K;

  const schema = [
    { key: 'text', label: '文字', control: 'textarea', group: '内容', defaultValue: '这是一条外部热加载组件：改完文件点「重载外部组件」即可生效。' },
    {
      key: 'type',
      label: '类型',
      control: 'select',
      group: '内容',
      defaultValue: 'info',
      options: [
        { label: '信息 info', value: 'info' },
        { label: '成功 success', value: 'success' },
        { label: '警告 warning', value: 'warning' },
        { label: '错误 error', value: 'error' },
      ],
    },
    { key: 'showIcon', label: '显示图标', control: 'switch', group: '外观', defaultValue: true },
    ...fontProps(12),
    { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#1f2329' },
    { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'left' },
    ...boxProps(),
  ];

  const PALETTE = {
    info: { bg: '#f0f7ff', line: '#1677ff', mark: 'ℹ' },
    success: { bg: '#f2fbf5', line: '#22a06b', mark: '✓' },
    warning: { bg: '#fff8ef', line: '#e08b2a', mark: '!' },
    error: { bg: '#fff2f0', line: '#d4380d', mark: '×' },
  };

  K.register({
    type: 'liveNotice',
    label: '提示条',
    category: '通用',
    supportedModes: ['document', 'web'],
    icon: 'Megaphone',
    description: '【外部热加载】四种语义色的提示条',
    defaultFrame: K.defaultFrameOf(520, 46),
    defaultProps: defaultsOf(schema),
    propSchema: schema,
    render: function (props, ctx) {
      const kind = asEnum(props.type, ['info', 'success', 'warning', 'error'], 'info');
      const p = PALETTE[kind];
      const size = ctx.mode === 'document' ? ctx.ptToPx(K.asNumber(props.fontSize, 12)) : K.asNumber(props.fontSize, 12);
      return React.createElement(
        'div',
        {
          style: Object.assign({}, boxStyle(props), {
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            padding: '6px 10px',
            background: p.bg,
            borderLeft: '4px solid ' + p.line,
            borderRadius: 4,
            fontSize: size,
            lineHeight: K.asNumber(props.lineHeight, 1.5),
            color: asString(props.color) || '#1f2329',
            textAlign: alignOf(props.align),
          }),
        },
        asBool(props.showIcon, true)
          ? React.createElement('span', { style: { color: p.line, fontWeight: 700, flex: 'none' } }, p.mark)
          : null,
        React.createElement('span', { style: { flex: 1 } }, asString(props.text)),
      );
    },
  });
})();
