/**
 * 入站守卫纯函数测试（P0）
 *
 * 覆盖三类威胁（决策 #1/#3）：
 *   · T1 本地网页 CSRF —— 跨源 `Origin` 必须被拒；无 Origin 的本地进程放行给 token 把关；
 *   · T2 冒充编辑器 —— hub 侧同样走这套判定（hello 带 token 才认）；
 *   · T3 DNS rebinding —— `Host` 只接受回环写法。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORIGIN_ALLOW,
  bearerToken,
  constantTimeEqual,
  guardRequest,
  isAuthorized,
  isHostAllowed,
  isOriginAllowed,
  parseOriginAllow,
} from '../src/security/guard';

const ALLOW = parseOriginAllow(DEFAULT_ORIGIN_ALLOW);

describe('parseOriginAllow', () => {
  it('空值回落默认（127.0.0.1 与 localhost 任意端口）', () => {
    expect(parseOriginAllow(undefined)).toEqual(ALLOW);
    expect(parseOriginAllow('')).toEqual(ALLOW);
    expect(parseOriginAllow('   ')).toEqual(ALLOW);
  });
  it('逗号分隔并去空白', () => {
    expect(parseOriginAllow(' http://a.example:1 , http://b.example:2 ')).toEqual(['http://a.example:1', 'http://b.example:2']);
  });
});

describe('isOriginAllowed（T1 本地网页 CSRF）', () => {
  it('没有 Origin 头 → 放行（Node/脚本客户端；由 token 把关）', () => {
    expect(isOriginAllowed(undefined, ALLOW).allowed).toBe(true);
    expect(isOriginAllowed(null, ALLOW).allowed).toBe(true);
    expect(isOriginAllowed('', ALLOW).allowed).toBe(true);
  });
  it('本机页面的任意端口放行（端口通配）', () => {
    expect(isOriginAllowed('http://127.0.0.1:5179', ALLOW).allowed).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:63421', ALLOW).allowed).toBe(true);
    expect(isOriginAllowed('http://localhost:5178', ALLOW).allowed).toBe(true);
  });
  it('恶意站点被拒（这是本轮最关键的一条断言）', () => {
    const d = isOriginAllowed('http://evil.example', ALLOW);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('ORIGIN_REJECTED');
    // 只差一个字符也不行（不是前缀匹配就放行）
    expect(isOriginAllowed('http://127.0.0.1.evil.example', ALLOW).allowed).toBe(false);
    expect(isOriginAllowed('https://127.0.0.1:37651', ALLOW).allowed).toBe(false); // 协议必须一致
  });
  it('Origin: null（file:// / 沙箱页面）被拒', () => {
    expect(isOriginAllowed('null', ALLOW).allowed).toBe(false);
  });
  it('白名单可写 * 表示全放行（自担风险）', () => {
    expect(isOriginAllowed('http://evil.example', ['*']).allowed).toBe(true);
  });
});

describe('isHostAllowed（T3 DNS rebinding）', () => {
  it('回环写法放行（含端口与 IPv6）', () => {
    for (const h of ['127.0.0.1', '127.0.0.1:37651', 'localhost', 'localhost:5179', '::1', '[::1]:37650', '127.0.0.1:80']) {
      expect(isHostAllowed(h).allowed, h).toBe(true);
    }
  });
  it('域名与缺 Host 被拒（攻击者把域名解析到 127.0.0.1）', () => {
    for (const h of ['evil.example', 'evil.example:37651', '0.0.0.0:37651', '192.168.1.9:37651', undefined, '']) {
      expect(isHostAllowed(h).allowed, String(h)).toBe(false);
    }
    expect(isHostAllowed('evil.example').code).toBe('HOST_REJECTED');
  });
});

describe('isAuthorized / bearerToken（决策 #1：token 强制）', () => {
  const token = 'a'.repeat(43);
  it('Bearer 解析', () => {
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`  bearer   ${token}  `)).toBe(token);
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
  });
  it('关闭校验时一律放行（开发期逃生门）', () => {
    expect(isAuthorized(undefined, token, false).allowed).toBe(true);
  });
  it('开启校验：正确 token 放行，缺失/错误/服务器未配 token 三种情况拒绝', () => {
    expect(isAuthorized(`Bearer ${token}`, token, true).allowed).toBe(true);
    expect(isAuthorized(undefined, token, true).code).toBe('UNAUTHORIZED');
    expect(isAuthorized('Bearer wrong', token, true).code).toBe('UNAUTHORIZED');
    expect(isAuthorized(`Bearer ${token}`, null, true).code).toBe('UNAUTHORIZED');
    expect(isAuthorized(`Bearer ${token}`, '', true).code).toBe('UNAUTHORIZED');
  });
  it('常量时间比较：长度不同也安全返回 false', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('guardRequest（组合顺序：Host → Origin → token）', () => {
  const opts = { allow: ALLOW, token: 'secret-token', requireToken: true };
  it('正常本地 Node 客户端（无 Origin、带 token）放行', () => {
    expect(guardRequest({ host: '127.0.0.1:37651', authorization: 'Bearer secret-token' }, opts).allowed).toBe(true);
  });
  it('浏览器页面（本机 Origin）带 token 放行', () => {
    expect(guardRequest({ host: '127.0.0.1:37651', origin: 'http://127.0.0.1:5179', authorization: 'Bearer secret-token' }, opts).allowed).toBe(true);
  });
  it('恶意网页：跨源 + 无 token → 先被 Origin 拒（不是 401）', () => {
    const d = guardRequest({ host: '127.0.0.1:37651', origin: 'http://evil.example' }, opts);
    expect(d.code).toBe('ORIGIN_REJECTED');
  });
  it('DNS rebinding：Host 是攻击者域名 → 先被 Host 拒', () => {
    const d = guardRequest({ host: 'evil.example:37651', authorization: 'Bearer secret-token' }, opts);
    expect(d.code).toBe('HOST_REJECTED');
  });
  it('本机但没带 token → 401', () => {
    const d = guardRequest({ host: '127.0.0.1:37651' }, opts);
    expect(d.code).toBe('UNAUTHORIZED');
  });
});
