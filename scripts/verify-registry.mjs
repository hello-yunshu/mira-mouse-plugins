// SPDX-License-Identifier: AGPL-3.0-or-later
// 第 3.8 节：验证 registry/index.json 的真实 Ed25519 detached signature。
//
// 验证流程：
//   1. 读取 registry/index.json 和 registry/trusted-keys.json
//   2. 检查 signature 结构完整性（keyId、algorithm、signedAt、payloadSha、value）
//   3. 计算 canonical payload（排除 signature 字段）的 sha256，与 signature.payloadSha 比对
//   4. 在 trusted-keys.json 中查找 keyId
//   5. 检查 key 在 signedAt 时是 active 的（key rotation 支持）
//      - activatedAt <= signedAt
//      - revokedAt == null 或 revokedAt > signedAt
//   6. 用公钥验证 Ed25519 签名（签名内容为 payloadSha 字节）
//   7. 对每个 entry，重新计算 entrySha 并验证一致性
//
// 退出码：
//   0 = 验证通过
//   1 = 验证失败（签名无效、密钥已撤销、payload 篡改等）
//   2 = 用法错误
//
// 用法：node scripts/verify-registry.mjs [registry.json] [trusted-keys.json]
//      默认 registry.json 为 registry/index.json
//      默认 trusted-keys.json 为 registry/trusted-keys.json
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const defaultRegistryPath = join(root, 'registry/index.json');
const defaultTrustedKeysPath = join(root, 'registry/trusted-keys.json');

/**
 * Canonical JSON：与 sign-registry.mjs / pack-sign.mjs 使用相同形式。
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
 * 从 trusted-keys.json 查找 keyId 对应的公钥，并验证 key 在 signedAt 时是 active 的。
 */
