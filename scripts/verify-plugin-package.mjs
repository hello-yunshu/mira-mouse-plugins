// SPDX-License-Identifier: AGPL-3.0-or-later
// 第 3.8 节补充：在 registry 写入前验证插件包的真实 Ed25519 签名。
//
// 背景：publish-registry.yml 原本只校验 .mira-plugin 的 SHA-256（资产完整性），
// 但未校验包内 META-INF/signature.ed25519 是否由受信任的 publisher 密钥签发。
// 这意味着未签名或被篡改的插件包可能进入 registry，仅由宿主安装时
// extract_package(..., require_signature=true) 兜底。
//
// 本脚本补齐此缺口：在 update-registry.mjs 调用前，对每个资产执行：
//   1. 从 ZIP 中提取 plugin.json / checksums.json / META-INF/signature.ed25519
//   2. 在 trusted-keys.json 中查找 manifest.publisherKeyId 对应的公钥
//   3. 构造签名消息：canonical_json(plugin.json) + b'\n' + canonical_json(checksums.json)
//   4. 用 Ed25519 公钥验证签名（与 runtime package.rs extract_package 一致）
//
// 退出码：
//   0 — 验证通过，stdout 输出 manifest JSON
//   1 — 验证失败（签名缺失、密钥未受信任、签名无效等）
//   2 — 用法错误
//
// 用法：node scripts/verify-plugin-package.mjs <package.mira-plugin> [trusted-keys.json]
import { createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const defaultTrustedKeysPath = join(root, 'registry/trusted-keys.json');

/**
 * Canonical JSON：递归排序键，无空格，UTF-8。
 * 与 runtime package.rs canonical_json / verify-registry.mjs 使用相同形式。
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

class VerificationError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'VerificationError';
  }
}

/**
 * 从 trusted-keys.json 查找 keyId 对应的 Ed25519 公钥。
 * 与 verify-registry.mjs lookupActiveKey 一致，但不检查 signedAt
 * （插件包签名没有 signedAt 字段，密钥 active 状态由当前时间隐式保证）。
 */
function lookupTrustedKey(trustedKeys, keyId) {
  if (!Array.isArray(trustedKeys.keys)) {
    throw new VerificationError('trusted-keys-malformed', 'trusted-keys.json missing keys array');
  }
  const key = trustedKeys.keys.find((k) => k.keyId === keyId);
  if (!key) {
    throw new VerificationError(
      'key-not-trusted',
      `publisherKeyId ${keyId} not found in trusted-keys.json`,
    );
  }
  if (key.algorithm && key.algorithm !== 'ed25519') {
    throw new VerificationError(
      'unsupported-algorithm',
      `keyId ${keyId} algorithm ${key.algorithm} not supported (only ed25519)`,
    );
  }
  if (key.revokedAt) {
    throw new VerificationError(
      'key-revoked',
      `keyId ${keyId} revokedAt ${key.revokedAt}: ${key.revocationReason || 'no reason given'}`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(key.publicKey)) {
    throw new VerificationError(
      'key-malformed',
      `keyId ${keyId} publicKey must be 32-byte lowercase hex (64 chars), got: ${key.publicKey}`,
    );
  }
  return key;
}

/**
 * 从 raw 32-byte Ed25519 公钥构造 Node Crypto PublicKey。
 * 与 verify-registry.mjs publicKeyFromRaw 一致。
 */
function publicKeyFromRaw(rawHex) {
  const raw = Buffer.from(rawHex, 'hex');
  if (raw.length !== 32) {
    throw new VerificationError(
      'key-malformed',
      `Ed25519 public key must be 32 bytes, got ${raw.length}`,
    );
  }
  // SPKI DER prefix for Ed25519 public key: 302a300506032b6570032100 + 32 bytes
  const spkiDer = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    raw,
  ]);
  return createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
}

/**
 * 从 ZIP 中提取指定条目为 Buffer。
 * 使用系统 unzip -p 命令（macOS/Linux/CI 均预装）。
 */
