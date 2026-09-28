/**
 * 加密配置的**读取端**（写端在 `tools/secure-config/secure-config.mjs`，那个文件是独立工具）。
 *
 * 分工（用户要求「加密工具单独剥离」）：
 *   · `tools/secure-config/` —— 零依赖的独立命令行工具，负责 keygen / encrypt / decrypt / verify /
 *     embed-key。**加密算法只在那里实现一份**，本文件 `import()` 它，不复制任何 crypto 代码。
 *   · 本文件 —— 应用侧：定位配置文件、按优先级找密钥、解密、与默认值合并、做一次取值校验，
 *     并把「配置从哪来、密钥从哪来、指纹是多少」如实报出来（出问题时一眼能定位）。
 *
 * 密钥来源优先级（与工具一致）：
 *   `--key`（调用方显式传入） > 环境变量 EDITOR_DESKTOP_CONFIG_KEY（也支持 EDITOR_DESKTOP_CONFIG_KEY_FILE）
 *   > 配置目录下的 `config.key` > 构建期嵌进包的 `config/buildKey.mjs`
 *
 * ⚠ 威胁模型：应用必须能自己解密，所以密钥必然随包分发。它防的是"改坏/一眼看穿更新地址"，
 *   不是有能力的攻击者。**别把真正的秘密写进配置文件。**
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 出厂默认值：配置里缺哪项就用哪项（不用改代码就能换端口/换更新地址） */
export const DEFAULT_CONFIG = {
  app: {
    /** 显示名，仅用于窗口标题与关于对话框 */
    title: '可视化编辑器',
  },
  server: {
    /** 内置静态服务器端口（0 = 自动挑空闲端口）*/
    port: 0,
    host: '127.0.0.1',
    /** 启动后是否用系统浏览器打开（Electron 外壳下默认 false：直接用应用窗口）*/
    openBrowser: false,
  },
  mcp: {
    /** 软件启动时是否自动拉起 editor-mcp */
    enabled: true,
    transport: 'http',
    host: '127.0.0.1',
    /** 外部 AI 连的地址：http://127.0.0.1:<port>/mcp */
    httpPort: 37651,
    /** Live Bridge 中转端口（编辑器页面 ↔ MCP）*/
    bridgePort: 37650,
    /** 意外退出是否自动重启 */
    autoRestart: true,
    /** 启动后等多久算就绪（毫秒）*/
    readyTimeoutMs: 20000,
    /** 写操作开关，透传给 editor-mcp 的 EDITOR_MCP_ALLOW_WRITE */
    allowWrite: true,
  },
  update: {
    /** 预留的更新接口总开关 */
    enabled: true,
    /** 更新服务器根地址（**换地址只改这里、重新加密一份 app-config.enc 即可**）*/
    baseUrl: 'https://updates.example.com/visual-editor/',
    /** 版本清单文件名，最终请求 <baseUrl><manifest> */
    manifest: 'latest.json',
    /** 通道，清单里可据此给不同通道不同版本 */
    channel: 'stable',
    /** 是否接受预发布版本 */
    allowPrerelease: false,
    /** 网络超时（毫秒）*/
    timeoutMs: 8000,
    /** 下载链接的打开方式：external=交给系统浏览器/下载器 */
    openMode: 'external',
  },
  logging: {
    level: 'info',
    /** 主进程日志保留天数（仅提示，不自动删） */
    keepDays: 30,
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 深合并：对象逐键合并，数组/标量整体替换（配置语义要可预期，不做花哨的拼接） */
function merge(base, over) {
  if (over === undefined || over === null) return clone(base);
  if (Array.isArray(over) || typeof over !== 'object') return over;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return clone(over);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : v;
  return out;
}

const isHttpUrl = (s) => /^https?:\/\/[^\s]+$/i.test(String(s ?? ''));

/**
 * 取值校验：**不抛**，只把问题列出来（配置坏掉时应用要能启动并说清楚哪里坏，
 * 而不是甩一个栈给用户）。返回 { config, problems[], warnings[] }。
 */
export function normalizeConfig(plain) {
  const problems = [];
  const warnings = [];
  const cfg = merge(DEFAULT_CONFIG, plain ?? {});

  const portOf = (v, name, allowZero = false) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < (allowZero ? 0 : 1) || n > 65535) {
      problems.push(`${name} 不是合法端口：${JSON.stringify(v)}`);
      return null;
    }
    return n;
  };

  cfg.server.port = portOf(cfg.server.port, 'server.port', true) ?? DEFAULT_CONFIG.server.port;
  cfg.mcp.httpPort = portOf(cfg.mcp.httpPort, 'mcp.httpPort') ?? DEFAULT_CONFIG.mcp.httpPort;
  cfg.mcp.bridgePort = portOf(cfg.mcp.bridgePort, 'mcp.bridgePort') ?? DEFAULT_CONFIG.mcp.bridgePort;
  if (cfg.mcp.httpPort === cfg.mcp.bridgePort) problems.push(`mcp.httpPort 与 mcp.bridgePort 不能相同（都是 ${cfg.mcp.httpPort}）`);
  if (cfg.server.port && cfg.server.port === cfg.mcp.httpPort) problems.push('server.port 与 mcp.httpPort 冲突');
  if (cfg.mcp.transport !== 'http') {
    warnings.push(`mcp.transport=${cfg.mcp.transport}：分发版只实现了 http（stdio 请直接跑 editor-mcp --stdio）`);
  }
  cfg.mcp.readyTimeoutMs = Math.max(1000, Number(cfg.mcp.readyTimeoutMs) || DEFAULT_CONFIG.mcp.readyTimeoutMs);
  cfg.update.timeoutMs = Math.max(500, Number(cfg.update.timeoutMs) || DEFAULT_CONFIG.update.timeoutMs);
  cfg.logging.keepDays = Math.max(1, Number(cfg.logging.keepDays) || DEFAULT_CONFIG.logging.keepDays);

  if (!isHttpUrl(cfg.update.baseUrl)) {
    problems.push(`update.baseUrl 必须是 http(s) 地址：${JSON.stringify(cfg.update.baseUrl)}`);
  } else {
    try {
      const u = new URL(cfg.update.baseUrl);
      if (u.username || u.password) problems.push('update.baseUrl 不允许带账号密码');
    } catch {
      problems.push(`update.baseUrl 解析失败：${cfg.update.baseUrl}`);
    }
  }
  if (typeof cfg.update.manifest !== 'string' || /^[a-z]+:/i.test(cfg.update.manifest)) {
    problems.push(`update.manifest 必须是相对文件名：${JSON.stringify(cfg.update.manifest)}`);
  }
  if (cfg.update.enabled && /example\.com/i.test(String(cfg.update.baseUrl))) {
    warnings.push(`update.baseUrl 还是示例地址（${cfg.update.baseUrl}）—— 正式分发前请换成真实地址并重新加密配置`);
  }
  if (cfg.update.openMode !== 'external') warnings.push(`update.openMode=${cfg.update.openMode}：目前只实现 external（交给系统浏览器/下载器）`);

  return { config: cfg, problems, warnings };
}

