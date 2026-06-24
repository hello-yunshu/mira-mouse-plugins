# mira.amaster

AMaster / Angry Miao compatible device plugin for Mira.

This plugin is a declarative `.mira-plugin` package. It contains device
descriptors and protocol definitions for:

- Protocol A (VID `0x3151`) over USB and 2.4 GHz receiver.
- AM35 (VID `0x0E8D`) over USB and 2.4 GHz receiver.

Bluetooth support is pending hardware evidence and is marked `blocked` in the
plugin capabilities.

Protocol A exposes bounded writes for the current DPI stage, the selected
stage's X/Y DPI, polling rate, mouse character-light color/enabled setting, and
receiver lighting. Full-state setters preserve their pre-read structure and
change only declared fields; the short receiver-lighting setter rebuilds the
exact zero-padded frame used by the source driver. Every mutation verifies target
fields by reading again.

Protocol reserves are tracked separately from enabled workflows and mutations in
[`../../docs/protocol-reserve-inventory.md`](../../docs/protocol-reserve-inventory.md).
The Protocol A `0x87` light-switch primitive is intentionally reserved and must
not be exposed as a mouse or receiver lighting switch until its physical target
is hardware-proven.

AM35 writes, button remapping, firmware operations, pairing, macros, and raw
reports remain unavailable.

## AM35 Protocol (Preparatory)

AM35 (VID `0x0E8D`) protocol definitions are collected from
AMasterDriver v1.0.6 reverse analysis. The protocol uses HID Output
Report (ID `0x06`) for writes and Input Report (ID `0x07`) for reads,
with a RACE-style inner protocol (`05 5A ...`).

The runtime engine includes a `hid-race` transport kind that frames
RACE payloads with a 3-byte header (`[reportId, length, type]`) and
handles read/write via HID Output/Input reports. `raceType` `0x00` is
used for direct USB; `0x80` for receiver forwarding.

AM35 read workflows cover battery, DPI, polling rate, sleep time, FPS,
DPI button, rotation, mouse lighting (mode + color), receiver lighting,
debounce, LOD, motion sync, angle snapping, ripple control, profile,
and firmware. Write mutations are not yet declared; they will be added
after hardware validation of the RACE write framing.

All AM35 field offsets are source-confirmed from static analysis but
not yet hardware-verified. The `am35.receiverLightingType` named-values
table remains `unknown` pending real device testing.
