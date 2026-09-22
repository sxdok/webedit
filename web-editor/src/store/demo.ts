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
    node('heading', { text: '1.1 示例表格', level: 3, fontSize: 14 }),
    node('table', {
      data: '项目 | 取值 | 说明\n纸张 | A4 210×297mm | 可切 A3/A5/Letter/Legal\n版心 | 上下2.54 / 左右3.17cm | 96DPI 换算\n分页 | 见阶段三 | 超出纸张自动分页预览',
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
