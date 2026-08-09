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

// 3.4 节：请求 checksum 与响应 checksum 必须彻底分离。
// - AMaster Protocol A 没有证据的响应不得复用请求 checksum；
// - Razer Viper 等确实有响应 XOR 的命令显式声明 response.checksum；
// - 用户提供的 Protocol A checksum-failed 假告警日志必须变成回归夹具。
test('3.4: AMaster Protocol A commands do not declare response.checksum (no false alarms)', async () => {
  const commands = await read('plugins/amaster/protocol/commands.json');
  for (const [id, command] of Object.entries(commands.commands)) {
    // Protocol A 响应没有证据存在 checksum，不得声明 response.checksum。
    // 宿主 verify_response_checksum 应返回 None，不发射 on_hid_checksum_failed。
    if (command.response) {
      assert.equal(command.response.checksum, undefined, `${id}: Protocol A must not declare response.checksum`);
    }
  }
});

test('3.4: Razer Viper commands declare response.checksum separately from request.checksum', async () => {
  const commands = await read('plugins/razer-viper/protocol/commands.json');
  for (const [id, command] of Object.entries(commands.commands)) {
    // Razer 响应有 XOR checksum，必须独立声明 response.checksum。
    assert.ok(command.response, `${id}: Razer commands must declare response`);
    assert.ok(command.response.checksum, `${id}: Razer commands must declare response.checksum`);
    assert.equal(command.response.checksum.algorithm, 'xor8', `${id}: response checksum algorithm`);
    // response.checksum 与 request.checksum 是独立声明，不复用。
    assert.ok(command.request.checksum, `${id}: Razer commands must declare request.checksum`);
  }
});

