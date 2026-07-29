#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// 第 9.1 节：单插件校验包装脚本。
// 用法：node scripts/validate-plugin.mjs --plugin <pluginId|dir>
//
// 依次执行：
//   1. check-version-sources.mjs（仓库级版本源校验）
//   2. validate.mjs --plugin <id>（目标插件协议/workflow/capability 校验）
//   3. protocol-inventory.mjs --check-docs --plugin <id>（目标插件保留协议清单）
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const pluginIdx = argv.indexOf('--plugin');
if (pluginIdx < 0 || !argv[pluginIdx + 1]) {
  console.error('usage: node scripts/validate-plugin.mjs --plugin <pluginId|dir>');
  process.exit(2);
}
const plugin = argv[pluginIdx + 1];

const steps = [
  ['check-version-sources.mjs', []],
  ['validate.mjs', ['--plugin', plugin]],
  ['protocol-inventory.mjs', ['--check-docs', '--plugin', plugin]],
];

for (const [script, args] of steps) {
  const result = spawnSync(process.execPath, [join(__dirname, script), ...args], {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
  });
  if (result.status !== 0) {
    console.error(`step failed: ${script} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}
console.log(`validate:plugin ${plugin}: ok`);