function lookupActiveKey(trustedKeys, keyId, signedAt) {
  if (!Array.isArray(trustedKeys.keys)) {
    throw new VerificationError('trusted-keys-malformed', 'trusted-keys.json missing keys array');
  }
  const key = trustedKeys.keys.find((k) => k.keyId === keyId);
  if (!key) {
    throw new VerificationError(
      'key-not-trusted',
      `keyId ${keyId} not found in trusted-keys.json (registry pinned keys)`,
    );
  }
  if (key.algorithm !== 'ed25519') {
    throw new VerificationError(
      'unsupported-algorithm',
      `keyId ${keyId} algorithm ${key.algorithm} not supported (only ed25519)`,
    );
  }
  const activatedAt = new Date(key.activatedAt);
  const revokedAt = key.revokedAt ? new Date(key.revokedAt) : null;
  const signedAtDate = new Date(signedAt);
  if (Number.isNaN(activatedAt.getTime())) {
    throw new VerificationError(
      'key-malformed',
      `keyId ${keyId} has invalid activatedAt: ${key.activatedAt}`,
    );
  }
  if (activatedAt > signedAtDate) {
    throw new VerificationError(
      'key-not-yet-active',
      `keyId ${keyId} activatedAt ${key.activatedAt} is after signature signedAt ${signedAt}`,
    );
  }
  if (revokedAt && revokedAt <= signedAtDate) {
    throw new VerificationError(
      'key-revoked',
      `keyId ${keyId} revokedAt ${key.revokedAt} is at or before signature signedAt ${signedAt}: ${key.revocationReason || 'no reason given'}`,
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
 * 验证 registry 签名结构、payload 完整性、密钥状态和签名有效性。
 */
export async function verifyRegistry(registryPath, trustedKeysPath) {
  const registryRaw = await readFile(registryPath, 'utf8');
  const registry = JSON.parse(registryRaw);
  const trustedKeys = JSON.parse(await readFile(trustedKeysPath, 'utf8'));

  if (registry.signed !== true) {
    throw new VerificationError(
      'not-signed',
      `registry.signed is ${registry.signed}, expected true (registry must be signed)`,
    );
  }
  const sig = registry.signature;
  if (!sig || typeof sig !== 'object') {
    throw new VerificationError(
      'missing-signature',
      'registry missing signature object (signed: true requires detached signature)',
    );
  }
  const requiredSigFields = ['keyId', 'algorithm', 'signedAt', 'payloadSha', 'value'];
  for (const field of requiredSigFields) {
    if (!sig[field]) {
      throw new VerificationError(
        'signature-malformed',
        `registry.signature missing field: ${field}`,
      );
    }
  }
  if (sig.algorithm !== 'ed25519') {
    throw new VerificationError(
      'unsupported-algorithm',
      `signature.algorithm ${sig.algorithm} not supported (only ed25519)`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(sig.payloadSha)) {
    throw new VerificationError(
      'signature-malformed',
      `signature.payloadSha must be lowercase sha256 hex, got: ${sig.payloadSha}`,
    );
  }
  if (!/^[a-f0-9]{128}$/.test(sig.value)) {
    throw new VerificationError(
      'signature-malformed',
      `signature.value must be 64-byte lowercase hex Ed25519 signature, got length ${sig.value.length}`,
    );
  }
  // signedAt 必须是有效 ISO 时间
  const signedAtDate = new Date(sig.signedAt);
  if (Number.isNaN(signedAtDate.getTime())) {
    throw new VerificationError(
      'signature-malformed',
      `signature.signedAt is not a valid ISO timestamp: ${sig.signedAt}`,
    );
  }

  // 1. 查找公钥并验证 key 在签名时是 active 的
  const key = lookupActiveKey(trustedKeys, sig.keyId, sig.signedAt);

  // 2. 计算 canonical payload 的 sha256，与 signature.payloadSha 比对
  const { signature: _omit, ...payload } = registry;
  const payloadJson = canonicalJson(payload);
  const computedPayloadSha = createHash('sha256').update(payloadJson).digest('hex');
  if (computedPayloadSha !== sig.payloadSha) {
    throw new VerificationError(
      'payload-tampered',
      `computed payloadSha ${computedPayloadSha} does not match signature.payloadSha ${sig.payloadSha} (registry content has been tampered after signing)`,
    );
  }

  // 3. 用公钥验证 Ed25519 签名（签名内容为 payloadSha 字节）
  const publicKey = publicKeyFromRaw(key.publicKey);
  const signatureBytes = Buffer.from(sig.value, 'hex');
  const payloadShaBytes = Buffer.from(sig.payloadSha, 'hex');
  const valid = verify(null, payloadShaBytes, publicKey, signatureBytes);
  if (!valid) {
    throw new VerificationError(
      'invalid-signature',
      `Ed25519 signature verification failed for keyId ${sig.keyId} (signature does not match payloadSha)`,
    );
  }

  // 4. 验证每个 entry 的 entrySha 与 entry 内容一致
  if (!Array.isArray(registry.plugins)) {
    throw new VerificationError(
      'registry-malformed',
      'registry.plugins must be an array',
    );
  }
  const entryErrors = [];
  for (const entry of registry.plugins) {
    const { entrySha: _omitEntry, ...entryPayload } = entry;
    if (!entry.entrySha) {
      entryErrors.push(`${entry.pluginId}@${entry.version}: missing entrySha`);
      continue;
    }
    const computedEntrySha = createHash('sha256').update(canonicalJson(entryPayload)).digest('hex');
    if (computedEntrySha !== entry.entrySha) {
      entryErrors.push(
        `${entry.pluginId}@${entry.version}: entrySha mismatch (computed ${computedEntrySha}, stored ${entry.entrySha})`,
      );
    }
  }
  if (entryErrors.length > 0) {
    throw new VerificationError(
      'entry-tampered',
      `entrySha verification failed for ${entryErrors.length} entries:\n  ${entryErrors.join('\n  ')}`,
    );
  }

  return {
    ok: true,
    keyId: sig.keyId,
    signedAt: sig.signedAt,
    payloadSha: sig.payloadSha,
    entryCount: registry.plugins.length,
    publicKey: key.publicKey,
  };
}

async function main() {
  const registryPath = process.argv[2] ? process.argv[2] : defaultRegistryPath;
  const trustedKeysPath = process.argv[3] ? process.argv[3] : defaultTrustedKeysPath;

  try {
    const result = await verifyRegistry(registryPath, trustedKeysPath);
    console.log('registry signature verified');
    console.log(`  keyId:      ${result.keyId}`);
    console.log(`  signedAt:   ${result.signedAt}`);
    console.log(`  payloadSha: ${result.payloadSha}`);
    console.log(`  entries:    ${result.entryCount}`);
    console.log(`  pubkey:     ${result.publicKey}`);
  } catch (err) {
    if (err instanceof VerificationError) {
      console.error(`verification failed: ${err.code}`);
      console.error(`  ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

// 仅在直接执行时运行 main（被 import 时不自动运行）。
// 使用 pathToFileURL 跨平台比较（macOS/Linux/Windows 路径格式不同）。
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { VerificationError, canonicalJson, lookupActiveKey, publicKeyFromRaw };