test('3.4: Protocol A checksum-false-alarm regression fixture covers all reported commands', async () => {
  const fixture = await read('plugins/amaster/tests/fixtures/protocol-a-checksum-false-alarm.json');
  const commands = await read('plugins/amaster/protocol/commands.json');
  // 回归夹具中每个假告警命令都必须在 AMaster commands 中存在。
  for (const alarm of fixture.falseAlarms) {
    assert.ok(commands.commands[alarm.command], `${alarm.command}: fixture references unknown command`);
    // 该命令不得声明 response.checksum（否则会再次产生假告警）。
    const cmd = commands.commands[alarm.command];
    if (cmd.response) {
      assert.equal(cmd.response.checksum, undefined, `${alarm.command}: must not declare response.checksum to avoid false alarm`);
    }
  }
  // 确保覆盖了用户报告的全部 12 个命令。
  assert.equal(fixture.falseAlarms.length, 12, 'fixture must cover all 12 reported false-alarm commands');
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

test('AM35 1.3.8 mouse-light parser and UI preserve switch/type/speed independently', async () => {
  const parsers = await read('plugins/amaster/protocol/parsers.json');
  const fields = parsers.parsers['am35-mouse-light-mode'].fields;
  assert.deepEqual(fields, {
    enabled: { offset: 13, kind: 'bool' },
    mode: { offset: 14, kind: 'u8' },
    speed: { offset: 15, kind: 'u8' },
  });
  assert.equal(fields.brightness, undefined, '1.3.8 getter has no brightness field');

  const manifest = await read('plugins/amaster/plugin.json');
  const lighting = manifest.capabilities.find((c) => c.id === 'lighting');
  const mouseZone = lighting.metadata.zones.find((z) => z.id === 'mouse');
  const enabledField = mouseZone.fields.find((f) => f.id === 'am35-enabled');
  const modeField = mouseZone.fields.find((f) => f.id === 'am35-mode');
  const speedField = mouseZone.fields.find((f) => f.id === 'am35-speed');
  assert.ok(enabledField, 'AM35 enabled toggle must be exposed');
  assert.equal(enabledField.source, 'capabilities.mouseLightMode.enabled');
  assert.equal(enabledField.param, 'enabled');
  for (const field of [enabledField, modeField, speedField]) {
    assert.equal(field.params?.enabled, undefined, `${field.id}: enabled must not be fixed true`);
    assert.deepEqual(Object.keys(field.paramSources).sort(), ['enabled', 'mode', 'speed']);
  }
  const exportable = manifest.exportableFields.find((f) => f.id === 'mouse-lighting-mode-am35');
  assert.equal(exportable.sources.enabled, 'capabilities.mouseLightMode.enabled');
});

test('AM35 mouse-light mutation verifies all fields and encodes the off state', async () => {
  const { mutations } = await read('plugins/amaster/protocol/workflows.json');
  for (const id of ['am35-direct-set-mouse-light-mode', 'am35-receiver-set-mouse-light-mode']) {
    const mutation = mutations[id];
    assert.deepEqual(mutation.inputs, {
      enabled: { kind: 'boolean' },
      mode: { kind: 'integer', min: 0, max: 2 },
      speed: { kind: 'integer', min: 0, max: 4 },
    });
    assert.deepEqual(
      mutation.verify.assertions.map(({ field, param }) => [field, param]),
      [['enabled', 'enabled'], ['mode', 'mode'], ['speed', 'speed']],
    );
  }
  const fixture = await read('plugins/amaster/tests/fixtures/am35-mouse-light-mode-write.json');
  const off = fixture.samples.find((sample) => sample.input.enabled === false);
  assert.ok(off, 'fixture must include an explicit off sample');
  assert.deepEqual(off.expectedRequestPayload, [5, 90, 5, 0, 179, 48, 0, 0, 0]);
  assert.deepEqual(fixture.readback.expectedParsed, {
    enabled: true, mode: 1, speed: 2, modeName: '呼吸', speedLabel: '中',
  });
  assert.deepEqual(
    [Boolean(fixture.readback.responseSample[13]), fixture.readback.responseSample[14], fixture.readback.responseSample[15]],
    [fixture.readback.expectedParsed.enabled, fixture.readback.expectedParsed.mode, fixture.readback.expectedParsed.speed],
  );
});

test('AM35 color writes use the source-confirmed internal C0 30 postWrite', async () => {
  const { commands } = await read('plugins/amaster/protocol/commands.json');
  const { mutations } = await read('plugins/amaster/protocol/workflows.json');
  const manifest = await read('plugins/amaster/plugin.json');
  const apply = commands['am35-mouse-light-apply'];
  assert.equal(apply.request.length, 13);
  assert.deepEqual(apply.request.bytes.map((byte) => Number(byte.value)), [5, 90, 9, 0, 192, 48, 128, 1, 16, 1, 255, 255, 255]);
  assert.equal(apply.request.base, undefined);
  for (const id of ['am35-direct-set-mouse-light-color', 'am35-receiver-set-mouse-light-color']) {
    assert.equal(mutations[id].settleMs, 0, id);
    assert.deepEqual(mutations[id].postWrites, [{ command: 'am35-mouse-light-apply', settleMs: 30 }], id);
    assert.equal(mutations[id].verify.command, 'am35-mouse-light-color', id);
  }
  assert.equal(mutations['am35-mouse-light-apply'], undefined, 'apply must not be a standalone mutation');
  assert.equal(JSON.stringify(manifest.capabilities).includes('am35-mouse-light-apply'), false, 'apply must not be a capability');
  const fixture = await read('plugins/amaster/tests/fixtures/am35-mouse-light-color-write.json');
  assert.deepEqual(fixture.postWrite.expectedRequestPayload, [5, 90, 9, 0, 192, 48, 128, 1, 16, 1, 255, 255, 255]);
  assert.deepEqual(fixture.operationOrder, ['am35-mouse-light-color-write', 'am35-mouse-light-apply', 'am35-mouse-light-color']);
});

test('AM35 1.3.8 inventory offsets and asymmetric fixtures match stripped Report ID semantics', async () => {
  const { parsers } = await read('plugins/amaster/protocol/parsers.json');
  assert.deepEqual(Object.values(parsers['am35-sleep-time'].fields).map((field) => field.offset), [8, 10, 12, 16, 18, 20]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(parsers['am35-button-mapping'].fields).map(([id, field]) => [id, field.offset])),
    { resId: 9, keyType: 10, cKeyCodeRaw: 11, stdKeyCode: 13, comboKeyCode: 14, macroNameRaw: 11, repeatMode: 27, repeatTimes: 28, dpiAction: 11, targetDpiSetting: 12, rawRecord: 9 },
  );
  assert.deepEqual(parsers['am35-firmware'].fields, {
    versionLength: { offset: 7, kind: 'u8' },
    versionRaw: { offset: 8, kind: 'bytes', count: 53 },
  });
  assert.deepEqual(parsers['am35-serial'].fields.serialRaw, { offset: 13, kind: 'bytes', count: 15 });

  const sleep = await read('plugins/amaster/tests/fixtures/am35-sleep-time.json');
  assert.deepEqual(
    sleep.samples.map((sample) => [sample.expectedParsed.wirelessSleepValue, sample.expectedParsed.bluetoothSleepValue]),
    [[61, 31], [-1, -1]],
  );
  const leU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
  for (const sample of sleep.samples) {
    const wirelessRaw = [8, 10, 12].reduce((sum, offset) => sum + leU16(sample.responsePayload, offset), 0);
    const bluetoothRaw = [16, 18, 20].reduce((sum, offset) => sum + leU16(sample.responsePayload, offset), 0);
    assert.equal(sample.expectedParsed.wirelessSleepValue, wirelessRaw === 65535 ? -1 : wirelessRaw);
    assert.equal(sample.expectedParsed.bluetoothSleepValue, bluetoothRaw === 65535 ? -1 : bluetoothRaw);
  }
  const buttons = await read('plugins/amaster/tests/fixtures/am35-button-mapping.json');
  assert.deepEqual(buttons.samples.slice(0, 4).map((sample) => sample.expectedParsed.keyType), [6, 8, 11, 1]);
  for (const sample of buttons.samples.filter((candidate) => !candidate.expectFailure)) {
    assert.equal(sample.responsePayload[9], sample.expectedParsed.resId);
    assert.equal(sample.responsePayload[10], sample.expectedParsed.keyType);
  }
  assert.equal(buttons.samples[1].responsePayload[27], buttons.samples[1].expectedParsed.repeatMode);
  assert.equal(buttons.samples[1].responsePayload[28], buttons.samples[1].expectedParsed.repeatTimes);
  assert.equal(leU16(buttons.samples[2].responsePayload, 12), buttons.samples[2].expectedParsed.targetDpiSetting);
  assert.equal(buttons.samples.at(-1).expectFailure, true);
  const inventorySteps = (await read('plugins/amaster/protocol/workflows.json')).workflows['am35-direct-inventory-read'].steps
    .filter((step) => step.command === 'am35-button-mapping');
  assert.equal(inventorySteps.length, 7);
  assert.ok(inventorySteps.every((step) => step.onFailure === 'continue'));

  const firmware = await read('plugins/amaster/tests/fixtures/am35-firmware.json');
  assert.equal(firmware.payload[7], firmware.expectedParsed.versionLength);
  assert.equal(String.fromCharCode(...firmware.payload.slice(8, 14)), firmware.expectedParsed.versionString);
  const serial = await read('plugins/amaster/tests/fixtures/am35-serial.json');
  assert.deepEqual(serial.payload.slice(13, 28), serial.expectedParsed.serialRaw);
});

test('validator rejects a postWrite that references a missing command', async () => {
  const { validatePostWrites } = await import('../scripts/validate.mjs');
  assert.throws(
    () => validatePostWrites('amaster', 'invalid-post-write', {
      inputs: {},
      postWrites: [{ command: 'does-not-exist', settleMs: 30 }],
    }, { commands: {}, parsers: {}, transports: {} }),
    /postWrite 1 references missing command/,
  );
});

test('validator accepts Host-managed software DPI stages without hardware stage fields', async () => {
  const { validStageLayout } = await import('../scripts/validate.mjs');
  assert.equal(validStageLayout({
    mode: 'software',
    currentValueSource: 'state.dpi',
    defaultValues: [400, 800, 1600, 3200, 6400],
    setMutation: 'set-dpi',
    valueParam: 'dpi',
    range: { min: 100, max: 26000, step: 50 },
  }), true);
  assert.equal(validStageLayout({
    mode: 'software',
    currentValueSource: 'state.dpi',
    defaultValues: [400],
    setMutation: 'set-dpi',
    range: { min: 100, max: 26000, step: 50 },
  }), false);
  assert.equal(validStageLayout({
    mode: 'auto',
    dotsSource: 'state.dpiStages',
    selectMutation: 'set-dpi-stage',
    setMutation: 'set-dpi',
    valueSource: 'state.dpiStages',
    currentValueSource: 'state.dpi',
    defaultValues: [400, 800, 1600, 3200, 6400],
    range: { min: 100, max: 26000, step: 50 },
  }), true);
});

// P0-E: AM35 sleep-time capability must use family-aware statusDisplay variants.
// Previously the statusDisplay pointed at the Protocol A path
// (capabilities.settings.wirelessSleepValue + onClickField protocol-a-wireless)
// even when the device was in the AM35 family, so the status chip showed the
// wrong value and tapping it opened the wrong field's editor. Fix: split into
// two variants gated on `family` so each family gets its own valueSource and
// onClickField.
test('P0-E: AM35 sleep-time statusDisplay uses family-aware variants', async () => {
  const manifest = await read('plugins/amaster/plugin.json');
  const sleepTime = manifest.capabilities.find((c) => c.id === 'sleep-time');
  const statusDisplay = sleepTime.metadata.statusDisplay;
  assert.ok(Array.isArray(statusDisplay.variants), 'sleep-time statusDisplay must use variants');
  assert.equal(statusDisplay.variants.length, 2);
  const protocolA = statusDisplay.variants.find((v) => v.visibleWhen.in.includes('protocol-a-direct'));
  const am35 = statusDisplay.variants.find((v) => v.visibleWhen.in.includes('am35-direct'));
  assert.ok(protocolA, 'must declare a Protocol A variant');
  assert.ok(am35, 'must declare an AM35 variant');
  // Protocol A variant must point at the Protocol A getter/settings path.
  assert.equal(protocolA.valueSource, 'capabilities.settings.wirelessSleepValue');
  assert.equal(protocolA.onClickField, 'protocol-a-wireless');
  assert.equal(protocolA.valueFormat, 'sleep');
  // AM35 variant must point at the AM35 sleepTime parser output and AM35 field.
  assert.equal(am35.valueSource, 'capabilities.sleepTime.wirelessSleepValue');
  assert.equal(am35.onClickField, 'am35-wireless');
  assert.equal(am35.valueFormat, 'sleep');
  // onClickField targets must exist in declared fields.
  const fieldIds = sleepTime.metadata.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('protocol-a-wireless'), 'protocol-a-wireless field must be declared');
  assert.ok(fieldIds.includes('am35-wireless'), 'am35-wireless field must be declared');
});
// P1-D: read-response base 命令必须由某个 mutation 携带 preReadResponse 使用。
// read-response 命令模板要求把 pre-read 响应作为 write payload 的 base，再覆盖
// 显式声明的 byte。如果没有任何 mutation 引用该命令作为 writeCommand，或者
// 引用它的 mutation 缺少有效的 read 步骤，该命令就是孤立模板，会在运行时
// 产生全零 base（无 pre-read 响应可复制），必须拒绝。
test('P1-D: every read-response base command is owned by a mutation with preReadResponse', async () => {
  const { commands } = await read('plugins/amaster/protocol/commands.json');
  const { mutations } = await read('plugins/amaster/protocol/workflows.json');

  // Build writeCommand -> mutations[] index.
  const writeCommandToMutations = new Map();
  for (const [mutationId, mutation] of Object.entries(mutations)) {
    if (!mutation.writeCommand) continue;
    const list = writeCommandToMutations.get(mutation.writeCommand) ?? [];
    list.push({ mutationId, mutation });
    writeCommandToMutations.set(mutation.writeCommand, list);
  }

  const readResponseCommands = Object.entries(commands).filter(
    ([, command]) => command.request.base === 'read-response',
  );
  assert.ok(readResponseCommands.length >= 6, 'expected at least 6 read-response base commands');

  for (const [id, command] of readResponseCommands) {
    const owners = writeCommandToMutations.get(id) ?? [];
    assert.ok(owners.length > 0, `${id}: read-response base command must be used as a writeCommand by at least one mutation (orphan template would produce all-zero base)`);
    for (const { mutationId, mutation } of owners) {
      assert.ok(mutation.read?.command, `${id}: mutation ${mutationId} uses read-response base but lacks preReadResponse (mutation.read.command)`);
      assert.ok(commands[mutation.read.command], `${id}: mutation ${mutationId} references unknown preReadResponse command ${mutation.read.command}`);
      assert.ok(mutation.read?.parser, `${id}: mutation ${mutationId} uses read-response base but lacks preReadResponse (mutation.read.parser)`);
    }
  }
});

