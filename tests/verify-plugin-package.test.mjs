// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyPluginPackage, VerificationError, canonicalJson } from '../scripts/verify-plugin-package.mjs';

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
 * 测试辅助：写入 trusted-keys.json。
 */
function writeTrustedKeys(directory, keys) {
  const trustedKeys = join(directory, 'trusted-keys.json');
  writeFileSync(trustedKeys, JSON.stringify({ schemaVersion: 1, keys }, null, 2));
  return trustedKeys;
}

/**
 * 测试辅助：构造 canonical JSON 字符串。
 * 与 verify-plugin-package.mjs canonicalJson 一致。
 */

/**
 * 测试辅助：创建一个签名后的 .mira-plugin ZIP 包。
 *
 * 签名消息 = canonical_json(plugin.json) + b'\n' + canonical_json(checksums.json)
 * 与 runtime package.rs extract_package 的验签逻辑一致。
 *
 * @param {string} packagePath - 输出 .mira-plugin 路径
 * @param {object} manifest - plugin.json 对象
 * @param {string} privatePem - Ed25519 私钥 PEM
 * @param {object} options - { omitSignature, tamperManifest, tamperSignature, extraFiles }
 */
function createSignedPackage(packagePath, manifest, privatePem, options = {}) {
  const {
    omitSignature = false,
    tamperManifest = false,
    tamperSignature = false,
    extraFiles = {},
  } = options;

  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');

  // 构造 payload files（与 CLI pack 一致：plugin.json + 额外文件）
  const files = new Map();
  files.set('plugin.json', manifestBytes);
  for (const [name, content] of Object.entries(extraFiles)) {
    files.set(name, Buffer.from(content, 'utf8'));
  }

  // 构造 checksums.json
  const checksums = {
    schemaVersion: 1,
    files: {},
  };
  for (const [name, bytes] of files) {
    checksums.files[name] = createHash('sha256').update(bytes).digest('hex');
  }
  const checksumsBytes = Buffer.from(JSON.stringify(checksums, null, 2), 'utf8');

  // 构造签名消息
  const manifestObj = JSON.parse(manifestBytes.toString('utf8'));
  const checksumsObj = JSON.parse(checksumsBytes.toString('utf8'));
  const message = Buffer.concat([
    Buffer.from(canonicalJson(manifestObj), 'utf8'),
    Buffer.from('\n'),
    Buffer.from(canonicalJson(checksumsObj), 'utf8'),
  ]);
  const signature = sign(null, message, privatePem);

  // 写入临时目录后用 zip 命令打包
  const tmpDir = mkdtempSync(join(tmpdir(), 'mira-pkg-'));
  writeFileSync(join(tmpDir, 'plugin.json'), manifestBytes);
  writeFileSync(join(tmpDir, 'checksums.json'), checksumsBytes);
  if (!omitSignature) {
    let sigBytes = signature;
    if (tamperSignature) {
      // 翻转签名首字节使其无效
      sigBytes = Buffer.from(signature);
      sigBytes[0] ^= 0xFF;
    }
    // 创建 META-INF/ 子目录以保留 ZIP 内路径结构
    mkdirSync(join(tmpDir, 'META-INF'), { recursive: true });
    writeFileSync(join(tmpDir, 'META-INF', 'signature.ed25519'), sigBytes);
  }
  for (const [name, content] of Object.entries(extraFiles)) {
    const filePath = join(tmpDir, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  // 用 zip 命令打包（不用 -j，保留 META-INF/ 等目录结构）
  // 先删除可能存在的旧包
  try { execFileSync('rm', ['-f', packagePath], { stdio: 'pipe' }); } catch {}
  execFileSync('zip', ['-r', packagePath, 'plugin.json', 'checksums.json'], {
    cwd: tmpDir,
    stdio: 'pipe',
  });
  if (!omitSignature) {
    execFileSync('zip', [packagePath, 'META-INF/signature.ed25519'], {
      cwd: tmpDir,
      stdio: 'pipe',
    });
  }
  for (const [name] of Object.entries(extraFiles)) {
    execFileSync('zip', [packagePath, name], {
      cwd: tmpDir,
      stdio: 'pipe',
    });
  }

  // 如果需要篡改 manifest，重新写入 plugin.json 并更新 ZIP 中的条目
  if (tamperManifest) {
    const tamperedManifest = { ...manifest, version: '9.9.9' };
    writeFileSync(join(tmpDir, 'plugin.json'), JSON.stringify(tamperedManifest, null, 2));
    execFileSync('zip', [packagePath, 'plugin.json'], {
      cwd: tmpDir,
      stdio: 'pipe',
    });
  }
}

test('valid signed plugin package verifies successfully', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-verify-'));
  const { privatePem, publicRaw } = generateTestKey();
  const keyId = 'mira-plugins-2026-001';
  const trustedKeysPath = writeTrustedKeys(directory, [{
    keyId,
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2026-01-01T00:00:00Z',
  }]);
  const packagePath = join(directory, 'test.mira-plugin');
  const manifest = {
    schemaVersion: 1,
    packageFormatVersion: 1,
    pluginId: 'mira.test',
    name: 'Test Plugin',
    version: '1.0.0',
    pluginApi: '>=1.1.0, <2.0.0',
    publisherKeyId: keyId,
    evidence: 'fixture-verified',
    permissions: [],
    runtime: {},
    capabilities: [],
  };
  createSignedPackage(packagePath, manifest, privatePem);

  const result = await verifyPluginPackage(packagePath, trustedKeysPath);
  assert.equal(result.ok, true);
  assert.equal(result.pluginId, 'mira.test');
  assert.equal(result.version, '1.0.0');
  assert.equal(result.publisherKeyId, keyId);
  assert.equal(result.signatureVerified, true);
});

test('unsigned plugin package (missing signature) is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-verify-'));
  const { privatePem, publicRaw } = generateTestKey();
  const keyId = 'mira-plugins-2026-001';
  const trustedKeysPath = writeTrustedKeys(directory, [{
    keyId,
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2026-01-01T00:00:00Z',
  }]);
  const packagePath = join(directory, 'test.mira-plugin');
  const manifest = {
    schemaVersion: 1,
    pluginId: 'mira.test',
    version: '1.0.0',
    publisherKeyId: keyId,
  };
  createSignedPackage(packagePath, manifest, privatePem, { omitSignature: true });

  await assert.rejects(
    () => verifyPluginPackage(packagePath, trustedKeysPath),
    (err) => {
      assert(err instanceof VerificationError);
      assert.match(err.code, /missing-signature/);
      return true;
    },
  );
});

