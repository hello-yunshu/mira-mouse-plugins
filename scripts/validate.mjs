// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const forbidden = /\.(exe|dll|dylib|so|wasm|html|css|js|ts|py|sh|bat|cmd|pyc)$/i;
let jsonCount = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.git', '.research', 'dist', 'node_modules'].includes(entry.name)) continue;
    const path = join(dir, entry.name); const rel = relative(root, path);
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`symlink forbidden: ${rel}`);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.json')) { JSON.parse(await readFile(path, 'utf8')); jsonCount++; }
    else if (rel.startsWith('plugins/') && forbidden.test(entry.name)) throw new Error(`executable or web file forbidden: ${rel}`);
  }
}
await walk(root);
for (const id of ['amaster', 'example-mock', 'logitech-hidpp', 'razer-viper']) {
  const manifest = JSON.parse(await readFile(join(root, 'plugins', id, 'plugin.json'), 'utf8'));
  if (manifest.writesEnabled && manifest.evidence !== 'hardware-verified') throw new Error(`${id}: unsafe write evidence`);
  if (!manifest.pluginId.startsWith('mira.')) throw new Error(`${id}: invalid plugin id`);
}
console.log(`validated ${jsonCount} JSON files and four plugin manifests`);

