/**
 * 配置与环境变量（规格 §4.3 / §10）。
 *
 * 所有路径都经过 `assertInside()` 白名单校验：只允许动 workspace 与插件目录，
 * 拒绝 `../` 逃逸与绝对路径越界。写操作还受 `ALLOW_WRITE` 开关约束。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ORIGIN_ALLOW, parseOriginAllow } from './security/guard.js';
import { VERSION } from './version.js';

/** editor-mcp/ 目录（dist/config.js 或 src/config.ts 的上一级都指向包根） */
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 仓库根（E:\可视化编辑器） */
const repoRoot = path.resolve(pkgRoot, '..');

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v == null || v.trim() === '') return fallback;
  return !/^(0|false|no|off)$/i.test(v.trim());
}

/**
 * 入站 token 的读取（决策 #1，P0 安全）：
 *   `EDITOR_MCP_TOKEN` 直接给值 → 用它；
 *   否则若给了 `EDITOR_MCP_TOKEN_FILE`（桌面版写 `userData/bridge-token` 后指过来）→ 读文件；
 *   两者都没有 → null（此时 requireToken 打开会让所有入站请求被拒，各入口会打警告）。
 */
function readToken(): string | null {
  const direct = process.env['EDITOR_MCP_TOKEN'];
  if (direct && direct.trim()) return direct.trim();
  const file = process.env['EDITOR_MCP_TOKEN_FILE'];
  if (file && file.trim()) {
    try {
      const text = fs.readFileSync(file.trim(), 'utf8').trim();
      return text || null;
    } catch {
      return null;
    }
  }
  return null;
}

export const config = {
  /** 服务器标识（会打印并参与 bridge.hello 的握手） */
  name: 'editor-mcp',
  /** ★版本来自根 `package.json` —— 由 `tools/sync-contracts.mjs` 生成到 `src/version.ts`，别手改 */
  version: VERSION,
  /** 支持的 MCP 协议版本（打印用；握手由 SDK 负责） */
  protocolVersion: '2025-06-18',

  /** 桥接中转地址（Hub 监听它；LiveBridge 也连它） */
  bridgeUrl: env('EDITOR_MCP_BRIDGE_URL', 'ws://127.0.0.1:37650/bridge'),
  /** 是否随进程启动桥接中转（EDITOR_MCP_NO_BRIDGE=1 可关掉） */
  bridgeHub: envBool('EDITOR_MCP_BRIDGE_HUB', true),
  /**
   * 无头模式的文档目录（**活文档**）。
   * ★P3-M5：默认从包内 `editor-mcp/workspace/` 改到**仓库根 `var/mcp-workspace/`**
   *   —— 活文档是"运行数据"，不该跟源码混在一起（迁移时先复制、逐文件比对 SHA256、再切默认，
   *   旧目录原样保留一个版本周期）。显式设 `EDITOR_MCP_WORKSPACE` 仍然优先。
   */
  workspace: path.resolve(env('EDITOR_MCP_WORKSPACE', path.join(repoRoot, 'var', 'mcp-workspace'))),
  /** 外部插件目录：默认指向编辑器工程的 public/组件 */
  pluginDir: path.resolve(env('EDITOR_MCP_PLUGIN_DIR', path.join(repoRoot, 'web-editor', 'public', '组件'))),
  /**
   * 写开关：false 时所有写操作返回 WRITE_DISABLED。
   * ★决策 #2（2026-09-28）：**默认关** —— 分发版首次运行不允许写工作区/插件；
   * 桌面版首选项里留开关（写入 `userData/prefs.json` 后由应用重启 MCP 生效）。
   * 开发期可用 `EDITOR_MCP_ALLOW_WRITE=1` 直接打开。
   */
  allowWrite: envBool('EDITOR_MCP_ALLOW_WRITE', false),

  /**
   * 入站鉴权 token（P0）。桌面版启动时生成 `userData/bridge-token` 并注入自己拉起的 MCP；
   * 其它客户端（如 DSH 的 mcp-client）需手工把同一个值填进 `headers.Authorization: Bearer <token>`。
   * 见「工具 → MCP 桥接」的一键复制配置。
   */
  token: readToken(),
  /** 是否强制校验 token（默认 **true**；开发期可用 EDITOR_MCP_REQUIRE_TOKEN=0 临时关闭） */
  requireToken: envBool('EDITOR_MCP_REQUIRE_TOKEN', true),
  /** Origin 白名单（逗号分隔；默认只放行本机页面的任意端口） */
  originAllow: parseOriginAllow(env('EDITOR_MCP_ORIGIN_ALLOW', DEFAULT_ORIGIN_ALLOW)),
  /** 单客户端速率限制（次/分钟，规格 §10） */
  rateLimitPerMinute: Number(env('EDITOR_MCP_RATE_LIMIT', '100')),
  /** 插件备份保留个数（规格 §5.12） */
  backupKeep: Number(env('EDITOR_MCP_BACKUP_KEEP', '5')),
  /**
   * `asset.*` 嵌图时单个文件的体积上限（字节）。
   * 为什么允许"读任意路径"：这些工具就是用来把**用户手上的图/HTML**搬进编辑器的；
   * 读进来只在内存里转成 data URL 写进节点，**不回传内容给模型**（也就不会占 token）。
   * 写仍然只允许工作区/插件目录（assertInside 不变）。
   */
  assetMaxBytes: Math.max(1, Number(env('EDITOR_MCP_ASSET_MAX_MB', '20'))) * 1024 * 1024,

  pkgRoot,
  repoRoot,
} as const;

/** 文档文件名：<workspace>/<docId>.editor.json（规格 §4.2） */
export function docFile(docId: string): string {
  return assertInside(config.workspace, `${docId}.editor.json`);
}

/**
 * 路径白名单：把相对路径解析到 base 下，并确保没跑出 base。
 * 传入绝对路径时同样要求落在 base 内（规格 §10「拒绝 ../ 与绝对路径」）。
 */
export function assertInside(base: string, candidate: string): string {
  const resolved = path.resolve(base, candidate);
  const rel = path.relative(base, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界（只允许 ${base} 下）：${candidate}`);
  }
  return resolved;
}

/** 文件名安全化：只保留字母数字与 . _ -，其余换成 -（避免进不了白名单） */
export function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
}