test('tampered plugin.json is rejected (signature mismatch)', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-verify-'));
  const { privatePem, publicRaw } = generateTestKey();
  const keyId = 'mira-plugins-2026-001';
  const trustedKeysPath = writeTrustedKeys(directory, [{
    keyId,
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2026-01-01T00:00:00Z',
  }]);
  const packagePath = join(directory, 'test.mira-plugin');
  const manifest = {
    schemaVersion: 1,
    pluginId: 'mira.test',
    version: '1.0.0',
    publisherKeyId: keyId,
  };
  createSignedPackage(packagePath, manifest, privatePem, { tamperManifest: true });

  await assert.rejects(
    () => verifyPluginPackage(packagePath, trustedKeysPath),
    (err) => {
      assert(err instanceof VerificationError);
      assert.match(err.code, /invalid-signature/);
      return true;
    },
  );
});

test('tampered signature bytes are rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-verify-'));
  const { privatePem, publicRaw } = generateTestKey();
  const keyId = 'mira-plugins-2026-001';
  const trustedKeysPath = writeTrustedKeys(directory, [{
    keyId,
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2026-01-01T00:00:00Z',
  }]);
  const packagePath = join(directory, 'test.mira-plugin');
  const manifest = {
    schemaVersion: 1,
    pluginId: 'mira.test',
    version: '1.0.0',
    publisherKeyId: keyId,
  };
  createSignedPackage(packagePath, manifest, privatePem, { tamperSignature: true });

  await assert.rejects(
    () => verifyPluginPackage(packagePath, trustedKeysPath),
    (err) => {
      assert(err instanceof VerificationError);
      assert.match(err.code, /invalid-signature/);
      return true;
    },
  );
});

