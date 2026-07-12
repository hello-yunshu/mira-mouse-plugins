# mira.amaster

AMaster / Angry Miao compatible device plugin for Mira.

This plugin is a declarative `.mira-plugin` package. It contains device
descriptors and protocol definitions for:

- Protocol A (VID `0x3151`) over USB and 2.4 GHz receiver.
- AM Infinity Mouse .97 / internal AM35 family (VID `0x0E8D`) over USB and
  2.4 GHz receiver.

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

AM35 (VID `0x0E8D`) protocol definitions were first collected from
AMasterDriver v1.0.6 reverse analysis and rechecked against the official
AM Master v1.3.6 macOS package. The current official UI maps `am35` and
`am35_d` to AM Infinity Mouse .97. The protocol uses HID Output Report
(ID `0x06`) for writes and `get_input_report` on Input Report (ID `0x07`)
for reads, with a RACE-style inner protocol (`05 5A ...`). Responses are
matched to the request's RACE command ID so stale reports are ignored.

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

## Adding a specific AMaster-compatible model

Add model support at the plugin boundary, not in the Mira host UI:

1. Add the exact interface match to `devices.json` with VID/PID, usage page,
   usage, connection type, family name, and evidence level.
2. Capture fixtures for every field that will become visible in the UI.
3. Extend `protocol/commands.json`, `protocol/parsers.json`,
   `protocol/transports.json`, and `protocol/workflows.json` only as needed for
   that family.
4. Declare host-rendered capability metadata in `plugin.json`, and put labels,
   receiver-lighting option names, and effect names in `locales/*.json`.
5. Keep writes disabled for the new family until bounded inputs, unknown-field
   preservation, and readback assertions pass on hardware.

If a model shares Protocol A or AM35 framing, prefer workflow guards and family
descriptors over a new model-specific plugin. Use a separate single-model plugin
only when the report layout or write semantics are not safe to generalize.
