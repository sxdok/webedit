/**
 * 职责：**文档 → Markdown**（B10）。只读源码视图用：把编辑器里的组件树翻译成 Markdown。
 *
 * 设计取舍：
 *   · 只做"结构 → 文本"的**单向**导出（Markdown → 文档不在范围内，见 README「十四」B10）；
 *   · 认得常用组件（标题/正文/列表/清单/引用/代码/表格/图片/分隔线/分页），其余组件走**通用兜底**：
 *     先把 `props` 里像文字的字段吐出来，再递归子节点（所以不认识的自定义组件也不会整块丢）；
 *   · 容器（分栏/卡片/Web 容器）不额外加层级，子节点按顺序铺平。
 */
import { getForest } from '../store/treeUtils';
import { parseTableData } from '../registry/components/common/tableKit';
import { asNumber, asString } from './id';
import type { ComponentNode, EditorDocument } from '../registry/types';

/** 表格/行内文本的转义：`|` 会撑破表格，换行用 <br> */
function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** 取组件里"像正文"的文字：字符串直接用；数组按行拼（`items` 在多数组件里是**多行文本**） */
function textOf(node: ComponentNode): string {
  const p = node.props as Record<string, unknown>;
  for (const k of ['text', 'content', 'title', 'caption', 'label', 'value', 'desc', 'items', 'data']) {
    const v = p[k];
    const s =
      typeof v === 'string'
        ? v
        : Array.isArray(v)
          ? v.map((x) => (typeof x === 'string' ? x : asString((x as Record<string, unknown>)?.text))).filter(Boolean).join('\n')
          : '';
    if (s.trim()) return s;
  }
  return '';
}

/** 多行文本 → 逐行（去掉空行、去掉行尾空白） */
function lines(node: ComponentNode): string[] {
  return textOf(node)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
}

function heading(node: ComponentNode): string {
  const level = Math.min(Math.max(asNumber(node.props.level, 2), 1), 6);
  return `${'#'.repeat(level)} ${lines(node).join(' ').trim() || '标题'}`;
}

/** 表格 → Markdown 管道表（首行当表头；列数取最宽的一行） */
function tableMd(node: ComponentNode): string[] {
  const rows = parseTableData(node.props.data);
  if (!rows.length) return [];
  const width = Math.max(1, rows.reduce((n, r) => Math.max(n, r.length), 0));
  const head = Array.from({ length: width }, (_, c) => esc(rows[0]?.[c] ?? '') || ' ');
  const out = [`| ${head.join(' | ')} |`, `| ${Array.from({ length: width }, () => '---').join(' | ')} |`];
  for (let r = 1; r < rows.length; r += 1) {
    out.push(`| ${Array.from({ length: width }, (_, c) => esc(rows[r]?.[c] ?? '') || ' ').join(' | ')} |`);
  }
  const cap = asString(node.props.caption);
  if (cap) out.unshift(`*${cap}*`, '');
  return out;
}

function nodeToMd(node: ComponentNode): string[] {
  const type = node.type;
  const out: string[] = [];
  const push = (...s: string[]): void => void out.push(...s);

  switch (type) {
    case 'heading':
      push(heading(node));
      break;
    case 'slideTitle':
      push(`## ${lines(node).join(' ')}`);
      break;
    case 'paragraph':
    case 'lead':
    case 'footnote':
      push(lines(node).join(' '));
      break;
    case 'abstract':
      push(`> ${lines(node).join(' ')}`);
      break;
    case 'quote':
    case 'quoteSlide':
      lines(node).forEach((l) => push(`> ${l}`));
      break;
    case 'bullets':
      lines(node).forEach((l) => push(`${/^\s/.test(l) ? '  - ' : '- '}${l.trim()}`));
      break;
    case 'list': {
      // 「列表」组件有 ordered 开关：编号列表 → 1. 2. 3.
      const ordered = node.props.ordered === true;
      lines(node).forEach((l, i) => push(`${/^\s/.test(l) ? '  ' : ''}${ordered ? `${i + 1}. ` : '- '}${l.trim()}`));
      break;
    }
    case 'defList':
      lines(node).forEach((l) => push(`- ${l.trim()}`));
      break;
    case 'checkList':
      lines(node).forEach((l) => push(`- [ ] ${l.trim()}`));
      break;
    case 'keywords':
      push(`**关键词**：${lines(node).join('、')}`);
      break;
    case 'code':
      push(`\`\`\`${asString(node.props.lang)}`);
      textOf(node)
        .split(/\r?\n/)
        .forEach((l) => out.push(l));
      push('```');
      break;
    case 'table':
    case 'threeLineTable':
    case 'paramTable':
    case 'detailTable':
    case 'checkTable':
      tableMd(node).forEach((l) => push(l));
      break;
    case 'image':
    case 'imagePair': {
      const src = asString(node.props.src);
      const alt = asString(node.props.alt) || asString(node.props.caption) || '图片';
      push(`![${alt}](${src})`);
      const cap = asString(node.props.caption);
      if (cap) push(`*${cap}*`);
      break;
    }
    case 'divider':
      push('---');
      break;
    case 'pageBreak':
      push('', '<!-- 分页 -->', '');
      break;
    case 'spacer':
      push('');
      break;
    default: {
      // 通用兜底：先吐自己那点文字（多行压成一行），子节点照旧递归
      const t = lines(node).join(' ');
      if (t) push(t);
      break;
    }
  }

  for (const child of node.children ?? []) out.push(...nodeToMd(child));
  return out;
}

function countNodes(forest: ComponentNode[]): number {
  let n = 0;
  const walk = (list: ComponentNode[]): void => {
    list.forEach((x) => {
      n += 1;
      if (x.children?.length) walk(x.children);
    });
  };
  walk(forest);
  return n;
}

/** 整篇文档 → Markdown 文本 */
export function buildDocMarkdown(doc: EditorDocument): string {
  const forest = getForest(doc);
  const body: string[] = [];
  for (const node of forest) {
    const block = nodeToMd(node);
    if (block.length) body.push(...block, '');
  }
  const head = [
    `# ${doc.title || '未命名文档'}`,
    '',
    `> 由可视化编辑器导出 · ${doc.mode === 'document' ? '文档模式' : 'Web 模式'} · 组件 ${countNodes(forest)} 个`,
    '',
  ];
  return `${[...head, ...body].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