test('untrusted publisher key is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-verify-'));
  const { privatePem, publicRaw } = generateTestKey();
  // trusted-keys.json 不包含签名时使用的 keyId
  const trustedKeysPath = writeTrustedKeys(directory, [{
    keyId: 'mira-plugins-2026-999',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2026-01-01T00:00:00Z',
  }]);
  const packagePath = join(directory, 'test.mira-plugin');
  const manifest = {
    schemaVersion: 1,
    pluginId: 'mira.test',
    version: '1.0.0',
    publisherKeyId: 'mira-plugins-2026-001',
  };
  createSignedPackage(packagePath, manifest, privatePem);

  await assert.rejects(
    () => verifyPluginPackage(packagePath, trustedKeysPath),
    (err) => {
      assert(err instanceof VerificationError);
      assert.match(err.code, /key-not-trusted/);
      return true;
    },
  );
});

test('TEST-ONLY publisher key is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-verify-'));
  const { privatePem, publicRaw } = generateTestKey();
  const keyId = 'TEST-ONLY-mira-plugins';
  // 即使 trusted-keys.json 包含 TEST-ONLY key，验证脚本也必须拒绝
  const trustedKeysPath = writeTrustedKeys(directory, [{
    keyId,
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2026-01-01T00:00:00Z',
  }]);
  const packagePath = join(directory, 'test.mira-plugin');
  const manifest = {
    schemaVersion: 1,
    pluginId: 'mira.test',
    version: '1.0.0',
    publisherKeyId: keyId,
  };
  createSignedPackage(packagePath, manifest, privatePem);

  await assert.rejects(
    () => verifyPluginPackage(packagePath, trustedKeysPath),
    (err) => {
      assert(err instanceof VerificationError);
      assert.match(err.code, /test-only-key/);
      return true;
    },
  );
});

test('revoked key is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-verify-'));
  const { privatePem, publicRaw } = generateTestKey();
  const keyId = 'mira-plugins-2026-001';
  const trustedKeysPath = writeTrustedKeys(directory, [{
    keyId,
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2026-01-01T00:00:00Z',
    revokedAt: '2026-06-01T00:00:00Z',
    revocationReason: 'key compromise test',
  }]);
  const packagePath = join(directory, 'test.mira-plugin');
  const manifest = {
    schemaVersion: 1,
    pluginId: 'mira.test',
    version: '1.0.0',
    publisherKeyId: keyId,
  };
  createSignedPackage(packagePath, manifest, privatePem);

  await assert.rejects(
    () => verifyPluginPackage(packagePath, trustedKeysPath),
    (err) => {
      assert(err instanceof VerificationError);
      assert.match(err.code, /key-revoked/);
      return true;
    },
  );
});

test('missing publisherKeyId in manifest is rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-verify-'));
  const { privatePem, publicRaw } = generateTestKey();
  const trustedKeysPath = writeTrustedKeys(directory, [{
    keyId: 'mira-plugins-2026-001',
    algorithm: 'ed25519',
    publicKey: publicRaw,
    activatedAt: '2026-01-01T00:00:00Z',
  }]);
  const packagePath = join(directory, 'test.mira-plugin');
  const manifest = {
    schemaVersion: 1,
    pluginId: 'mira.test',
    version: '1.0.0',
    publisherKeyId: null,
  };
  createSignedPackage(packagePath, manifest, privatePem);

  await assert.rejects(
    () => verifyPluginPackage(packagePath, trustedKeysPath),
    (err) => {
      assert(err instanceof VerificationError);
      assert.match(err.code, /missing-publisher-key/);
      return true;
    },
  );
});
