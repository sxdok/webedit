/**
 * 握手判据（ARCHITECTURE §5.1）：**用"协议 + 能力"替换"版本全等"**。
 *
 * 背景：原来 `编辑器 v0.1.0 / MCP v0.2.0 → 拒绝使用 Live Bridge` —— 任何一次发版都会让 Live 直接废掉，
 * 而真正影响互通的是协议版本与能力集。这组用例把判据穷举，避免把契约埋在 WebSocket 处理里靠联调碰运气。
 */
import { describe, expect, it } from 'vitest';
import { EDITOR_PROTOCOL, evaluateHandshake, METHOD_FEATURE, missingFeature } from '../src/bridge/protocolGate.js';

describe('协议一致', () => {
  it('协议相同、版本相同 → 可用 Live', () => {
    const d = evaluateHandshake({ protocol: EDITOR_PROTOCOL, version: '0.3.0' }, '0.3.0');
    expect(d.live).toBe(true);
    expect(d.protocolMismatch).toBe(false);
  });

  it('协议相同、版本不同 → **仍然可用 Live**，只记一句 info（这是本条改动的核心）', () => {
    const d = evaluateHandshake({ protocol: EDITOR_PROTOCOL, version: '0.1.0' }, '0.2.0');
    expect(d.live).toBe(true);
    expect(d.protocolMismatch).toBe(false);
    expect(d.note).toContain('协议 v2 兼容');
    expect(d.note).toContain('0.1.0');
  });
});

describe('协议不同 / 未报', () => {
  it('协议不同 → 仍尝试 Live，但标记 protocolMismatch 并给出可行动提示', () => {
    const d = evaluateHandshake({ protocol: 1, version: '0.1.0' }, '0.3.0');
    expect(d.live).toBe(true);
    expect(d.protocolMismatch).toBe(true);
    expect(d.note).toContain('一起升级');
  });

  it('老编辑器没报协议 → 同样尝试 Live，但保守标记 protocolMismatch', () => {
    const d = evaluateHandshake({ version: '0.1.0' }, '0.3.0');
    expect(d.live).toBe(true);
    expect(d.protocolMismatch).toBe(true);
    expect(d.note).toContain('未上报');
  });
});

describe('能力判定（缺能力的方法退回无头）', () => {
  it('方法不依赖能力 → 永不算缺', () => {
    expect(missingFeature('doc.create', undefined, true)).toBeNull();
  });

  it('编辑器明确支持 → 不缺（即使协议不一致）', () => {
    expect(missingFeature('export.docx', { exportDocx: true }, true)).toBeNull();
  });

  it('编辑器明确不支持 → 缺（不论协议）', () => {
    expect(missingFeature('export.docx', { exportDocx: false }, false)).toBe('exportDocx');
  });

  it('编辑器没报这项：协议一致 → 不缺；协议不一致 → 保守视为缺', () => {
    expect(missingFeature('export.docx', {}, false)).toBeNull();
    expect(missingFeature('export.docx', {}, true)).toBe('exportDocx');
    expect(missingFeature('export.docx', undefined, true)).toBe('exportDocx');
  });

  it('方法→能力的映射本身是契约：列出的键都是真实能力名', () => {
    const feats = ['exportDocx', 'liveSelection', 'realtime'];
    for (const [method, need] of Object.entries(METHOD_FEATURE)) {
      if (!need) continue;
      expect(feats, `${method} 依赖了未知能力 ${String(need)}`).toContain(need);
    }
  });
});