/** 找密钥；返回 { secret, source } —— source 会写进日志，方便排查"配置解不开" */
export function resolveSecretForConfig({ layout, env = process.env, explicitKey } = {}) {
  if (explicitKey) return { secret: String(explicitKey).trim(), source: 'explicit' };
  if (env.EDITOR_DESKTOP_CONFIG_KEY) return { secret: String(env.EDITOR_DESKTOP_CONFIG_KEY).trim(), source: 'env:EDITOR_DESKTOP_CONFIG_KEY' };
  const keyFileEnv = env.EDITOR_DESKTOP_CONFIG_KEY_FILE;
  if (keyFileEnv && existsSync(keyFileEnv)) return { secret: readFileSync(keyFileEnv, 'utf8').trim(), source: `env-file:${keyFileEnv}` };
  if (layout?.configKeyPath && existsSync(layout.configKeyPath)) {
    return { secret: readFileSync(layout.configKeyPath, 'utf8').trim(), source: `file:${layout.configKeyPath}` };
  }
  return { secret: null, source: null };
}

/**
 * 构建期嵌入的兜底密钥（`config/buildKey.mjs`），可能不存在。
 *
 * P0 ⑥（2026-09-28）：**删掉了对老 `buildKey.js` 的回退分支** —— 仓库与安装包里只有 `buildKey.mjs`，
 * 留一个永不命中的兼容分支只会让人以为"还有第二种形态"。真要轮换密钥：`npm run keygen` 重新生成
 * `config.key`（本地优先），或用 `npm run embed-key` 重写 `buildKey.mjs`。
 */
export async function loadEmbeddedKey({ layout, env = process.env } = {}) {
  const explicit = env.EDITOR_DESKTOP_BUILD_KEY;
  const candidates = [explicit, layout?.buildKeyPath].filter(Boolean);
  const p = candidates.find((c) => existsSync(c)) ?? candidates[0] ?? null;
  if (!p || !existsSync(p)) return { key: null, fingerprint: null, path: p ?? null };
  const mod = await import(pathToFileURL(p).href);
  return { key: mod.BUILD_CONFIG_KEY ?? null, fingerprint: mod.BUILD_KEY_FINGERPRINT ?? null, path: p };
}

/** 载入独立的加密核心（不复制实现，直接 import 那个工具文件） */
export async function loadSecureConfigCore({ layout } = {}) {
  const core = layout?.secureConfigCore;
  if (!core || !existsSync(core)) {
    throw new Error(
      `找不到独立的加密工具：${core ?? '(未解析到路径)'}。\n` +
        `dev 模式请确认 tools/secure-config/secure-config.mjs 存在；安装包请确认 resources/tools/secure-config/ 被打进去了。`,
    );
  }
  const mod = await import(pathToFileURL(core).href);
  for (const fn of ['encryptConfig', 'decryptConfig', 'checkSecretShape']) {
    if (typeof mod[fn] !== 'function') throw new Error(`加密工具缺少导出：${fn}`);
  }
  return mod;
}