function extractEntry(zipPath, entryName) {
  try {
    const stdout = execFileSync('unzip', ['-p', zipPath, entryName], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    if (err.status === 11 || /not found/i.test(err.message || '')) {
      // unzip 返回非零表示条目不存在
      return null;
    }
    throw new VerificationError(
      'extract-failed',
      `failed to extract ${entryName} from ${zipPath}: ${err.message}`,
    );
  }
}

/**
 * 验证插件包的 Ed25519 签名。
 * 签名消息 = canonical_json(plugin.json) + b'\n' + canonical_json(checksums.json)
 * 与 runtime package.rs extract_package 的验签逻辑一致。
 */
export async function verifyPluginPackage(packagePath, trustedKeysPath) {
  // 1. 提取 ZIP 条目
  const manifestBytes = extractEntry(packagePath, 'plugin.json');
  if (!manifestBytes || manifestBytes.length === 0) {
    throw new VerificationError('missing-manifest', `plugin.json not found in ${packagePath}`);
  }
  const checksumsBytes = extractEntry(packagePath, 'checksums.json');
  if (!checksumsBytes || checksumsBytes.length === 0) {
    throw new VerificationError('missing-checksums', `checksums.json not found in ${packagePath}`);
  }
  const signatureBytes = extractEntry(packagePath, 'META-INF/signature.ed25519');
  if (!signatureBytes || signatureBytes.length === 0) {
    throw new VerificationError(
      'missing-signature',
      `META-INF/signature.ed25519 not found in ${packagePath} (plugin package must be signed)`,
    );
  }
  if (signatureBytes.length !== 64) {
    throw new VerificationError(
      'signature-malformed',
      `META-INF/signature.ed25519 must be 64 bytes (Ed25519), got ${signatureBytes.length}`,
    );
  }

  // 2. 解析 manifest，获取 publisherKeyId
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const publisherKeyId = manifest.publisherKeyId;
  if (!publisherKeyId) {
    throw new VerificationError(
      'missing-publisher-key',
      'plugin.json missing publisherKeyId (unsigned plugin cannot be published)',
    );
  }
  if (String(publisherKeyId).startsWith('TEST-ONLY')) {
    throw new VerificationError(
      'test-only-key',
      `publisherKeyId=${publisherKeyId} is a test key (production registry requires production key)`,
    );
  }

  // 3. 在 trusted-keys.json 中查找公钥
  const trustedKeys = JSON.parse(await readFile(trustedKeysPath, 'utf8'));
  const key = lookupTrustedKey(trustedKeys, publisherKeyId);

  // 4. 构造签名消息：canonical_json(manifest) + b'\n' + canonical_json(checksums)
  const manifestObj = JSON.parse(manifestBytes.toString('utf8'));
  const checksumsObj = JSON.parse(checksumsBytes.toString('utf8'));
  const message = Buffer.concat([
    Buffer.from(canonicalJson(manifestObj), 'utf8'),
    Buffer.from('\n'),
    Buffer.from(canonicalJson(checksumsObj), 'utf8'),
  ]);

  // 5. 验证 Ed25519 签名
  const publicKey = publicKeyFromRaw(key.publicKey);
  const valid = verify(null, message, publicKey, signatureBytes);
  if (!valid) {
    throw new VerificationError(
      'invalid-signature',
      `Ed25519 signature verification failed for publisherKeyId ${publisherKeyId} (signature does not match plugin.json + checksums.json)`,
    );
  }

  return {
    ok: true,
    pluginId: manifest.pluginId,
    version: manifest.version,
    publisherKeyId,
    evidence: manifest.evidence,
    signatureVerified: true,
    publicKey: key.publicKey,
  };
}

async function main() {
  const packagePath = process.argv[2];
  const trustedKeysPath = process.argv[3] ? process.argv[3] : defaultTrustedKeysPath;

  if (!packagePath) {
    console.error('usage: verify-plugin-package.mjs <package.mira-plugin> [trusted-keys.json]');
    process.exit(2);
  }

  try {
    const result = await verifyPluginPackage(packagePath, trustedKeysPath);
    console.log(`plugin signature verified: ${packagePath}`);
    console.log(`  pluginId:       ${result.pluginId}`);
    console.log(`  version:        ${result.version}`);
    console.log(`  publisherKeyId: ${result.publisherKeyId}`);
    console.log(`  evidence:       ${result.evidence}`);
    console.log(`  pubkey:         ${result.publicKey}`);
    // stdout 最后一行输出 manifest JSON，供 update-registry.mjs 消费
    const manifestBytes = extractEntry(packagePath, 'plugin.json');
    process.stdout.write(manifestBytes);
  } catch (err) {
    if (err instanceof VerificationError) {
      console.error(`verification failed: ${err.code}`);
      console.error(`  ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { VerificationError, canonicalJson, lookupTrustedKey, publicKeyFromRaw, extractEntry };
