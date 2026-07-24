// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyRegistry, VerificationError, canonicalJson } from '../scripts/verify-registry.mjs';

/**
 * 第 3.8 节测试辅助：生成测试 Ed25519 密钥对。
 */
function generateTestKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
  return { privatePem, publicRaw };
}

/**
 * 第 3.8 节测试辅助：准备一个含一条 entry 的 registry（未签名）。
 */
function setupUnsignedRegistry(directory, manifestOverrides = {}) {
  const registry = join(directory, 'index.json');
  const manifest = join(directory, 'plugin.json');
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, plugins: [] }));
  writeFileSync(manifest, JSON.stringify({
    pluginId: 'mira.example',
    version: '1.2.3',
    pluginApi: '>=1.0.0, <2.0.0',
    publisherKeyId: 'mira-plugins-2026-001',
    packageFormatVersion: 1,
    minimumHostVersion: '0.9.0',
    ...manifestOverrides,
  }));
  execFileSync(process.execPath, ['scripts/update-registry.mjs', registry, manifest], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ASSET_URL: 'https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/plugin%2Fexample%2Fv1.2.3/mira-example-1.2.3.mira-plugin',
      SHA256: 'a'.repeat(64),
      RELEASE_TAG: 'plugin/example/v1.2.3',
      RELEASE_CHANNEL: 'stable',
    },
  });
  return { registry, manifest };
}

/**
 * 第 3.8 节测试辅助：写入 trusted-keys.json。
 */
function writeTrustedKeys(directory, keys) {
  const trustedKeys = join(directory, 'trusted-keys.json');
  writeFileSync(trustedKeys, JSON.stringify({ schemaVersion: 1, keys }, null, 2));
  return trustedKeys;
}

/**
 * 第 3.8 节测试辅助：用给定私钥签名 registry。
 */
function signRegistry(registryPath, privatePem, keyId) {
  execFileSync(process.execPath, ['scripts/sign-registry.mjs', registryPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REGISTRY_SIGNING_KEY: privatePem,
      REGISTRY_KEY_ID: keyId,
    },
  });
}

test('published plugin metadata updates the registry deterministically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-registry-'));
  const registry = join(directory, 'index.json');
  const manifest = join(directory, 'plugin.json');
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, plugins: [] }));
  writeFileSync(manifest, JSON.stringify({
    pluginId: 'mira.example',
    version: '1.2.3',
    publisherKeyId: 'mira-plugins-2026-001',
  }));
  execFileSync(process.execPath, ['scripts/update-registry.mjs', registry, manifest], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ASSET_URL: 'https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/plugin%2Fexample%2Fv1.2.3/mira-example-1.2.3.mira-plugin',
      SHA256: 'a'.repeat(64),
      RELEASE_TAG: 'plugin/example/v1.2.3',
    },
  });
  const result = JSON.parse(readFileSync(registry, 'utf8'));
  assert.equal(result.status, 'active');
  assert.equal(result.plugins[0].pluginId, 'mira.example');
  assert.equal(result.plugins[0].version, '1.2.3');
});

// 第 3.7 节：registry entry 必须使用 plugin/<plugin-id>/v<semver> tag，
// 旧 release/vYYYY-MM-DD 统一 Release tag 必须被拒绝。
test('registry rejects legacy release/ tag prefix', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-registry-'));
  const registry = join(directory, 'index.json');
  const manifest = join(directory, 'plugin.json');
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, plugins: [] }));
  writeFileSync(manifest, JSON.stringify({
    pluginId: 'mira.example',
    version: '1.2.3',
    publisherKeyId: 'mira-plugins-2026-001',
  }));
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/update-registry.mjs', registry, manifest], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ASSET_URL: 'https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/release%2Fv2026-07-24/mira-example-1.2.3.mira-plugin',
        SHA256: 'a'.repeat(64),
        RELEASE_TAG: 'release/v2026-07-24',
      },
    }),
    /must be a plugin\/<plugin-id>\/v<semver>/,
  );
});

