#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';

const pluginIndex = process.argv.indexOf('--plugin');
const pluginId = pluginIndex >= 0 ? process.argv[pluginIndex + 1] : null;
if (!pluginId || pluginId.startsWith('-')) {
  throw new Error('usage: npm run validate:plugin -- --plugin <plugin-id-or-directory>');
}

for (const args of [
  ['scripts/validate.mjs', '--plugin', pluginId],
  ['scripts/protocol-inventory.mjs', '--check-docs', '--plugin', pluginId],
]) {
  execFileSync(process.execPath, args, { stdio: 'inherit' });
}
