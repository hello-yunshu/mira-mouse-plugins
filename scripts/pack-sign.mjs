// SPDX-License-Identifier: AGPL-3.0-or-later
// 3.5 节：pack-sign.mjs 是 thin wrapper，所有打包/签名/校验逻辑由
// mira-plugin-cli 实现（与主仓库 runtime 共享同一个 allowlist）。
// 插件仓库不再维护自己的打包规则、allowlist 或 checksum 逻辑。
//
// 用法：
//   node scripts/pack-sign.mjs <plugin-dir> <output-path>
//
// 环境变量：
//   PLUGIN_SIGNING_KEY — 生产 PEM 私钥（或 base64 编码的 PEM）
//   PLUGIN_KEY_ID      — 生产 keyId（写入 manifest.publisherKeyId）
//   MIRA_PLUGIN_CLI    — 已下载的 mira-plugin 二进制路径（跳过 fetch）
//
// 若未设置 PLUGIN_SIGNING_KEY，CLI 会生成临时测试密钥（仅用于本地）。
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile, readdir, existsSync } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fetchCli } from './fetch-cli.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const keyId = process.env.PLUGIN_KEY_ID || 'TEST-ONLY-mira-plugins';

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function resolveCli() {
  if (process.env.MIRA_PLUGIN_CLI && existsSync(process.env.MIRA_PLUGIN_CLI)) {
    return process.env.MIRA_PLUGIN_CLI;
  }
  return fetchCli();
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

  const cli = await resolveCli();

  // 准备 staging 目录：把 plugin-dir 复制到临时目录，注入 publisherKeyId 后交给 CLI。
  // 这样不污染源仓库的 plugin.json，且 CLI pack 直接操作 staging 目录。
  const stage = await mkdtemp(join(tmpdir(), 'mira-pack-'));
  try {
    await copyDir(pluginDir, stage);
    manifest.publisherKeyId = keyId;
    await writeFile(join(stage, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');

    // 3.5 节：CLI pack 使用 runtime 共享的 allowlist 过滤文件。
    // 文档（README.md/LICENSE/docs/*.md）默认不进入生产包。
    const unsignedPath = join(stage, 'unsigned.mira-plugin');
    execFileSync(cli, ['pack', stage, '--output', unsignedPath], { stdio: 'inherit' });

    // 3.5 节：CLI sign 使用 PLUGIN_SIGNING_KEY 或 --key-hex。
    // 生产环境通过环境变量传入 PEM 私钥；CI secret 可能是 base64 编码的 PEM。
    execFileSync(cli, ['sign', unsignedPath, '--output', outPath], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    // 3.5 节：CLI inspect 验证刚生成的包（checksum + 签名）。
    execFileSync(cli, ['inspect', outPath, '--require-signature'], { stdio: 'inherit' });

    const sha256 = await sha256File(outPath);
    console.log(`packed: ${outPath}`);
    console.log(`asset:  ${assetName}`);
    console.log(`sha256: ${sha256}`);
    console.log(`keyId:  ${keyId}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function copyDir(src, dest) {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
    // 符号链接跳过：CLI pack 会拒绝符号链接。
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
