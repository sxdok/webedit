/**
 * 职责：组件注册入口。所有组件在这里统一注册——新增组件只需在 common/document/ppt/web 下写一个文件，
 *       把它的 ComponentDefinition 加进 ALL_COMPONENTS，面板与画布自动支持（supportedModes 决定出现在哪些模式）。
 *
 * 当前清单（45 个）：
 *   通用 13：标题 / 正文段落 / 图片 / 图片并排 / 表格 / 三线表 / 两列参数表 / 明细表 / 核对表 /
 *            分割线 / 提示示意警示框 / 徽章按键标签 / 链接
 *   文档专用 18：列表 / 引用块 / 代码块 / 分栏 / 页码 / 日期 / 签名区 / 间隔块 / 脚注 / 印章 / 分页符 /
 *               封面 / 目录 / 导语 / 摘要 / 关键词 / 定义列表 / 核对清单
 *   PPT 专用 10：幻灯封面 / 要点列表 / 数据卡片 / 时间轴 / 流程步骤 / 左右对比 / 团队卡片 / 引用页 / 结束页 / 柱状图
 *   Web 专用 4：按钮 / 输入框 / 容器 / 卡片
 *
 * ★去重记录（功能重复的组件已合并/删除，避免"同一个能力两条路"）：
 *   · 独立「题注」组件已删除 —— 图题由 image 的 caption 属性承载，表题由 table 的 caption 属性承载
 *     （与"容器自带题注"统一，不再单列一个组件）；
 *   · 独立「富文本」组件已删除 —— paragraph 的 html 属性本身就是富文本（rich 开关控制按 HTML 还是纯文本渲染），
 *     两者是同一条渲染路径，保留 paragraph 一个入口；
 *   · 页眉页脚已是**页面属性**（不是组件）；页码/日期是否也收进页面属性见 README「未做项」的待定项。
 */
import { registerComponents } from '../index';
import type { ComponentDefinition } from '../types';

// 通用
import { headingComponent } from './common/heading';
import { paragraphComponent } from './common/paragraph';
import { imageComponent } from './common/image';
import { imagePairComponent } from './common/imagePair';
import { tableComponent } from './common/table';
import { checkTableComponent, detailTableComponent, paramTableComponent, threeLineTableComponent } from './common/tablePreset';
import { dividerComponent } from './common/divider';
import { calloutComponent } from './common/callout';
import { badgeComponent } from './common/badge';
import { linkComponent } from './common/link';
// 文档专用
import { listComponent } from './document/list';
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
import { coverComponent } from './document/cover';
import { tocComponent } from './document/toc';
import { leadComponent } from './document/lead';
import { abstractComponent } from './document/abstract';
import { keywordsComponent } from './document/keywords';
import { defListComponent } from './document/defList';
import { checkListComponent } from './document/checkList';
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
  imagePairComponent,
  tableComponent,
  threeLineTableComponent,
  paramTableComponent,
  detailTableComponent,
  checkTableComponent,
  dividerComponent,
  calloutComponent,
  badgeComponent,
  linkComponent,
  // 文档专用
  listComponent,
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
  coverComponent,
  tocComponent,
  leadComponent,
  abstractComponent,
  keywordsComponent,
  defListComponent,
  checkListComponent,
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
