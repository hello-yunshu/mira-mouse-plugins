#!/usr/bin/env node
// 架构要求（第 3.6 节）：动态发现 plugins/*/plugin.json，不得硬编码插件列表。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DOC_PATH = join(ROOT, "docs/protocol-reserve-inventory.md");

// 动态发现插件：枚举 plugins/*/plugin.json
const PLUGINS = readdirSync(join(ROOT, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "plugins", entry.name, "plugin.json")))
  .map((entry) => entry.name)
  .sort();

// 支持 --plugin <id|dir> 单插件校验（第 9.1 节）
const pluginFilterIdx = process.argv.indexOf("--plugin");
if (pluginFilterIdx >= 0) {
  const filter = process.argv[pluginFilterIdx + 1];
  PLUGINS.length = 0;
  // 先按目录名匹配
  if (existsSync(join(ROOT, "plugins", filter, "plugin.json"))) {
    PLUGINS.push(filter);
  } else {
    // 再按 pluginId 匹配
    const all = readdirSync(join(ROOT, "plugins"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "plugins", entry.name, "plugin.json")))
      .map((entry) => entry.name);
    const match = all.find((name) => {
      try {
        const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", name, "plugin.json"), "utf8"));
        return manifest.pluginId === filter;
      } catch { return false; }
    });
    if (!match) throw new Error(`plugin not found: ${filter}`);
    PLUGINS.push(match);
  }
}

const checkDocs = process.argv.includes("--check-docs");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function collectStringFields(value, keys, out = new Set()) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectStringFields(item, keys, out);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key) && typeof child === "string") out.add(child);
    collectStringFields(child, keys, out);
  }
  return out;
}

function inventory(pluginId) {
  const base = join(ROOT, "plugins", pluginId);
  const commands = readJson(join(base, "protocol/commands.json")).commands ?? {};
  const parsers = readJson(join(base, "protocol/parsers.json")).parsers ?? {};
  const transports = readJson(join(base, "protocol/transports.json")).transports ?? {};
  const workflowsFile = readJson(join(base, "protocol/workflows.json"));
  const featuresPath = join(base, "protocol/features.json");
  const features = existsSync(featuresPath) ? readJson(featuresPath).features ?? {} : {};

  const usedCommands = new Set();
  const usedParsers = new Set();
  const workflowCommands = new Set();
  const workflowParsers = new Set();
  const featureRefs = new Set();

  for (const workflow of Object.values(workflowsFile.workflows ?? {})) {
    for (const step of workflow.steps ?? []) {
      if (step.command) {
        usedCommands.add(step.command);
        workflowCommands.add(step.command);
      }
      if (step.parser) {
        usedParsers.add(step.parser);
        workflowParsers.add(step.parser);
      }
      collectStringFields(step, ["featureRef"], featureRefs);
    }
  }

  for (const mutation of Object.values(workflowsFile.mutations ?? {})) {
    for (const command of [mutation.read?.command, mutation.writeCommand, mutation.verify?.command]) {
      if (command) usedCommands.add(command);
    }
    for (const parser of [mutation.read?.parser, mutation.verify?.parser]) {
      if (parser) usedParsers.add(parser);
    }
    collectStringFields(mutation, ["command"], usedCommands);
    collectStringFields(mutation, ["parser"], usedParsers);
    collectStringFields(mutation, ["featureRef"], featureRefs);
  }

  for (const transport of Object.values(transports)) {
    collectStringFields(
      transport,
      ["command", "startCommand", "pollCommand", "setLengthCommand", "readCommand"],
      usedCommands,
    );
    collectStringFields(transport, ["parser", "statusParser"], usedParsers);
  }

  const commandIds = Object.keys(commands).sort();
  const parserIds = Object.keys(parsers).sort();
  const featureIds = Object.keys(features).sort();
  return {
    pluginId,
    commandCount: commandIds.length,
    parserCount: parserIds.length,
    featureCount: featureIds.length,
    enabledCommands: commandIds.filter((id) => usedCommands.has(id)),
    reservedCommands: commandIds.filter((id) => !usedCommands.has(id)),
    enabledParsers: parserIds.filter((id) => usedParsers.has(id)),
    reservedParsers: parserIds.filter((id) => !usedParsers.has(id)),
    workflowCommands: [...workflowCommands].sort(),
    workflowParsers: [...workflowParsers].sort(),
    featureRefs: [...featureRefs].sort(),
    reservedFeatures: featureIds.filter((id) => !featureRefs.has(id)),
  };
}

const inventories = PLUGINS.map(inventory);

if (checkDocs) {
  const doc = readFileSync(DOC_PATH, "utf8");
  const missing = [];
  for (const item of inventories) {
    for (const id of [...item.reservedCommands, ...item.reservedParsers]) {
      if (!doc.includes(id)) missing.push(`${item.pluginId}: ${id}`);
    }
  }
  if (missing.length > 0) {
    console.error("docs/protocol-reserve-inventory.md is missing reserved protocol entries:");
    for (const id of missing) console.error(`  - ${id}`);
    process.exit(1);
  }
}

for (const item of inventories) {
  console.log(`${item.pluginId}: ${item.commandCount} commands, ${item.parserCount} parsers`);
  console.log(`  enabled commands: ${item.enabledCommands.length}`);
  console.log(`  reserved commands: ${item.reservedCommands.join(", ") || "(none)"}`);
  console.log(`  enabled parsers: ${item.enabledParsers.length}`);
  console.log(`  reserved parsers: ${item.reservedParsers.join(", ") || "(none)"}`);
  if (item.featureCount > 0) {
    console.log(`  feature registry: ${item.featureCount} entries, ${item.featureRefs.length} referenced`);
  }
}