test('P1-D: no orphan read-response command remains (profile-write regression)', async () => {
  const { commands } = await read('plugins/amaster/protocol/commands.json');
  // The previously-orphan "profile-write" command must stay deleted.
  assert.equal(commands['profile-write'], undefined, 'profile-write orphan read-response command must remain deleted');
});

test('research plugins stay read-only and expose evidence-scoped descriptors', async () => {
  const emptyWhitelist = []
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
test('research metadata stays out of executable command schema', async () => {
  const commands = await read('plugins/amaster/protocol/commands.json');
  assert.deepEqual(Object.keys(commands).sort(), ['commands', 'schemaVersion']);
  assert.equal(commands.am35, undefined);
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
  assert.equal(capabilities.lighting.metadata.statusDisplay.labelKey, 'capability.lighting');
  // ITERATION-004 §2.3：lighting statusDisplay.valueSource 改为 accent color 路径，
  // 不再使用 Protocol-A-only 的 capabilities.settings.mouseLightEnabled。
  // onClickField 已移除，点击状态项通过 controlAction 跳转到灯光控制页。
  assert.equal(capabilities.lighting.metadata.statusDisplay.valueSource, 'capabilities.mouseLighting.color');
  assert.equal(capabilities.lighting.metadata.statusDisplay.onClickField, undefined);
  assert.equal(capabilities.dpi.metadata.summary, undefined);
  // 回报率页的三个设备读数由插件声明；路径跟随当前拆分后的 capability
  // 命名空间。Protocol A 和 AM35 各声明一组来源，Host 只选择实际
  // 已上报的三项，不内置 A-Master 型号或字段。
  assert.deepEqual(capabilities['polling-rate'].metadata.summary, [
    {
      labelKey: 'summary.motionSync',
      source: 'capabilities.settings.motionSync',
      sourceFallbacks: ['capabilities.motionSync.motionSync'],
      priority: 100,
    },
    {
      labelKey: 'summary.angleSnap',
      source: 'capabilities.settings.angleSnap',
      sourceFallbacks: ['capabilities.angleSnap.angleSnap'],
      priority: 90,
    },
    {
      labelKey: 'summary.liftCutOff',
      source: 'capabilities.settings.liftCutOff',
      sourceFallbacks: ['capabilities.lod.liftCutOff'],
      priority: 80,
    },
  ]);
  // Protocol A 与 AM35 接收器灯光以独立 zone 暴露，分别通过
  // visibleWhen.capabilities.receiverLighting / capabilities.receiverLight 区分。
  assert.deepEqual(capabilities.lighting.metadata.zones.map((zone) => zone.id), ['mouse', 'receiver', 'receiver-am35']);
  assert.equal(capabilities.lighting.metadata.zones[0].fields[0].mutation, 'set-mouse-lighting');
  assert.deepEqual(Object.keys(capabilities.lighting.metadata.zones[0].fields[0].paramSources).sort(), ['color', 'enabled']);
  // Protocol A mouse zone fields use visibleWhen.in to separate from AM35 siblings.
  assert.deepEqual(capabilities.lighting.metadata.zones[0].fields[0].visibleWhen, {
    path: 'family', in: ['protocol-a-direct', 'protocol-a-receiver'],
  });
  assert.deepEqual(capabilities.lighting.metadata.zones[0].fields[1].visibleWhen, {
    path: 'family', in: ['protocol-a-direct', 'protocol-a-receiver'],
  });
  // AM35 mouse zone fields expose mode/speed/color with family gating.
  // ITERATION-004 §2.3：am35-enabled false toggle 已移除，AM35 mouse zone 现有 3 个字段（mode/speed/color）。
  const am35MouseFields = capabilities.lighting.metadata.zones[0].fields.filter(
    (field) => field.visibleWhen?.in?.includes('am35-direct'),
  );
  assert.ok(am35MouseFields.length >= 3, 'AM35 mouse zone must expose mode/speed/color fields');
  for (const field of am35MouseFields) {
    assert.ok(['set-mouse-light-mode', 'set-mouse-light-color'].includes(field.mutation), `unexpected mutation ${field.mutation}`);
  }
  assert.equal(capabilities.lighting.metadata.zones[1].fields.length, 5);
  assert.deepEqual(Object.keys(capabilities.lighting.metadata.zones[1].fields[0].paramSources).sort(), ['brightness', 'color', 'effect', 'option', 'speed']);
  // AM35 receiver-am35 zone 暴露十字段，与 AM35 mutation inputs 严格对齐。
  assert.equal(capabilities.lighting.metadata.zones[2].fields.length, 10);
  assert.deepEqual(capabilities.lighting.metadata.zones[2].fields.map((field) => field.id),
    ['enabled', 'type', 'color1', 'ratio1', 'color2', 'ratio2', 'color3', 'ratio3', 'speed', 'brightness']);
  assert.equal(capabilities.profile.metadata.statusDisplay.valueSource, 'state.profile');
  assert.equal(capabilities.firmware.metadata.fields[0].editor, 'static-readonly');
  assert.deepEqual(
    capabilities['sleep-time'].metadata.fields
      .filter((field) => field.visibleWhen?.eq)
      .map((field) => [field.id, field.visibleWhen.eq]),
    [['protocol-a-bluetooth', 'bluetooth'], ['protocol-a-wireless', 'wireless'], ['protocol-a-virtual', 'virtual']],
  );
  assert.deepEqual(
    capabilities['sleep-time'].metadata.fields
      .filter((field) => field.visibleWhen?.in)
      .map((field) => [field.id, field.visibleWhen.in]),
    [
      ['am35-bluetooth', ['am35-direct', 'am35-receiver']],
      ['am35-wireless', ['am35-direct', 'am35-receiver']],
      ['am35-virtual', ['am35-direct', 'am35-receiver']],
    ],
  );
  for (const field of capabilities['sleep-time'].metadata.fields) {
    assert.ok(
      Object.keys(mutations).some((id) => id.endsWith(`-${field.mutation}`)),
      `missing ${field.mutation}`,
    );
  }
  assert.deepEqual(capabilities.dpi.placements[0], {
    region: 'control', group: 'performance', order: 10, span: 1, icon: 'gauge',
    priority: 100, dashboardRole: 'fixed-core', fixedSlot: 1, fourthSlotEligible: false,
    dedupeKey: 'dashboard.dpi', fallbackRegion: 'advanced',
  });
  // ITERATION-006 §P1-A：lighting 下方重复 status placement 已移除（dedupeKey=dashboard.lighting 统一去重）。
  assert.deepEqual(capabilities.lighting.placements.map((placement) => placement.region), ['control']);
  assert.deepEqual(capabilities['button-mappings'].placements[0], {
    region: 'details', order: 40, span: 1, icon: 'info',
  });
});

// ITERATION-005 §P1-B：Placement Contract 强契约验证。
// 遍历全部动态发现插件的 control/status placement，断言：
// - priority ∈ [0,100]
// - fourthSlotEligible=true 时 dashboardRole='candidate' 且 priority>=90
// - fixedSlot 仅在 dashboardRole='fixed-core' 时出现，且 ∈ {1,2,3}
// - control/status 必须声明 dedupeKey 与 fallbackRegion
test('P1-B: all plugin placements satisfy dashboard contract', async () => {
  const { readdir } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const pluginDirs = (await readdir(new URL('../plugins/', import.meta.url), { withFileTypes: true }))
    .filter((e) => e.isDirectory() && existsSync(fileURLToPath(new URL(`../plugins/${e.name}/plugin.json`, import.meta.url))))
    .map((e) => e.name);

  for (const dir of pluginDirs) {
    const manifest = await read(`plugins/${dir}/plugin.json`);
    for (const capability of manifest.capabilities ?? []) {
      for (const placement of capability.placements ?? []) {
        const isDashboard = placement.region === 'control' || placement.region === 'status';
        if (!isDashboard) continue;
        // priority ∈ [0,100]
        assert.ok(
          Number.isInteger(placement.priority) && placement.priority >= 0 && placement.priority <= 100,
          `${dir}/${capability.id}: priority must be 0..100, got ${String(placement.priority)}`,
        );
        // dedupeKey 非空
        assert.ok(typeof placement.dedupeKey === 'string' && placement.dedupeKey.length > 0,
          `${dir}/${capability.id}: dedupeKey required`);
        // fallbackRegion 合法（跨仓统一：advanced | inventory | hidden，不再接受 details）
        assert.ok(['advanced', 'inventory', 'hidden'].includes(placement.fallbackRegion),
          `${dir}/${capability.id}: fallbackRegion invalid`);
        // fourthSlotEligible=true → candidate + priority>=90
        if (placement.fourthSlotEligible === true) {
          assert.equal(placement.dashboardRole, 'candidate',
            `${dir}/${capability.id}: fourthSlotEligible=true requires dashboardRole='candidate'`);
          assert.ok(placement.priority >= 90,
            `${dir}/${capability.id}: fourthSlotEligible=true requires priority>=90, got ${placement.priority}`);
        }
        // fixedSlot 仅 fixed-core
        if (placement.fixedSlot !== undefined) {
          assert.equal(placement.dashboardRole, 'fixed-core',
            `${dir}/${capability.id}: fixedSlot requires dashboardRole='fixed-core'`);
          assert.ok([1, 2, 3].includes(placement.fixedSlot),
            `${dir}/${capability.id}: fixedSlot must be 1/2/3, got ${placement.fixedSlot}`);
        }
      }
    }
  }
});

// ITERATION-007 §P0-H：AM35 receiver-am35 十字段灯光 role/priority 契约。
// 反编译证据继续保持十字段协议（enabled/type/color1/ratio1/color2/ratio2/
// color3/ratio3/speed/brightness），首页声明 type=effect, color1=primary-color,
// 其余 candidate。type 最左、color1 最右，中间最多 4 个 candidate。
test('P0-H: AM35 receiver-am35 zone declares correct lightingRole and priority', async () => {
  const manifest = await read('plugins/amaster/plugin.json');
  const lighting = manifest.capabilities.find((c) => c.id === 'lighting');
  const receiverAm35Zone = lighting.metadata.zones.find((z) => z.id === 'receiver-am35');
  assert.ok(receiverAm35Zone, 'receiver-am35 zone must exist');
  // 十字段协议完整保留
  assert.deepEqual(receiverAm35Zone.fields.map((f) => f.id),
    ['enabled', 'type', 'color1', 'ratio1', 'color2', 'ratio2', 'color3', 'ratio3', 'speed', 'brightness']);
  // type=effect priority=100；color1=primary-color priority=100
  const typeField = receiverAm35Zone.fields.find((f) => f.id === 'type');
  assert.equal(typeField.lightingRole, 'effect', 'type must be effect');
  assert.equal(typeField.priority, 100, 'type priority must be 100');
  const color1Field = receiverAm35Zone.fields.find((f) => f.id === 'color1');
  assert.equal(color1Field.lightingRole, 'primary-color', 'color1 must be primary-color');
  assert.equal(color1Field.priority, 100, 'color1 priority must be 100');
  // enabled/speed/brightness/ratio1=candidate with明确 priority
  for (const id of ['enabled', 'speed', 'brightness', 'ratio1']) {
    const field = receiverAm35Zone.fields.find((f) => f.id === id);
    assert.equal(field.lightingRole, 'candidate', `${id} must be candidate`);
    assert.ok(typeof field.priority === 'number' && field.priority >= 0 && field.priority < 100,
      `${id} priority must be < 100 (not effect/primary-color)`);
  }
  // 次级颜色/比例必须 presentation=details，不进入首页
  for (const id of ['color2', 'ratio2', 'color3', 'ratio3']) {
    const field = receiverAm35Zone.fields.find((f) => f.id === id);
    assert.equal(field.presentation, 'details', `${id} must be presentation=details`);
  }
});

// ITERATION-007 §P0-I：Logitech 灯光迁移。
// effect=effect priority=100；color=primary-color priority=100；
// enabled/speed/brightness=candidate with明确 priority；extra-color=details。
test('P0-I: Logitech mouse-lighting zone declares correct lightingRole and priority', async () => {
  const manifest = await read('plugins/logitech-hidpp/plugin.json');
  const lighting = manifest.capabilities.find((c) => c.id === 'mouse-lighting');
  assert.ok(lighting, 'mouse-lighting capability must exist');
  const zone = lighting.metadata.zones[0];
  assert.ok(zone, 'lighting zone must exist');
  const fieldsById = Object.fromEntries(zone.fields.map((f) => [f.id, f]));
  // effect=effect priority=100
  assert.equal(fieldsById.effect.lightingRole, 'effect', 'effect must be effect');
  assert.equal(fieldsById.effect.priority, 100, 'effect priority must be 100');
  // color=primary-color priority=100
  assert.equal(fieldsById.color.lightingRole, 'primary-color', 'color must be primary-color');
  assert.equal(fieldsById.color.priority, 100, 'color priority must be 100');
  // enabled/speed/brightness=candidate
  for (const id of ['enabled', 'speed', 'brightness']) {
    assert.equal(fieldsById[id].lightingRole, 'candidate', `${id} must be candidate`);
    assert.ok(typeof fieldsById[id].priority === 'number' && fieldsById[id].priority < 100,
      `${id} priority must be < 100 (not effect/primary-color)`);
  }
  // extra-color=details
  assert.equal(fieldsById['extra-color'].presentation, 'details', 'extra-color must be details');
});

// ITERATION-007 §P1-B：status variants 必须 visibleWhen 必填。
// validate.mjs 已强制要求，此处增加显式契约测试，防止 regression。
test('P1-B: statusDisplay variants require visibleWhen', async () => {
  const { readdir } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const pluginDirs = (await readdir(new URL('../plugins/', import.meta.url), { withFileTypes: true }))
    .filter((e) => e.isDirectory() && existsSync(fileURLToPath(new URL(`../plugins/${e.name}/plugin.json`, import.meta.url))))
    .map((e) => e.name);

  for (const dir of pluginDirs) {
    const manifest = await read(`plugins/${dir}/plugin.json`);
    for (const capability of manifest.capabilities ?? []) {
      const display = capability.metadata?.statusDisplay;
      if (!display || !Array.isArray(display.variants)) continue;
      for (const variant of display.variants) {
        assert.ok(variant.visibleWhen,
          `${dir}/${capability.id}: statusDisplay variant requires visibleWhen`);
      }
    }
  }
});

test('battery history eligibility is declared by each plugin', async () => {
  const amaster = await read('plugins/amaster/plugin.json');
  const logitech = await read('plugins/logitech-hidpp/plugin.json');
  const batteryPolicy = (manifest) => manifest.capabilities.find((capability) => capability.id === 'battery')?.metadata?.batteryHistory;

  assert.deepEqual(batteryPolicy(amaster).validConnections, ['wireless', 'bluetooth']);
  assert.deepEqual(batteryPolicy(logitech).validConnections, ['wireless', 'usb']);
});

test('AMaster declares plugin-owned identity for the .100 connection aliases', async () => {
  const devices = await read('plugins/amaster/devices.json');
  const protocolADevices = devices.devices.filter((device) => device.family.startsWith('protocol-a-'));
  assert.equal(protocolADevices.length, 4);
  for (const device of protocolADevices) {
    assert.equal(device.identity.group, 'am-infinity-8k-mouse', device.family);
    assert.equal(device.identity.displayName, 'AM INFINITY MOUSE .100', device.family);
    assert.ok(device.identity.aliases.includes('amaster protocol-a-direct'), device.family);
    assert.ok(device.identity.aliases.includes('amaster protocol-a-receiver'), device.family);
    assert.ok(device.identity.aliases.includes('AM INFINITY 8K MOUSE'), device.family);
  }
  const directPriorities = protocolADevices
    .filter((device) => device.family === 'protocol-a-direct')
    .map((device) => device.selectionPriority);
  const receiverPriorities = protocolADevices
    .filter((device) => device.family === 'protocol-a-receiver')
    .map((device) => device.selectionPriority);
  assert.ok(directPriorities.every((priority) => priority > Math.max(...receiverPriorities)));
});

test('AMaster .97 uses the official input-report RACE transport and shared identity', async () => {
  const devices = await read('plugins/amaster/devices.json');
  const transports = await read('plugins/amaster/protocol/transports.json');
  const am97Devices = devices.devices.filter((device) => device.family.startsWith('am35-'));
  assert.equal(am97Devices.length, 2);
  for (const device of am97Devices) {
    assert.equal(device.identity.group, 'am-infinity-97-mouse', device.family);
    assert.equal(device.identity.displayName, 'AM INFINITY MOUSE .97', device.family);
  }
  assert.ok(
    am97Devices.find((device) => device.family === 'am35-direct').selectionPriority
      > am97Devices.find((device) => device.family === 'am35-receiver').selectionPriority,
  );
  for (const id of ['am35-direct', 'am35-receiver']) {
    assert.equal(transports.transports[id].readMode, 'input-report', id);
    assert.equal(transports.transports[id].readDelayMs, 50, id);
    assert.equal(transports.transports[id].readRetries, 20, id);
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
  const controlMode = manifest.capabilities.find((capability) => capability.id === 'control-mode');
  const profileCurrent = manifest.capabilities.find((capability) => capability.id === 'profile-mgmt-current');
  assert.ok(
    devices.devices[0].selectionPriorityByConnection.usb
      > devices.devices[0].selectionPriorityByConnection.wireless,
  );
  assert.equal(manifest.capabilities.some((capability) => capability.metadata?.description), false);
  assert.deepEqual(polling.metadata.fields[0].mutation, ['set-polling-rate', 'set-polling-rate-extended']);
  assert.deepEqual(dpi.metadata.stageLayout.setMutation, ['set-dpi-value', 'set-dpi-value-extended']);
  assert.equal(pointerSpeed.metadata.fields[0].mutation, 'set-pointer-speed');
  assert.deepEqual(controlMode.placements[0], {
    region: 'control',
    group: 'configuration',
    order: 5,
    span: 1,
    icon: 'settings',
    priority: 95,
    dashboardRole: 'candidate',
    fourthSlotEligible: true,
    dedupeKey: 'dashboard.control-mode',
    fallbackRegion: 'advanced',
    optionalPosition: 'leading',
    compactLabelKey: 'dashboard.tab.configuration',
  });
  assert.equal(profileCurrent.metadata.fields[0].mutation, 'set-profile-mgmt-current');
  assert.equal(profileCurrent.placements[0].compactLabelKey, 'dashboard.tab.configuration');
  const zhLocale = await read('plugins/logitech-hidpp/locales/zh-CN.json');
  assert.equal(zhLocale['dashboard.tab.configuration'], '配置');
  assert.ok(Array.from(zhLocale['dashboard.tab.configuration']).length <= 3);
  assert.equal(lighting.metadata.zones[0].fields[0].mutation, 'set-mouse-lighting');
  assert.equal(lighting.metadata.statusDisplay.valueSource, 'capabilities.mouseLighting.effect');
  assert.deepEqual(Object.keys(lighting.metadata.zones[0].fields[0].paramSources).sort(), ['brightness', 'color', 'effect', 'enabled', 'extraColor', 'speed']);
  // ITERATION-006 §P1-A：logitech-hidpp lighting 下方重复 status placement 已移除（dedupeKey=dashboard.lighting 统一去重）。
  assert.equal(lighting.placements.find((placement) => placement.region === 'status'), undefined);
  const families = new Set(devices.devices.map((device) => device.family));
  for (const family of families) {
    assert.ok(workflows.workflows[`${family}-read`], `${family}: missing read workflow`);
  }
  const mutations = workflows.mutations ?? {};
  assert.deepEqual(Object.keys(mutations).sort(), [
    'hidpp2-device-set-control-mode',
    'hidpp2-device-set-dpi-stage',
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
    'hidpp2-device-set-dpi-stage': [
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
  // D-3 fix: default layout was removed to prevent misapplication to unknown
  // device formats. Only the explicit V5 conditional layout remains, so no
  // layout should carry default: true.
  assert.equal(
    normalizer.layouts.some((layout) => layout.default === true),
    false,
    'no default layout should remain after D-3 fix',
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

test('Logitech commands declare diagnostics payload policies for sensitive commands', async () => {
  const commands = await read('plugins/logitech-hidpp/protocol/commands.json');
  // 敏感命令必须有声明式 diagnostics 策略
  const sensitiveCommands = {
    'device-info-get': 'mask',        // 含 unit ID / model ID
    'device-name-get': 'mask',         // 含用户可定制设备名
    'onboard-memory-read': 'deny',     // 含 profile / 按键映射 / 宏
    'onboard-memory-write-start': 'deny',
    'onboard-memory-write-chunk': 'deny',
    'onboard-memory-write-end': 'deny',
  };
  for (const [id, expectedPolicy] of Object.entries(sensitiveCommands)) {
    const cmd = commands.commands[id];
    assert.ok(cmd, `command ${id} should exist`);
    assert.ok(cmd.diagnostics, `${id}: should declare diagnostics policy`);
    assert.equal(cmd.diagnostics.payload, expectedPolicy, `${id}: payload policy should be ${expectedPolicy}`);
  }
});

test('Logitech commands allow non-sensitive protocol commands', async () => {
  const commands = await read('plugins/logitech-hidpp/protocol/commands.json');
  // 非敏感命令应声明 allow
  const safeCommands = [
    'root-get-feature',
    'feature-set-get-count',
    'battery-get-status',
    'battery-get-capability',
    'unified-battery-get-capabilities',
    'unified-battery-get-status',
    'dpi-get-capability',
    'dpi-get-list',
    'dpi-get-current',
    'dpi-set',
    'mouse-pointer-get',
    'pointer-speed-get',
    'pointer-speed-set',
    'report-rate-get-list',
    'report-rate-get',
    'report-rate-set',
    'onboard-get-description',
    'onboard-get-mode',
    'onboard-get-current-profile',
    'onboard-get-current-dpi-index',
    'onboard-set-current-dpi-index',
    'profile-mgmt-get-info',
    'profile-mgmt-get-count',
    'profile-mgmt-get-current',
    'profile-mgmt-set-current',
  ];
  for (const id of safeCommands) {
    const cmd = commands.commands[id];
    assert.ok(cmd, `command ${id} should exist`);
    assert.ok(cmd.diagnostics, `${id}: should declare diagnostics policy`);
    assert.equal(cmd.diagnostics.payload, 'allow', `${id}: payload policy should be allow`);
  }
});

test('Logitech diagnostics policies use only valid values', async () => {
  const commands = await read('plugins/logitech-hidpp/protocol/commands.json');
  const validPolicies = new Set(['allow', 'mask', 'deny']);
  for (const [id, cmd] of Object.entries(commands.commands)) {
    if (cmd.diagnostics === undefined) continue;
    assert.ok(cmd.diagnostics && typeof cmd.diagnostics === 'object', `${id}: diagnostics must be an object`);
    assert.ok(cmd.diagnostics.payload, `${id}: diagnostics.payload is required`);
    assert.ok(validPolicies.has(cmd.diagnostics.payload), `${id}: invalid payload policy ${cmd.diagnostics.payload}`);
  }
});

test('Logitech devices declare stable identity for cross-connection dedup', async () => {
  const devices = await read('plugins/logitech-hidpp/devices.json');
  assert.ok(devices.devices.length > 0, 'Logitech should expose device descriptors');
  for (const device of devices.devices) {
    assert.ok(device.identity, `${device.family}: should declare identity`);
    assert.ok(typeof device.identity.group === 'string' && device.identity.group.length > 0,
      `${device.family}: identity.group is required`);
    assert.ok(device.identity.displayName, `${device.family}: identity.displayName is recommended`);
    assert.ok(Array.isArray(device.identity.aliases), `${device.family}: identity.aliases should be an array`);
  }
});
