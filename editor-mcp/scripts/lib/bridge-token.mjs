/**
 * 诊断脚本共用的「MCP 入站 token」解析（P0 决策 #1）。
 *
 * 桌面版启动时会生成 `userData/bridge-token` 并注入自己拉起的 MCP；
 * agent 侧（DSH 的 mcp-client 等）必须拿同一个值填进 `Authorization: Bearer <token>`。
 * 本模块只做"按优先级找一个 token"，找不到就返回 null（调用方给出人话提示）。
 *
 * 优先级：
 *   ① `EDITOR_MCP_TOKEN` 环境变量（最明确，脚本/CI 用）；
 *   ② `%APPDATA%\<产品名>\bridge-token`（桌面版生成的持久 token；含旧名回退）；
 *   ③ `EDITOR_MCP_TOKEN_FILE` 指向的文件。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 桌面版 `app.getPath('userData')` 的目录名候选（productName 优先，其次是包名与 0.3.0 的新名） */
export const USERDATA_NAMES = ['可视化编辑器', 'visual-editor-desktop', 'webedit'];

/**
 * @returns {{ token: string|null, source: string|null }} source 是"从哪拿到的"，便于排查
 */
export function resolveBridgeToken({ env = process.env, appData = process.env.APPDATA } = {}) {
  const direct = (env.EDITOR_MCP_TOKEN ?? '').trim();
  if (direct) return { token: direct, source: 'EDITOR_MCP_TOKEN' };
  const file = (env.EDITOR_MCP_TOKEN_FILE ?? '').trim();
  if (file) {
    try {
      const text = readFileSync(file, 'utf8').trim();
      if (text) return { token: text, source: file };
    } catch {
      /* 文件不存在或读不了 → 继续下一档 */
    }
  }
  if (appData) {
    for (const name of USERDATA_NAMES) {
      const p = join(appData, name, 'bridge-token');
      if (!existsSync(p)) continue;
      try {
        const text = readFileSync(p, 'utf8').trim();
        if (text) return { token: text, source: p };
      } catch {
        /* 忽略，试下一个 */
      }
    }
  }
  return { token: null, source: null };
}

/** 找不到 token 时的统一提示（把三条路都写清楚，避免"为什么连不上"的来回猜） */
export function noTokenHint(mcpUrl = 'http://127.0.0.1:37651/mcp') {
  return [
    `没找到 MCP 入站 token（P0 起鉴权强制）。三选一：`,
    `  ① 从桌面版「工具 → MCP 桥接 → 复制带 token 的客户端配置」拿；`,
    `  ② 设置环境变量 EDITOR_MCP_TOKEN=<token> 后重跑本脚本；`,
    `  ③ 确认桌面版已启动过（它会把 token 写到 %APPDATA%\\可视化编辑器\\bridge-token）。`,
    `若那个 MCP 是你自己起的、且已关掉校验（EDITOR_MCP_REQUIRE_TOKEN=0），本次请求应能直接通过：${mcpUrl}`,
  ].join('\n');
}
