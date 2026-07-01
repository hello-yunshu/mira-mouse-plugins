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

if (!releaseYmlRaw.includes('version: manifest.version')) {
  throw new Error('.github/workflows/release.yml must enumerate release versions from plugin manifests');
}
if (!releaseYmlRaw.includes('version="${{ matrix.plugin.version }}"')) {
  throw new Error('.github/workflows/release.yml must package each plugin using matrix.plugin.version');
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
