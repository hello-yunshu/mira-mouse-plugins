#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, access } from 'node:fs/promises';

const plugins = ['amaster', 'logitech-hidpp', 'razer-viper'];
const fail = (message) => { throw new Error(message); };
const HOST_DEVICE_CONNECTIONS = new Set(['usb', 'wireless', 'bluetooth', 'virtual']);
const VALUE_FORMATS = new Set(['sleep', 'color']);
const DECLARATIVE_CONTROLS = new Set(['Toggle', 'Segmented', 'Select', 'Slider', 'Number', 'Color', 'GradientStops', 'DpiStages', 'LightingZone', 'ReadOnlyValue', 'Action']);
const DECLARATIVE_METADATA = new Set(['accentSource', 'fields', 'zones', 'stageLayout', 'statusDisplay', 'stateMapping', 'batteryHistory', 'visibleWhen', 'summary']);
const EDITORS = new Set(['inline-toggle', 'inline-segmented', 'inline-value', 'inline-action', 'modal-select', 'modal-color', 'modal-range', 'modal-number', 'modal-dpi-stage', 'modal-gradient', 'static-readonly']);
const FORMATS = new Set(['sleep', 'percent', 'hertz', 'connection', 'color', 'default']);

const REQUIRED_FILES = [
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

  await Promise.all(REQUIRED_FILES.map(async (path) => {
    try {
      await access(new URL(path, root));
    } catch {
      fail(`plugin ${name}: missing required file ${path}`);
    }
  }));

  const [manifest, devices, commandsFile, parsersFile, transportsFile, workflowsFile, featuresFile] = await Promise.all([
    read('plugin.json'),
    read('devices.json'),
    read('protocol/commands.json'),
    read('protocol/parsers.json'),
    read('protocol/transports.json'),
    read('protocol/workflows.json'),
    readOptional('protocol/features.json'),
  ]);

  const assertTopLevelKeys = (file, value, allowed) => {
    const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
    if (unexpected.length > 0) fail(`${name}/${file}: unexpected top-level keys: ${unexpected.join(', ')}`);
  };
  assertTopLevelKeys('protocol/commands.json', commandsFile, new Set(['schemaVersion', 'commands']));
  assertTopLevelKeys('protocol/parsers.json', parsersFile, new Set(['schemaVersion', 'parsers']));
  assertTopLevelKeys('protocol/transports.json', transportsFile, new Set(['schemaVersion', 'transports']));
  assertTopLevelKeys('protocol/workflows.json', workflowsFile, new Set(['schemaVersion', 'workflows', 'mutations', 'transactions']));

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

  const manifestKeys = new Set([
    'schemaVersion', 'pluginId', 'name', 'version', 'pluginApi', 'publisherKeyId',
    'evidence', 'permissions', 'runtime', 'capabilities', 'writesEnabled',
    'exportableFields', 'dependsOn',
  ]);
  const unexpectedManifestKeys = Object.keys(manifest).filter((key) => !manifestKeys.has(key));
  if (unexpectedManifestKeys.length > 0) fail(`${name}/plugin.json: unexpected keys: ${unexpectedManifestKeys.join(', ')}`);
  validateRuntime(name, manifest.runtime);

  const controlGroups = new Set();
  let statusItems = 0;
  for (const capability of manifest.capabilities ?? []) {
    for (const placement of capability.placements ?? []) {
      if (placement.region === 'control') controlGroups.add(placement.group ?? capability.id);
      if (placement.region === 'status') statusItems += 1;
    }
    validateDeclarativeCapability(name, capability);
  }
  validateExportableFields(name, manifest.exportableFields ?? []);
  if (controlGroups.size > 6 || statusItems > 6) fail(`${name}: dashboard layout exceeds host limits`);
}

