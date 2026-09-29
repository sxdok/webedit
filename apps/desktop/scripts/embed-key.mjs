/**
 * 一键"生成密钥 → 加密配置 → 把密钥嵌进构建产物"，让分发版**开箱即用**。
 *
 * 为什么要有这个脚本（而不是让打包的人手敲三条命令）：
 *   · 三条命令的密钥必须**完全一致**，敲错一个字符就变成"配置解不开、只能兜底启动"；
 *   · 换更新地址时最怕漏掉 `embed-key`，于是配置文件换了、包里的密钥还是旧的；
 *   这个脚本把三件事绑在一起，并把**指纹**打出来，出问题时一眼能对上。
 *
 * 用法（在 apps/desktop 下）：
 *   node scripts/embed-key.mjs                      # 已有 config/config.key 就复用，否则新生成
 *   node scripts/embed-key.mjs --rotate             # 强制换新密钥（会重新加密配置）
 *   node scripts/embed-key.mjs --in config/app-config.example.json --key-file config/config.key
 *
 * ⚠ 换密钥后必须重新加密配置文件，并把 config/config.key 一起更新；分发出去的包要重打。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, '..');
const REPO_ROOT = resolve(APP_DIR, '..', '..');
const TOOL = join(REPO_ROOT, 'tools', 'secure-config', 'secure-config.mjs');

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const rotate = args.includes('--rotate');

const configDir = resolve(APP_DIR, argOf('--config-dir', 'config'));
const inPath = resolve(APP_DIR, argOf('--in', join('config', 'app-config.example.json')));
/**
 * ★P3-M8：明文密钥的**缺省位置**移到 `<仓库根>/var/keys/config.key`（"运行数据"集中到 var/，
 * 不跟源码混放；它本来就不在版本库里）。仍然优先复用**旧位置** `config/config.key`（老检出、以及
 * 已经生成过密钥的机器），所以要读的时候按"新 → 旧"找；生成时写新位置。
 */
const legacyKeyPath = resolve(APP_DIR, 'config', 'config.key');
const keyPath = resolve(APP_DIR, argOf('--key-file', join(REPO_ROOT, 'var', 'keys', 'config.key')));
const existingKeyPath = [keyPath, legacyKeyPath].find((p) => existsSync(p));
const encPath = resolve(APP_DIR, argOf('--out', join('config', 'app-config.enc')));
const buildKeyPath = resolve(APP_DIR, argOf('--build-key', join('config', 'buildKey.mjs')));

if (!existsSync(TOOL)) {
  process.stderr.write(`✗ 找不到独立的加密工具：${TOOL}\n`);
  process.exit(2);
}

const run = (a) => execFileSync(process.execPath, [TOOL, ...a], { stdio: 'inherit' });

// ① 密钥：已有就复用（--rotate 强制换新）
let key;
if (!rotate && existingKeyPath) {
  key = readFileSync(existingKeyPath, 'utf8').trim();
  process.stdout.write(`· 复用已有密钥：${existingKeyPath}${existingKeyPath === keyPath ? '' : '（旧位置，建议下次换到 var/keys）'}\n`);
} else {
  process.stdout.write(`· 生成新密钥：${keyPath}\n`);
  run(['keygen', '--out', keyPath]);
  key = readFileSync(keyPath, 'utf8').trim();
}

// ② 加密配置（明文源可能是 example，也可能是运维自己维护的那份）
if (!existsSync(inPath)) {
  process.stderr.write(`✗ 找不到明文配置：${inPath}\n`);
  process.exit(2);
}
process.stdout.write(`· 加密配置：${inPath} → ${encPath}\n`);
run(['encrypt', inPath, '--out', encPath, '--key', key]);

// ③ 把密钥嵌进构建产物（分发版找不到 config.key 时用它兜底）
process.stdout.write(`· 嵌入构建期密钥：${buildKeyPath}\n`);
run(['embed-key', key, '--out', buildKeyPath]);

// ④ 自检：验证"用这份密钥确实能解开这份密文"
process.stdout.write('· 验证：\n');
run(['verify', encPath, '--key', key]);

process.stdout.write(`\n完成。配置目录：${configDir}\n`);
process.stdout.write('⚠ 换更新地址的正确姿势：改 app-config.example.json（或你自己的明文）里的 update.baseUrl → 重跑本脚本 → 重新打包。\n');
process.stdout.write('⚠ 这份密钥随包分发，只能算"防误改"，不是安全边界 —— 别把真正的秘密写进配置。\n');

// 顺手把"用了哪个明文源"记下来，方便下一个人知道该改哪个文件
writeFileSync(
  join(configDir, 'README.txt'),
  [
    '本目录由 apps/desktop/scripts/embed-key.mjs 生成/维护：',
    '',
    `· ${inPath}`,
    '    明文源（改这里）。update.baseUrl / mcp.httpPort 等都在里面。',
    `· ${keyPath}`,
    '    AES-256-GCM 密钥（base64 的 32 字节）。随包分发，不是秘密。',
    `· ${encPath}`,
    '    **应用真正读的加密配置**。换地址 = 重新生成这个文件并替换掉。',
    `· ${buildKeyPath}`,
    '    构建期兜底密钥（应用找不到 config.key 时用它）。',
    '',
    '重新生成：node scripts/embed-key.mjs [--rotate]',
    `手动验证：node ${TOOL} verify ${encPath} --key-file ${keyPath}`,
    '',
  ].join('\n'),
  'utf8',
);
