#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';

const plugins = ['amaster', 'logitech-hidpp'];
const fail = (message) => { throw new Error(message); };

const REQUIRED_FILES = [
  'plugin.json',
  'devices.json',
  'capabilities.json',
  'protocol/commands.json',
  'protocol/parsers.json',
  'protocol/transports.json',
  'protocol/workflows.json',
  'README.md',
  'LICENSE',
];

const pluginData = {};
for (const name of plugins) {
  const root = new URL(`../plugins/${name}/`, import.meta.url);
  const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const readOptional = async (path) => {
    try { return await read(path); } catch { return null; }
  };

  for (const path of REQUIRED_FILES) {
    try {
      await readFile(new URL(path, root), 'utf8');
    } catch {
      fail(`plugin ${name}: missing required file ${path}`);
    }
  }

  const [manifest, devices, commandsFile, parsersFile, transportsFile, workflowsFile, featuresFile] = await Promise.all([
    read('plugin.json'),
    read('devices.json'),
    read('protocol/commands.json'),
    read('protocol/parsers.json'),
    read('protocol/transports.json'),
    read('protocol/workflows.json'),
    readOptional('protocol/features.json'),
  ]);

  if (featuresFile) {
    expandFeatureRefs(name, featuresFile.features ?? {}, workflowsFile);
  }

  pluginData[name] = {
    manifest,
    devices,
    commands: commandsFile.commands,
    parsers: parsersFile.parsers,
    transports: transportsFile.transports,
    workflows: workflowsFile.workflows,
    mutations: workflowsFile.mutations ?? {},
  };

  const controlGroups = new Set();
  let statusItems = 0;
  for (const capability of manifest.capabilities ?? []) {
    for (const placement of capability.placements ?? []) {
      if (placement.region === 'control') controlGroups.add(placement.group ?? capability.id);
      if (placement.region === 'status') statusItems += 1;
    }
    const options = capability.metadata?.options;
    if (options !== undefined && (!Array.isArray(options) || options.length > 8)) {
      fail(`${name}/${capability.id}: invalid control option count`);
    }
    const summary = capability.metadata?.summary;
    if (summary === undefined) continue;
    if (!Array.isArray(summary) || summary.length > 4) fail(`${name}/${capability.id}: invalid summary count`);
    for (const item of summary) {
      if (!item || typeof item !== 'object' || typeof item.label !== 'string' || item.label.length === 0
        || typeof item.source !== 'string' || item.source.length === 0) {
        fail(`${name}/${capability.id}: invalid summary item`);
      }
      if (item.options !== undefined && (!Array.isArray(item.options) || item.options.length > 32)) {
        fail(`${name}/${capability.id}: invalid summary options`);
      }
    }
  }
  if (controlGroups.size > 6 || statusItems > 6) fail(`${name}: dashboard layout exceeds host limits`);
}

function expandFeatureRefs(pluginName, features, workflowsFile) {
  function resolve(name, context) {
    const entry = features[name];
    if (!entry) fail(`${pluginName}/${context}: unknown featureRef '${name}'`);
    return entry.decimal;
  }
  function expandObject(object, context) {
    if (object && typeof object === 'object') {
      if ('featureRef' in object) {
        object.featureId = resolve(object.featureRef, context);
        delete object.featureRef;
      }
      for (const [key, value] of Object.entries(object)) {
        expandValue(value, `${context} -> ${key}`);
      }
    }
  }
  function expandValue(value, context) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => expandValue(item, `${context} -> [${index}]`));
    } else if (value && typeof value === 'object') {
      expandObject(value, context);
    }
  }
  for (const [workflowId, workflow] of Object.entries(workflowsFile.workflows ?? {})) {
    for (const [stepIndex, step] of workflow.steps.entries()) {
      expandObject(step.params, `workflow ${workflowId} step ${stepIndex + 1}`);
    }
  }
  for (const [mutationId, mutation] of Object.entries(workflowsFile.mutations ?? {})) {
    expandObject(mutation.read?.params, `mutation ${mutationId} read`);
    expandObject(mutation.writeParams, `mutation ${mutationId} write`);
    expandObject(mutation.verify?.params, `mutation ${mutationId} verify`);
    if (mutation.memory) {
      expandObject(mutation.memory.contextParams, `mutation ${mutationId} memory context`);
      expandObject(mutation.memory.patchParams, `mutation ${mutationId} memory patch`);
    }
  }
}

