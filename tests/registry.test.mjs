// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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
