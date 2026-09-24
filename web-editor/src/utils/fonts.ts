/**
 * 职责：**字体清单** —— 读"这台机器上装了哪些字体"，供属性面板的「字体」下拉使用。
 *
 * 用户 2026-09-24：「文档模式显示文字的组件都要支持字体切换，读系统的字体文件使用」。
 *
 * 浏览器里拿系统字体有两条路（都不需要把字体文件读进来 —— CSS 按字体名就能用已装字体）：
 *   ① `window.queryLocalFonts()`（Chromium/Edge 的 **Local Font Access API**）：直接枚举系统已装字体，
 *      首次调用会弹一次授权框。这是浏览器侧"读系统字体"的正路。
 *   ② 不支持 / 用户不给权限时**回落**：对一份常用候选表逐个做"是否装了"的探测
 *      （canvas 量同一串文字：候选字体 vs 纯 fallback，宽度不同才算装了）—— 不弹权限也能给出可用清单。
 *
 * 结果缓存；`refreshSystemFonts()` 可以强制重读（点下拉旁的 ⟳）。
 * ★**不要在页面启动时调用 `queryLocalFonts()`**：那会在用户没要字体的时候弹授权框。
 *   默认只用探测（无权限、无弹窗），用户主动点 ⟳ 时才走系统枚举。
 */
import { log } from './logger';

export type FontSource = 'probe' | 'system';

export interface FontList {
  /** 中文/宋黑楷仿类（按常见程度排序） */
  chinese: string[];
  /** 西文/衬线/无衬线 */
  latin: string[];
  /** 等宽 */
  mono: string[];
  /** 这份清单是怎么来的：探测（默认）还是系统枚举（用户授权后） */
  source: FontSource;
  /** 系统枚举读到的**全部**字体族（探测模式下为空） */
  systemAll: string[];
  /** 读取时间（毫秒） */
  at: number;
}

/** 常用候选（探测用）：常见中文 + 西文。装了才会出现在下拉里 */
const CANDIDATE_CN = [
  '宋体',
  '新宋体',
  '仿宋',
  '仿宋_GB2312',
  '楷体',
  '楷体_GB2312',
  '黑体',
  '微软雅黑',
  '微软雅黑 Light',
  '等线',
  '等线 Light',
  '幼圆',
  '隶书',
  '华文中宋',
  '华文宋体',
  '华文楷体',
  '华文仿宋',
  '华文细黑',
  '华文琥珀',
  '方正舒体',
  '方正姚体',
  '思源黑体',
  '思源宋体',
  'Noto Sans SC',
  'Noto Serif SC',
  '苹方',
  'PingFang SC',
  '冬青黑体',
  'Hiragino Sans GB',
  '文泉驿微米黑',
];

const CANDIDATE_LATIN = [
  'Times New Roman',
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Candara',
  'Century Gothic',
  'Corbel',
  'Garamond',
  'Georgia',
  'Helvetica',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Trebuchet MS',
  'Verdana',
  'Gill Sans MT',
  'Franklin Gothic Medium',
  'Book Antiqua',
];

const CANDIDATE_MONO = ['Consolas', 'Courier New', 'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', 'Lucida Console', 'Source Code Pro', 'Fira Code'];

/**
 * 字体装没装：canvas 量同一串文字的宽度，和纯 fallback 比。
 * 装了 → 宽度（通常）不同；没装 → 浏览器用 fallback，宽度一模一样。
 */
function probeInstalled(family: string, ctx: CanvasRenderingContext2D | null): boolean {
  if (!ctx) return false;
  const text = '汉字Wg字体探测0123WM';
  try {
    ctx.font = '72px monospace';
    const base = ctx.measureText(text).width;
    ctx.font = `72px "${family}", monospace`;
    const withFamily = ctx.measureText(text).width;
    return Math.abs(withFamily - base) > 0.5;
  } catch {
    return false;
  }
}