function validMutationRef(value) {
  if (typeof value === 'string') return value.length > 0;
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length > 0);
}
function validateRuntime(name, runtime) {
  if (runtime === undefined) return;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)
    || Object.keys(runtime).some((key) => key !== 'wakeRecovery' && key !== 'inventory')) {
    fail(`${name}: invalid runtime contract`);
  }
  const recovery = runtime.wakeRecovery;
  if (recovery === undefined) return;
  const allowed = new Set(['activitySource', 'componentId', 'connections']);
  if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)
    || Object.keys(recovery).some((key) => !allowed.has(key))
    || recovery.activitySource !== 'system-pointer'
    || typeof recovery.componentId !== 'string'
    || !/^[a-z][a-z0-9-]{0,31}$/.test(recovery.componentId)
    || !Array.isArray(recovery.connections)
    || recovery.connections.length === 0
    || recovery.connections.length > 4
    || new Set(recovery.connections).size !== recovery.connections.length
    || !recovery.connections.every((connection) => HOST_DEVICE_CONNECTIONS.has(connection))) {
    fail(`${name}: invalid runtime.wakeRecovery contract`);
  }
}

function validPath(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160; }
function validOptions(value, max = 32) {
  return Array.isArray(value) && value.length <= max && value.every((item) => item && typeof item === 'object'
    && ['string', 'number', 'boolean'].includes(typeof item.value) && typeof item.labelKey === 'string' && item.labelKey.length > 0);
}
function validRange(value) {
  return value && typeof value === 'object' && typeof value.min === 'number' && typeof value.max === 'number'
    && value.min <= value.max && (value.step === undefined || (typeof value.step === 'number' && value.step > 0));
}
function validWhen(value) {
  return value === undefined || (value && typeof value === 'object' && validPath(value.path));
}
function validBatteryHistory(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1
    && Array.isArray(value.validConnections) && value.validConnections.length > 0 && value.validConnections.length <= 4
    && value.validConnections.every((connection) => HOST_DEVICE_CONNECTIONS.has(connection))
    && new Set(value.validConnections).size === value.validConnections.length;
}
function validField(field) {
  if (!field || typeof field !== 'object' || !validPath(field.id) || !validPath(field.source) || !EDITORS.has(field.editor)) return false;
  if (field.mutation !== undefined && !validMutationRef(field.mutation)) return false;
  if (field.param !== undefined && !validPath(field.param)) return false;
  if (field.params !== undefined && (!field.params || typeof field.params !== 'object' || Array.isArray(field.params))) return false;
  if (field.paramSources !== undefined && (!field.paramSources || typeof field.paramSources !== 'object' || Array.isArray(field.paramSources)
    || Object.keys(field.paramSources).length === 0 || !Object.entries(field.paramSources).every(([param, source]) => validPath(param) && validPath(source)))) return false;
  if (field.editTitleKey !== undefined && !validPath(field.editTitleKey)) return false;
  if (field.editLabelKey !== undefined && !validPath(field.editLabelKey)) return false;
  if (field.options !== undefined && !validOptions(field.options)) return false;
  if (field.optionSource !== undefined && !validPath(field.optionSource)) return false;
  if (field.range !== undefined && !validRange(field.range)) return false;
  if (field.format !== undefined && !FORMATS.has(field.format)) return false;
  if (!validWhen(field.visibleWhen)) return false;
  return field.switch === undefined || (field.switch && typeof field.switch === 'object'
    && validPath(field.switch.source)
    && Object.hasOwn(field.switch, 'offValue')
    && (field.switch.restoreField === undefined || validPath(field.switch.restoreField)));
}
function validStageLayout(value) {
  return value && typeof value === 'object' && validPath(value.dotsSource) && validPath(value.valueSource)
    && validMutationRef(value.selectMutation) && validMutationRef(value.setMutation) && validRange(value.range)
    && ['selectParam', 'stageParam', 'valueParam'].every((key) => value[key] === undefined || validPath(value[key]));
}
function validSummary(value) {
  return Array.isArray(value) && value.length <= 4 && value.every((item) => item && typeof item === 'object'
    && (validPath(item.labelKey) || (typeof item.label === 'string' && item.label.length > 0 && item.label.length <= 24))
    && validPath(item.source)
    && (item.unit === undefined || (typeof item.unit === 'string' && item.unit.length <= 12))
    && (item.format === undefined || FORMATS.has(item.format))
    && (item.options === undefined || validOptions(item.options)));
}
function validateExportableFields(name, fields) {
  const allowed = new Set(['id', 'exportKey', 'kind', 'mutation', 'param', 'source', 'sources']);
  if (!Array.isArray(fields)) fail(`${name}: exportableFields must be an array`);
  const exportKeys = new Set();
  for (const field of fields) {
    if (!field || typeof field !== 'object' || Array.isArray(field)
      || !validPath(field.id) || !validPath(field.exportKey)
      || Object.keys(field).some((key) => !allowed.has(key))) {
      fail(`${name}: invalid exportable field declaration`);
    }
    if (exportKeys.has(field.exportKey)) fail(`${name}: duplicate exportable key ${field.exportKey}`);
    exportKeys.add(field.exportKey);
    if (field.kind !== undefined && !validPath(field.kind)) fail(`${name}/${field.id}: invalid export kind`);
    if (field.mutation !== undefined && (typeof field.mutation !== 'string' || !validPath(field.mutation))) fail(`${name}/${field.id}: invalid export mutation`);
    if (field.param !== undefined && !validPath(field.param)) fail(`${name}/${field.id}: invalid export param`);
    if (field.source !== undefined && !validPath(field.source)) fail(`${name}/${field.id}: invalid export source`);
    if (field.sources !== undefined && (!field.sources || typeof field.sources !== 'object' || Array.isArray(field.sources)
      || Object.keys(field.sources).length === 0 || !Object.entries(field.sources).every(([param, source]) => validPath(param) && validPath(source)))) {
      fail(`${name}/${field.id}: invalid export sources`);
    }
  }
}
function mutationRefs(value) {
  return typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
}
function validateFieldMutationCoverage(name, capabilityId, field) {
  if (field.mutation === undefined) return;
  const covered = new Set([
    ...Object.keys(field.params ?? {}),
    ...Object.keys(field.paramSources ?? {}),
  ]);
  if (field.editor !== 'inline-action') covered.add(field.param ?? 'value');
  for (const mutationRef of mutationRefs(field.mutation)) {
    const definitions = Object.entries(pluginData[name].mutations)
      .filter(([id]) => id === mutationRef || id.endsWith(`-${mutationRef}`))
      .map(([, mutation]) => mutation);
    if (definitions.length === 0) fail(`${name}/${capabilityId}/${field.id}: unknown mutation ${mutationRef}`);
    for (const definition of definitions) {
      const missing = Object.keys(definition.inputs ?? {}).filter((param) => !covered.has(param));
      if (missing.length > 0) {
        fail(`${name}/${capabilityId}/${field.id}: mutation ${mutationRef} is missing declared params ${missing.join(', ')}`);
      }
    }
  }
}
function validateDeclarativeCapability(name, capability) {
  if (!DECLARATIVE_CONTROLS.has(capability.control)) fail(`${name}/${capability.id}: unsupported legacy control ${capability.control}`);
  const metadata = capability.metadata ?? {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail(`${name}/${capability.id}: metadata must be an object`);
  for (const key of Object.keys(metadata)) if (!DECLARATIVE_METADATA.has(key)) fail(`${name}/${capability.id}: legacy metadata.${key} is not supported`);
  if (metadata.fields !== undefined && (!Array.isArray(metadata.fields) || metadata.fields.length > 32 || !metadata.fields.every(validField))) fail(`${name}/${capability.id}: invalid declarative fields`);
  if (metadata.zones !== undefined && (!Array.isArray(metadata.zones) || metadata.zones.length > 8 || !metadata.zones.every((zone) => zone && typeof zone === 'object' && validPath(zone.id) && typeof zone.labelKey === 'string' && Array.isArray(zone.fields) && zone.fields.length <= 32 && zone.fields.every(validField) && validWhen(zone.visibleWhen)))) fail(`${name}/${capability.id}: invalid declarative zones`);
  if (metadata.stageLayout !== undefined && !validStageLayout(metadata.stageLayout)) fail(`${name}/${capability.id}: invalid stageLayout`);
  const declaredFields = [
    ...(metadata.fields ?? []),
    ...(metadata.zones ?? []).flatMap((zone) => zone.fields ?? []),
  ];
  if (metadata.statusDisplay !== undefined && (
    !metadata.statusDisplay
    || typeof metadata.statusDisplay !== 'object'
    || !validPath(metadata.statusDisplay.valueSource)
    || (metadata.statusDisplay.labelKey !== undefined && !validPath(metadata.statusDisplay.labelKey))
    || (metadata.statusDisplay.valueOptions !== undefined && !validOptions(metadata.statusDisplay.valueOptions))
    || (metadata.statusDisplay.valueFormat !== undefined && !FORMATS.has(metadata.statusDisplay.valueFormat))
    || (metadata.statusDisplay.onClickField !== undefined && (
      !validPath(metadata.statusDisplay.onClickField)
      || !declaredFields.some((field) => field.id === metadata.statusDisplay.onClickField)
    ))
  )) fail(`${name}/${capability.id}: invalid statusDisplay`);
  if (metadata.summary !== undefined && !validSummary(metadata.summary)) fail(`${name}/${capability.id}: invalid summary`);
  if (metadata.accentSource !== undefined && !validPath(metadata.accentSource)) fail(`${name}/${capability.id}: invalid accentSource`);
  for (const field of metadata.fields ?? []) validateFieldMutationCoverage(name, capability.id, field);
  for (const zone of metadata.zones ?? []) for (const field of zone.fields) validateFieldMutationCoverage(name, capability.id, field);
  if (metadata.stateMapping !== undefined && (!metadata.stateMapping || typeof metadata.stateMapping !== 'object' || Object.values(metadata.stateMapping).some((value) => !validPath(value)))) fail(`${name}/${capability.id}: invalid stateMapping`);
  if (capability.id === 'battery' && !validBatteryHistory(metadata.batteryHistory)) fail(`${name}/${capability.id}: battery requires batteryHistory.validConnections`);
  if (capability.id !== 'battery' && metadata.batteryHistory !== undefined) fail(`${name}/${capability.id}: batteryHistory is only valid on the battery capability`);
  if (!validWhen(metadata.visibleWhen)) fail(`${name}/${capability.id}: invalid visibleWhen`);
  if (capability.readOnly) return;
  if (capability.control === 'DpiStages' && !validStageLayout(metadata.stageLayout)) fail(`${name}/${capability.id}: writable DpiStages requires stageLayout`);
  if (capability.control === 'LightingZone' && !metadata.zones?.some((zone) => zone.fields.some((field) => field.mutation !== undefined))) fail(`${name}/${capability.id}: writable LightingZone requires writable zone fields`);
  if (!['DpiStages', 'LightingZone'].includes(capability.control) && !metadata.fields?.some((field) => field.mutation !== undefined)) fail(`${name}/${capability.id}: writable capability requires a mutation field`);
}

function validBindingSources(bindings) {
  return Array.isArray(bindings) && bindings.length > 0
    && bindings.every((binding) => binding && typeof binding === 'object'
      && typeof binding.source === 'string' && binding.source.length > 0);
}

function validBindingMutations(bindings) {
  return Array.isArray(bindings) && bindings.length > 0
    && bindings.every((binding) => binding && typeof binding === 'object' && validMutationRef(binding.mutation));
}

function validMutationContract(metadata) {
  return validMutationRef(metadata?.mutation)
    || validMutationRef(metadata?.mutations?.default)
    || (validBindingSources(metadata?.bindings) && validBindingMutations(metadata?.bindings));
}

function validateNumberRange(name, capability) {
  const metadata = capability.metadata ?? {};
  for (const key of ['min', 'max', 'step']) {
    if (metadata[key] !== undefined && typeof metadata[key] !== 'number') {
      fail(`${name}/${capability.id}: ${key} must be numeric`);
    }
  }
  if (typeof metadata.step === 'number' && metadata.step <= 0) {
    fail(`${name}/${capability.id}: step must be greater than zero`);
  }
  if (typeof metadata.min === 'number' && typeof metadata.max === 'number' && metadata.min > metadata.max) {
    fail(`${name}/${capability.id}: min must be less than or equal to max`);
  }
}

function validatePresentationContract(name, capability) {
  const metadata = capability.metadata ?? {};
  if (metadata.format !== undefined && !VALUE_FORMATS.has(metadata.format)) {
    fail(`${name}/${capability.id}: invalid value format ${JSON.stringify(metadata.format)}`);
  }
  validateNumberRange(name, capability);
  if (capability.readOnly) return;

  if (capability.control === 'DpiStages') {
    if (!validMutationRef(metadata.mutations?.select) || !validMutationRef(metadata.mutations?.value)) {
      fail(`${name}/${capability.id}: writable DpiStages requires mutations.select and mutations.value`);
    }
    return;
  }
  if (capability.control === 'LightingZone') {
    if (!validMutationRef(metadata.lightingRole?.mouse) && !validMutationRef(metadata.lightingRole?.receiver)) {
      fail(`${name}/${capability.id}: writable LightingZone requires metadata.lightingRole`);
    }
    return;
  }
  if (capability.control === 'Select' || capability.control === 'Segmented') {
    if (!Array.isArray(metadata.options) || metadata.options.length === 0) {
      fail(`${name}/${capability.id}: ${capability.control} requires metadata.options`);
    }
    if (!validMutationContract(metadata)) {
      fail(`${name}/${capability.id}: writable ${capability.control} requires metadata.mutation or binding mutations`);
    }
    return;
  }
  if (['Toggle', 'Number', 'Slider', 'Color', 'Action'].includes(capability.control)
    && !validMutationContract(metadata)) {
    fail(`${name}/${capability.id}: writable ${capability.control} requires metadata.mutation or binding mutations`);
  }
}

function validateDeviceIdentity(name, device) {
  if (device.identity === undefined) return;
  const { identity } = device;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    fail(`${name}/${device.family}: identity must be an object`);
  }
  if (typeof identity.group !== 'string' || identity.group.trim().length === 0) {
    fail(`${name}/${device.family}: identity.group is required`);
  }
  if (identity.displayName !== undefined && (typeof identity.displayName !== 'string' || identity.displayName.trim().length === 0)) {
    fail(`${name}/${device.family}: identity.displayName must be non-empty`);
  }
  if (identity.aliases !== undefined) {
    if (!Array.isArray(identity.aliases)) fail(`${name}/${device.family}: identity.aliases must be an array`);
    for (const alias of identity.aliases) {
      if (typeof alias !== 'string' || alias.trim().length === 0) {
        fail(`${name}/${device.family}: identity.aliases must contain non-empty strings`);
      }
    }
  }
}

