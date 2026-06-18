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
test('AM35 fixture validates little-endian command id', async () => {
  const fixture = await read('plugins/amaster/tests/fixtures/am35-fragment.json');
  assert.equal(fixture.payload[4] | (fixture.payload[5] << 8), fixture.expectedCommandIdLittleEndian);
});
test('unverified plugins have empty device whitelists and no writes', async () => {
  for (const name of ['logitech-hidpp', 'razer-viper']) {
    const manifest = await read(`plugins/${name}/plugin.json`); const devices = await read(`plugins/${name}/devices.json`);
    assert.equal(manifest.writesEnabled, false); assert.deepEqual(devices.devices, []);
  }
});
test('receiver lighting type remains unnamed', async () => {
  const commands = await read('plugins/amaster/protocol/commands.json');
  assert.equal(commands.am35.receiverLightingType.status, 'unknown');
  assert.deepEqual(commands.am35.receiverLightingType.namedValues, {});
});