// 第 3.7 节：release tag 中的 semver 必须与 manifest.version 精确匹配。
test('registry rejects tag version mismatch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-registry-'));
  const registry = join(directory, 'index.json');
  const manifest = join(directory, 'plugin.json');
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, plugins: [] }));
  writeFileSync(manifest, JSON.stringify({
    pluginId: 'mira.example',
    version: '1.2.3',
    publisherKeyId: 'mira-plugins-2026-001',
  }));
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/update-registry.mjs', registry, manifest], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ASSET_URL: 'https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/plugin%2Fexample%2Fv9.9.9/mira-example-1.2.3.mira-plugin',
        SHA256: 'a'.repeat(64),
        RELEASE_TAG: 'plugin/example/v9.9.9',
      },
    }),
    /release tag version does not match/,
  );
});

// 第 3.8 节预备：每条 entry 必须包含 entrySha、packageSha、pluginApi、
// packageFormatVersion、minimumHostVersion、publishedAt、channel、yanked 等字段。
test('registry entry includes 3.8 schema fields', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-registry-'));
  const registry = join(directory, 'index.json');
  const manifest = join(directory, 'plugin.json');
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, plugins: [] }));
  writeFileSync(manifest, JSON.stringify({
    pluginId: 'mira.example',
    version: '1.2.3',
    pluginApi: '>=1.0.0, <2.0.0',
    publisherKeyId: 'mira-plugins-2026-001',
    packageFormatVersion: 1,
    minimumHostVersion: '0.9.0',
  }));
  execFileSync(process.execPath, ['scripts/update-registry.mjs', registry, manifest], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ASSET_URL: 'https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/plugin%2Fexample%2Fv1.2.3/mira-example-1.2.3.mira-plugin',
      SHA256: 'a'.repeat(64),
      RELEASE_TAG: 'plugin/example/v1.2.3',
      RELEASE_CHANNEL: 'stable',
    },
  });
  const result = JSON.parse(readFileSync(registry, 'utf8'));
  const entry = result.plugins[0];
  assert.equal(entry.packageSha, 'a'.repeat(64));
  assert.equal(entry.pluginApi, '>=1.0.0, <2.0.0');
  assert.equal(entry.packageFormatVersion, 1);
  assert.equal(entry.minimumHostVersion, '0.9.0');
  assert.equal(entry.channel, 'stable');
  assert.equal(entry.yanked, false);
  assert.match(entry.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(entry.entrySha, /^[a-f0-9]{64}$/);
  // Note: canonicalJson in update-registry.mjs uses a custom canonical form (no spaces).
  // 我们只验证 entrySha 是 64 位 hex；具体 canonical 形式由 update-registry.mjs 保证。
  assert.equal(entry.entrySha.length, 64);
});

// 第 3.7 节：批量发布时也必须使用 plugin/ 前缀。
test('registry batch update rejects legacy release/ tag', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-registry-'));
  const registry = join(directory, 'index.json');
  const manifest = join(directory, 'plugin.json');
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, plugins: [] }));
  writeFileSync(manifest, JSON.stringify({
    pluginId: 'mira.example',
    version: '1.2.3',
    publisherKeyId: 'mira-plugins-2026-001',
  }));
  const batch = JSON.stringify([
    {
      url: 'https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/release%2Fv2026-07-24/mira-example-1.2.3.mira-plugin',
      manifest,
      sha256: 'a'.repeat(64),
    },
  ]);
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/update-registry.mjs', registry, '--batch', batch], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RELEASE_TAG: 'release/v2026-07-24',
      },
    }),
    /must be plugin\/<plugin-id>\/v<semver>/,
  );
});

// ============================================================================
// 第 3.8 节：真实可验证的签名 registry schema 测试
// ============================================================================

// 第 3.8 节：sign-registry.mjs + verify-registry.mjs 端到端签名验证。
test('3.8 registry can be signed and verified end-to-end', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-sign-e2e-'));
  const { registry } = setupUnsignedRegistry(directory);
  const { privatePem, publicRaw } = generateTestKey();
  const trustedKeys = writeTrustedKeys(directory, [{
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2020-01-01T00:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    owner: 'Tests',
    purpose: ['registry'],
  }]);

  signRegistry(registry, privatePem, 'test-key-001');

  const result = await verifyRegistry(registry, trustedKeys);
  assert.equal(result.ok, true);
  assert.equal(result.keyId, 'test-key-001');
  assert.equal(result.entryCount, 1);
  assert.match(result.payloadSha, /^[a-f0-9]{64}$/);
  assert.equal(result.publicKey, publicRaw);
});

