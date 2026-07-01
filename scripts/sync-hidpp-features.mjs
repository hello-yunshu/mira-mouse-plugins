#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Synchronizes the Logitech HID++ feature ID registry from upstream sources:
//   - vendor/solaar/lib/logitech_receiver/hidpp20_constants.py
//   - vendor/cpg-docs/hidpp20/features/
//
// Run from the repository root:
//   node scripts/sync-hidpp-features.mjs
//
// The script regenerates plugins/logitech-hidpp/protocol/features.json and
// prints a summary of additions/removals/changes. Review the diff before
// committing.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SOLAAR_CONSTANTS = join(
  ROOT,
  "vendor/solaar/lib/logitech_receiver/hidpp20_constants.py",
);
const SOLAAR_RAW_URL_TEMPLATE =
  "https://raw.githubusercontent.com/pwr-Solaar/Solaar/{sha}/lib/logitech_receiver/hidpp20_constants.py";
const CPG_DOCS_FEATURES = join(ROOT, "vendor/cpg-docs/hidpp20/features");
const OUT_PATH = join(
  ROOT,
  "plugins/logitech-hidpp/protocol/features.json",
);

const args = process.argv.slice(2);
const toStdout = args.includes("--stdout");
const checkMode = args.includes("--check");

const pySource = await loadPySource();
const features = parseSupportedFeature(pySource);
const documented = await loadDocumentedFeatures(CPG_DOCS_FEATURES);

const registry = {
  $schema: "./features.schema.json",
  generatedFrom: {
    solaar: {
      path: "vendor/solaar/lib/logitech_receiver/hidpp20_constants.py",
      license: "GPL-2.0-or-later",
    },
    cpgDocs: {
      path: "vendor/cpg-docs/hidpp20/features",
      license: "See upstream repository",
    },
  },
  generatedAt: new Date().toISOString(),
  features: Object.fromEntries(
    features.map(({ name, id }) => {
      const docs = documented.get(id);
      return [
        name,
        {
          id,
          decimal: Number.parseInt(id, 16),
          documented: docs?.file ?? null,
          sources: ["solaar", ...(docs ? ["cpg-docs"] : [])],
        },
      ];
    }),
  ),
};

const output = `${JSON.stringify(registry, null, 2)}\n`;

if (toStdout) {
  process.stdout.write(output);
} else if (!checkMode) {
  const previous = await readFile(OUT_PATH, "utf8").then(
    (text) => JSON.parse(text),
    () => ({ features: {} }),
  );

  try {
    await writeFile(OUT_PATH, output, "utf8");
  } catch (error) {
    console.error(`Failed to write ${OUT_PATH}: ${error.message}`);
    console.error("You can regenerate the file manually with:");
    console.error(`  node scripts/sync-hidpp-features.mjs --stdout > ${OUT_PATH}`);
    process.exit(1);
  }

  const diff = summarizeDiff(previous.features ?? {}, registry.features);
  console.log(`Wrote ${Object.keys(registry.features).length} features to ${OUT_PATH}`);
  if (diff.added.length) console.log(`  + added:   ${diff.added.join(", ")}`);
  if (diff.removed.length) console.log(`  - removed: ${diff.removed.join(", ")}`);
  if (diff.changed.length) console.log(`  ~ changed: ${diff.changed.join(", ")}`);
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
    console.log("  (no changes)");
  }
}

if (checkMode) {
  const previous = await readFile(OUT_PATH, "utf8").then(
    (text) => JSON.parse(text),
    () => ({}),
  );
  const diff = summarizeDiff(previous.features ?? {}, registry.features);
  const changed = diff.added.length || diff.removed.length || diff.changed.length;
  if (changed) {
    console.error("features.json is out of sync with upstream sources.");
    if (diff.added.length) console.error(`  + added:   ${diff.added.join(", ")}`);
    if (diff.removed.length) console.error(`  - removed: ${diff.removed.join(", ")}`);
    if (diff.changed.length) console.error(`  ~ changed: ${diff.changed.join(", ")}`);
    process.exit(1);
  }
  console.log("features.json is up to date.");
}

async function loadPySource() {
  if (checkMode) {
    const sha = resolveSolaarSha();
    if (sha) {
      try {
        const content = await fetchSolaarRaw(sha);
        if (content !== null) return content;
      } catch (error) {
        console.error(`warning: raw API fetch failed: ${error.message}`);
      }
    } else {
      console.error(
        "warning: could not resolve solaar submodule SHA; falling back to local file",
      );
    }
    try {
      return await readFile(SOLAAR_CONSTANTS, "utf8");
    } catch (error) {
      console.error(`error: local submodule file unavailable: ${error.message}`);
      console.error(
        "Initialize the submodule with `git submodule update --init vendor/solaar` or run without --check.",
      );
      process.exit(1);
    }
  }
  return await readFile(SOLAAR_CONSTANTS, "utf8");
}

// Resolve the submodule commit recorded in the superproject (gitlink) so the
// raw API content matches the locally checked-out file at the same commit.
function resolveSolaarSha() {
  try {
    const out = execFileSync("git", ["submodule", "status", "vendor/solaar"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = out.match(/^[+\-U ]?([0-9a-f]{7,40})\s/);
    if (match) return match[1];
  } catch {}
  try {
    const out = execFileSync(
      "git",
      ["ls-tree", "HEAD", "--", "vendor/solaar"],
      { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const match = out.match(/commit\s+([0-9a-f]{40})/);
    if (match) return match[1];
  } catch {}
  return null;
}

async function fetchSolaarRaw(sha) {
  const url = SOLAAR_RAW_URL_TEMPLATE.replace("{sha}", sha);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`warning: raw API returned ${res.status} for ${url}`);
    return null;
  }
  return await res.text();
}

function parseSupportedFeature(source) {
  const result = [];
  const classMatch = source.match(/class SupportedFeature\(IntEnum\):([\s\S]*?)(?=\nclass |\ndef |\n\n[A-Z])/);
  if (!classMatch) throw new Error("SupportedFeature enum not found in Solaar constants");

  const body = classMatch[1];
  const linePattern = /^\s+([A-Z][A-Z0-9_]*)\s*=\s*(0x[0-9A-Fa-f]+)/gm;
  let match;
  while ((match = linePattern.exec(body)) !== null) {
    const [, name, id] = match;
    result.push({ name, id });
  }
  return result;
}

async function loadDocumentedFeatures(dir) {
  const map = new Map();
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const match = entry.match(/^0x([0-9A-Fa-f]{4})-.+\.rst$/);
      if (match) {
        map.set(`0x${match[1].toUpperCase()}`, { file: entry });
      }
    }
  } catch {
    // cpg-docs may not have a features directory yet.
  }
  return map;
}

function summarizeDiff(previous, current) {
  const previousKeys = Object.keys(previous);
  const currentKeys = Object.keys(current);
  const previousSet = new Set(previousKeys);
  const currentSet = new Set(currentKeys);
  const added = currentKeys.filter((k) => !previousSet.has(k));
  const removed = previousKeys.filter((k) => !currentSet.has(k));
  const changed = currentKeys.filter((k) => {
    if (!previous[k]) return false;
    return previous[k].id !== current[k].id || previous[k].decimal !== current[k].decimal;
  });
  return { added, removed, changed };
}
