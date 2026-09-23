/**
 * 职责：示例文档（?demo=1）。给两种模式各塞一份能体现注册表能力的样例内容
 * —— 文档模式：标题/段落/表格/列表/图片占位；Web 模式：容器嵌套 + 卡片 + 按钮 + 输入框。
 * 只在带 ?demo=1 时调用，且会整体替换当前文档（不影响默认空文档行为）。
 */
import { createId } from '../utils/id';
import { createInitialDocument, useEditorStore } from './editorStore';
import type { ComponentNode } from '../registry/types';

const node = (
  type: string,
  props: Record<string, unknown>,
  extra: Partial<ComponentNode> = {},
): ComponentNode => ({ id: createId(type.slice(0, 3)), type, props, ...extra });

export function buildDemoDocument() {
  const doc = createInitialDocument();
  doc.title = '可视化编辑器 示例文档';

  doc.document.components = [
    node('heading', { text: '可视化编辑器 使用示例', level: 1, align: 'center', fontSize: 22, marginTop: 0, marginBottom: 14 }),
    node('divider', { style: 'solid', thickness: 2, color: '#1677ff', width: 100 }),
    node('heading', { text: '1 文档模式（A4 纸张 · 文档流）', level: 2, fontSize: 16 }),
    node('paragraph', {
      html:
        '这是<strong>正文段落</strong>：支持富文本（加粗/斜体/列表/链接/颜色）、对齐、行距、字距与首行缩进；' +
        '宽度按纸张版心自动换算（mm → px @96DPI）。点击文字可直接在右侧属性面板里改。',
      align: 'justify',
      fontSize: 12,
      lineHeight: 1.6,
    }),
    node('list', { items: '拖拽或双击左侧组件即可插入\n属性面板由注册表 Schema 自动生成\n切换模式时两套内容分别保留', ordered: true }),
    node('heading', { text: '1.1 示例表格（跨页续排）', level: 3, fontSize: 14 }),
    node('table', {
      data: [
        '序号 | 检查项 | 结果 | 说明',
        '1 | 纸张与版心 | 通过 | A4 210×297mm，上下 25.4 / 左右 31.7mm',
        '2 | 文档流分页 | 通过 | 超出纸张版心自动排到下一页',
        '3 | 表格跨页续排 | 通过 | 放不下的表按行拆到下一页，续表重复表头',
        '4 | 单元格格式 | 通过 | Excel A1 记法（B2 / A2:B3），可点选后批量改',
        '5 | 合并单元格 | 通过 | 范围键即合并，被覆盖的格子不渲染',
        '6 | 行列表头 | 通过 | 首行作表头，可关闭',
        '7 | 线条风格 | 通过 | 全框线 / 三线表 / 横线表',
        '8 | 列宽行高 | 通过 | 列宽按 % 或 mm，行高按 mm',
        '9 | 表题 | 通过 | 显示在表格上方，可设对齐与字号',
        '10 | 页眉页脚 | 通过 | 支持 {page} / {total} / {date} 变量',
        '11 | 三段式页码 | 通过 | 封面不显示 → 目录罗马数字 → 正文阿拉伯数字',
        '12 | 分页符 | 通过 | 插入即另起一页（相当于 Ctrl+Enter）',
        '13 | 图片图题 | 通过 | 由图片组件自身承载',
        '14 | 导出 | 通过 | HTML / Word(.doc) / 打印（Edge 直接打印）',
        '15 | 外部组件 | 通过 | public/组件/*.js 热加载，改完不用重新构建',
        '16 | 撤销重做 | 通过 | Ctrl+Z / Ctrl+Y，历史按 300ms 合并',
        '17 | 属性面板 | 通过 | 三抽屉：通用属性 / 专有属性 / 状态',
        '18 | 分组折叠 | 通过 | 26px 分组标题，默认只展开常用组',
        '19 | 属性说明 | 通过 | 悬停属性名弹气泡（含 key / 默认值 / 取值范围）',
        '20 | 过滤属性 | 通过 | 面板顶部「过滤属性…」按名称/键筛选',
        '21 | 多选批改 | 通过 | 同时选中多个组件批量改位置尺寸与对齐',
        '22 | 日志落盘 | 通过 | 前端日志写到运行目录 logs/，可导出诊断报告',
        '23 | 热加载 | 通过 | public/组件/*.js 改完点「重载外部组件」即可',
        '24 | 自检 | 通过 | ?check=1 跑全量端到端自检（106 项）',
      ].join('\n'),
      headerRow: true,
      stripe: true,
      fontSize: 10.5,
    }),
    node('heading', { text: '1.2 图片占位', level: 3, fontSize: 14 }),
    node('image', { src: '', width: 70, caption: '图 1-1　图片占位（在属性面板选择本地图片）' }),
    node('heading', { text: '2 PPT 常用组件', level: 2, fontSize: 16 }),
    node('kpiCards', {
      items: '设备数量|128|台\n在线率|99.6|%\n平均节拍|42|秒/单\n异常告警|3|条/日',
      columns: 4,
      borderWidth: 1,
    }),
    node('timeline', { items: '第 1 月|需求确认与现场勘察\n第 2 月|设备进场与安装\n第 3 月|联调与试运行\n第 4 月|验收与培训', fontSize: 11 }),
    node('chartBar', { items: '一月|120\n二月|180\n三月|150\n四月|210', height: 150, fontSize: 10 }),
    node('heading', { text: '3 文档专用组件', level: 2, fontSize: 16 }),
    node('columns', { col1: '左栏：适用于要点并列说明。', col2: '右栏：与左栏等宽，便于对比。', count: 2, gap: 16, fontSize: 11 }),
    node('quote', { text: '引用的原文或标准条文，可在此填写。', source: 'GB/T 示例' }),
    node('footnote', { index: '1', text: '注：本页数据口径以现场实测为准。' }),
    node('signature', { leftLabel: '甲方（签字）', rightLabel: '乙方（签字）' }),
    node('stamp', { text: '江苏誉创智能科技', size: 96, rotation: -12 }),
  ];

  const card = node('card', { title: '卡片容器（可嵌套）', extra: '示例', padding: 14 }, {});
  card.children = [
    node('button', { text: '主按钮', variant: 'primary', size: 'md' }),
    node('input', { placeholder: '输入框示例', size: 'md', prefix: '🔍' }),
  ];

  const box = node(
    'container',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: { value: 16, unit: 'px' },
      background: '#ffffff',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      shadow: true,
    },
    { frame: { x: 40, y: 40, w: 420, h: 320 } },
  );
  box.children = [card];

  doc.web.root.children = [
    node('heading', { text: 'Web 模式：绝对定位画布', level: 2, fontSize: 20, marginTop: 0 }, {
      frame: { x: 40, y: 24, w: 520, h: 40 },
    }),
    box,
    node('button', { text: '独立按钮', variant: 'default', size: 'lg' }, { frame: { x: 500, y: 60, w: 160, h: 38 } }),
  ];

  return doc;
}

/** 把示例文档灌进 store（整体替换，可 Ctrl+Z 撤销） */
export function seedDemo(): void {
  useEditorStore.getState().importJSON(JSON.stringify(buildDemoDocument()));
}
