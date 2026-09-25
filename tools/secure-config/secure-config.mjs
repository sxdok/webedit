#!/usr/bin/env node
/**
 * secure-config —— **独立的加密配置工具 + 加密核心**（零依赖，纯 Node 内置模块）
 *
 * 为什么单独剥离（用户 2026-09-25：「加密工具单独剥离」）：
 *   · 它是**给厂商/打包者用的**命令行工具（生成密钥、加密配置文件、验证、把密钥嵌进构建产物），
 *     业务代码只依赖它的 `decryptConfig()` 一个函数；
 *   · 分发版要读的那份 `app-config.enc` 由本工具产出，**换更新地址 = 重新加密一份文件**，不用改代码、不用重新打包前端；
 *   · 它是一个文件、没有依赖，可以单独拷走/单独升级，也不会把加密逻辑散到应用各处。
 *
 * ⚠ **威胁模型（别把它当安全边界）**：应用要能自己解密，所以密钥必然随包分发（`buildKey.js` 里那份）
 *   或放在用户机器上 —— 拿到安装包的人**总能**解出配置。它防的是"用户顺手改坏/一眼看穿接口地址"，
 *   不是"有能力的攻击者"。**真正的秘密（token、私钥）不要放进来。**
 *
 * 文件格式（JSON 信封，自描述、带版本，方便以后换算法）：
 *   { v:1, alg:'aes-256-gcm', kdf:'raw'|'scrypt', salt?, n?, r?, p?, iv, tag, data }   ← 全是 base64
 *   · AAD = `v|alg|kdf`，所以改头部字段也会校验失败；
 *   · `--key` 传 32 字节 base64 → 直接当 AES 密钥（kdf:raw）；传别的字符串 → 当口令走 scrypt。
 *
 * CLI：
 *   node tools/secure-config/secure-config.mjs keygen [--out key.txt]
 *   node tools/secure-config/secure-config.mjs encrypt <in.json> [--out out.enc] [密钥来源]
 *   node tools/secure-config/secure-config.mjs decrypt <in.enc>  [--out out.json] [密钥来源]
 *   node tools/secure-config/secure-config.mjs verify  <in.enc> [密钥来源]     # 只打印字段名，不打印值
 *   node tools/secure-config/secure-config.mjs embed-key <key> --out <buildKey.js>
 *   node tools/secure-config/secure-config.mjs selftest
 *
 * 密钥来源（优先级）：`--key` / `--key-file` / `--key-env <NAME>` / 环境变量 EDITOR_DESKTOP_CONFIG_KEY
 *                    / 与 .enc 同目录的 `config.key`
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_FORMAT_VERSION = 1;
const AAD_OF = (v, alg, kdf) => Buffer.from(`${v}|${alg}|${kdf}`, 'utf8');

/**
 * 判断传进来的"密钥"是 32 字节密钥还是口令：
 *   · 合法的 base64/base64url 且解出来正好 32 字节 → 直接当 AES-256 密钥（kdf:raw）；
 *   · 其它（包括"是 base64 但长度不对"）→ 当口令走 scrypt，并给一句提醒（长度不对常是复制少了字符）。
 */
export function checkSecretShape(secret) {
  const t = String(secret ?? '').trim();
  if (!/^[A-Za-z0-9+/=_-]{40,}$/.test(t)) return { mode: 'passphrase', warn: null };
  let buf = null;
  try {
    buf = t.includes('-') || t.includes('_') ? Buffer.from(t, 'base64url') : Buffer.from(t, 'base64');
  } catch {
    buf = null;
  }
  if (buf && buf.length === 32) return { mode: 'raw', warn: null };
  return {
    mode: 'passphrase',
    warn: `密钥看着像 base64 但解出来是 ${buf ? buf.length : '?'} 字节（不是 32）—— 按**口令**处理（scrypt）。真要当 AES 密钥用请给 32 字节的 base64。`,
  };
}

const looksLikeRawKey = (s) => checkSecretShape(s).mode === 'raw';

