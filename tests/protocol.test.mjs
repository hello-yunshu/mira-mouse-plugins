// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('protocol A checksum uses ones-complement sum8', async () => {
  const fixture = await read('plugins/amaster/tests/fixtures/protocol-a-checksum.json');
  const checksum = 0xff - (fixture.input.reduce((sum, byte) => sum + byte, 0) & 0xff);
  assert.equal(checksum, fixture.expectedChecksum);
});
test('protocol A commands write checksum at payload offset 7', async () => {
  const commands = await read('plugins/amaster/protocol/commands.json');
  for (const [id, command] of Object.entries(commands.commands)) {
    const checksum = command.request.checksum;
    if (checksum && id !== 'receiver-lighting-write') {
      assert.equal(checksum.algorithm, 'ff-minus-sum8', id);
      assert.equal(checksum.endExclusive, 7, id);
      assert.equal(checksum.writeOffset, 7, id);
    }
  }
});
test('receiver control commands intentionally have no mouse checksum', async () => {
  const commands = await read('plugins/amaster/protocol/commands.json');
  for (const id of ['receiver-start', 'receiver-poll', 'receiver-set-length', 'receiver-read']) {
    assert.equal(commands.commands[id].request.checksum, null, id);
  }
  assert.equal(commands.commands['receiver-start'].request.bytes[1].value, '0x05');
});
test('AM35 fixture validates little-endian command id', async () => {
  const fixture = await read('plugins/amaster/tests/fixtures/am35-fragment.json');
  assert.equal(fixture.payload[4] | (fixture.payload[5] << 8), fixture.expectedCommandIdLittleEndian);
});
test('research plugins stay read-only and expose evidence-scoped descriptors', async () => {
  const emptyWhitelist = ['razer-viper'];
  for (const name of emptyWhitelist) {
    const manifest = await read(`plugins/${name}/plugin.json`);
    const devices = await read(`plugins/${name}/devices.json`);
    assert.equal(manifest.writesEnabled, false);
    assert.deepEqual(devices.devices, []);
  }
  const logitech = await read('plugins/logitech-hidpp/plugin.json');
  const logitechDevices = await read('plugins/logitech-hidpp/devices.json');
  assert.equal(logitech.writesEnabled, true);
  assert.equal(logitech.evidence, 'hardware-verified');
  assert.ok(logitechDevices.devices.length > 0, 'logitech-hidpp should expose discovery descriptors');
  for (const device of logitechDevices.devices) {
    assert.ok(['source-confirmed', 'protocol-verified', 'hardware-verified'].includes(device.evidence), `${device.family}: descriptor evidence must be reviewable`);
  }
  assert.ok(logitechDevices.hardwareVerifiedModels.length > 0, 'logitech-hidpp should list hardware-verified models');
});
test('receiver lighting type remains unnamed', async () => {
  const commands = await read('plugins/amaster/protocol/commands.json');
  assert.equal(commands.am35.receiverLightingType.status, 'unknown');
  assert.deepEqual(commands.am35.receiverLightingType.namedValues, {});
});
test('receiver workflow reads mouse color from settings and receiver light locally', async () => {
  const workflows = await read('plugins/amaster/protocol/workflows.json');
  const steps = workflows.workflows['protocol-a-receiver-read'].steps;
  const receiver = steps.find((step) => step.output === 'receiverLighting');
  assert.equal(steps.some((step) => step.output === 'mouseLighting'), false);
  assert.equal(steps.find((step) => step.output === 'settings').transport, undefined);
  assert.equal(receiver.command, 'lighting');
  assert.equal(receiver.transport, 'protocol-a');
});

test('writable protocol A commands preserve readback and use setter command ids', async () => {
  const commands = (await read('plugins/amaster/protocol/commands.json')).commands;
  const setters = {
    'dpi-stage-write': 0x54,
    'dpi-value-write': 0x54,
    'polling-rate-write': 0x53,
    'bluetooth-sleep-write': 0x53,
    'wireless-sleep-write': 0x53,
    'mouse-lighting-write': 0x53,
    'receiver-lighting-write': 0x08,
  };
  for (const [id, commandId] of Object.entries(setters)) {
    assert.equal(commands[id].request.base, id === 'receiver-lighting-write' ? undefined : 'read-response', id);
    assert.equal(Number(commands[id].request.bytes[0].value), commandId, id);
  }
  assert.equal(commands['receiver-lighting-write'].request.checksum.endExclusive, 8);
  assert.equal(commands['receiver-lighting-write'].request.checksum.writeOffset, 8);
  assert.equal(commands['bluetooth-sleep-write'].request.bytes.at(-1).offset, 40);
  assert.equal(commands['wireless-sleep-write'].request.bytes.at(-1).offset, 44);
});

