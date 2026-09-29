/**
 * 清单形状契约（REFACTORING §6.4.5）：
 *   · **写入端只能写规范形状** `{ "files": [...] }`；
 *   · **读取端必须兼容裸数组**（过渡期），以及垃圾输入（不崩、返回空）。
 *
 * 这组用例存在的意义：形状是跨包契约（editor-mcp 写、编辑器读、桌面壳伺服），
 * 一旦哪边"顺手写成裸数组"，只有断言能拦住 —— 而且它是**纯函数**，验起来不需要文件系统。
 */
import { describe, expect, it } from 'vitest';
import { parseManifest, serializeManifest } from '../src/tools/plugin.js';

describe('清单形状：写入端只写规范形状', () => {
  it('serializeManifest 产出 {files:[…]}，且是稳定排序（便于 diff）', () => {
    const text = serializeManifest(['乙.js', '甲.js']);
    expect(JSON.parse(text)).toEqual({ files: ['乙.js', '甲.js'].sort() });
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/^\[/); // 不是裸数组
  });

  it('去重 + 去空白 + 丢掉非字符串项', () => {
    const text = serializeManifest(['a.js', ' a.js ', '', 'b.js']);
    expect(JSON.parse(text).files).toEqual(['a.js', 'b.js']);
  });

  it('空清单也写规范形状（不是 []）', () => {
    expect(JSON.parse(serializeManifest([]))).toEqual({ files: [] });
  });
});

describe('清单形状：读取端兼容裸数组', () => {
  it('裸数组（过渡期的旧文件、以及随包种子）能读', () => {
    expect(parseManifest('["甲.js","乙.js"]')).toEqual(['甲.js', '乙.js']);
  });

  it('规范形状能读', () => {
    expect(parseManifest('{"files":["甲.js"]}')).toEqual(['甲.js']);
  });

  it('垃圾输入返回空数组，不抛异常', () => {
    expect(parseManifest('不是 JSON')).toEqual([]);
    expect(parseManifest('{"files":"甲.js"}')).toEqual([]);
    expect(parseManifest('null')).toEqual([]);
    expect(parseManifest('{"files":[1,"甲.js",null]}')).toEqual(['甲.js']);
  });

  it('读→写→读 一圈不漂移（规范形状幂等）', () => {
    const once = serializeManifest(parseManifest('["甲.js","乙.js"]'));
    const twice = serializeManifest(parseManifest(once));
    expect(twice).toBe(once);
  });
});
