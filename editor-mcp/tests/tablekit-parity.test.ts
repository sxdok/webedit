/**
 * 表格内核「两份实现一致性」测试（D17）
 *
 * 背景：表格的 9+ 个纯函数在**两份代码**里各实现一遍 ——
 *   · `editor-mcp/src/engine/tableKit.ts`（无头通道用）
 *   · `web-editor/src/registry/components/common/tableKit.tsx`（Live 通道 / 编辑器用）
 * MCP 侧注释自认"语义必须一致"，规格 §14 也要求抽公共包。在 P1 真正同源之前，
 * **用这个测试把它们钉在一起**：同一组输入必须给出逐字节相同的结果。
 *
 * 这个测试的价值：它把"两份实现要一致"从注释变成**可执行的断言** ——
 * 任何一边改了语义，CI/本地 `npm test` 立刻红。
 */
import { describe, expect, it } from 'vitest';

import * as mcp from '../src/engine/tableKit';
import * as editor from '../../web-editor/src/registry/components/common/tableKit';

/** 两份实现里都存在、且应当语义一致的函数 */
const SHARED = [
  'escapeCell',
  'parseTableData',
  'serializeTableData',
  'colName',
  'a1',
  'a1Key',
  'parseA1',
  'normalizeKey',
  'parseCellStyles',
  'cellStyleKeyAt',
  'shiftCellKeys',
  'parseColWidths',
] as const;

/** 用 deep-equal 比较两边（对对象做 JSON 归一，避免 getter/原型差异干扰） */
function same(fn: string, args: unknown[]): { m: unknown; e: unknown } {
  const m = (mcp as Record<string, unknown>)[fn] as (...a: unknown[]) => unknown;
  const e = (editor as Record<string, unknown>)[fn] as (...a: unknown[]) => unknown;
  const mv = m(...args);
  const ev = e(...args);
  expect(JSON.stringify(ev), `${fn}(${JSON.stringify(args)}) 两份实现结果不一致`).toBe(JSON.stringify(mv));
  return { m: mv, e: ev };
}

/** 这些用例只做"两边一致"断言（语义细节多，不写死期望值） */
const PARITY_ONLY: Array<[string, unknown[]]> = [
  ['escapeCell', ['']],
  ['escapeCell', ['a|b']],
  ['escapeCell', ['a\\b']],
  ['escapeCell', ['a\nb']],
  ['escapeCell', ['中文|文本\\换行\n结束']],
  ['parseTableData', [undefined]],
  ['parseTableData', [null]],
  ['parseTableData', ['']],
  ['parseTableData', ['   ']],
  ['parseTableData', ['a|b\nc|d']],
  ['parseTableData', [['a', 'b'], ['c', 'd']]],
  ['parseTableData', [[[1, 2], [3, 4]]]],
  ['parseTableData', ['a|b\nc']],
  ['parseTableData', ['a\\|b|c']],
  ['serializeTableData', [[['a', 'b'], ['c', 'd']]]],
  ['serializeTableData', [[['含|竖线', '含\n换行']]]],
  ['serializeTableData', [[]]],
  ['colName', [0]],
  ['colName', [25]],
  ['colName', [26]],
  ['colName', [27]],
  ['colName', [51]],
  ['colName', [52]],
  ['colName', [701]],
  ['colName', [702]],
  ['colName', [-3]],
  ['a1', [0, 0]],
  ['a1', [2, 1]],
  ['a1', [9, 27]],
  ['a1Key', [0, 0, 0, 0]],
  ['a1Key', [0, 0, 2, 3]],
  ['a1Key', [1, 1, 1, 1]],
  ['parseA1', ['A1']],
  ['parseA1', ['B3']],
  ['parseA1', ['AA10']],
  ['parseA1', ['B2:C3']],
  ['parseA1', ['2,3']],
  ['parseA1', ['']],
  ['parseA1', ['1A']],
  ['parseA1', ['B2:C']],
  ['normalizeKey', ['A1']],
  ['normalizeKey', ['b3']],
  ['normalizeKey', ['B2:C3']],
  ['normalizeKey', ['2,3']],
  ['normalizeKey', ['x']],
  ['parseCellStyles', [undefined]],
  ['parseCellStyles', [null]],
  ['parseCellStyles', [{}]],
  ['parseCellStyles', [{ A1: { bold: true } }]],
  ['parseCellStyles', [{ '2,3': { bold: true } }]],
  ['parseCellStyles', [[]]],
  ['parseCellStyles', ['{"A1":{"bold":true}}']],
  ['cellStyleKeyAt', [{ A1: { bold: true } }, 0, 0]],
  ['cellStyleKeyAt', [{ '2,3': { bold: true } }, 2, 3]],
  ['cellStyleKeyAt', [{}, 5, 5]],
  ['shiftCellKeys', [{ A1: { bold: true }, B2: { italic: true } }, 'row', 0, 1]],
  ['shiftCellKeys', [{ A1: { bold: true }, B2: { italic: true } }, 'row', 1, -1]],
  ['shiftCellKeys', [{ A1: { bold: true }, B2: { italic: true } }, 'col', 0, 1]],
  ['shiftCellKeys', [{}, 'col', 0, 1]],
  ['parseColWidths', [undefined]],
  ['parseColWidths', ['']],
  ['parseColWidths', ['30, 40 50，60']],
  ['parseColWidths', [['30', '40']]],
];