test('every mutation performs pre-read and readback assertions', async () => {
  const { mutations } = await read('plugins/amaster/protocol/workflows.json');
  const commands = (await read('plugins/amaster/protocol/commands.json')).commands;
  assert.ok(Object.keys(mutations).length >= 9);
  for (const [id, mutation] of Object.entries(mutations)) {
    assert.ok(mutation.read.command, id);
    assert.ok(mutation.writeCommand, id);
    assert.ok(mutation.verify.command, id);
    assert.ok(mutation.verify.assertions.length > 0, id);
    assert.equal(commands[mutation.writeCommand].request.base === 'read-response', mutation.preserveUnknown, id);
  }
});

test('AMaster declares complete host-rendered capability metadata', async () => {
  const manifest = await read('plugins/amaster/plugin.json');
  const { mutations } = await read('plugins/amaster/protocol/workflows.json');
  const capabilities = Object.fromEntries(manifest.capabilities.map((capability) => [capability.id, capability]));
  assert.equal(capabilities.dpi.metadata.section, 'control');
  assert.equal(capabilities['polling-rate'].metadata.mutation, 'set-polling-rate');
  assert.deepEqual(
    capabilities['polling-rate'].metadata.summary.map(({ label, source }) => ({ label, source })),
    [
      { label: '运动同步', source: 'capabilities.settings.motionSync' },
      { label: '角度吸附', source: 'capabilities.settings.angleSnap' },
      { label: '抬升高度', source: 'capabilities.settings.liftCutOff' },
    ],
  );
  assert.equal(capabilities.lighting.control, 'LightingZone');
  assert.equal(capabilities.lighting.metadata.mutations.mouse, 'set-mouse-lighting');
  assert.equal(capabilities.profile.metadata.section, 'status');
  assert.equal(capabilities.firmware.metadata.section, 'details');
  assert.deepEqual(
    capabilities['sleep-time'].metadata.bindings.map((binding) => binding.when.eq),
    ['bluetooth', 'wireless', 'virtual'],
  );
  for (const binding of capabilities['sleep-time'].metadata.bindings) {
    assert.ok(
      Object.keys(mutations).some((id) => id.endsWith(`-${binding.mutation}`)),
      `missing ${binding.mutation}`,
    );
  }
  assert.deepEqual(capabilities.dpi.placements[0], {
    region: 'control', group: 'performance', order: 10, span: 1, icon: 'gauge',
  });
  assert.deepEqual(capabilities.lighting.placements.map((placement) => placement.region), ['control', 'status']);
  assert.deepEqual(capabilities['button-mappings'].placements[0], {
    region: 'details', order: 40, span: 1, icon: 'info',
  });
});

