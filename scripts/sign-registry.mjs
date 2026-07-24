// SPDX-License-Identifier: AGPL-3.0-or-later
// 第 3.8 节：为 registry/index.json 生成真实的 Ed25519 detached signature。
//
// 流程：
//   1. 读取 registry/index.json
//   2. 计算 canonical payload（排除 signature 字段）的 sha256
//   3. 用 Ed25519 私钥签名 payloadSha 字节，得到 detached signature
//   4. 写回 registry，包含 signature.{keyId, algorithm, signedAt, payloadSha, value}
//
// 签名密钥来源（按优先级）：
//   - REGISTRY_SIGNING_KEY 环境变量（PEM 私钥，可为 base64 编码）
//   - PLUGIN_SIGNING_KEY 环境变量（PEM 私钥，可为 base64 编码）
//   - TEST-ONLY-mira-plugins.key.pem 文件（本地测试用）
//
// 密钥 ID 来源：
//   - REGISTRY_KEY_ID 环境变量
//   - PLUGIN_KEY_ID 环境变量
//   - 'TEST-ONLY-mira-plugins'（本地测试用）
//
// 用法：node scripts/sign-registry.mjs [registry.json]
//      默认 registry.json 路径为 registry/index.json
import { createHash, generateKeyPairSync, createPublicKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const defaultRegistryPath = join(root, 'registry/index.json');
const testPrivPath = join(root, 'TEST-ONLY-mira-plugins.key.pem');
const testPubPath = join(root, 'TEST-ONLY-mira-plugins.pub');

/**
 * Canonical JSON: 递归排序键，无空格，UTF-8。
 * 与 pack-sign.mjs / verify-test.mjs 使用相同的 canonical 形式。
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * 计算 registry 签名 payload（排除 signature 字段）的 canonical JSON。
 * 顶层其他字段（schemaVersion、signed、publisherKeyId、plugins、status）都参与签名。
 */
function buildSigningPayload(registry) {
  const { signature: _omit, ...payload } = registry;
  return canonicalJson(payload);
}

async function loadSigningKey() {
  const envPem = process.env.REGISTRY_SIGNING_KEY || process.env.PLUGIN_SIGNING_KEY;
  if (envPem) {
    const privatePem = envPem.includes('BEGIN PRIVATE KEY')
      ? envPem
      : Buffer.from(envPem, 'base64').toString('utf8');
    const publicDer = createPublicKey(privatePem).export({ type: 'spki', format: 'der' });
    const publicRaw = publicDer.slice(-32);
    return {
      privatePem,
      publicRaw,
      keyId: process.env.REGISTRY_KEY_ID || process.env.PLUGIN_KEY_ID || 'mira-plugins-2026-001',
      source: 'env:REGISTRY_SIGNING_KEY',
    };
  }
  // 本地测试：复用 pack-sign.mjs 的 TEST-ONLY 密钥
  try {
    const privatePem = await readFile(testPrivPath, 'utf8');
    const publicRaw = Buffer.from(await readFile(testPubPath, 'utf8'), 'hex');
    return {
      privatePem,
      publicRaw,
      keyId: process.env.REGISTRY_KEY_ID || process.env.PLUGIN_KEY_ID || 'TEST-ONLY-mira-plugins',
      source: testPrivPath,
    };
  } catch {
    // 没有现成的测试密钥，临时生成（仅用于本地一次性测试，不会持久化）
    const { privateKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicRaw = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).slice(-32);
    return {
      privatePem,
      publicRaw,
      keyId: 'TEST-ONLY-mira-plugins',
      source: 'ephemeral',
    };
  }
}

async function main() {
  const registryPath = process.argv[2] ? process.argv[2] : defaultRegistryPath;
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));

  if (!registry.schemaVersion) {
    throw new Error(`registry missing schemaVersion: ${registryPath}`);
  }
  if (!Array.isArray(registry.plugins)) {
    throw new Error(`registry missing plugins array: ${registryPath}`);
  }

  const { privatePem, publicRaw, keyId, source } = await loadSigningKey();

  // 1. 为每个 entry 重新计算 entrySha（确保 entry 内容与 entrySha 一致）
  for (const entry of registry.plugins) {
    const { entrySha: _omit, ...entryPayload } = entry;
    entry.entrySha = createHash('sha256').update(canonicalJson(entryPayload)).digest('hex');
  }

  // 2. 标记 signed: true（必须在计算 payloadSha 之前设置，否则签名时 payload 含
  //    signed:false，而验证时 payload 含 signed:true，会导致 payload-tampered）
  registry.signed = true;

  // 3. 计算 registry 级 payloadSha（排除 signature 字段）
  const payloadJson = buildSigningPayload(registry);
  const payloadSha = createHash('sha256').update(payloadJson).digest('hex');

  // 4. 用 Ed25519 签名 payloadSha 字节
  const signatureValue = sign(null, Buffer.from(payloadSha, 'hex'), privatePem);

  // 5. 写回 signature 字段
  registry.signature = {
    keyId,
    algorithm: 'ed25519',
    signedAt: new Date().toISOString(),
    payloadSha,
    value: signatureValue.toString('hex'),
  };

  await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n');

  console.log(`signed: ${registryPath}`);
  console.log(`  keyId:     ${keyId}`);
  console.log(`  algorithm: ed25519`);
  console.log(`  payloadSha: ${payloadSha}`);
  console.log(`  signature: ${signatureValue.toString('hex')}`);
  console.log(`  pubkey:    ${publicRaw.toString('hex')}`);
  console.log(`  source:    ${source}`);
  console.log(`  entries:   ${registry.plugins.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
