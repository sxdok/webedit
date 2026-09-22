/**
 * 职责：外部组件示例——免责声明块。热加载：改完点「重载外部组件」。
 */
(function () {
  const K = window.EditorKit;
  if (!K) return;
  const { React, defaultsOf, fontProps, boxProps, boxStyle, asString, asBool, asNumber } = K;

  const schema = [
    { key: 'title', label: '标题', control: 'text', group: '内容', defaultValue: '免责声明' },
    { key: 'text', label: '声明内容', control: 'textarea', group: '内容', defaultValue: '本文所载参数与配置以最终确认的技术协议为准；文中涉及的价格、交期等信息仅供内部沟通使用。' },
    { key: 'showTitle', label: '显示标题', control: 'switch', group: '内容', defaultValue: true },
    ...fontProps(10.5),
    { key: 'color', label: '文字颜色', control: 'color', group: '排版', defaultValue: '#5b6472' },
    ...boxProps(),
  ];

  K.register({
    type: 'liveDisclaimer',
    label: '免责声明',
    category: 'Word 常用',
    supportedModes: ['document', 'web'],
    icon: 'ShieldCheck',
    description: '【外部热加载】小字免责声明块',
    defaultFrame: K.defaultFrameOf(560, 70),
    defaultProps: defaultsOf(schema),
    propSchema: schema,
    render: function (props, ctx) {
      const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 10.5)) : asNumber(props.fontSize, 10.5);
      return React.createElement(
        'div',
        {
          style: Object.assign({}, boxStyle(props), {
            padding: '8px 10px',
            border: '1px dashed #d0d5dd',
            borderRadius: 4,
            background: '#fbfcfd',
            fontSize: size,
            lineHeight: 1.6,
            color: asString(props.color, '#5b6472'),
          }),
        },
        asBool(props.showTitle, true)
          ? React.createElement('div', { style: { fontWeight: 700, marginBottom: 3 } }, asString(props.title, '免责声明'))
          : null,
        React.createElement('div', null, asString(props.text)),
      );
    },
  });
})();