describe('表格内核：两份实现语义一致性（editor-mcp ↔ web-editor）', () => {
  it('两份都导出全部共享函数（防止单边改名/删除）', () => {
    for (const fn of SHARED) {
      expect(typeof (mcp as Record<string, unknown>)[fn], `editor-mcp 缺 ${fn}`).toBe('function');
      expect(typeof (editor as Record<string, unknown>)[fn], `web-editor 缺 ${fn}`).toBe('function');
    }
  });

  it.each(PARITY_ONLY)('%s(%j) 两边结果一致', (fn, args) => {
    same(fn, args);
  });

  it('关键行为的期望值（防止两边一起改错）', () => {
    // 列名换算：A..Z, AA..ZZ, AAA
    expect(same('colName', [0]).m).toBe('A');
    expect(same('colName', [25]).m).toBe('Z');
    expect(same('colName', [26]).m).toBe('AA');
    expect(same('colName', [701]).m).toBe('ZZ');
    expect(same('colName', [702]).m).toBe('AAA');
    // A1 记法
    expect(same('a1', [0, 0]).m).toBe('A1');
    expect(same('a1', [2, 1]).m).toBe('B3');
    expect(same('a1Key', [0, 0, 0, 0]).m).toBe('A1');
    expect(same('a1Key', [0, 0, 2, 3]).m).toBe('A1:D3');
    // 兼容旧的 "行,列" 键
    expect(same('parseA1', ['2,3']).m).toEqual({ r0: 2, c0: 3, r1: 2, c1: 3 });
    expect(same('normalizeKey', ['2,3']).m).toBe('D3');
    expect(same('parseA1', ['B2:C3']).m).toEqual({ r0: 1, c0: 1, r1: 2, c1: 2 });
    // 单元格转义：\| \\ \n（回车不进内容）
    expect(same('escapeCell', ['a|b']).m).toBe('a\\|b');
    expect(same('escapeCell', ['a\\b']).m).toBe('a\\\\b');
    expect(same('escapeCell', ['a\nb']).m).toBe('a\\nb');
    // 序列化：列用 " | "，行用 \n
    expect(same('serializeTableData', [[['a', 'b'], ['c', 'd']]]).m).toBe('a | b\nc | d');
    // 解析：竖线分列 + 换行分行
    expect(same('parseTableData', ['a|b\nc|d']).m).toEqual([['a', 'b'], ['c', 'd']]);
    // 列宽：逗号/中文逗号/空白都当分隔，空项丢弃；**裸数字会被补成百分比**
    expect(same('parseColWidths', ['30, 40 50，60']).m).toEqual(['30%', '40%', '50%', '60%']);
    expect(same('parseColWidths', ['30%, 40px']).m).toEqual(['30%', '40px']);
  });
});
