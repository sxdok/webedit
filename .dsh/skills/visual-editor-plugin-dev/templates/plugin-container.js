/**
 * 模板 2：Web 容器组件（可嵌套子组件）
 * ------------------------------------------------------------------
 * 要点：isContainer: true + render 的**第三个参数 children 必须放进自己的 DOM**；
 *       Web 模式的容器要加一层 `position:absolute; inset:0; overflow:hidden` 的**裁剪层**
 *       （与容器边框盒重合 → 不改子组件坐标，同时把"拖出容器的部分"裁掉）；
 *       不要给自己加 data-node-id（那是画布包装节点的标记）。
 */
(function () {
  const K = window.EditorKit;
  if (!K) return;
  const { React, asString, asEnum, asNumber, asBool } = K;

  const schema = [
    { key: 'title', label: '容器标题（留空则不显示）', control: 'text', group: '内容', defaultValue: '容器标题' },
    { key: 'display', label: '显示方式', control: 'select', group: '布局', defaultValue: 'flex', options: [
      { label: 'block', value: 'block' },
      { label: 'flex', value: 'flex' },
      { label: 'grid', value: 'grid' },
    ] },
    { key: 'direction', label: '主轴方向（flex）', control: 'select', group: '布局', defaultValue: 'column', options: [
      { label: '纵向 column', value: 'column' },
      { label: '横向 row', value: 'row' },
    ] },
    { key: 'gap', label: '子项间距（px）', control: 'number', group: '布局', defaultValue: 12, min: 0, max: 80 },
    { key: 'padding', label: '内边距（px）', control: 'number', group: '尺寸', defaultValue: 14, min: 0, max: 64 },
    { key: 'background', label: '背景', control: 'color', group: '外观', defaultValue: '#ffffff' },
    { key: 'borderRadius', label: '圆角（px）', control: 'number', group: '外观', defaultValue: 8, min: 0, max: 60 },
    { key: 'borderWidth', label: '边框宽（px）', control: 'number', group: '外观', defaultValue: 1, min: 0, max: 10 },
    { key: 'borderColor', label: '边框色', control: 'color', group: '外观', defaultValue: '#e5e7eb' },
    { key: 'shadow', label: '阴影', control: 'switch', group: '外观', defaultValue: false },
    // 容器特有能力：在属性面板里列出/选中子组件
    { key: 'children', label: '子组件', control: 'children', group: '高级', defaultValue: null },
  ];

  K.register({
    type: 'liveTemplatePanel',
    label: '面板容器（模板）',
    category: 'Web 容器',
    supportedModes: ['web'],
    icon: 'Box',
    isContainer: true,
    description: '【模板】可嵌套子组件的容器：block/flex/grid、间距、内边距、背景边框',
    defaultFrame: K.defaultFrameOf(420, 260),
    defaultProps: K.defaultsOf(schema),
    propSchema: schema,
    render: (props, ctx, children) => {
      const pad = asNumber(props.padding, 14);
      const display = asEnum(props.display, ['block', 'flex', 'grid'], 'flex');
      const box = {
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display,
        flexDirection: asEnum(props.direction, ['row', 'column'], 'column'),
        gap: asNumber(props.gap, 12),
        gridTemplateColumns: display === 'grid' ? 'repeat(2, minmax(0,1fr))' : undefined,
        background: asString(props.background, '#ffffff'),
        borderRadius: asNumber(props.borderRadius, 8),
        border: asNumber(props.borderWidth, 1) ? `${asNumber(props.borderWidth, 1)}px solid ${asString(props.borderColor, '#e5e7eb')}` : 'none',
        boxShadow: asBool(props.shadow, false) ? '0 2px 10px rgba(0,0,0,.08)' : undefined,
        overflow: 'hidden',
      };
      return React.createElement(
        'div',
        { style: box },
        asString(props.title)
          ? React.createElement(
              'div',
              { key: 'h', style: { padding: `${pad * 0.6}px ${pad}px`, borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 13 } },
              asString(props.title),
            )
          : null,
        // ★裁剪层：与容器边框盒重合（absolute + inset:0），只负责把越界内容裁掉，不改变子组件坐标
        React.createElement(
          'div',
          { key: 'c', 'data-container-clip': '1', style: { position: 'absolute', inset: 0, overflow: 'hidden' } },
          children,
        ),
      );
    },
  });
})();
