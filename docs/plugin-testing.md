<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin Testing

Run `npm run validate` and `npm test`, then use the pinned published Mira CLI
for `validate`, `test`, `pack`, and `inspect`. Package twice in clean
directories and require identical SHA-256.

Fixtures cover success, checksum, framing, fragmentation, forwarding, timeout,
malformed packet, unplug, readback mismatch, and unknown-field preservation.
Passing fixtures alone are only `fixture-verified`.

Before promoting a model or capability:

1. Confirm `devices.json` matches the intended interface scope and does not
   turn a validation sample into an accidental model whitelist.
2. Confirm optional protocol features are skipped by workflow guards or feature
   discovery, not by host-side brand or model branches.
3. Confirm every plugin-specific capability label, effect name, and option
   label in `plugin.json` has entries in both plugin locale files.
4. Confirm every enabled write has bounded inputs, pre-read state, readback
   assertions, and unknown-field preservation when it patches an existing
   report or memory sector.
5. Record real hardware runs in `docs/hardware-evidence-matrix.md`; keep empty
   fields as unknown instead of broadening compatibility claims.
