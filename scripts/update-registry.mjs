// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, writeFile } from 'node:fs/promises';

const [registryPath, manifestPath] = process.argv.slice(2);
if (!registryPath || !manifestPath) {
  throw new Error('usage: update-registry.mjs <registry.json> <plugin.json>');
}

const assetUrl = process.env.ASSET_URL;
const sha256 = process.env.SHA256;
const releaseTag = process.env.RELEASE_TAG;
if (!assetUrl?.startsWith('https://github.com/hello-yunshu/mira-mouse-plugins/releases/download/')) {
  throw new Error('ASSET_URL must use the canonical plugin release origin');
}
if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new Error('SHA256 must be lowercase hex');
if (!releaseTag?.startsWith('plugin/') && !releaseTag?.startsWith('release/')) {
  throw new Error('RELEASE_TAG must be a plugin/ or release/ tag');
}

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest.publisherKeyId || manifest.publisherKeyId.startsWith('TEST-ONLY')) {
  throw new Error('published registry packages require a production publisher key');
}
// For per-plugin tags (plugin/{name}/v{version}), the tag must match the manifest version.
// For unified release tags (release/v*), the tag is a bundle tag and version matching is not required.
if (releaseTag.startsWith('plugin/') && !releaseTag.endsWith('/v' + manifest.version)) {
  throw new Error('release tag version does not match plugin manifest');
}
const entry = {
  pluginId: manifest.pluginId,
  version: manifest.version,
  releaseTag,
  url: assetUrl,
  sha256,
  publisherKeyId: manifest.publisherKeyId,
  notes: 'Mira plugin ' + manifest.pluginId + ' ' + manifest.version,
};
const plugins = (registry.plugins ?? []).filter((item) => item.pluginId !== entry.pluginId);
plugins.push(entry);
plugins.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
await writeFile(registryPath, JSON.stringify({
  schemaVersion: 1,
  signed: true,
  plugins,
  status: 'active',
}, null, 2) + '\n');
