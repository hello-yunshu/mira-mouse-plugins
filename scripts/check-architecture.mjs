// SPDX-License-Identifier: AGPL-3.0-or-later
// Architecture lint: 插件仓库不得出现以下耦合（依据
// Mira_All_Plugins_Development_Requirements_Complete_Decoupling_Trae_Prompt_v7
// 第 3.6、3.7、3.8、9、11 节）：
//   1. 硬编码插件目录数组（必须动态发现 plugins/*/plugin.json）
//   2. 跨仓库 push/commit/checkout（sync-mira 类逻辑）
//   3. 统一 Release 全量枚举（必须 per-plugin Release）
//   4. 多套 package allowlist（必须使用统一 CLI）
//   5. registry 标记 signed 但没有真实签名
//   6. workflow 依赖 MIRA_APP_TOKEN（跨仓库 token）
//
// 本脚本必须可重复执行，输出 file:line:context 形式的违规清单。
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ignoredDirs = new Set([
  '.git',
  '.trae',
  'node_modules',
  'dist',
  'target',
  'vendor',
  // 插件包产物目录
  'staged',
]);

// 白名单文件：lint 自身需要列出品牌关键词作为检测规则。
const allowedFiles = new Set([
  'scripts/check-architecture.mjs',
]);

function normalize(rel) {
  return rel.split(sep).join('/');
}

const textExtensions = new Set([
  '.rs', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.toml', '.yaml', '.yml',
  '.md', '.rst', '.txt',
]);
function hasTextExt(rel) {
  for (const ext of textExtensions) {
    if (rel.endsWith(ext)) return true;
  }
  return false;
}

const violations = [];

// 1) 硬编码插件列表：检测 ['amaster', 'logitech-hidpp', 'razer-viper'] 风格的数组
//    允许：tests/ 下的测试断言（测试本身可以引用具体插件名）
//    允许：docs/ 下的文档
//    禁止：scripts/ 下的工具脚本（必须动态发现）
//    禁止：.github/workflows/ 下的 workflow（必须动态发现或按输入参数）
const hardcodedListPatterns = [
  {
    pattern: /\[\s*['"]amaster['"]\s*,\s*['"]logitech-hidpp['"]\s*,\s*['"]razer-viper['"]\s*\]/,
    label: '硬编码三个插件目录数组（必须改为 readdirSync("plugins") 动态发现）',
  },
  {
    pattern: /\[\s*["']amaster["']\s*,\s*["']logitech-hidpp["']\s*,\s*["']razer-viper["']\s*,?\s*\]/,
    label: '硬编码三个插件目录数组',
  },
];

// 2) 跨仓库写入：检测 sync-mira 类逻辑
//    - checkout 主仓库 hello-yunshu/mira-mouse
//    - push 到 mira-mouse
//    - 修改 plugins.lock.json
//    - 修改 tauri.conf.json
//    - MIRA_APP_TOKEN / MIRA_REPOSITORY
//    注意：同仓库的 git push origin HEAD:main 是合法的（例如 publish-registry.yml
//    提交 registry/index.json 到插件仓库自身），不算跨仓库写入。跨仓库 push 已
//    通过 MIRA_REPOSITORY / hello-yunshu/mira-mouse / cargo xtask 等模式捕获。
const crossRepoPatterns = [
  { pattern: /MIRA_APP_TOKEN/, label: '跨仓库 token MIRA_APP_TOKEN（插件发布不得依赖主仓库 token）' },
  { pattern: /MIRA_REPOSITORY/, label: '跨仓库变量 MIRA_REPOSITORY' },
  { pattern: /hello-yunshu\/mira-mouse/, label: '硬编码主仓库 hello-yunshu/mira-mouse（跨仓库写入）' },
  { pattern: /plugins\.lock\.json|bundled-plugins\.lock\.json/, label: '插件 workflow 修改主仓库 bundled-plugins.lock.json' },
  { pattern: /tauri\.conf\.json/, label: '插件 workflow 修改主仓库 tauri.conf.json' },
  { pattern: /cargo\s+run\s+--package\s+xtask/, label: '插件 workflow 调用主仓库 xtask（跨仓库依赖）' },
];

// 3) 统一 Release：检测覆盖式 Release、统一 tag
const unifiedReleasePatterns = [
  { pattern: /overwrite_latest/, label: 'overwrite_latest 覆盖式 Release（必须改为不可覆盖的 per-plugin Release）' },
  { pattern: /release\/v\d{4}-\d{2}-\d{2}/, label: '统一 Release tag release/vYYYY-MM-DD（必须改为 plugin/<plugin-id>/v<semver>）' },
];