for (const [name, data] of Object.entries(pluginData)) {
  const { commands, parsers, transports, workflows, mutations, manifest, devices } = data;

  for (const [id, command] of Object.entries(commands)) {
    const { length, bytes, checksum } = command.request;
    if (!Number.isInteger(length) || length < 1 || length > 1024) fail(`${name}/${id}: invalid length`);
    for (const byte of bytes) {
      if (byte.offset < 0 || byte.offset >= length) fail(`${name}/${id}: byte offset out of range`);
      if ((byte.value === undefined) === (byte.param === undefined)) fail(`${name}/${id}: byte must have exactly one source`);
      if (byte.encoding && !['u8', 'bool', 'le-u16', 'be-u16', 'rgb', 'bytes', 'lookup-u8'].includes(byte.encoding)) fail(`${name}/${id}: unsupported encoding`);
      if (byte.indexedBy && (!Number.isInteger(byte.stride) || byte.stride < 1)) fail(`${name}/${id}: invalid indexed stride`);
    }
    if (command.request.base && command.request.base !== 'read-response') fail(`${name}/${id}: invalid request base`);
    if (checksum) {
      if (checksum.algorithm !== 'ff-minus-sum8') fail(`${name}/${id}: unsupported checksum`);
      if (checksum.start < 0 || checksum.endExclusive > length || checksum.start >= checksum.endExclusive) fail(`${name}/${id}: invalid checksum range`);
      if (checksum.writeOffset < 0 || checksum.writeOffset >= length) fail(`${name}/${id}: invalid checksum output`);
    }
  }

  for (const [id, mutation] of Object.entries(mutations)) {
    if (!transports[mutation.transport]) fail(`${name}/${id}: missing mutation transport`);
    if (!commands[mutation.read.command] || !parsers[mutation.read.parser]) fail(`${name}/${id}: invalid pre-read`);
    if (!commands[mutation.writeCommand]) fail(`${name}/${id}: missing write command`);
    if (!Number.isInteger(mutation.settleMs) || mutation.settleMs < 0 || mutation.settleMs > 1000) fail(`${name}/${id}: invalid settle delay`);
    if (!commands[mutation.verify.command] || !parsers[mutation.verify.parser]) fail(`${name}/${id}: invalid verification read`);
    const preservesResponse = commands[mutation.writeCommand].request.base === 'read-response';
    if (preservesResponse !== mutation.preserveUnknown) fail(`${name}/${id}: write strategy does not match command template`);
    for (const assertion of mutation.verify.assertions) {
      if (!mutation.inputs[assertion.param]) fail(`${name}/${id}: assertion uses undeclared parameter`);
      if (assertion.indexParam && !mutation.inputs[assertion.indexParam]) fail(`${name}/${id}: assertion uses undeclared index`);
    }
    for (const guard of mutation.skipIfZero ?? []) {
      if (!guard.output || !guard.field) fail(`${name}/${id}: invalid skip guard`);
    }
    for (const guard of mutation.skipIfNonZero ?? []) {
      if (!guard.output || !guard.field) fail(`${name}/${id}: invalid skip-if-non-zero guard`);
    }
    if (mutation.onboardProfiles) {
      const cfg = mutation.onboardProfiles;
      if (!cfg.enabledWhen || !cfg.enabledWhen.output || !cfg.enabledWhen.field) fail(`${name}/${id}: onboardProfiles.enabledWhen required`);
      if (!cfg.profileFormat) fail(`${name}/${id}: onboardProfiles.profileFormat required`);
      if (!cfg.sectorSize || cfg.sectorSize < 16) fail(`${name}/${id}: onboardProfiles.sectorSize invalid`);
      if (cfg.reportRateOffset === undefined && cfg.ledOffset === undefined) fail(`${name}/${id}: onboardProfiles needs at least one offset`);
    }
    if (mutation.memory) {
      const memory = mutation.memory;
      if (!workflows[memory.readWorkflow]) fail(`${name}/${id}: missing memory read workflow`);
      if (!transports[memory.transport] || !transports[memory.endTransport]) fail(`${name}/${id}: missing memory transport`);
      for (const command of [memory.startCommand, memory.chunkCommand, memory.endCommand]) {
        if (!commands[command]) fail(`${name}/${id}: missing memory command ${command}`);
      }
      if (!Number.isInteger(memory.chunkSize) || memory.chunkSize < 1 || memory.chunkSize > 64) fail(`${name}/${id}: invalid memory chunk size`);
      if (memory.checksum !== 'crc-ccitt-false') fail(`${name}/${id}: unsupported memory checksum`);
      if (!Array.isArray(memory.patches) || memory.patches.length < 1) fail(`${name}/${id}: memory patches required`);
      for (const patch of memory.patches) {
        if ((patch.param === undefined) === (patch.value === undefined)) fail(`${name}/${id}: memory patch must have exactly one source`);
        if (patch.param !== undefined && !mutation.inputs[patch.param]) fail(`${name}/${id}: memory patch uses undeclared parameter`);
      }
    }
  }

  if (Object.keys(mutations).length > 0 && (!manifest.writesEnabled || manifest.evidence !== 'hardware-verified')) {
    fail(`${name}: declared writes require a hardware-verified writable manifest`);
  }

  for (const [id, transport] of Object.entries(transports)) {
    if (!['hid-feature', 'hid-feature-proxy', 'hid-output-input'].includes(transport.kind)) {
      fail(`${name}/${id}: unsupported transport kind`);
    }
    if (transport.kind === 'hid-output-input') {
      if (![0x10, 0x11, 0x12].includes(transport.reportId)) fail(`${name}/${id}: invalid HID++ report id`);
      if (transport.writeLength < 2 || transport.readLength < 2) fail(`${name}/${id}: invalid report length`);
      if (!Number.isInteger(transport.readTimeoutMs) || transport.readTimeoutMs < 1 || transport.readTimeoutMs > 5000) fail(`${name}/${id}: invalid read timeout`);
    }
    if (transport.kind === 'hid-feature-proxy') {
      if (!transports[transport.baseTransport]) fail(`${name}/${id}: missing base transport`);
      for (const key of ['startCommand', 'pollCommand', 'setLengthCommand', 'readCommand']) {
        if (!commands[transport[key]]) fail(`${name}/${id}: missing ${key}`);
      }
      if (!parsers[transport.statusParser]) fail(`${name}/${id}: missing status parser`);
    }
  }

  for (const [id, workflow] of Object.entries(workflows)) {
    if (!transports[workflow.transport]) fail(`${name}/${id}: missing transport`);
    for (const step of workflow.steps) {
      if (!commands[step.command]) fail(`${name}/${id}: missing command ${step.command}`);
      if (!parsers[step.parser]) fail(`${name}/${id}: missing parser ${step.parser}`);
      if (step.transport && !transports[step.transport]) fail(`${name}/${id}: missing step transport`);
      const candidates = Object.entries(step.paramCandidates ?? {});
      if (candidates.length > 1) fail(`${name}/${id}: only one candidate parameter is supported per step`);
      for (const [param, values] of candidates) {
        if (!Array.isArray(values) || values.length < 1 || values.length > 16) fail(`${name}/${id}: invalid candidates for ${param}`);
        if (Object.hasOwn(step.params ?? {}, param)) fail(`${name}/${id}: candidate parameter ${param} is also fixed`);
      }
      for (const [param, value] of Object.entries(step.params ?? {})) {
        if (value && typeof value === 'object') {
          const keys = Object.keys(value).sort().join(',');
          if (!['field,fromOutput', 'field,fromOutput,subtract'].includes(keys)) fail(`${name}/${id}: invalid output reference for ${param}`);
          if (value.subtract !== undefined && (!Number.isInteger(value.subtract) || value.subtract < 0)) fail(`${name}/${id}: invalid subtraction for ${param}`);
          const source = workflow.steps.find((candidate) => candidate.output === value.fromOutput);
          if (!source) fail(`${name}/${id}: missing referenced output ${value.fromOutput}`);
        }
      }
      for (const guard of step.skipIfZero ?? []) {
        const source = workflow.steps.find((candidate) => candidate.output === guard.output);
        if (!source) fail(`${name}/${id}: missing guard output ${guard.output}`);
      }
    }
  }

  const familyPrefixes = name === 'amaster' ? ['protocol-a-'] : ['hidpp2-'];
  for (const device of devices.devices) {
    for (const prefix of familyPrefixes) {
      if (device.family.startsWith(prefix) && !workflows[`${device.family}-read`]) {
        fail(`${name}/${device.family}: missing read workflow`);
      }
    }
  }

  console.log(`validate ${name}: ${Object.keys(commands).length} commands, ${Object.keys(parsers).length} parsers, ${Object.keys(workflows).length} workflows, ${Object.keys(mutations).length} mutations`);
}
