/**
 * 配置与环境变量（规格 §4.3 / §10）。
 *
 * 所有路径都经过 `assertInside()` 白名单校验：只允许动 workspace 与插件目录，
 * 拒绝 `../` 逃逸与绝对路径越界。写操作还受 `ALLOW_WRITE` 开关约束。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export const config = {
  /** 服务器标识（会打印并参与 bridge.hello 版本协商） */
  name: 'editor-mcp',
  version: '0.1.0',
  /** 支持的 MCP 协议版本（打印用；握手由 SDK 负责） */
  protocolVersion: '2025-06-18',

  /** 桥接中转地址（Hub 监听它；LiveBridge 也连它） */
  bridgeUrl: env('EDITOR_MCP_BRIDGE_URL', 'ws://127.0.0.1:37650/bridge'),
  /** 是否随进程启动桥接中转（EDITOR_MCP_NO_BRIDGE=1 可关掉） */
  bridgeHub: envBool('EDITOR_MCP_BRIDGE_HUB', true),
  /** 无头模式的文档目录 */
  workspace: path.resolve(env('EDITOR_MCP_WORKSPACE', path.join(pkgRoot, 'workspace'))),
  /** 外部插件目录：默认指向编辑器工程的 public/组件 */
  pluginDir: path.resolve(env('EDITOR_MCP_PLUGIN_DIR', path.join(repoRoot, 'web-editor', 'public', '组件'))),
  /** 写开关：false 时所有写操作返回 WRITE_DISABLED */
  allowWrite: envBool('EDITOR_MCP_ALLOW_WRITE', true),
  /** 单客户端速率限制（次/分钟，规格 §10） */
  rateLimitPerMinute: Number(env('EDITOR_MCP_RATE_LIMIT', '100')),
  /** 插件备份保留个数（规格 §5.12） */
  backupKeep: Number(env('EDITOR_MCP_BACKUP_KEEP', '5')),

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