function canvasCtx(): CanvasRenderingContext2D | null {
  try {
    return document.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
}

/** 探测得到的清单（无权限、无弹窗）—— 也是"系统枚举不可用"时的默认清单 */
export function probeFonts(): FontList {
  const ctx = canvasCtx();
  const pick = (list: string[]): string[] => list.filter((f) => probeInstalled(f, ctx));
  const chinese = pick(CANDIDATE_CN);
  const latin = pick(CANDIDATE_LATIN);
  const mono = pick(CANDIDATE_MONO);
  // 兜底：一个中文都没探到（极端环境）也要有可选项，否则下拉空着没法用
  if (!chinese.length) chinese.push('宋体', '黑体', '微软雅黑');
  if (!latin.length) latin.push('Times New Roman', 'Arial');
  if (!mono.length) mono.push('Consolas', 'Courier New');
  return { chinese, latin, mono, source: 'probe', systemAll: [], at: Date.now() };
}

/* ── 系统字体枚举（Local Font Access API） ── */

interface LocalFontData {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
}

type QueryLocalFonts = (opts?: { postscriptNames?: string[] }) => Promise<LocalFontData[]>;

function queryLocalFontsFn(): QueryLocalFonts | null {
  const w = window as unknown as { queryLocalFonts?: QueryLocalFonts };
  return typeof w.queryLocalFonts === 'function' ? w.queryLocalFonts.bind(window) : null;
}

/** 浏览器支不支持"读系统字体"（Edge/Chrome 支持；Firefox/Safari 没有） */
export function systemFontApiAvailable(): boolean {
  return queryLocalFontsFn() !== null;
}

/** 中文/西文/等宽的大致分档（系统枚举回来的是一大堆族名，分档只是为了让下拉好看） */
function bucketOf(family: string): 'chinese' | 'latin' | 'mono' {
  const cn = /[\u4e00-\u9fa5]|宋|黑|楷|仿|雅黑|等线|幼圆|隶书|华文|方正|思源|Noto (Sans|Serif) (SC|TC|JP|KR)|PingFang|Hiragino|YaHei|SimSun|SimHei|KaiTi|FangSong|Microsoft YaHei|MS Gothic|Meiryo|Malgun/i;
  if (cn.test(family)) return 'chinese';
  if (/Mono|Consol|Courier|Code|Terminal|Menlo|Hack|Fira/i.test(family)) return 'mono';
  return 'latin';
}

let cached: FontList | null = null;

/** 当前清单（第一次调用做一次探测；同步，面板渲染可以直接用） */
export function fontList(): FontList {
  if (!cached) cached = probeFonts();
  return cached;
}

/**
 * 读系统字体（**要用户主动触发**：会弹一次授权框）。失败/被拒时保持探测清单并如实返回。
 * @param useSystem true = 尝试系统枚举；false = 重新探测
 */
export async function refreshSystemFonts(useSystem = true): Promise<FontList> {
  if (!useSystem) {
    cached = probeFonts();
    log.info('fonts', '字体清单（探测）', { 中文: cached.chinese.length, 西文: cached.latin.length, 等宽: cached.mono.length });
    return cached;
  }
  const q = queryLocalFontsFn();
  if (!q) {
    cached = probeFonts();
    log.warn('fonts', '这个浏览器没有 queryLocalFonts（读不到系统字体清单），已改用探测清单', { 中文: cached.chinese.length });
    return cached;
  }
  try {
    const all = await q();
    const families = [...new Set(all.map((f) => f.family).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    const b: FontList = { chinese: [], latin: [], mono: [], source: 'system', systemAll: families, at: Date.now() };
    for (const f of families) b[bucketOf(f)].push(f);
    // 系统清单里一个中文都没有（英文版系统）→ 把探测到的中文补上，别让用户没得选
    if (!b.chinese.length) b.chinese = probeFonts().chinese;
    cached = b;
    log.info('fonts', '系统字体清单已读取（queryLocalFonts）', { 总数: families.length, 中文: b.chinese.length, 西文: b.latin.length, 等宽: b.mono.length });
    return cached;
  } catch (e) {
    cached = probeFonts();
    log.warn('fonts', '读系统字体被拒/失败，已改用探测清单', { 原因: e instanceof Error ? e.name : String(e), 中文: cached.chinese.length });
    return cached;
  }
}

/** 拼 CSS 字体栈：选中的字体在前，后面跟通用兜底（导出物与画布一致） */
export function fontStack(family: string): string {
  const f = (family || '').trim();
  if (!f) return '';
  const generic = /Mono|Consol|Courier|Code/i.test(f) ? 'monospace' : 'serif';
  return `"${f}", ${generic}`;
}
