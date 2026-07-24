// SPDX-License-Identifier: AGPL-3.0-or-later
// Registry entry builder (第 3.7、3.8 节)。
//
// 严格规则：
//   1. releaseTag 必须形如 plugin/<pluginId>/v<semver>，且 semver 与 manifest.version 精确匹配。
//      旧 release/vYYYY-MM-DD 统一 Release tag 自本版本起拒绝写入。
//   2. 资产 URL 必须位于 canonical 插件 release origin。
//   3. publisherKeyId 必须是生产密钥 ID，不得以 TEST-ONLY 开头。
//   4. 每条 entry 写入时附带 entrySha（canonical JSON sha256）、packageFormatVersion、
//      pluginApi、minimumHostVersion、publishedAt、channel、yanked 等字段，为 3.8
//      真实签名做准备。
//   5. 本脚本只更新 entries，不写入 signature。签名由 scripts/sign-registry.mjs 单独完成。
//      CI 流程：update-registry.mjs → sign-registry.mjs → verify-registry.mjs → commit。
//      仓库中提交的 registry/index.json 必须始终是已签名状态（check-architecture.mjs 强制）。
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const CANONICAL_ORIGIN = 'https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/';

const argv = process.argv.slice(2);
const registryPath = argv[0];
if (!registryPath) {
  throw new Error('usage: update-registry.mjs <registry.json> [--batch <json-array>] <plugin.json>');
}

const batchIndex = argv.indexOf('--batch');
const isBatch = batchIndex !== -1;

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function buildEntry(assetUrl, sha256, releaseTag, manifest) {
  if (!assetUrl?.startsWith(CANONICAL_ORIGIN)) {
    throw new Error('ASSET_URL must use the canonical plugin release origin');
  }
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new Error('SHA256 must be lowercase hex');
  // 第 3.7 节：releaseTag 必须是 plugin/<pluginId>/v<semver>，禁止 release/ 统一 tag。
  if (!releaseTag?.startsWith('plugin/')) {
    throw new Error('RELEASE_TAG must be a plugin/<plugin-id>/v<semver> tag (legacy release/ tags are rejected)');
  }
  const expectedSuffix = '/v' + manifest.version;
  if (!releaseTag.endsWith(expectedSuffix)) {
    throw new Error('release tag version does not match plugin manifest: tag=' + releaseTag + ' version=' + manifest.version);
  }
  if (!manifest.publisherKeyId || manifest.publisherKeyId.startsWith('TEST-ONLY')) {
    throw new Error('published registry packages require a production publisher key');
  }
  const entry = {
    pluginId: manifest.pluginId,
    version: manifest.version,
    releaseTag,
    url: assetUrl,
    packageSha: sha256,
    publisherKeyId: manifest.publisherKeyId,
    pluginApi: manifest.pluginApi || null,
    packageFormatVersion: manifest.packageFormatVersion || 1,
    minimumHostVersion: manifest.minimumHostVersion || null,
    publishedAt: new Date().toISOString(),
    channel: process.env.RELEASE_CHANNEL || 'stable',
    yanked: false,
    notes: 'Mira plugin ' + manifest.pluginId + ' ' + manifest.version,
  };
  // entrySha 覆盖除自身外的全部字段，作为 3.8 detached signature 的 payload 基础。
  const { entrySha: _omit, ...entryPayload } = entry;
  entry.entrySha = createHash('sha256').update(canonicalJson(entryPayload)).digest('hex');
  return entry;
}

function writeRegistry(path, plugins) {
  plugins.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  // 第 3.8 节：update-registry.mjs 只负责写入 unsigned registry。
  // 真实 detached signature 由 scripts/sign-registry.mjs 单独写入。
  // 仓库中提交的 registry/index.json 必须经过 sign-registry.mjs 处理，
  // 由 check-architecture.mjs 强制验证 signed:true + signature 结构。
  return writeFile(path, JSON.stringify({
    schemaVersion: 1,
    signed: false,
    publisherKeyId: 'mira-plugins-2026-001',
    plugins,
    status: 'active',
  }, null, 2) + '\n');
}

if (isBatch) {
  const batchJson = argv[batchIndex + 1];
  if (!batchJson) throw new Error('--batch requires a JSON array argument');
  const items = JSON.parse(batchJson);
  const releaseTag = process.env.RELEASE_TAG;
  if (!releaseTag?.startsWith('plugin/')) {
    throw new Error('RELEASE_TAG env must be plugin/<plugin-id>/v<semver>');
  }
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  let plugins = registry.plugins ?? [];
  for (const item of items) {
    const manifest = JSON.parse(await readFile(item.manifest, 'utf8'));
    const entry = buildEntry(item.url, item.sha256, releaseTag, manifest);
    plugins = plugins.filter((p) => p.pluginId !== entry.pluginId);
    plugins.push(entry);
  }
  await writeRegistry(registryPath, plugins);
} else {
  const manifestPath = argv[1];
  if (!manifestPath) {
    throw new Error('usage: update-registry.mjs <registry.json> <plugin.json>');
  }
  const assetUrl = process.env.ASSET_URL;
  const sha256 = process.env.SHA256;
  const releaseTag = process.env.RELEASE_TAG;
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = buildEntry(assetUrl, sha256, releaseTag, manifest);
  let plugins = (registry.plugins ?? []).filter((item) => item.pluginId !== entry.pluginId);
  plugins.push(entry);
  await writeRegistry(registryPath, plugins);
}