test('logitech-hidpp exposes a read workflow per device family and writable mutations', async () => {
  const manifest = await read('plugins/logitech-hidpp/plugin.json');
  const workflows = await read('plugins/logitech-hidpp/protocol/workflows.json');
  const devices = await read('plugins/logitech-hidpp/devices.json');
  const lighting = manifest.capabilities.find((capability) => capability.id === 'mouse-lighting');
  const polling = manifest.capabilities.find((capability) => capability.id === 'polling-rate');
  const dpi = manifest.capabilities.find((capability) => capability.id === 'dpi');
  const pointerSpeed = manifest.capabilities.find((capability) => capability.id === 'pointer-speed');
  const rgbControl = manifest.capabilities.find((capability) => capability.id === 'rgb-control');
  const profileCurrent = manifest.capabilities.find((capability) => capability.id === 'profile-mgmt-current');
  assert.equal(polling.metadata.summary.length, 2);
  assert.deepEqual(polling.metadata.mutation, ['set-polling-rate', 'set-polling-rate-extended']);
  assert.deepEqual(dpi.metadata.mutations.value, ['set-dpi-value', 'set-dpi-value-extended']);
  assert.equal(pointerSpeed.metadata.mutation, 'set-pointer-speed');
  assert.equal(rgbControl.metadata.mutation, 'set-rgb-control');
  assert.equal(profileCurrent.metadata.mutation, 'set-profile-mgmt-current');
  assert.equal(lighting.placements.find((placement) => placement.region === 'status').span, 1);
  const families = new Set(devices.devices.map((device) => device.family));
  for (const family of families) {
    assert.ok(workflows.workflows[`${family}-read`], `${family}: missing read workflow`);
  }
  const mutations = workflows.mutations ?? {};
  assert.deepEqual(Object.keys(mutations).sort(), [
    'hidpp2-device-set-control-mode',
    'hidpp2-device-set-dpi-value',
    'hidpp2-device-set-dpi-value-extended',
    'hidpp2-device-set-mouse-lighting',
    'hidpp2-device-set-pointer-speed',
    'hidpp2-device-set-polling-rate',
    'hidpp2-device-set-polling-rate-extended',
    'hidpp2-device-set-profile-mgmt-current',
    'hidpp2-device-set-rgb-control',
  ]);
  const expectedFeatureGate = {
    'hidpp2-device-set-control-mode': 'featureIndexOnboardProfiles',
    'hidpp2-device-set-dpi-value': 'featureIndexDpi',
    'hidpp2-device-set-dpi-value-extended': 'featureIndexExtendedDpi',
    'hidpp2-device-set-mouse-lighting': 'featureIndexColorLed',
    'hidpp2-device-set-pointer-speed': 'featureIndexPointerSpeed',
    'hidpp2-device-set-polling-rate': 'featureIndexReportRate',
    'hidpp2-device-set-polling-rate-extended': 'featureIndexExtendedReportRate',
    'hidpp2-device-set-profile-mgmt-current': 'featureIndexProfileManagement',
    'hidpp2-device-set-rgb-control': 'featureIndexRgbEffects',
  };
  for (const [id, mutation] of Object.entries(mutations)) {
    assert.ok(mutation.read.command, id);
    assert.ok(mutation.writeCommand, id);
    assert.ok(mutation.verify.command, id);
    assert.ok(mutation.verify.assertions.length > 0, id);
    assert.deepEqual(
      mutation.skipIfZero,
      [{ output: expectedFeatureGate[id], field: 'featureIndex' }],
      `${id}: mutation is not feature-gated`,
    );
    if (mutation.memory) {
      assert.deepEqual(
        mutation.memory.availableWhen,
        { output: 'featureIndexOnboardProfiles', field: 'featureIndex' },
        `${id}: onboard fallback is not feature-gated`,
      );
    }
  }
});

test('Logitech writes are protocol-gated without a model whitelist', async () => {
  const devices = await read('plugins/logitech-hidpp/devices.json');
  assert.equal(devices.devices.length, 1);
  assert.equal(devices.devices[0].productId, undefined);
  assert.equal(devices.devices[0].evidence, 'protocol-verified');

  const { mutations } = await read('plugins/logitech-hidpp/protocol/workflows.json');
  assert.equal(mutations['hidpp2-device-set-polling-rate'].onboardProfiles, undefined);
  assert.deepEqual(mutations['hidpp2-device-set-control-mode'].inputs.mode.allowed, [1, 2]);
  assert.equal(
    mutations['hidpp2-device-set-control-mode'].writeCommand,
    'onboard-set-mode',
  );
  assert.deepEqual(
    mutations['hidpp2-device-set-mouse-lighting'].memory.requiredWhen,
    [{ output: 'onboardDescription', field: 'profileFormatId', eq: 5 }],
  );
  assert.equal(
    mutations['hidpp2-device-set-profile-mgmt-current'].writeCommand,
    'profile-mgmt-set-current',
  );
  assert.equal(
    mutations['hidpp2-device-set-rgb-control'].writeCommand,
    'rgb-control-set',
  );
});

test('logitech-hidpp root-get-feature discovers feature indices via be-u16 featureId', async () => {
  const commands = (await read('plugins/logitech-hidpp/protocol/commands.json')).commands;
  const root = commands['root-get-feature'];
  assert.equal(root.request.length, 19);
  const featureIdByte = root.request.bytes.find((byte) => byte.param === 'featureId');
  // HID++ 2.0 encodes feature IDs as big-endian u16 (e.g. 0x1000 = BatteryStatus).
  assert.equal(featureIdByte.encoding, 'be-u16');
  // Byte 0 selects the paired receiver slot; the low nibble of byte 2 is a client id.
  assert.equal(root.request.bytes[0].param, 'deviceIndex');
  assert.equal(root.request.bytes[1].value, '0x00');
  assert.equal(root.request.bytes[2].value, '0x01');
  assert.equal(featureIdByte.offset, 3);
});