// 第 3.8 节：未签名的 registry（含 plugins）必须被拒绝。
test('3.8 unsigned registry with plugins is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-unsigned-'));
  const { registry } = setupUnsignedRegistry(directory);
  const trustedKeys = writeTrustedKeys(directory, []);

  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'not-signed',
  );
});

// 第 3.8 节：签名后篡改 entry 内容必须导致 payload-tampered 错误。
test('3.8 tampered entry payload is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-tamper-entry-'));
  const { registry } = setupUnsignedRegistry(directory);
  const { privatePem, publicRaw } = generateTestKey();
  const trustedKeys = writeTrustedKeys(directory, [{
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2020-01-01T00:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    owner: 'Tests',
    purpose: ['registry'],
  }]);

  signRegistry(registry, privatePem, 'test-key-001');

  // 篡改 entry 内容（不更新 entrySha 或 signature）
  const tampered = JSON.parse(readFileSync(registry, 'utf8'));
  tampered.plugins[0].version = '9.9.9';
  writeFileSync(registry, JSON.stringify(tampered, null, 2) + '\n');

  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'payload-tampered',
  );
});

// 第 3.8 节：篡改 signature.value 必须导致 invalid-signature 错误。
test('3.8 tampered signature value is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-tamper-sig-'));
  const { registry } = setupUnsignedRegistry(directory);
  const { privatePem, publicRaw } = generateTestKey();
  const trustedKeys = writeTrustedKeys(directory, [{
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2020-01-01T00:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    owner: 'Tests',
    purpose: ['registry'],
  }]);

  signRegistry(registry, privatePem, 'test-key-001');

  // 翻转 signature.value 的最后一个字节
  const tampered = JSON.parse(readFileSync(registry, 'utf8'));
  const lastChar = tampered.signature.value.slice(-1);
  const flipped = (parseInt(lastChar, 16) ^ 0x1).toString(16);
  tampered.signature.value = tampered.signature.value.slice(0, -1) + flipped;
  writeFileSync(registry, JSON.stringify(tampered, null, 2) + '\n');

  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'invalid-signature',
  );
});

// 第 3.8 节：signature.keyId 不在 trusted-keys.json 中必须导致 key-not-trusted 错误。
test('3.8 untrusted key is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-untrusted-'));
  const { registry } = setupUnsignedRegistry(directory);
  const { privatePem, publicRaw } = generateTestKey();
  // trusted-keys.json 只包含另一个 keyId
  const trustedKeys = writeTrustedKeys(directory, [{
    keyId: 'other-key-999',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2020-01-01T00:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    owner: 'Tests',
    purpose: ['registry'],
  }]);

  signRegistry(registry, privatePem, 'test-key-001');

  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'key-not-trusted',
  );
});

// 第 3.8 节：已撤销的 key 在 revokedAt 之后签名必须导致 key-revoked 错误。
test('3.8 revoked key is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-revoked-'));
  const { registry } = setupUnsignedRegistry(directory);
  const { privatePem, publicRaw } = generateTestKey();
  const trustedKeys = writeTrustedKeys(directory, [{
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2020-01-01T00:00:00.000Z',
    revokedAt: '2025-01-01T00:00:00.000Z',
    revocationReason: 'test rotation',
    owner: 'Tests',
    purpose: ['registry'],
  }]);

  signRegistry(registry, privatePem, 'test-key-001');

  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'key-revoked',
  );
});

// 第 3.8 节：key 在 activatedAt 之前签名必须导致 key-not-yet-active 错误。
test('3.8 not-yet-active key is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-not-active-'));
  const { registry } = setupUnsignedRegistry(directory);
  const { privatePem, publicRaw } = generateTestKey();
  // key 将在未来激活
  const futureActivation = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const trustedKeys = writeTrustedKeys(directory, [{
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: futureActivation,
    revokedAt: null,
    revocationReason: null,
    owner: 'Tests',
    purpose: ['registry'],
  }]);

  signRegistry(registry, privatePem, 'test-key-001');

  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'key-not-yet-active',
  );
});