function validateDeviceSelection(name, device) {
  const validatePriority = (path, value) => {
    if (!Number.isInteger(value) || value < -1000 || value > 1000) {
      fail(`${name}/${device.family}: ${path} must be an integer between -1000 and 1000`);
    }
  };
  if (device.selectionPriority !== undefined) {
    validatePriority('selectionPriority', device.selectionPriority);
  }
  if (device.selectionPriorityByConnection === undefined) return;
  const priorities = device.selectionPriorityByConnection;
  if (!priorities || typeof priorities !== 'object' || Array.isArray(priorities)) {
    fail(`${name}/${device.family}: selectionPriorityByConnection must be an object`);
  }
  const validConnections = new Set(['usb', 'wireless', 'bluetooth', 'virtual']);
  for (const [connection, priority] of Object.entries(priorities)) {
    if (!validConnections.has(connection)) {
      fail(`${name}/${device.family}: selectionPriorityByConnection has unknown connection ${connection}`);
    }
    validatePriority(`selectionPriorityByConnection.${connection}`, priority);
  }
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
      if (byte.encoding && !['u8', 'bool', 'le-u16', 'be-u16', 'rgb', 'bytes', 'lookup-u8', 'bool-lookup-u8', 'hue-index-be-u16'].includes(byte.encoding)) fail(`${name}/${id}: unsupported encoding`);
      if (byte.indexedBy && (!Number.isInteger(byte.stride) || byte.stride < 1)) fail(`${name}/${id}: invalid indexed stride`);
    }
    if (command.request.base && command.request.base !== 'read-response') fail(`${name}/${id}: invalid request base`);
    if (checksum) {
      if (!['ff-minus-sum8', 'xor8'].includes(checksum.algorithm)) fail(`${name}/${id}: unsupported checksum`);
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

  for (const capability of manifest.capabilities ?? []) {
    if (capability.metadata && Object.hasOwn(capability.metadata, 'description')) {
      fail(`${name}/${capability.id}: capability metadata.description is developer copy; use docs or locales instead`);
    }
  }

  for (const [id, transport] of Object.entries(transports)) {
    if (!['hid-feature', 'hid-feature-proxy', 'hid-output-input', 'hid-race'].includes(transport.kind)) {
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
    if (transport.kind === 'hid-race') {
      if (![0x06, 0x07].includes(transport.writeReportId)) fail(`${name}/${id}: invalid race write report id`);
      if (![0x06, 0x07].includes(transport.readReportId)) fail(`${name}/${id}: invalid race read report id`);
      if (transport.writeLength < 2 || transport.readLength < 2) fail(`${name}/${id}: invalid race report length`);
      if (![0, 128].includes(transport.raceType)) fail(`${name}/${id}: invalid race type`);
      if (!['interrupt', 'input-report'].includes(transport.readMode ?? 'interrupt')) fail(`${name}/${id}: invalid race read mode`);
      if (!Number.isInteger(transport.readDelayMs ?? 0) || (transport.readDelayMs ?? 0) < 0 || (transport.readDelayMs ?? 0) > 500) fail(`${name}/${id}: invalid race read delay`);
      if (!Number.isInteger(transport.readTimeoutMs) || transport.readTimeoutMs < 1 || transport.readTimeoutMs > 5000) fail(`${name}/${id}: invalid read timeout`);
      if (!Number.isInteger(transport.readRetries) || transport.readRetries < 1 || transport.readRetries > 100) fail(`${name}/${id}: invalid race read retries`);
    }
  }

  for (const [id, workflow] of Object.entries(workflows)) {
    if (!transports[workflow.transport]) fail(`${name}/${id}: missing transport`);
    const stepByOutput = new Map(workflow.steps.map((s) => [s.output, s]));
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
          const source = stepByOutput.get(value.fromOutput);
          if (!source) fail(`${name}/${id}: missing referenced output ${value.fromOutput}`);
        }
      }
      for (const guard of step.skipIfZero ?? []) {
        const source = stepByOutput.get(guard.output);
        if (!source) fail(`${name}/${id}: missing guard output ${guard.output}`);
      }
    }
  }

  const familyPrefixes = name === 'amaster' ? ['protocol-a-', 'am35-'] : name === 'razer-viper' ? ['razer-'] : ['hidpp2-'];
  for (const device of devices.devices) {
    validateDeviceIdentity(name, device);
    validateDeviceSelection(name, device);
    for (const prefix of familyPrefixes) {
      if (device.family.startsWith(prefix) && !workflows[`${device.family}-read`]) {
        fail(`${name}/${device.family}: missing read workflow`);
      }
    }
  }

  console.log(`validate ${name}: ${Object.keys(commands).length} commands, ${Object.keys(parsers).length} parsers, ${Object.keys(workflows).length} workflows, ${Object.keys(mutations).length} mutations`);
}
