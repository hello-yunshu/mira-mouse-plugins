// SPDX-License-Identifier: AGPL-3.0-or-later
// 3.5 节：插件仓库下载并固定一个已发布的 mira-plugin-cli 二进制 + SHA-256。
// CI 不 checkout 主仓库源码。本脚本：
//   1. 读取 mira-plugin-cli.version.json 获取固定版本和 SHA-256
//   2. 探测当前平台对应的 target triple
//   3. 从 GitHub Release 下载压缩包到 .cache/mira-plugin-cli/
//   4. 校验 SHA-256（必须与 version.json 完全一致）
//   5. 解压并返回 mira-plugin 可执行文件路径
//
// 退出码：
//   0 — 成功，最后一行打印可执行文件绝对路径
//   1 — 下载/校验/解压失败
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, mkdirSync, readdirSync, renameSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = join(root, 'mira-plugin-cli.version.json');
const cacheDir = join(root, '.cache', 'mira-plugin-cli');

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fetch-cli.mjs');

function detectTarget() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  throw new Error(`unsupported platform: ${platform}-${arch}`);
}

function sha256File(path) {
  const hash = createHash('sha256');
  const buf = readFileSync(path);
  hash.update(buf);
  return hash.digest('hex');
}

async function download(url, dest) {
  // GitHub Release 下载可能跳转，Node 18+ fetch 默认跟随重定向。
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${url} -> HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  await pipeline(
    (async function* () { yield Buffer.from(ab); })(),
    (await import('node:fs')).createWriteStream(dest),
  );
}

function extract(archive, destDir, target) {
  mkdirSync(destDir, { recursive: true });
  if (target.endsWith('-apple-darwin') || target.endsWith('-unknown-linux-gnu')) {
    execFileSync('tar', ['-xzf', archive, '-C', destDir], { stdio: 'inherit' });
  } else if (target.endsWith('-pc-windows-msvc')) {
    // Windows zip 用 PowerShell Expand-Archive
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Force -Path "${archive}" -DestinationPath "${destDir}"`],
      { stdio: 'inherit' });
  } else {
    throw new Error(`cannot extract for target: ${target}`);
  }
}

function findBinary(extractedDir, target) {
  const exe = target.endsWith('-pc-windows-msvc') ? 'mira-plugin.exe' : 'mira-plugin';
  // 二进制可能在嵌套目录（mira-plugin-<target>/mira-plugin）
  if (existsSync(join(extractedDir, exe))) return join(extractedDir, exe);
  for (const entry of readdirSync(extractedDir)) {
    const candidate = join(extractedDir, entry, exe);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`mira-plugin binary not found in ${extractedDir}`);
}

export async function fetchCli() {
  const version = JSON.parse(readFileSync(versionFile, 'utf8'));
  const target = detectTarget();
  const targetInfo = version.targets[target];
  if (!targetInfo) {
    throw new Error(`no CLI binary pinned for target ${target} in ${versionFile}`);
  }
  if (targetInfo.sha256 === 'PENDING_RELEASE_PUBLISH') {
    throw new Error(
      `mira-plugin-cli ${version.version} has not been published yet. ` +
      `Push tag ${version.releaseTag} to ${version.repository} and update ${versionFile} with real SHA-256 values.`,
    );
  }

  const versionCacheDir = join(cacheDir, version.version, target);
  const markerPath = join(versionCacheDir, '.verified');
  const exePath = join(versionCacheDir, target.endsWith('-pc-windows-msvc') ? 'mira-plugin.exe' : 'mira-plugin');

  // 缓存命中：已校验过的二进制直接复用。
  if (existsSync(markerPath) && existsSync(exePath)) {
    return exePath;
  }

  rmSync(versionCacheDir, { recursive: true, force: true });
  mkdirSync(versionCacheDir, { recursive: true });

  const assetName = targetInfo.asset;
  const downloadUrl = `https://github.com/${version.repository}/releases/download/${version.releaseTag}/${assetName}`;
  const archivePath = join(versionCacheDir, assetName);

  console.log(`fetch-cli: downloading ${downloadUrl}`);
  await download(downloadUrl, archivePath);

  const actualSha = sha256File(archivePath);
  if (actualSha !== targetInfo.sha256) {
    rmSync(versionCacheDir, { recursive: true, force: true });
    throw new Error(
      `SHA-256 mismatch for ${assetName}:\n  expected (pinned): ${targetInfo.sha256}\n  actual (downloaded): ${actualSha}\n` +
      `Refusing to use untrusted CLI binary (3.5: 固定 CLI 版本和 SHA-256).`,
    );
  }
  console.log(`fetch-cli: SHA-256 verified (${actualSha})`);

  const extractDir = join(versionCacheDir, 'extract');
  extract(archivePath, extractDir, target);
  const binaryPath = findBinary(extractDir, target);
  renameSync(binaryPath, exePath);
  // 清理解压临时目录与压缩包，只保留最终二进制。
  rmSync(extractDir, { recursive: true, force: true });
  rmSync(archivePath, { force: true });

  if (!exePath.endsWith('.exe')) {
    execFileSync('chmod', ['+x', exePath]);
  }

  // 校验二进制能运行且版本匹配。
  const versionOutput = execFileSync(exePath, ['--version'], { encoding: 'utf8' }).trim();
  if (!versionOutput.includes(version.version)) {
    throw new Error(`CLI version mismatch: expected ${version.version}, got:\n${versionOutput}`);
  }
  console.log(`fetch-cli: ${versionOutput.replace(/\n/g, ' | ')}`);

  writeFileSync(markerPath, new Date().toISOString());
  return exePath;
}

if (isMain) {
  fetchCli()
    .then((path) => console.log(path))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