test('logitech-hidpp declares public HID++ pointer, RGB, and profile commands', async () => {
  const commands = (await read('plugins/logitech-hidpp/protocol/commands.json')).commands;
  assert.equal(commands['feature-set-get-count'].request.bytes[2].value, '0x00');
  assert.equal(commands['mouse-pointer-get'].request.bytes[2].value, '0x00');
  assert.equal(commands['pointer-speed-set'].request.bytes[2].value, '0x10');
  assert.equal(commands['pointer-speed-set'].request.bytes.find((byte) => byte.param === 'speed').encoding, 'be-u16');
  assert.equal(commands['rgb-effects-get-info'].request.bytes[2].value, '0x00');
  assert.deepEqual(
    commands['rgb-effects-get-info'].request.bytes.slice(3).map((byte) => byte.value),
    ['0xff', '0xff', '0x00'],
  );
  const rgbEnabledByte = commands['rgb-control-set'].request.bytes.find((byte) => byte.offset === 4);
  const rgbFlagsByte = commands['rgb-control-set'].request.bytes.find((byte) => byte.offset === 5);
  assert.equal(rgbEnabledByte.encoding, 'bool-lookup-u8');
  assert.deepEqual(rgbEnabledByte.lookup, { true: 3, false: 0 });
  assert.deepEqual(rgbFlagsByte.lookup, { true: 4, false: 0 });
  assert.equal(commands['profile-mgmt-set-current'].request.bytes[2].value, '0x30');
});

test('logitech-hidpp battery fixture uses the protocol percentage directly', async () => {
  const fixture = await read('plugins/logitech-hidpp/tests/fixtures/hidpp2-battery-status.json');
  const statusTable = { 0x00: 'discharging', 0x01: 'recharging', 0x02: 'charge-in-final-stage', 0x03: 'charge-complete', 0x04: 'recharging-below-optimal', 0x05: 'invalid-battery', 0x06: 'thermal-error' };
  const percentage = fixture.response[3];
  const statusRaw = fixture.response[5];
  assert.equal(percentage, fixture.expected.percentage);
  assert.equal(statusTable[statusRaw], fixture.expected.statusName);
});

test('logitech-hidpp workflows use discovered feature indices and skip unsupported features', async () => {
  const workflows = await read('plugins/logitech-hidpp/protocol/workflows.json');
  for (const workflow of Object.values(workflows.workflows)) {
    const first = workflow.steps[0];
    assert.deepEqual(first.paramCandidates.deviceIndex, [1, 2, 3, 4, 5, 6, 255]);
    for (const step of workflow.steps.filter((candidate) => candidate.command !== 'root-get-feature')) {
      assert.equal(typeof step.params.featureIndex, 'object', `${step.command}: feature index is still hard-coded`);
      if (step.params.featureIndex.fromOutput.startsWith('featureIndex')) {
        assert.ok(step.skipIfZero?.length, `${step.command}: missing unsupported-feature guard`);
      }
    }
    for (const step of workflow.steps.slice(1)) {
      assert.equal(step.params.deviceIndex.fromOutput, first.output, `${step.command}: device index is still hard-coded`);
    }
  }
});

test('G705 hardware fixtures preserve unified battery and adjustable DPI readback', async () => {
  const battery = await read('plugins/logitech-hidpp/tests/fixtures/g705-unified-battery.json');
  assert.equal(battery.response[3], battery.expected.percentage);
  assert.equal(battery.response[4], battery.expected.levelFlags);
  assert.equal(battery.response[5], battery.expected.chargingStatus);

  const dpi = await read('plugins/logitech-hidpp/tests/fixtures/g705-adjustable-dpi.json');
  assert.equal(dpi.response[3], dpi.expected.sensorIndex);
  assert.equal((dpi.response[4] << 8) | dpi.response[5], dpi.expected.dpiValue);
  assert.equal((dpi.response[6] << 8) | dpi.response[7], dpi.expected.defaultDpi);
});
