/**
 * 模板 3：表格类组件（用编辑器的**表格内核**）
 * ------------------------------------------------------------------
 * 为什么要用内核：`renderTable` 输出的真实 table 带 `data-cell="行,列"` 标记，
 *   编辑器据此实现「点选/拖选单元格 → 单元格格式 → 内容」；
 *   `tableSchema` 给出与内置表格**一模一样**的属性面板（含「单元格格式」「行 / 列数量」）。
 *
 * 硬性约定：
 *   · schema 里**没有「数据」属性行**（内容以单元格为主）；
 *   · 默认内容必须显式写进 `defaultProps.data`（`serializeTableData(二维数组)`），
 *     否则渲染出来是一张**空表**（很容易被误认为"组件坏了"）；
 *   · 转义：`\|` 格内竖线、`\n` 格内换行、`\\` 反斜杠；单元格格式键用 A1（`B2` / 合并区 `B2:C3`）。
 */
(function () {
  const K = window.EditorKit;
  if (!K) return;
  const { serializeTableData } = K;

  /** 首发内容（第一行是表头） */
  const DATA = [
    ['参数', '方案 A', '方案 B'],
    ['载重', '1000kg', '1500kg'],
    ['速度', '1.2m/s', '1.5m/s'],
    ['导航', '激光 SLAM', '激光+二维码'],
    ['价格', '—', '+18%'],
  ];

  const ACCENT = '#1677ff';
  /** 默认把「方案 B」那列高亮（C 列）：单元格格式就是文档数据，用户可在「单元格」组里改回来 */
  const ACCENT_CELLS = {
    C1: { background: ACCENT + '14', color: ACCENT, fontWeight: 600 },
    C2: { background: ACCENT + '0a', fontWeight: 600 },
    C3: { background: ACCENT + '0a', fontWeight: 600 },
    C4: { background: ACCENT + '0a', fontWeight: 600 },
    C5: { background: ACCENT + '0a', fontWeight: 600 },
  };

  /** 表格属性：直接用内核生成（表格 / 单元格 / 尺寸 三组，含 cells + tableSize + tableHtml 控件） */
  const schema = K.tableSchema(DATA, 'normal', { colWidths: '30,35,35' });

  K.register({
    type: 'liveTemplateTable',
    label: '对比表（模板）',
    category: 'Excel 表格',
    supportedModes: ['document', 'web'],
    icon: 'Table',
    description: '【模板】参数/方案对照表；内容按单元格编辑（与内置表格同一套内核）',
    defaultFrame: K.defaultFrameOf(560, 200),
    defaultProps: Object.assign(K.defaultsOf(schema), {
      data: serializeTableData(DATA), // ★删掉了「数据」属性行，默认内容要自己给
      caption: '参数对比',
      captionSize: 12.5,
      variant: 'normal',
      borderColor: '#e5e7eb',
      headerBackground: '#f7f9fc',
      headerColor: '#1f2329',
      cellPadding: 6,
      fontSize: 12,
      colWidths: '30,35,35',
      stripe: false,
      cellStyles: ACCENT_CELLS,
    }),
    propSchema: schema,
    render: (props, ctx) => {
      // 兼容旧数据：老版本可能只有 items 文本（每行 `参数|A|B`）
      let data = typeof props.data === 'string' ? props.data : '';
      if (!data && typeof props.items === 'string' && props.items) {
        const rows = String(props.items)
          .split('\n')
          .filter((l) => l.trim() !== '')
          .map((l) => l.split('|').map((c) => c.trim()));
        data = serializeTableData([['参数', '方案 A', '方案 B']].concat(rows));
      }
      if (!data) data = serializeTableData(DATA); // 裸节点（没有 defaultProps）也不要渲染成空表
      return K.renderTable(Object.assign({}, props, { data: data, headerRow: props.headerRow !== false }), ctx);
    },
  });
})();