/**
 * 载入配置。**永远不会因为配置坏掉而让应用起不来**：
 *   · 有 .enc 且能解开 → 用它（source: 'encrypted'）；
 *   · 有 .enc 但解不开 → 记 error、退回默认值（source: 'defaults'，problems 里说明原因）；
 *   · 只有明文 app-config.json（dev 便利）→ 用它并**明确警告**这是明文；
 *   · 什么都没有 → 默认值。
 */
export async function loadAppConfig({ layout, env = process.env, logger = null, explicitKey, configPath } = {}) {
  const encPath = configPath ?? layout?.configEncPath;
  const plainPath = layout?.configPlainPath;
  const problems = [];
  const warnings = [];
  let plain = null;
  let source = 'defaults';
  let keyInfo = { secret: null, source: null };
  let embedded = { key: null, fingerprint: null, path: layout?.buildKeyPath ?? null };

  try {
    embedded = await loadEmbeddedKey({ layout, env });
  } catch (e) {
    warnings.push(`构建期密钥模块读取失败：${e instanceof Error ? e.message : String(e)}`);
  }

  if (encPath && existsSync(encPath)) {
    const core = await loadSecureConfigCore({ layout });
    keyInfo = resolveSecretForConfig({ layout, env, explicitKey });
    const secret = keyInfo.secret ?? embedded.key;
    const usedSource = keyInfo.secret ? keyInfo.source : embedded.key ? `build:${embedded.path}` : null;
    if (!secret) {
      problems.push(`配置文件存在（${encPath}）但找不到密钥：环境变量 EDITOR_DESKTOP_CONFIG_KEY / config.key / 构建期 buildKey.mjs 都没有`);
      source = 'defaults';
    } else {
      try {
        plain = core.decryptConfig(readFileSync(encPath, 'utf8'), secret);
        source = 'encrypted';
        keyInfo = { secret: null, source: usedSource };
      } catch (e) {
        problems.push(`配置解密失败（${e instanceof Error ? e.message : String(e)}）：密钥与密文不配套（换过 key 却没重新加密配置？）`);
        source = 'defaults';
        keyInfo = { secret: null, source: usedSource };
      }
    }
  } else if (plainPath && existsSync(plainPath)) {
    try {
      plain = JSON.parse(readFileSync(plainPath, 'utf8'));
      source = 'plain';
      warnings.push(`使用的是**明文**配置 ${plainPath}（仅开发便利；分发版请用 secure-config 加密成 app-config.enc）`);
    } catch (e) {
      problems.push(`明文配置解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    // 既没有 .enc 也没有明文：先用默认值起（端口 0 = 自动挑），提示怎么生成配置
    warnings.push(`未找到配置文件（期望 ${encPath}）：本次用默认值启动，更新接口地址为示例地址`);
  }

  const { config, problems: p2, warnings: w2 } = normalizeConfig(plain);
  const result = {
    config,
    meta: {
      source,
      configPath: source === 'plain' ? plainPath : encPath,
      keySource: keyInfo.source,
      keyFingerprint: embedded.fingerprint,
      buildKeyPath: embedded.path,
      problems: [...problems, ...p2],
      warnings: [...warnings, ...w2],
      loadedAt: new Date().toISOString(),
    },
  };

  if (logger) {
    logger.info(`配置载入：来源=${source} 路径=${result.meta.configPath ?? '(无)'} 密钥来源=${result.meta.keySource ?? '(无)'} 指纹=${result.meta.keyFingerprint ?? '(无)'}`);
    for (const w of result.meta.warnings) logger.warn(`配置提醒：${w}`);
    for (const p of result.meta.problems) logger.error(`配置问题：${p}`);
  }
  return result;
}

/** 给界面/IPC 的**脱敏**视图：绝不回传密钥，只回传"从哪来" */
export function redactConfig({ config, meta }) {
  return {
    title: config.app.title,
    server: { port: config.server.port, host: config.server.host },
    mcp: { ...config.mcp },
    update: { ...config.update, baseUrl: maskUrl(config.update.baseUrl) },
    updateBaseUrlMasked: maskUrl(config.update.baseUrl),
    meta: { ...meta, keySource: meta.keySource ?? null },
  };
}

/** 更新地址在日志/界面里默认打码（保留能认出是哪台服务器的部分） */
export function maskUrl(url) {
  try {
    const u = new URL(String(url));
    const seg = u.pathname.split('/').filter(Boolean);
    return `${u.protocol}//${u.host}/${seg.length ? seg[0].slice(0, 2) + '***' : ''}`;
  } catch {
    return '(无法解析)';
  }
}

export const _internals = { merge, isHttpUrl };