function deriveKey(secret, kdf, salt, params) {
  if (kdf === 'raw') return Buffer.from(secret.trim(), secret.includes('-') || secret.includes('_') ? 'base64url' : 'base64');
  const n = params?.n ?? 16384;
  const r = params?.r ?? 8;
  const p = params?.p ?? 1;
  return scryptSync(secret, salt, 32, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
}

/** 明文对象 → 加密信封对象（纯函数，测试可以直接调） */
export function encryptConfig(plain, secret) {
  const raw = looksLikeRawKey(secret);
  const kdf = raw ? 'raw' : 'scrypt';
  const salt = raw ? Buffer.alloc(0) : randomBytes(16);
  const iv = randomBytes(12);
  const params = raw ? undefined : { n: 16384, r: 8, p: 1 };
  const key = deriveKey(secret, kdf, salt, params);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD_OF(CONFIG_FORMAT_VERSION, 'aes-256-gcm', kdf));
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(plain), 'utf8')), cipher.final()]);
  return {
    v: CONFIG_FORMAT_VERSION,
    alg: 'aes-256-gcm',
    kdf,
    ...(raw ? {} : { salt: salt.toString('base64'), ...params }),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** 加密信封对象 → 明文对象；密钥不对/被改动会抛（GCM 认证失败） */
export function decryptConfig(envelope, secret) {
  const env = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
  if (!env || env.v !== CONFIG_FORMAT_VERSION) throw new Error(`配置文件版本不认识：${env?.v}（本工具支持 ${CONFIG_FORMAT_VERSION}）`);
  if (env.alg !== 'aes-256-gcm') throw new Error(`不支持的算法：${env.alg}`);
  const salt = env.salt ? Buffer.from(env.salt, 'base64') : Buffer.alloc(0);
  const key = deriveKey(secret, env.kdf, salt, env);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  decipher.setAAD(AAD_OF(env.v, env.alg, env.kdf));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}

/** 从各处找密钥（命令行 > 环境变量 > 同目录 config.key） */
export function resolveSecret({ key, keyFile, keyEnv, encPath } = {}) {
  if (key) return key.trim();
  if (keyFile && existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
  const envName = keyEnv || 'EDITOR_DESKTOP_CONFIG_KEY';
  if (process.env[envName]) return String(process.env[envName]).trim();
  if (encPath) {
    const side = join(dirname(resolve(encPath)), 'config.key');
    if (existsSync(side)) return readFileSync(side, 'utf8').trim();
  }
  return null;
}

/* ══════════════════ CLI ══════════════════ */

const USAGE = `secure-config —— 加密配置工具（独立、零依赖）

  keygen   [--out key.txt]                        生成 32 字节密钥（base64）
  encrypt  <in.json> [--out out.enc] [密钥来源]    明文 JSON → 加密配置
  decrypt  <in.enc>  [--out out.json] [密钥来源]   解密回来（人看）
  verify   <in.enc>  [密钥来源]                    验证能不能解开 + 列出字段名（不打印值）
  embed-key <key> --out <buildKey.js>             把密钥写成构建期模块（分发版兜底密钥）
  selftest                                        自检（往返/错密钥/被篡改/口令模式）

密钥来源：--key <b64|口令> | --key-file <f> | --key-env <NAME> | 环境变量 EDITOR_DESKTOP_CONFIG_KEY | 同目录 config.key`;

function argOf(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  const keyOpts = { key: argOf(args, '--key'), keyFile: argOf(args, '--key-file'), keyEnv: argOf(args, '--key-env') };

  if (cmd === 'keygen') {
    const out = argOf(args, '--out');
    const k = randomBytes(32).toString('base64');
    if (out) {
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(out, k + '\n', 'utf8');
      process.stdout.write(`已写入密钥：${resolve(out)}\n`);
    }
    process.stdout.write(k + '\n');
    return 0;
  }

  if (cmd === 'embed-key') {
    const k = args[0];
    const out = argOf(args, '--out');
    if (!k || !out) {
      process.stderr.write('用法：embed-key <key> --out <buildKey.js>\n');
      return 2;
    }
    const body =
      `/**\n * 构建期兜底密钥（由 tools/secure-config 的 embed-key 生成；⚠ 随包分发 = 只能算"防误改"，不是安全边界）\n` +
      ` * 想换密钥：重新 keygen → embed-key → 用新密钥重新加密 app-config.enc。\n */\n` +
      `export const BUILD_CONFIG_KEY = '${k.trim()}';\n` +
      `/** 这份密钥的指纹（换密钥时一眼能看出配置是不是配套的） */\n` +
      `export const BUILD_KEY_FINGERPRINT = '${createHash('sha256').update(k.trim()).digest('hex').slice(0, 12)}';\n`;
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, body, 'utf8');
    process.stdout.write(`已写入构建期密钥模块：${resolve(out)}（指纹 ${createHash('sha256').update(k.trim()).digest('hex').slice(0, 12)}）\n`);
    return 0;
  }

  if (cmd === 'encrypt') {
    const inPath = args[0];
    if (!inPath) {
      process.stderr.write('用法：encrypt <in.json> [--out out.enc] [密钥来源]\n');
      return 2;
    }
    const out = argOf(args, '--out') || inPath.replace(/\.json$/i, '') + '.enc';
    const secret = resolveSecret({ ...keyOpts, encPath: out });
    if (!secret) {
      process.stderr.write('找不到密钥：用 --key/--key-file/--key-env，或设 EDITOR_DESKTOP_CONFIG_KEY，或在输出目录放 config.key\n');
      return 2;
    }
    const plain = JSON.parse(readFileSync(inPath, 'utf8'));
    const shape = checkSecretShape(secret);
    if (shape.warn) process.stderr.write(`⚠ ${shape.warn}\n`);
    const env = encryptConfig(plain, secret);
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(env, null, 2) + '\n', 'utf8');
    process.stdout.write(`已加密：${inPath} → ${resolve(out)}（kdf=${env.kdf}，字段：${Object.keys(plain).join(', ')}）\n`);
    return 0;
  }

  if (cmd === 'decrypt' || cmd === 'verify') {
    const inPath = args[0];
    if (!inPath) {
      process.stderr.write(`用法：${cmd} <in.enc> [密钥来源]\n`);
      return 2;
    }
    const secret = resolveSecret({ ...keyOpts, encPath: inPath });
    if (!secret) {
      process.stderr.write('找不到密钥（同上）\n');
      return 2;
    }
    try {
      const plain = decryptConfig(readFileSync(inPath, 'utf8'), secret);
      if (cmd === 'verify') {
        process.stdout.write(`✓ 能解开：${resolve(inPath)}\n字段：${Object.keys(plain).join(', ')}\n`);
        return 0;
      }
      const out = argOf(args, '--out');
      if (out) {
        writeFileSync(out, JSON.stringify(plain, null, 2) + '\n', 'utf8');
        process.stdout.write(`已解密写出：${resolve(out)}\n`);
      }
      process.stdout.write(JSON.stringify(plain, null, 2) + '\n');
      return 0;
    } catch (e) {
      process.stderr.write(`✗ 解不开：${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }

  if (cmd === 'selftest') {
    const { runSelfTest } = await import('./selftest.mjs');
    return runSelfTest();
  }

  process.stderr.write(`不认识的命令：${cmd}\n\n${USAGE}\n`);
  return 2;
}

// 只有"直接当命令跑"时才进 CLI；被 import 时只导出加密核心
const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`出错了：${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    },
  );
}
