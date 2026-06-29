#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function assertNoRootVersion(name, json) {
  if (Object.hasOwn(json, 'version')) {
    throw new Error(`${name} must not define a repository-wide version; plugin versions live in plugins/*/plugin.json`);
  }
}

assertNoRootVersion('package.json', JSON.parse(await readFile('package.json', 'utf8')));

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assertNoRootVersion('package-lock.json', lock);
if (lock.packages?.['']) assertNoRootVersion('package-lock.json packages[""]', lock.packages['']);

const citation = await readFile('CITATION.cff', 'utf8');
if (/^version:/m.test(citation) || /^date-released:/m.test(citation)) {
  throw new Error('CITATION.cff must not define a repository-wide release version; cite plugin release tags instead');
}

const workflow = await readFile('.github/workflows/release.yml', 'utf8');
if (!workflow.includes('version: manifest.version')) {
  throw new Error('.github/workflows/release.yml must enumerate release versions from plugin manifests');
}
if (!workflow.includes('version="${{ matrix.plugin.version }}"')) {
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
