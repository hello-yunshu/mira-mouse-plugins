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

test('AMaster declares complete declarative host capability metadata', async () => {
  const manifest = await read('plugins/amaster/plugin.json');
  const { mutations } = await read('plugins/amaster/protocol/workflows.json');
  const capabilities = Object.fromEntries(manifest.capabilities.map((capability) => [capability.id, capability]));
  assert.equal(capabilities.dpi.metadata.stageLayout.selectMutation, 'set-dpi-stage');
  assert.equal(capabilities['polling-rate'].metadata.fields[0].mutation, 'set-polling-rate');
  assert.equal(capabilities['polling-rate'].metadata.fields[0].optionSource, 'state.supportedPollingRates');
  assert.equal(capabilities.lighting.control, 'LightingZone');
  assert.equal(capabilities.lighting.metadata.statusDisplay.valueFormat, 'color');
  assert.deepEqual(capabilities.lighting.metadata.zones.map((zone) => zone.id), ['mouse', 'receiver']);
  assert.equal(capabilities.lighting.metadata.zones[0].fields[0].mutation, 'set-mouse-lighting');
  assert.equal(capabilities.profile.metadata.statusDisplay.valueSource, 'state.profile');
  assert.equal(capabilities.firmware.metadata.fields[0].editor, 'static-readonly');
  for (const field of capabilities['sleep-time'].metadata.fields) {
    assert.ok(
      Object.keys(mutations).some((id) => id.endsWith(`-${field.mutation}`)),
      `missing ${field.mutation}`,
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

test('battery history eligibility is declared by each plugin', async () => {
  const amaster = await read('plugins/amaster/plugin.json');
  const logitech = await read('plugins/logitech-hidpp/plugin.json');
  const batteryPolicy = (manifest) => manifest.capabilities.find((capability) => capability.id === 'battery')?.metadata?.batteryHistory;

  assert.deepEqual(batteryPolicy(amaster).validConnections, ['wireless', 'bluetooth']);
  assert.deepEqual(batteryPolicy(logitech).validConnections, ['wireless']);
});

test('AMaster declares plugin-owned identity for Protocol A connection aliases', async () => {
  const devices = await read('plugins/amaster/devices.json');
  const protocolADevices = devices.devices.filter((device) => device.family.startsWith('protocol-a-'));
  assert.equal(protocolADevices.length, 4);
  for (const device of protocolADevices) {
    assert.equal(device.identity.group, 'am-infinity-8k-mouse', device.family);
    assert.equal(device.identity.displayName, 'AM INFINITY 8K MOUSE', device.family);
    assert.ok(device.identity.aliases.includes('amaster protocol-a-direct'), device.family);
    assert.ok(device.identity.aliases.includes('amaster protocol-a-receiver'), device.family);
  }
});

test('logitech-hidpp exposes a read workflow per device family and writable mutations', async () => {
  const manifest = await read('plugins/logitech-hidpp/plugin.json');
  const workflows = await read('plugins/logitech-hidpp/protocol/workflows.json');
  const devices = await read('plugins/logitech-hidpp/devices.json');
  const lighting = manifest.capabilities.find((capability) => capability.id === 'mouse-lighting');
  const polling = manifest.capabilities.find((capability) => capability.id === 'polling-rate');
  const dpi = manifest.capabilities.find((capability) => capability.id === 'dpi');
  const pointerSpeed = manifest.capabilities.find((capability) => capability.id === 'pointer-speed');
  const profileCurrent = manifest.capabilities.find((capability) => capability.id === 'profile-mgmt-current');
  assert.equal(manifest.capabilities.some((capability) => capability.metadata?.description), false);
  assert.deepEqual(polling.metadata.fields[0].mutation, ['set-polling-rate', 'set-polling-rate-extended']);
  assert.deepEqual(dpi.metadata.stageLayout.setMutation, ['set-dpi-value', 'set-dpi-value-extended']);
  assert.equal(pointerSpeed.metadata.fields[0].mutation, 'set-pointer-speed');
  assert.equal(profileCurrent.metadata.fields[0].mutation, 'set-profile-mgmt-current');
  assert.equal(lighting.metadata.zones[0].fields[0].mutation, 'set-mouse-lighting');
  assert.equal(lighting.metadata.statusDisplay.valueFormat, 'color');
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
    'hidpp2-device-set-mouse-lighting-onboard',
    'hidpp2-device-set-pointer-speed',
    'hidpp2-device-set-polling-rate',
    'hidpp2-device-set-polling-rate-extended',
    'hidpp2-device-set-profile-mgmt-current',
  ]);
  // Mutations gated by the standard skipIfZero primitive.
  // Mutations WITH a memory path (set-dpi-value, set-polling-rate,
  // set-mouse-lighting) are intentionally NOT gated by controlMode.hostMode:
  // their memory.enabledWhen already restricts the onboard-memory patch to
  // onboard mode (mode eq 1), and the direct-write path covers host mode.
  // Hiding them via skipIfZero:hostMode would make the memory path dead code
  // in the exact mode (onboard) where it is the only correct path.
  // Mutations WITHOUT a memory path (set-dpi-value-extended, set-pointer-speed,
  // set-polling-rate-extended, set-profile-mgmt-current) only work in host
  // mode, so skipIfZero:hostMode correctly hides them in onboard mode.
  const skipIfZeroGated = {
    'hidpp2-device-set-control-mode': [
      { output: 'featureIndexOnboardProfiles', field: 'featureIndex' },
    ],
    'hidpp2-device-set-dpi-value': [
      { output: 'featureIndexDpi', field: 'featureIndex' },
    ],
    'hidpp2-device-set-dpi-value-extended': [
      { output: 'featureIndexExtendedDpi', field: 'featureIndex' },
      { output: 'controlMode', field: 'hostMode' },
    ],
    'hidpp2-device-set-pointer-speed': [
      { output: 'featureIndexPointerSpeed', field: 'featureIndex' },
      { output: 'controlMode', field: 'hostMode' },
    ],
    'hidpp2-device-set-polling-rate': [
      { output: 'featureIndexReportRate', field: 'featureIndex' },
    ],
    'hidpp2-device-set-polling-rate-extended': [
      { output: 'featureIndexExtendedReportRate', field: 'featureIndex' },
      { output: 'controlMode', field: 'hostMode' },
    ],
    'hidpp2-device-set-profile-mgmt-current': [
      { output: 'featureIndexProfileManagement', field: 'featureIndex' },
      { output: 'controlMode', field: 'hostMode' },
    ],
  };
  // Lighting mutations use multi-primitive gating: skipIfAllZero hides when no
  // relevant feature exists; writeSkipIfZero skips the direct write when only
  // the onboard path is available; skipIfNonZero (onboard variant) hides when
  // the direct-write path, format V5, or host mode already covers the device.
  // set-mouse-lighting has a memory path (requiredWhen: profileFormatId eq 5)
  // so it must stay visible in onboard mode for G705-style devices.
  // set-mouse-lighting-onboard has no direct-write fallback, so skipIfNonZero:
  // hostMode hides it in host mode where it would be a silent no-op.
  const lightingGating = {
    'hidpp2-device-set-mouse-lighting': {
      skipIfAllZero: ['featureIndexColorLed', 'featureIndexOnboardProfiles'],
      writeSkipIfZero: ['featureIndexColorLed'],
    },
    'hidpp2-device-set-mouse-lighting-onboard': {
      skipIfNonZero: ['featureIndexColorLed', 'onboardDescription', 'controlMode'],
      skipIfAllZero: ['featureIndexOnboardProfiles'],
      writeSkipIfZero: ['featureIndexColorLed'],
    },
  };
  for (const [id, mutation] of Object.entries(mutations)) {
    assert.ok(mutation.read.command, id);
    assert.ok(mutation.writeCommand, id);
    assert.ok(mutation.verify.command, id);
    assert.ok(mutation.verify.assertions.length > 0, id);
    if (skipIfZeroGated[id]) {
      assert.deepEqual(
        mutation.skipIfZero,
        skipIfZeroGated[id],
        `${id}: mutation is not feature-gated`,
      );
    } else if (lightingGating[id]) {
      const expected = lightingGating[id];
      for (const [gate, outputs] of Object.entries(expected)) {
        // Strengthened assertion: verify both length AND the actual
        // output/field values, not just the array length. A length-only
        // check would pass even if the wrong fields were gated.
        const actual = mutation[gate] ?? [];
        assert.equal(
          actual.length,
          outputs.length,
          `${id}: missing or incomplete ${gate}`,
        );
        assert.deepEqual(
          actual.map((entry) => entry.output),
          outputs,
          `${id}: ${gate} references unexpected outputs`,
        );
      }
    }
    if (mutation.memory) {
      assert.deepEqual(
        mutation.memory.availableWhen,
        { output: 'featureIndexOnboardProfiles', field: 'featureIndex' },
        `${id}: onboard fallback is not feature-gated`,
      );
      // Critical invariant: a mutation with memory.enabledWhen: mode eq 1
      // (designed for onboard mode) must NOT be hidden by skipIfZero on
      // controlMode.hostMode, because hostMode is 0 in onboard mode and
      // would make the memory path unreachable. The memory patch is the
      // only correct write path for 0x8100 devices in onboard mode
      // (confirmed via libratbag driver-hidpp20.c).
      if (mutation.memory.enabledWhen &&
          mutation.memory.enabledWhen.output === 'onboardMode' &&
          mutation.memory.enabledWhen.field === 'mode' &&
          mutation.memory.enabledWhen.eq === 1) {
        const hostModeGated = (mutation.skipIfZero ?? []).some(
          (entry) => entry.output === 'controlMode' && entry.field === 'hostMode',
        );
        assert.equal(
          hostModeGated,
          false,
          `${id}: skipIfZero on controlMode.hostMode contradicts memory.enabledWhen (mode eq 1) — would hide the memory path in onboard mode`,
        );
      }
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
});

test('logitech-hidpp declares protocol-level onboard lighting normalization', async () => {
  const capabilities = await read('plugins/logitech-hidpp/capabilities.json');
  const normalizer = capabilities.normalizers?.mouseLighting?.onboardProfile;
  assert.equal(normalizer.sourceWorkflow, 'hidpp2-device-onboard-read');
  assert.deepEqual(normalizer.sectorSize, { output: 'onboardDescription', field: 'sectorSize' });
  assert.deepEqual(normalizer.enabledOverride, { output: 'rgbControl', field: 'enabled' });
  assert.equal(normalizer.chunkPrefix, 'onboardProfileChunk');
  assert.equal(normalizer.chunkField, 'bytes');
  assert.equal(
    normalizer.layouts.some((layout) => Object.hasOwn(layout, 'model') || Object.hasOwn(layout, 'productId')),
    false,
  );
  assert.deepEqual(normalizer.layouts.find((layout) => layout.when?.profileFormatId === 5), undefined);
  const v5 = normalizer.layouts.find((layout) => layout.when?.field === 'profileFormatId' && layout.when?.eq === 5);
  assert.deepEqual(
    {
      effectOffset: v5.effectOffset,
      colorOffset: v5.colorOffset,
      speedOffset: v5.speedOffset,
      brightnessOffset: v5.brightnessOffset,
      extraColorOffset: v5.extraColorOffset,
    },
    {
      effectOffset: 219,
      colorOffset: 220,
      speedOffset: 223,
      brightnessOffset: 225,
      extraColorOffset: 226,
    },
  );
  assert.ok(normalizer.layouts.some((layout) => layout.default === true));
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