// 第 3.8 节：key rotation - 新 key 签的 registry 必须验证通过，
// 旧 key（已撤销）签的 registry 必须被拒绝。
test('3.8 key rotation: new key succeeds, old revoked key fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-rotation-'));
  const { registry } = setupUnsignedRegistry(directory);

  const oldKey = generateTestKey();
  const newKey = generateTestKey();

  // trusted-keys.json 同时包含旧 key（已撤销）和新 key（active）
  const trustedKeys = writeTrustedKeys(directory, [
    {
      keyId: 'old-key-001',
      algorithm: 'ed25519',
      publicKey: oldKey.publicRaw,
      activatedAt: '2020-01-01T00:00:00.000Z',
      revokedAt: '2026-06-01T00:00:00.000Z',
      revocationReason: 'rotated to new-key-002',
      owner: 'Mira Plugins',
      purpose: ['registry'],
    },
    {
      keyId: 'new-key-002',
      algorithm: 'ed25519',
      publicKey: newKey.publicRaw,
      activatedAt: '2026-06-01T00:00:00.000Z',
      revokedAt: null,
      revocationReason: null,
      owner: 'Mira Plugins',
      purpose: ['registry'],
    },
  ]);

  // 用旧 key 签名（当前时间晚于 revokedAt）→ 必须失败
  signRegistry(registry, oldKey.privatePem, 'old-key-001');
  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'key-revoked',
  );

  // 用新 key 签名（覆盖旧签名）→ 必须成功
  signRegistry(registry, newKey.privatePem, 'new-key-002');
  const result = await verifyRegistry(registry, trustedKeys);
  assert.equal(result.ok, true);
  assert.equal(result.keyId, 'new-key-002');
});

// 第 3.8 节：签名后篡改 entrySha 必须导致 entry-tampered 错误。
// 注意：sign-registry.mjs 会重算 entrySha，因此这里手动签名以保留被篡改的 entrySha。
// 通过让 signature.payloadSha 与篡改后的 payload 一致来绕过 payload-tampered 检查，
// 专门验证 entry 级 entrySha 一致性检查（defense-in-depth）。
test('3.8 tampered entrySha is rejected at entry verification', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-tamper-entrysha-'));
  const { registry } = setupUnsignedRegistry(directory);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
  const trustedKeys = writeTrustedKeys(directory, [{
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2020-01-01T00:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    owner: 'Tests',
    purpose: ['registry'],
  }]);

  // 1. 正常签名
  signRegistry(registry, privatePem, 'test-key-001');

  // 2. 读取已签名 registry，篡改 entrySha，然后手动重新签名（不重算 entrySha）
  const reg = JSON.parse(readFileSync(registry, 'utf8'));
  reg.plugins[0].entrySha = '0'.repeat(64);
  const { signature: _omit, ...payload } = reg;
  const payloadSha = createHash('sha256').update(canonicalJson(payload)).digest('hex');
  const signatureValue = sign(null, Buffer.from(payloadSha, 'hex'), privatePem);
  reg.signed = true;
  reg.signature = {
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    signedAt: new Date().toISOString(),
    payloadSha,
    value: signatureValue.toString('hex'),
  };
  writeFileSync(registry, JSON.stringify(reg, null, 2) + '\n');

  // 3. payload 与 signature 一致（绕过 payload-tampered），但 entrySha 与 entry 内容不一致
  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'entry-tampered',
  );
});

// 第 3.8 节：signature 缺少必填字段必须导致 signature-malformed 错误。
test('3.8 malformed signature is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-malformed-'));
  const { registry } = setupUnsignedRegistry(directory);
  const { publicRaw } = generateTestKey();
  const trustedKeys = writeTrustedKeys(directory, [{
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2020-01-01T00:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    owner: 'Tests',
    purpose: ['registry'],
  }]);

  // 构造 signed:true 但 signature 缺少 value 字段
  const malformed = JSON.parse(readFileSync(registry, 'utf8'));
  malformed.signed = true;
  malformed.signature = {
    keyId: 'test-key-001',
    algorithm: 'ed25519',
    signedAt: new Date().toISOString(),
    payloadSha: 'a'.repeat(64),
    // value 故意缺失
  };
  writeFileSync(registry, JSON.stringify(malformed, null, 2) + '\n');

  await assert.rejects(
    () => verifyRegistry(registry, trustedKeys),
    (err) => err instanceof VerificationError && err.code === 'signature-malformed',
  );
});
