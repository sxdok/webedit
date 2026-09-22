/**
 * 职责：组件注册入口。所有组件在这里统一注册——新增组件只需在 common/document/ppt/web 下写一个文件，
 *       把它的 ComponentDefinition 加进 ALL_COMPONENTS，面板与画布自动支持（supportedModes 决定出现在哪些模式）。
 *
 * 当前清单（31 个）：
 *   通用 5：标题 / 正文段落 / 图片 / 表格 / 分割线
 *   文档专用 12：列表 / 富文本 / 引用块 / 代码块 / 分栏 / 页码 / 日期 / 签名区 / 间隔块 / 脚注 / 印章 / 分页符
 *   （页眉页脚已改为**页面属性**，不再是组件）
 *   PPT 专用 10：幻灯封面 / 要点列表 / 数据卡片 / 时间轴 / 流程步骤 / 左右对比 / 团队卡片 / 引用页 / 结束页 / 柱状图
 *   Web 专用 4：按钮 / 输入框 / 容器 / 卡片
 */
import { registerComponents } from '../index';
import type { ComponentDefinition } from '../types';

// 通用
import { headingComponent } from './common/heading';
import { paragraphComponent } from './common/paragraph';
import { imageComponent } from './common/image';
import { tableComponent } from './common/table';
import { dividerComponent } from './common/divider';
// 文档专用
import { listComponent } from './document/list';
import { richtextComponent } from './document/richtext';
import { quoteComponent } from './document/quote';
import { codeComponent } from './document/code';
import { columnsComponent } from './document/columns';
import { pageNumberComponent } from './document/pageNumber';
import { dateComponent } from './document/dateField';
import { signatureComponent } from './document/signature';
import { spacerComponent } from './document/spacer';
import { footnoteComponent } from './document/footnote';
import { stampComponent } from './document/stamp';
import { pageBreakComponent } from './document/pageBreak';
// PPT 专用
import { slideTitleComponent } from './ppt/slideTitle';
import { bulletsComponent } from './ppt/bullets';
import { kpiCardsComponent } from './ppt/kpiCards';
import { timelineComponent } from './ppt/timeline';
import { processComponent } from './ppt/process';
import { compareComponent } from './ppt/compare';
import { teamComponent } from './ppt/team';
import { quoteSlideComponent } from './ppt/quoteSlide';
import { endSlideComponent } from './ppt/endSlide';
import { chartBarComponent } from './ppt/chartBar';
// Web 专用
import { buttonComponent } from './web/button';
import { inputComponent } from './web/input';
import { containerComponent } from './web/container';
import { cardComponent } from './web/card';

export const ALL_COMPONENTS: ComponentDefinition[] = [
  // 通用（两种模式）
  headingComponent,
  paragraphComponent,
  imageComponent,
  tableComponent,
  dividerComponent,
  // 文档专用
  listComponent,
  richtextComponent,
  quoteComponent,
  codeComponent,
  columnsComponent,
  pageNumberComponent,
  dateComponent,
  signatureComponent,
  spacerComponent,
  footnoteComponent,
  stampComponent,
  pageBreakComponent,
  // PPT 专用
  slideTitleComponent,
  bulletsComponent,
  kpiCardsComponent,
  timelineComponent,
  processComponent,
  compareComponent,
  teamComponent,
  quoteSlideComponent,
  endSlideComponent,
  chartBarComponent,
  // Web 专用
  buttonComponent,
  inputComponent,
  containerComponent,
  cardComponent,
];

export function registerAllComponents(): void {
  registerComponents(ALL_COMPONENTS);
}

registerAllComponents();
