// SPDX-License-Identifier: AGPL-3.0-or-later
// TEST-ONLY verification of a .mira-plugin against a raw Ed25519 public key.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const zipPath = process.argv[2] || join(root, 'dist', 'mira-example-mock-1.0.0.mira-plugin');
const pubPath = process.argv[3] || join(root, 'TEST-ONLY-mira-plugins.pub');

function sortJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortJson(value[k])])
    );
  }
  if (Array.isArray(value)) return value.map(sortJson);
  return value;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function walk(dir, callback) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, callback);
    else await callback(p);
  }
}

async function main() {
  const pubRaw = Buffer.from(await readFile(pubPath, 'utf8'), 'hex');
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pubRaw]),
    format: 'der',
    type: 'spki',
  });

  const tmp = join(tmpdir(), `mira-verify-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  execFileSync('unzip', ['-q', zipPath, '-d', tmp]);

  const files = {};
  await walk(tmp, async (p) => {
    const rel = relative(tmp, p).replace(/\\/g, '/');
    files[rel] = p;
  });

  const manifestBytes = await readFile(files['plugin.json']);
  const checksumsBytes = await readFile(files['checksums.json']);
  const signature = await readFile(files['META-INF/signature.ed25519']);

  const manifest = JSON.parse(manifestBytes);
  const checksums = JSON.parse(checksumsBytes);

  if (checksums.schemaVersion !== 1) throw new Error('bad checksum schema');

  const payloadNames = Object.keys(files)
    .filter((n) => n !== 'checksums.json' && n !== 'META-INF/signature.ed25519')
    .sort();
  const expectedNames = Object.keys(checksums.files).sort();
  if (JSON.stringify(payloadNames) !== JSON.stringify(expectedNames)) {
    throw new Error('checksum coverage mismatch');
  }

  for (const [name, expected] of Object.entries(checksums.files)) {
    const actual = await sha256File(files[name]);
    if (actual !== expected) throw new Error(`checksum mismatch: ${name}`);
  }

  const message = Buffer.concat([
    Buffer.from(JSON.stringify(sortJson(manifest))),
    Buffer.from('\n'),
    Buffer.from(JSON.stringify(sortJson(checksums))),
  ]);
  const ok = verify(null, message, publicKey, signature);
  if (!ok) throw new Error('signature verification failed');

  console.log('verification passed');
  console.log(`  pluginId: ${manifest.pluginId}`);
  console.log(`  version:  ${manifest.version}`);
  console.log(`  publisherKeyId: ${manifest.publisherKeyId}`);

  await rm(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
