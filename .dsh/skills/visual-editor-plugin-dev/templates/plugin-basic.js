/**
 * 模板 1：最小可注册组件（文本类）
 * ------------------------------------------------------------------
 * 用法：复制到 web-editor/public/组件/<中文名>.js，改 type/label/category 与内容，
 *       文件名加进同目录 _manifest.json 的 files，然后在编辑器里点「重载外部组件」。
 *
 * 要点（详见 Skill「可视化编辑器 · 组件/插件开发规范」）：
 *   · 纯 JS，无 import/require/TSX；浏览器直接执行这段源码；
 *   · type 必须 live 开头（否则 register 拒绝注册）；
 *   · category 必须是七个约定分类之一；
 *   · 渲染一律 React.createElement（reactJsxRuntime 也是经典签名）；
 *   · 取值用 EditorKit 的 asString/asNumber/asBool/asEnum 兜底；
 *   · 渲染里不要有全局副作用，编辑态装饰加 no-print。
 */
(function () {
  const K = window.EditorKit;
  if (!K) return;
  const { React, asString, asEnum, asBool } = K;

  const TONES = [
    { label: '信息 info', value: 'info' },
    { label: '成功 success', value: 'success' },
    { label: '警告 warning', value: 'warning' },
  ];
  const PALETTE = {
    info: { bg: '#eef4ff', border: '#c7d7fe', color: '#1d4ed8', icon: 'ℹ' },
    success: { bg: '#eefbf3', border: '#bbe7cd', color: '#0f7b45', icon: '✓' },
    warning: { bg: '#fff8e6', border: '#f4d99a', color: '#96650b', icon: '!' },
  };

  const schema = [
    // 说明写在括号里 —— 面板只显示主名，说明进悬停气泡（带 key / 默认值 / 取值范围）
    { key: 'text', label: '文字（支持 \n 换行）', control: 'textarea', group: '内容', defaultValue: '这是一段提示文字。' },
    { key: 'tone', label: '语气', control: 'select', group: '外观', defaultValue: 'info', options: TONES },
    { key: 'showIcon', label: '显示图标', control: 'switch', group: '外观', defaultValue: true },
    { key: 'fontSize', label: '字号（pt）', control: 'unit', group: '排版', defaultValue: 12, unit: 'pt', min: 8, max: 24 },
    { key: 'align', label: '对齐', control: 'align', group: '排版', defaultValue: 'left' },
    // 通用属性片段（与内置组件同一套词汇）：字体/颜色等
    ...K.fontProps(12),
  ];

  K.register({
    type: 'liveTemplateNotice',
    label: '提示条（模板）',
    category: '通用',
    supportedModes: ['document', 'web'],
    icon: 'Info',
    description: '【模板】一句话提示条，三种语气',
    // Web 模式默认位置尺寸（文档模式不需要 frame）
    defaultFrame: K.defaultFrameOf(420, 36),
    defaultProps: K.defaultsOf(schema),
    propSchema: schema,
    render: (props, ctx) => {
      const tone = asEnum(props.tone, ['info', 'success', 'warning'], 'info');
      const p = PALETTE[tone];
      const pt = ctx.mode === 'document' ? ctx.ptToPx(asString(props.fontSize, 12) ? Number(props.fontSize) : 12) : Number(props.fontSize) || 12;
      return React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 6,
            background: p.bg,
            border: `1px solid ${p.border}`,
            color: p.color,
            fontSize: pt,
            lineHeight: 1.6,
            whiteSpace: 'pre-line', // \n 渲染成换行（像 HTML 的 <br>）
            textAlign: asEnum(props.align, ['left', 'center', 'right', 'justify'], 'left'),
          },
        },
        asBool(props.showIcon, true) ? React.createElement('span', { key: 'i' }, p.icon) : null,
        React.createElement('span', { key: 't', style: { flex: 1 } }, asString(props.text)),
      );
    },
  });
})();
