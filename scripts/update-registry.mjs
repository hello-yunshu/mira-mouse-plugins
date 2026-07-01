// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, writeFile } from 'node:fs/promises';

const CANONICAL_ORIGIN = 'https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/';

const argv = process.argv.slice(2);
const registryPath = argv[0];
if (!registryPath) {
  throw new Error('usage: update-registry.mjs <registry.json> [--batch <json-array>] <plugin.json>');
}

const batchIndex = argv.indexOf('--batch');
const isBatch = batchIndex !== -1;

function buildEntry(assetUrl, sha256, releaseTag, manifest) {
  if (!assetUrl?.startsWith(CANONICAL_ORIGIN)) {
    throw new Error('ASSET_URL must use the canonical plugin release origin');
  }
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new Error('SHA256 must be lowercase hex');
  if (!releaseTag?.startsWith('plugin/') && !releaseTag?.startsWith('release/')) {
    throw new Error('RELEASE_TAG must be a plugin/ or release/ tag');
  }
  if (!manifest.publisherKeyId || manifest.publisherKeyId.startsWith('TEST-ONLY')) {
    throw new Error('published registry packages require a production publisher key');
  }
  if (releaseTag.startsWith('plugin/') && !releaseTag.endsWith('/v' + manifest.version)) {
    throw new Error('release tag version does not match plugin manifest');
  }
  return {
    pluginId: manifest.pluginId,
    version: manifest.version,
    releaseTag,
    url: assetUrl,
    sha256,
    publisherKeyId: manifest.publisherKeyId,
    notes: 'Mira plugin ' + manifest.pluginId + ' ' + manifest.version,
  };
}

function writeRegistry(path, plugins) {
  plugins.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  return writeFile(path, JSON.stringify({
    schemaVersion: 1,
    signed: true,
    plugins,
    status: 'active',
  }, null, 2) + '\n');
}

if (isBatch) {
  const batchJson = argv[batchIndex + 1];
  if (!batchJson) throw new Error('--batch requires a JSON array argument');
  const items = JSON.parse(batchJson);
  const releaseTag = process.env.RELEASE_TAG;
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
