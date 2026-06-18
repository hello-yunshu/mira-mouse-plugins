<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin Testing

Run `npm run validate` and `npm test`, then use the pinned published Mira CLI for `validate`, `test`, `pack`, and `inspect`. Package twice in clean directories and require identical SHA-256. Fixtures cover success, checksum, framing, fragmentation, forwarding, timeout, malformed packet, unplug, readback mismatch, and unknown-field preservation. Passing is only `fixture-verified`.

