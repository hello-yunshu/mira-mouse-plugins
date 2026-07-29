#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function assertNoRootVersion(name, json) {
  if (Object.hasOwn(json, 'version')) {
    throw new Error(`${name} must not define a repository-wide version; plugin versions live in plugins/*/plugin.json`);
  }
}

const [packageJsonRaw, packageLockJsonRaw, citationRaw, releaseYmlRaw] = await Promise.all([
  readFile('package.json', 'utf8'),
  readFile('package-lock.json', 'utf8'),
  readFile('CITATION.cff', 'utf8'),
  readFile('.github/workflows/release.yml', 'utf8'),
]);

assertNoRootVersion('package.json', JSON.parse(packageJsonRaw));

const lock = JSON.parse(packageLockJsonRaw);
assertNoRootVersion('package-lock.json', lock);
if (lock.packages?.['']) assertNoRootVersion('package-lock.json packages[""]', lock.packages['']);

if (/^version:/m.test(citationRaw) || /^date-released:/m.test(citationRaw)) {
  throw new Error('CITATION.cff must not define a repository-wide release version; cite plugin release tags instead');
}

// 第 3.7 节：release.yml 必须从 plugin.json 动态读取 version，并在 matrix 中
// 使用 manifest version（不得使用统一仓库版本或硬编码版本）。
// 兼容两种 matrix 命名：matrix.plugin.version（旧统一 Release）与
// matrix.target.version（新 per-plugin Release）。
if (!releaseYmlRaw.includes('m.version') && !releaseYmlRaw.includes('manifest.version')) {
  throw new Error('.github/workflows/release.yml must read version from plugin manifests');
}
if (
  !releaseYmlRaw.includes('matrix.plugin.version') &&
  !releaseYmlRaw.includes('matrix.target.version')
) {
  throw new Error('.github/workflows/release.yml must package each plugin using matrix.plugin.version or matrix.target.version');
}
// 第 3.7 节：禁止统一覆盖式 Release 输入。
if (/overwrite_latest/.test(releaseYmlRaw)) {
  throw new Error('.github/workflows/release.yml must not define overwrite_latest input (per-plugin releases are immutable)');
}
// 第 3.7 节：必须使用 plugin/<plugin-id>/v<semver> tag 格式。
if (!/plugin\/\$\{.*pluginId.*\}\/v\$?\{/.test(releaseYmlRaw) && !/plugin\/<plugin-id>\/v<semver>/.test(releaseYmlRaw)) {
  throw new Error('.github/workflows/release.yml must use plugin/<plugin-id>/v<semver> tag format');
}
// Source manifests deliberately keep publisherKeyId unset. The production key
// identity is part of the release plan and is injected only into the isolated
// staging copy before signing.
if (!releaseYmlRaw.includes('const publisherKeyId = "mira-plugins-2026-001"')) {
  throw new Error('.github/workflows/release.yml must declare the production publisher key in the release plan');
}
if (!releaseYmlRaw.includes("PLUGIN_KEY_ID: '${{ matrix.target.publisherKeyId }}'")) {
  throw new Error('.github/workflows/release.yml must pass the planned publisher key to the staging packer');
}
if (/if\s*\(\s*!m\.publisherKeyId/.test(releaseYmlRaw)) {
  throw new Error('.github/workflows/release.yml must not require publisherKeyId before staging injection');
}

const cliPin = JSON.parse(await readFile('mira-plugin-cli.version.json', 'utf8'));
if (cliPin.localDev !== false) {
  throw new Error('mira-plugin-cli.version.json must disable localDev before production plugin releases');
}
const requiredCliTargets = [
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc',
];
for (const target of requiredCliTargets) {
  const pinned = cliPin.targets?.[target];
  if (!pinned || typeof pinned.asset !== 'string' || !/^[0-9a-f]{64}$/.test(pinned.sha256)) {
    throw new Error(`mira-plugin-cli.version.json must pin a production asset and SHA-256 for ${target}`);
  }
}

let manifestCount = 0;
for (const name of await readdir('plugins')) {
  const manifestPath = join('plugins', name, 'plugin.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    continue;
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error(`${manifestPath} has invalid SemVer version`);
  }
  manifestCount += 1;
}

console.log(`version sources: ${manifestCount} plugin manifests only`);
