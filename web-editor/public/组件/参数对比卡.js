/**
 * 职责：外部组件示例——参数对比表（参数 / 方案 A / 方案 B 三列对照）。热加载：改完点「重载外部组件」。
 *
 * ★内容编辑方式（用户 2026-09-23：**按单元格逻辑编辑，删掉整块「参数」属性**）：
 *   本组件用编辑器暴露的**表格内核** `EditorKit.renderTable` 渲染、`EditorKit.tableSchema` 生成属性，
 *   与内置「表格」共用一份实现，因此自动获得：
 *     · 画布上点选 / 拖选单元格 →「单元格格式」组里的「内容」框逐格改文字；
 *     · 「行 / 列数量」组增删行列（单元格格式、列宽跟着平移）；
 *     · `\|` 格内竖线、`\n` 格内换行、A1 单元格格式键、合并/拆分 —— 与内置表格完全一致。
 *   所以这里**不再有**「参数（每行：参数|A|B）」这样的整块文本属性。
 *
 * 观感：默认按"参数对照表"给好默认值（全框线 + 表头浅底 + 右列（方案 B）高亮），
 *       这些都能在面板上继续改（线条风格 / 表头底色 / 单元格格式…）。
 *
 * 兼容旧文档：旧版本存的是 `items` + `leftTitle/rightTitle/title`，render 里会先转成
 * `data`（首行为表头），老文件打开后内容不丢。
 */
(function () {
  const K = window.EditorKit;
  if (!K) return;
  const { asString, serializeTableData } = K;

  const DEFAULT_DATA = [
    ['参数', '方案 A', '方案 B'],
    ['载重', '1000kg', '1500kg'],
    ['速度', '1.2m/s', '1.5m/s'],
    ['导航', '激光 SLAM', '激光+二维码'],
    ['价格', '—', '+18%'],
  ];

  /** 默认把「方案 B」那一列高亮（ACcent 淡底 + 加粗），用户可在单元格里改回 */
  const ACCENT = '#1677ff';
  const ACCENT_CELLS = {
    C1: { background: ACCENT + '14', color: ACCENT, fontWeight: 600 },
    C2: { background: ACCENT + '0a', fontWeight: 600 },
    C3: { background: ACCENT + '0a', fontWeight: 600 },
    C4: { background: ACCENT + '0a', fontWeight: 600 },
    C5: { background: ACCENT + '0a', fontWeight: 600 },
  };

  /** 表格属性（含「单元格格式」「行 / 列数量」两个单元格逻辑控件；已不含「数据」行） */
  const schema = K.tableSchema(DEFAULT_DATA, 'normal', { colWidths: '30,35,35' });

  /** 旧数据（items 文本 + 左右列标题）→ 表格 data，保证老文档打开后内容还在 */
  function legacyData(props) {
    const raw = asString(props.items);
    if (!raw) return '';
    const rows = raw
      .split('\n')
      .filter(function (l) {
        return l.trim() !== '';
      })
      .map(function (l) {
        return l.split('|').map(function (c) {
          return c.trim();
        });
      });
    const head = ['参数', asString(props.leftTitle, '方案 A'), asString(props.rightTitle, '方案 B')];
    return serializeTableData([head].concat(rows));
  }

  /**
   * 取这一份表格内容（三种情况都要照顾到）：
   *   · 有 `data`（哪怕是空串 —— 用户把单元格清空了）→ 照用；
   *   · 没有 data、但有旧的 `items`（老版本属性，哪怕是空串）→ 按旧属性转（老文档不丢内容、也尊重"清空"）；
   *   · 两者都没有（脚本/导入建出来的"裸节点"，没有 defaultProps）→ 给默认样例，
   *     否则会渲染成一张**空表**（看起来就像"组件坏了"）。
   */
  function resolveData(props) {
    if (typeof props.data === 'string') return props.data;
    if (typeof props.items === 'string') return legacyData(props);
    return serializeTableData(DEFAULT_DATA);
  }

  K.register({
    type: 'liveCompareCard',
    label: '参数对比表',
    category: 'Word 常用',
    supportedModes: ['document', 'web'],
    icon: 'Table',
    description: '【外部热加载示例】参数 / 方案 A / 方案 B 三列对照表；内容按单元格编辑（与内置表格同一套内核）',
    defaultFrame: K.defaultFrameOf(560, 200),
    /* ★`data` 不在 schema 里（「数据」属性行已删），所以默认内容要显式给：
       与内置表格同一约定 —— `serializeTableData(二维数组)` 存成文本形态。 */
    defaultProps: Object.assign(K.defaultsOf(schema), {
      data: serializeTableData(DEFAULT_DATA),
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
    render: function (props, ctx) {
      // 旧文档没有 caption/表题 → 用旧的 title 顶上，观感不变
      const caption = asString(props.caption) || asString(props.title);
      return K.renderTable(
        Object.assign({}, props, { data: resolveData(props), caption: caption, headerRow: props.headerRow !== false }),
        ctx,
      );
    },
  });
})();
