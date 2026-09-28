/**
 * 入站访问守卫（P0 安全，2026-09-28）
 *
 * 为什么需要它：两个端口（37650 hub / 37651 HTTP）只监听回环，但**回环不是安全边界** ——
 * 用户浏览的任意网页都能向 `127.0.0.1` 发请求：
 *   · 用 `Content-Type: text/plain`（简单请求，不触发预检）POST 工具调用 → 真的会写文件；
 *   · 直接 `new WebSocket('ws://127.0.0.1:37650/bridge')`（WS 不受 CORS 约束）→ 可冒充编辑器，
 *     读到本该转发给编辑器的请求内容。
 * MCP 规范（Transports）也明确要求：**服务端 MUST 校验 Origin**（防 DNS rebinding）、本地服务只绑回环、SHOULD 鉴权。
 *
 * 本模块只做**纯判断**（不碰 http/ws 对象），便于用 vitest 覆盖所有分支；调用方负责发 401/403 或关闭连接。
 */
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/** 判定结果：allowed=false 时给出可编程的原因 */
export interface GuardDecision {
  allowed: boolean;
  /** 机器可读原因（对应 ErrorCodes 或日志用） */
  code?: 'ORIGIN_REJECTED' | 'HOST_REJECTED' | 'UNAUTHORIZED';
  /** 人类可读说明（写进响应体与日志） */
  reason?: string;
}

const OK: GuardDecision = { allowed: true };

/** 默认 Origin 白名单：本机任意端口的 http 页面（编辑器 dev 5178 / 启动器 5179 / 桌面版随机端口） */
export const DEFAULT_ORIGIN_ALLOW = 'http://127.0.0.1:*,http://localhost:*';

/** 允许的 Host 主机名（只接受回环写法；域名一律拒绝 → 防 DNS rebinding） */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** 解析逗号分隔的 Origin 白名单；空值回落默认 */
export function parseOriginAllow(raw: string | undefined | null): string[] {
  const text = (raw ?? '').trim();
  if (!text) return DEFAULT_ORIGIN_ALLOW.split(',');
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Origin 是否允许。
 * 规则（决策 #3）：
 *   · **没有 Origin 头** → 放行（Node/脚本客户端不发它；由 token 把关）；
 *   · 有 Origin → 必须命中白名单（支持 `http://127.0.0.1:*` 这种端口通配）；
 *   · `Origin: null`（file:// 页面、沙箱 iframe）→ **拒绝**。
 */
export function isOriginAllowed(origin: string | undefined | null, allow: readonly string[]): GuardDecision {
  if (origin === undefined || origin === null || origin === '') return OK;
  const value = origin.trim();
  if (value === 'null') {
    return { allowed: false, code: 'ORIGIN_REJECTED', reason: 'Origin 为 null（file:// 或沙箱页面）不允许访问本机服务' };
  }
  for (const pattern of allow) {
    if (pattern === '*') return OK;
    if (pattern === value) return OK;
    // 端口通配：http://127.0.0.1:* 匹配任意端口
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1); // 去掉 '*'，保留 ':' 之前的内容 + ':'
      if (value.startsWith(prefix) && /^https?:\/\/[^/]+:\d+$/.test(value)) return OK;
    }
  }
  return {
    allowed: false,
    code: 'ORIGIN_REJECTED',
    reason: `Origin ${value} 不在白名单（EDITOR_MCP_ORIGIN_ALLOW）。这是防"网页打本机端口"的关键检查`,
  };
}

/**
 * Host 是否允许（防 DNS rebinding）。
 * 攻击方式：把域名解析到 127.0.0.1，浏览器请求里 Host 是攻击者域名 → 这里直接拒。
 */
export function isHostAllowed(host: string | undefined | null): GuardDecision {
  if (host === undefined || host === null || host === '') {
    // 极少数客户端不发 Host（HTTP/1.0）；HTTP/1.1 必须有，缺了按拒绝处理更安全
    return { allowed: false, code: 'HOST_REJECTED', reason: '请求缺少 Host 头' };
  }
  const raw = host.trim().toLowerCase();
  // 去掉端口：[::1]:37651 → [::1]；127.0.0.1:37651 → 127.0.0.1；裸 IPv6（::1）本身含多个冒号，不按端口切
  let hostname = raw;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    hostname = end >= 0 ? raw.slice(0, end + 1) : raw;
  } else if (raw.split(':').length - 1 <= 1) {
    const colon = raw.lastIndexOf(':');
    if (colon >= 0) hostname = raw.slice(0, colon);
  }
  if (LOOPBACK_HOSTS.has(hostname)) return OK;
  return {
    allowed: false,
    code: 'HOST_REJECTED',
    reason: `Host ${host} 不是回环地址（只接受 127.0.0.1 / localhost / ::1），拒绝以防 DNS rebinding`,
  };
}

/** 常量时间字符串比较（长度不同也走一次 hash 比较，避免长度侧信道） */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return nodeTimingSafeEqual(ha, hb);
}

/** 从 `Authorization` 头里取 Bearer token；取不到返回 null */
export function bearerToken(authorization: string | undefined | null): string | null {
  if (!authorization) return null;
  const m = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorization);
  return m ? m[1] : null;
}

/**
 * 鉴权（决策 #1：token 强制，只给桌面版自动发放）。
 *   · `requireToken=false` → 一律放行（开发期逃生门，会在日志里警告一次）；
 *   · `requireToken=true` → 必须带 `Authorization: Bearer <token>` 且与配置一致，否则 401。
 */
export function isAuthorized(
  authorization: string | undefined | null,
  token: string | null | undefined,
  requireToken: boolean,
): GuardDecision {
  if (!requireToken) return OK;
  if (!token) {
    return {
      allowed: false,
      code: 'UNAUTHORIZED',
      reason: '服务器已开启 token 校验，但没有配置 token（EDITOR_MCP_TOKEN）—— 无法鉴权，拒绝服务',
    };
  }
  const got = bearerToken(authorization);
  if (!got) {
    return { allowed: false, code: 'UNAUTHORIZED', reason: '缺少 Authorization: Bearer <token>（见「工具 → MCP 桥接」里复制的客户端配置）' };
  }
  if (!constantTimeEqual(got, token)) {
    return { allowed: false, code: 'UNAUTHORIZED', reason: 'token 不匹配' };
  }
  return OK;
}

/** 综合判定：Host → Origin → token（顺序即响应的优先级） */
export function guardRequest(
  headers: { host?: string; origin?: string; authorization?: string },
  opts: { allow: readonly string[]; token: string | null; requireToken: boolean },
): GuardDecision {
  const host = isHostAllowed(headers.host);
  if (!host.allowed) return host;
  const origin = isOriginAllowed(headers.origin, opts.allow);
  if (!origin.allowed) return origin;
  return isAuthorized(headers.authorization, opts.token, opts.requireToken);
}
