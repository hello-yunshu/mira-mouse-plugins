// SPDX-License-Identifier: AGPL-3.0-or-later
// Pack and sign a .mira-plugin asset.
// For production, set PLUGIN_SIGNING_KEY (PEM private key) and PLUGIN_KEY_ID.
// For local testing, leave them unset and a TEST-ONLY key pair will be generated.
import { createHash, generateKeyPairSync, createPublicKey, sign } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rm, copyFile, utimes } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sortJson, canonicalJson } from './lib/canonical.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const keyId = process.env.PLUGIN_KEY_ID || 'TEST-ONLY-mira-plugins';
const testPrivPath = join(root, 'TEST-ONLY-mira-plugins.key.pem');
const testPubPath = join(root, 'TEST-ONLY-mira-plugins.pub');

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function walkFiles(dir, callback) {
  const paths = [];
  async function collect(d) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await collect(p);
      else paths.push(p);
    }
  }
  await collect(dir);
  await Promise.all(paths.map((p) => callback(p)));
}

async function loadOrCreateKeys() {
  const envPem = process.env.PLUGIN_SIGNING_KEY;
  if (envPem) {
    const privatePem = envPem.includes('BEGIN PRIVATE KEY') ? envPem : Buffer.from(envPem, 'base64').toString('utf8');
    const publicRaw = createPublicKey(privatePem).export({ type: 'spki', format: 'der' }).slice(-32);
    return { privatePem, publicRaw, source: 'env:PLUGIN_SIGNING_KEY' };
  }
  try {
    const privatePem = await readFile(testPrivPath, 'utf8');
    const publicRaw = Buffer.from(await readFile(testPubPath, 'utf8'), 'hex');
    return { privatePem, publicRaw, source: testPrivPath };
  } catch {
    const { privateKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicRaw = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).slice(-32);
    await writeFile(testPrivPath, privatePem);
    await writeFile(testPubPath, publicRaw.toString('hex'));
    return { privatePem, publicRaw, source: testPrivPath };
  }
}

async function main() {
  const pluginDir = process.argv[2] ? process.argv[2] : join(root, 'plugins/example-mock');
  const manifestPathSrc = join(pluginDir, 'plugin.json');
  const manifest = JSON.parse(await readFile(manifestPathSrc, 'utf8'));
  const pluginId = manifest.pluginId;
  const version = manifest.version;
  const assetName = `${pluginId.replace(/\./g, '-')}-${version}.mira-plugin`;
  const outPath = resolve(process.argv[3] ? process.argv[3] : join(root, 'dist', assetName));

  await mkdir(dirname(outPath), { recursive: true });

  const { privatePem, publicRaw, source } = await loadOrCreateKeys();

  const stage = join(tmpdir(), `mira-pack-${Date.now()}`);
  await mkdir(stage, { recursive: true });

  // Copy plugin source into staging area.
  const files = [];
  await walkFiles(pluginDir, async (srcPath) => {
    const rel = relative(pluginDir, srcPath).replace(/\\/g, '/');
    if (rel === 'checksums.json' || rel === 'META-INF/signature.ed25519') return;
    const dst = join(stage, rel);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(srcPath, dst);
    files.push(rel);
  });

  // Inject publisher key id into the staged manifest.
  manifest.publisherKeyId = keyId;
  await writeFile(join(stage, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');

  // Compute checksums for all payload files (excluding checksums.json and signature).
  const checksums = { schemaVersion: 1, files: {} };
  const checksumEntries = await Promise.all(files.sort().map(async (rel) => [rel, await sha256File(join(stage, rel))]));
  for (const [rel, hash] of checksumEntries) checksums.files[rel] = hash;
  await writeFile(join(stage, 'checksums.json'), JSON.stringify(checksums, null, 2) + '\n');

  // Sign canonical manifest + checksums.
  const [manifestCanonical, checksumsCanonical] = await Promise.all([
    readFile(join(stage, 'plugin.json'), 'utf8').then((raw) => canonicalJson(JSON.parse(raw))),
    readFile(join(stage, 'checksums.json'), 'utf8').then((raw) => canonicalJson(JSON.parse(raw))),
  ]);
  const message = Buffer.concat([
    Buffer.from(manifestCanonical),
    Buffer.from('\n'),
    Buffer.from(checksumsCanonical),
  ]);
  const signature = sign(null, message, privatePem);
  const sigPath = join(stage, 'META-INF', 'signature.ed25519');
  await mkdir(dirname(sigPath), { recursive: true });
  await writeFile(sigPath, signature);

  // Deterministic timestamps for reproducible archives.
  const epoch = new Date('1980-01-01T00:00:00Z');
  await walkFiles(stage, async (p) => utimes(p, epoch, epoch));

  // Build deterministic zip with sorted entries and no extra fields.
  const entries = files.concat(['checksums.json', 'META-INF/signature.ed25519']).sort();
  await rm(outPath, { force: true });
  execFileSync('zip', ['-X', '-q', outPath, ...entries], { cwd: stage });

  const sha256 = await sha256File(outPath);
  console.log(`packed: ${outPath}`);
  console.log(`asset:  ${assetName}`);
  console.log(`sha256: ${sha256}`);
  console.log(`keyId:  ${keyId}`);
  console.log(`pubkey: ${publicRaw.toString('hex')}`);
  console.log(`source: ${source}`);

  await rm(stage, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
