/**
 * 职责：外部组件示例——参数对比卡（两列参数对照）。热加载：改完点「重载外部组件」。
 */
(function () {
  const K = window.EditorKit;
  if (!K) return;
  const { React, defaultsOf, fontProps, boxProps, boxStyle, asString, asEnum, asNumber } = K;

  const schema = [
    { key: 'title', label: '卡片标题', control: 'text', group: '内容', defaultValue: '参数对比' },
    { key: 'leftTitle', label: '左列标题', control: 'text', group: '内容', defaultValue: '方案 A' },
    { key: 'rightTitle', label: '右列标题', control: 'text', group: '内容', defaultValue: '方案 B' },
    { key: 'items', label: '参数（每行：参数|A|B）', control: 'textarea', group: '内容', defaultValue: '载重|1000kg|1500kg\n速度|1.2m/s|1.5m/s\n导航|激光 SLAM|激光+二维码\n价格|—|+18%' },
    {
      key: 'highlight',
      label: '高亮列',
      control: 'select',
      group: '外观',
      defaultValue: 'right',
      options: [
        { label: '左列', value: 'left' },
        { label: '右列', value: 'right' },
        { label: '都不高亮', value: 'none' },
      ],
    },
    ...fontProps(12),
    { key: 'accent', label: '高亮色', control: 'color', group: '外观', defaultValue: '#1677ff' },
    ...boxProps(),
  ];

  K.register({
    type: 'liveCompareCard',
    label: '参数对比卡',
    category: '文档专用',
    supportedModes: ['document', 'web'],
    icon: 'Table',
    description: '【外部热加载】两列参数对照卡，可高亮一侧',
    defaultFrame: K.defaultFrameOf(560, 200),
    defaultProps: defaultsOf(schema),
    propSchema: schema,
    render: function (props, ctx) {
      const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
      const accent = asString(props.accent, '#1677ff');
      const hl = asEnum(props.highlight, ['left', 'right', 'none'], 'right');
      const cell = { border: '1px solid #e5e7eb', padding: '5px 8px', fontSize: size };
      const head = function (text, side) {
        const on = hl === side;
        return React.createElement(
          'th',
          { style: Object.assign({}, cell, { background: on ? accent + '14' : '#f7f9fc', color: on ? accent : '#1f2329', fontWeight: 600 }) },
          text,
        );
      };
      const rows = K.rows(props.items);
      return React.createElement(
        'div',
        { style: Object.assign({}, boxStyle(props), { borderRadius: 8, overflow: 'hidden', background: '#fff' }) },
        asString(props.title)
          ? React.createElement('div', { style: { fontWeight: 600, padding: '8px 10px', borderBottom: '1px solid #eef1f5', fontSize: size * 1.05 } }, asString(props.title))
          : null,
        React.createElement(
          'table',
          { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' } },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              null,
              React.createElement(head, { key: 'h0' }, '参数', 'none'),
              React.createElement(head, { key: 'h1' }, asString(props.leftTitle), 'left'),
              React.createElement(head, { key: 'h2' }, asString(props.rightTitle), 'right'),
            ),
          ),
          React.createElement(
            'tbody',
            null,
            rows.map(function (r, i) {
              return React.createElement(
                'tr',
                { key: i },
                React.createElement('td', { style: Object.assign({}, cell, { color: '#7a8496' }) }, r[0] || ''),
                React.createElement('td', { style: cell }, r[1] || ''),
                React.createElement(
                  'td',
                  { style: Object.assign({}, cell, hl === 'right' ? { background: accent + '0a', fontWeight: 600 } : {}) },
                  r[2] || '',
                ),
              );
            }),
          ),
        ),
      );
    },
  });
})();