// 4) 多套 package allowlist：检测脚本中自带打包逻辑
//    pack-sign.mjs 必须改为调用统一 mira-plugin-cli
const packerPatterns = [
  { pattern: /async\s+function\s+packPlugin|async\s+function\s+walkFiles.*pluginDir/, label: '插件仓库自带打包逻辑（必须改为调用已发布的 mira-plugin-cli）' },
  // 3.5 节：pack-sign.mjs 不得维护自己的 checksum/签名/zip 逻辑。
  { pattern: /schemaVersion\s*:\s*1.*files\s*:/, label: '插件仓库自带 checksums 构造（必须由 mira-plugin-cli 生成）' },
  { pattern: /sign\(null,\s*message/, label: '插件仓库自带 Ed25519 签名（必须由 mira-plugin-cli sign 生成）' },
  { pattern: /execFileSync\(['"]zip['"]/, label: '插件仓库直接调用 zip 命令打包（必须由 mira-plugin-cli pack 生成）' },
];

// 5) registry 签名：检测 "signed": true 但无真实 detached signature
//    第 3.8 节要求：
//    - signed: true 必须附带真实的 Ed25519 detached signature 结构
//    - signature.{keyId, algorithm, signedAt, payloadSha, value} 全部必填
//    - signature.algorithm 必须是 ed25519
//    - signature.payloadSha 必须是 64 字符 lowercase hex
//    - signature.value 必须是 128 字符 lowercase hex（64 字节 Ed25519 签名）
//    - 每个 entry 必须有 entrySha / packageSha / pluginApi / packageFormatVersion / yanked / minimumHostVersion / publishedAt / channel
//    - 含有 plugins 的 registry 必须是 signed: true（unsigned registry 不得包含插件条目）
function checkRegistrySignature(text, rel) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    // 非 JSON 或解析失败，跳过
    return;
  }
  if (!obj || typeof obj !== 'object') return;

  const hasPlugins = Array.isArray(obj.plugins) && obj.plugins.length > 0;

  // 含有插件条目的 registry 必须已签名（防止发布未签名的插件下载地址）
  if (hasPlugins && obj.signed !== true) {
    violations.push(`${rel}:0: registry-unsigned-with-plugins: registry.signed is ${obj.signed}, but plugins array is non-empty (run scripts/sign-registry.mjs before committing)`);
    return;
  }

  // 空 registry 允许 signed: false（初始状态，等待首次签名）
  if (obj.signed !== true) {
    return;
  }

  // 检查 signature 结构
  const sig = obj.signature;
  if (!sig || typeof sig !== 'object') {
    violations.push(`${rel}:0: registry-fake-sign: signed:true 但缺少 signature 对象（3.8 要求真实 Ed25519 detached signature）`);
  } else {
    const requiredFields = ['keyId', 'algorithm', 'signedAt', 'payloadSha', 'value'];
    for (const field of requiredFields) {
      if (!sig[field]) {
        violations.push(`${rel}:0: registry-fake-sign: signature.${field} 缺失（3.8 要求）`);
      }
    }
    if (sig.algorithm && sig.algorithm !== 'ed25519') {
      violations.push(`${rel}:0: registry-fake-sign: signature.algorithm=${sig.algorithm}, 只支持 ed25519`);
    }
    if (sig.payloadSha && !/^[a-f0-9]{64}$/.test(sig.payloadSha)) {
      violations.push(`${rel}:0: registry-fake-sign: signature.payloadSha 必须是 64 字符 lowercase hex（sha256）`);
    }
    if (sig.value && !/^[a-f0-9]{128}$/.test(sig.value)) {
      violations.push(`${rel}:0: registry-fake-sign: signature.value 必须是 128 字符 lowercase hex（64 字节 Ed25519 签名）`);
    }
    if (sig.signedAt && Number.isNaN(new Date(sig.signedAt).getTime())) {
      violations.push(`${rel}:0: registry-fake-sign: signature.signedAt 不是有效 ISO 时间戳: ${sig.signedAt}`);
    }
    // signature.keyId 不得是 TEST-ONLY 密钥（生产 registry 必须用生产密钥签名）
    if (sig.keyId && String(sig.keyId).startsWith('TEST-ONLY')) {
      violations.push(`${rel}:0: registry-fake-sign: signature.keyId=${sig.keyId} 是测试密钥（生产 registry 必须使用生产密钥签名）`);
    }
  }

  // publisherKeyId 必须存在且非 TEST-ONLY
  if (!obj.publisherKeyId) {
    violations.push(`${rel}:0: registry-fake-sign: 缺少 publisherKeyId（3.8 要求）`);
  } else if (String(obj.publisherKeyId).startsWith('TEST-ONLY')) {
    violations.push(`${rel}:0: registry-fake-sign: publisherKeyId=${obj.publisherKeyId} 是测试密钥（生产 registry 必须使用生产密钥）`);
  }

  // 每个 entry 必须有 entrySha / packageSha / pluginApi / packageFormatVersion / yanked / minimumHostVersion / publishedAt / channel
  if (Array.isArray(obj.plugins)) {
    for (const entry of obj.plugins) {
      const missing = [];
      if (!entry.entrySha) missing.push('entrySha');
      if (!entry.packageSha) missing.push('packageSha');
      if (!entry.pluginApi) missing.push('pluginApi');
      if (!entry.packageFormatVersion) missing.push('packageFormatVersion');
      if (entry.yanked === undefined) missing.push('yanked');
      if (!entry.minimumHostVersion) missing.push('minimumHostVersion');
      if (!entry.publishedAt) missing.push('publishedAt');
      if (!entry.channel) missing.push('channel');
      if (!entry.publisherKeyId) missing.push('publisherKeyId');
      if (!entry.releaseTag) missing.push('releaseTag');
      if (entry.releaseTag && !entry.releaseTag.startsWith('plugin/')) {
        violations.push(`${rel}:0: registry-legacy-tag: ${entry.pluginId}@${entry.version} releaseTag=${entry.releaseTag} 必须是 plugin/<plugin-id>/v<semver>`);
      }
      if (missing.length) {
        violations.push(`${rel}:0: registry-incomplete-entry: ${entry.pluginId}@${entry.version} 缺字段 ${missing.join(', ')}`);
      }
    }
  }
}

// 6) trusted-keys.json 结构检查（3.8 公钥 pinning）
function checkTrustedKeys(text, rel) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return;
  }
  if (!obj || typeof obj !== 'object') return;
  if (!Array.isArray(obj.keys)) {
    violations.push(`${rel}:0: trusted-keys-malformed: keys 数组缺失`);
    return;
  }
  for (const key of obj.keys) {
    if (!key.keyId) {
      violations.push(`${rel}:0: trusted-keys-malformed: key 缺少 keyId`);
    }
    if (key.algorithm && key.algorithm !== 'ed25519') {
      violations.push(`${rel}:0: trusted-keys-malformed: keyId=${key.keyId} algorithm=${key.algorithm}, 只支持 ed25519`);
    }
    if (key.publicKey && !/^[a-f0-9]{64}$/.test(key.publicKey)) {
      violations.push(`${rel}:0: trusted-keys-malformed: keyId=${key.keyId} publicKey 必须是 64 字符 lowercase hex（32 字节 Ed25519 公钥）`);
    }
    if (!key.activatedAt || Number.isNaN(new Date(key.activatedAt).getTime())) {
      violations.push(`${rel}:0: trusted-keys-malformed: keyId=${key.keyId} activatedAt 缺失或无效`);
    }
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!hasTextExt(rel)) continue;
    const normalized = normalize(rel);
    if (allowedFiles.has(normalized)) continue;
    const text = await readFile(path, 'utf8').catch(() => '');
    if (!text) continue;
    const lines = text.split(/\r?\n/);

    // 禁止在 scripts/ 下出现硬编码插件列表
    if (normalized.startsWith('scripts/')) {
      for (let i = 0; i < lines.length; i++) {
        for (const { pattern, label } of hardcodedListPatterns) {
          if (pattern.test(lines[i])) {
            violations.push(`${normalized}:${i + 1}: hardcoded-plugin-list: ${label} | ${lines[i].trim().slice(0, 160)}`);
          }
        }
      }
    }

    // 禁止在 .github/workflows/ 下出现跨仓库写入、统一 Release、自带打包
    if (normalized.startsWith('.github/workflows/')) {
      for (let i = 0; i < lines.length; i++) {
        for (const { pattern, label } of crossRepoPatterns) {
          if (pattern.test(lines[i])) {
            violations.push(`${normalized}:${i + 1}: cross-repo-write: ${label} | ${lines[i].trim().slice(0, 160)}`);
          }
        }
        for (const { pattern, label } of unifiedReleasePatterns) {
          if (pattern.test(lines[i])) {
            violations.push(`${normalized}:${i + 1}: unified-release: ${label} | ${lines[i].trim().slice(0, 160)}`);
          }
        }
        // workflow 中不得直接打包，必须调用 mira-plugin-cli
        if (normalized.endsWith('release.yml') || normalized.endsWith('publish-registry.yml')) {
          for (let i = 0; i < lines.length; i++) {
            for (const { pattern, label } of packerPatterns) {
              if (pattern.test(lines[i])) {
                violations.push(`${normalized}:${i + 1}: duplicate-packer: ${label} | ${lines[i].trim().slice(0, 160)}`);
              }
            }
          }
        }
      }
    }

    // scripts/pack-sign.mjs 不得再维护自己的打包规则
    if (normalized === 'scripts/pack-sign.mjs') {
      for (let i = 0; i < lines.length; i++) {
        for (const { pattern, label } of packerPatterns) {
          if (pattern.test(lines[i])) {
            violations.push(`${normalized}:${i + 1}: duplicate-packer: ${label} | ${lines[i].trim().slice(0, 160)}`);
          }
        }
      }
    }

    // registry/index.json 签名检查（3.8 真实签名）
    if (normalized === 'registry/index.json') {
      checkRegistrySignature(text, normalized);
    }
    // registry/trusted-keys.json 公钥 pinning 结构检查（3.8）
    if (normalized === 'registry/trusted-keys.json') {
      checkTrustedKeys(text, normalized);
    }
  }
}

await walk(root);

if (violations.length) {
  console.error(`\n架构 lint 失败：发现 ${violations.length} 处违规\n`);
  console.error(violations.join('\n'));
  console.error('\n参考：Mira_All_Plugins_Development_Requirements_Complete_Decoupling_Trae_Prompt_v7 第 3.6/3.7/3.8/9/11 节');
  process.exit(1);
}
console.log('architecture lint: clean (dynamic discovery ok, no cross-repo write, no unified release, no fake signature)');
