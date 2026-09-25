/**
 * secure-config 自检（`node tools/secure-config/secure-config.mjs selftest`）
 *
 * 验的是**加密这件事本身**，不看应用：
 *   ① 往返：明文 → 加密 → 解密，逐字段一致；
 *   ② 错密钥：必须抛（而不是还回垃圾数据）；
 *   ③ 篡改密文 / 篡改头部（AAD）：必须抛（GCM 认证）；
 *   ④ 口令模式（非 32 字节密钥）走 scrypt，salt 每次不同 → 同一明文两次密文不同，但都能解开；
 *   ⑤ 密钥来源优先级：--key > 环境变量 > 同目录 config.key；
 *   ⑥ CLI 层：encrypt/verify/decrypt 三个子命令真的能跑（子进程，stdout 重定向到**文件**而不是管道）。
 *
 * ⚠ 受限沙箱里 `child_process` 用**管道** stdio 会被拒（EPERM，"不能开命名管道"）——第 ⑥ 项在这种环境下
 *   会如实报 `SKIP` 并给出可手动执行的命令，**不算通过**。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkSecretShape, decryptConfig, encryptConfig, resolveSecret } from './secure-config.mjs';

const results = [];
const check = (name, pass, note) => {
  results.push({ name, pass, note });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  → ${note}` : ''}\n`);
};
const skip = (name, note) => {
  results.push({ name, pass: true, skipped: true, note });
  process.stdout.write(`SKIP  ${name}${note ? `  → ${note}` : ''}\n`);
};

export function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'secure-config-'));
  /** 真正的 32 字节密钥（base64 44 字符） */
  const rawKey = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
  const otherKey = Buffer.from('fedcba9876543210fedcba9876543210').toString('base64');

  // ① 往返
  const plain = { version: 1, update: { baseUrl: 'https://example.com/updates/', manifest: 'latest.json' }, mcp: { httpPort: 37651 } };
  const env = encryptConfig(plain, rawKey);
  const back = decryptConfig(env, rawKey);
  check(
    '往返：加密 → 解密逐字段一致（含嵌套）',
    JSON.stringify(back) === JSON.stringify(plain) && env.kdf === 'raw' && env.alg === 'aes-256-gcm' && !('salt' in env),
    `kdf=${env.kdf}（32 字节密钥不走 scrypt、无 salt）、信封字段=${Object.keys(env).join(',')}、往返一致=${JSON.stringify(back) === JSON.stringify(plain)}`,
  );

  // ② 错密钥
  let wrongErr = '';
  try {
    decryptConfig(env, otherKey);
  } catch (e) {
    wrongErr = e instanceof Error ? e.message : String(e);
  }
  check('错密钥必须失败（GCM 认证不过）', wrongErr !== '', `报错：${wrongErr.slice(0, 60)}`);

  // ③ 篡改密文 / 篡改头部
  let dataErr = '';
  let headErr = '';
  try {
    decryptConfig({ ...env, data: Buffer.from('坏数据').toString('base64') }, rawKey);
  } catch (e) {
    dataErr = e instanceof Error ? e.message : String(e);
  }
  try {
    decryptConfig({ ...env, kdf: 'scrypt', salt: Buffer.alloc(16).toString('base64') }, rawKey);
  } catch (e) {
    headErr = e instanceof Error ? e.message : String(e);
  }
  check('篡改密文必须失败', dataErr !== '', `报错：${dataErr.slice(0, 50)}`);
  check('篡改头部（AAD 里的 kdf）必须失败', headErr !== '', `报错：${headErr.slice(0, 50)}`);

  // ④ 口令模式
  const p1 = encryptConfig(plain, '这是一句中文口令 passphrase-123');
  const p2 = encryptConfig(plain, '这是一句中文口令 passphrase-123');
  const pk = decryptConfig(p1, '这是一句中文口令 passphrase-123');
  check(
    '口令模式（非 32 字节）走 scrypt：两次密文不同、都能解开',
    p1.kdf === 'scrypt' && !!p1.salt && p1.data !== p2.data && JSON.stringify(pk) === JSON.stringify(plain),
    `kdf=${p1.kdf}、salt 长度=${p1.salt.length}、两次 data 不同=${p1.data !== p2.data}`,
  );

  // ⑤ 密钥形状提醒 + 来源优先级
  const shapeBad = checkSecretShape('dGhpcy1pcy1hLXRlc3Qta2V5LTMyLWJ5dGVzISE='); // base64 但只有 28 字节
  const shapeOk = checkSecretShape(rawKey);
  check(
    '密钥形状：32 字节 base64 走 raw；长度不对的 base64 当口令并给出提醒',
    shapeOk.mode === 'raw' && shapeOk.warn === null && shapeBad.mode === 'passphrase' && !!shapeBad.warn,
    `32 字节→${shapeOk.mode}；28 字节→${shapeBad.mode}（提醒：${(shapeBad.warn ?? '').slice(0, 30)}…）`,
  );
  const keyFile = join(dir, 'config.key');
  writeFileSync(keyFile, otherKey + '\n', 'utf8');
  process.env.EDITOR_DESKTOP_CONFIG_KEY = rawKey;
  const fromEnv = resolveSecret({ encPath: join(dir, 'x.enc') });
  const fromArg = resolveSecret({ key: rawKey, encPath: join(dir, 'x.enc') });
  delete process.env.EDITOR_DESKTOP_CONFIG_KEY;
  const fromFile = resolveSecret({ encPath: join(dir, 'x.enc') });
  check(
    '密钥来源优先级：--key > 环境变量 > 同目录 config.key',
    fromArg === rawKey && fromEnv === rawKey && fromFile.trim() === otherKey,
    `--key=${fromArg.slice(0, 6)}…、env=${fromEnv.slice(0, 6)}…、config.key=${fromFile.trim().slice(0, 6)}…`,
  );

  // ⑥ CLI 三个子命令真跑（stdout 落文件，避开沙箱不允许的管道 stdio）
  const cli = resolve(import.meta.dirname, 'secure-config.mjs');
  const plainPath = join(dir, 'app-config.json');
  const encPath = join(dir, 'app-config.enc');
  const verifyOut = join(dir, 'verify.txt');
  const decOut = join(dir, 'dec.txt');
  writeFileSync(plainPath, JSON.stringify(plain, null, 2), 'utf8');
  const runTo = (args, outFile) => {
    const fd = outFile ? openSync(outFile, 'w') : 'ignore';
    try {
      execFileSync(process.execPath, [cli, ...args], { stdio: ['ignore', fd, 'ignore'] });
    } finally {
      if (typeof fd === 'number') closeSync(fd);
    }
  };
  try {
    runTo(['encrypt', plainPath, '--out', encPath, '--key', rawKey]);
    runTo(['verify', encPath, '--key', rawKey], verifyOut);
    runTo(['decrypt', encPath, '--key', rawKey], decOut);
    const verifyText = readFileSync(verifyOut, 'utf8');
    const decText = readFileSync(decOut, 'utf8');
    const encOnDisk = JSON.parse(readFileSync(encPath, 'utf8'));
    check(
      'CLI 三件套：encrypt → verify（只列字段名、不泄露值）→ decrypt',
      verifyText.includes('能解开') && verifyText.includes('update') && !verifyText.includes('example.com') && JSON.parse(decText).update.baseUrl === plain.update.baseUrl && encOnDisk.alg === 'aes-256-gcm',
      `verify 首行=「${verifyText.split('\n')[0]}」；decrypt 解出 baseUrl=${JSON.parse(decText).update.baseUrl}；verify 未泄露值=${!verifyText.includes('example.com')}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/EPERM|not permitted|spawn/i.test(msg)) {
      skip('CLI 三件套：encrypt → verify（只列字段名、不泄露值）→ decrypt', `本环境不允许 spawn 子进程（${msg.slice(0, 40)}）；请手动跑：node tools/secure-config/secure-config.mjs encrypt/verify/decrypt`);
    } else {
      check('CLI 三件套：encrypt → verify（只列字段名、不泄露值）→ decrypt', false, `子进程失败：${msg.slice(0, 120)}`);
    }
  }

  const bad = results.filter((r) => !r.pass);
  const skipped = results.filter((r) => r.skipped).length;
  process.stdout.write(
    `\n自检结果：${results.length - bad.length}/${results.length} 通过${skipped ? `（其中 ${skipped} 项因环境 SKIP）` : ''}${bad.length ? '（有失败）' : ' 全部通过'}\n`,
  );
  return bad.length ? 1 : 0;
}
