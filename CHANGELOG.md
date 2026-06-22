<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Changelog

## [Unreleased]

- Added complete declarative UI metadata for AMaster performance, sleep,
  profile, lighting, firmware, device-settings, receiver, and button-mapping
  capabilities, including connection-aware sleep bindings.
- Added a readback-verified HID++ software/onboard control-mode mutation and
  plugin-declared UI metadata, allowing hosts to render the control without a
  Logitech-specific component.
- Added declarative HID++ `0x8100` metadata and full-sector reads using the
  device-reported sector size, including aligned final-block reads and
  CRC-CCITT verification.
- Made DPI and report-rate mutations prefer the active onboard profile while
  preserving every unrelated byte; standard HID++ writes remain the fallback.
- Enabled guarded profile-format-5 lighting writes through the second LED slot.
- Hardware-verified and restored G705 round trips for DPI, report rate, and
  lighting; the G705 remains a protocol validation sample, not a model whitelist.
- Generalized `mira.logitech-hidpp` to the Logitech HID++ long-report collection without a model/PID whitelist, with bounded device-index discovery across receiver slots `1..6` and direct index `0xFF`.
- Hardware-verified the generic workflow on a G705 validation sample: device identity/name, Unified Battery, current DPI, and report rate.
- Added readback-verified standard HID++ writes for current DPI and report rate. Available mutations are derived from the feature indices each device exposes.
- Added Output/Input transport response/error matching, dynamic feature-index references, and unsupported-feature guards.
- Corrected Battery Level Status to use its reported percentage directly and separated Device Information (`0x0003`) from Device Name (`0x0005`).
- Removed unverified direct-USB usage collections and unverified firmware and pointer-speed claims.
- Corrected HID++ report sizing to 20 bytes total (`0x11` report ID plus 19-byte payload), matching the receiver report descriptor.
- Hardware-verified a G705 Mouse through `046d:c547` receiver slot `1`: device name/info, Unified Battery (`0x1004`) at 66%, and Adjustable DPI (`0x2201`) at 1800 DPI with 800 DPI default.

## [1.4.0] - 2026-06-21

- `mira.logitech-hidpp` 0.3.0: replaced the split `dpiHigh`/`dpiLow` u8 fields with a single `be-u16` `dpiValue` field, leveraging the new DSL `be-u16`/`be-u16-array` field kinds added to the Mira runtime.
- Renamed the DPI workflow output from `dpiValue` to `dpi` so the runtime's `standard_reading` maps it to `DeviceSnapshot.dpiStages` as a single active stage, letting the Mira UI render and edit the active DPI without a full stage list.
- Made `standard_reading` tolerant of missing `stageColors`/`stageCount`/`currentStage` and added a `dpi.dpiValue` fallback path so single-DPI devices display correctly.
- Added `be-u16` to the plugin validator's allowed encoding list.
- Removed the unsupported `polling-rate` capability (HID++ 2.0 has no standard polling-rate feature) and added `pointer-speed` as a read-only capability.
- All four topologies (unifying, lightspeed, bolt, usb-direct) now expose the aligned `dpi` output.

## [1.3.1] - 2026-06-21

- Added read-modify-write-readback mutations for Bluetooth and 2.4 GHz sleep time, preserving all unrelated settings bytes.
- Exposed the active connection mode's sleep timeout to Mira as an editable setting.

## [1.3.0] - 2026-06-20

- Added declarative read-modify-write-readback mutations for current DPI stage, per-stage DPI, polling rate, mouse character lighting, and receiver lighting.
- Preserved unknown bytes for full-state setters, rebuilt the exact short lighting frame, and added input schemas, bounded settle delays, and field-level readback assertions.
- Kept AM35, button mapping, application-layer lighting linkage, firmware, pairing, macros, and raw writes disabled.
- Fixture and build verification pass; hardware write smoke remains pending because the matched receiver reported its mouse offline during final verification.

## [1.2.0] - 2026-06-19

- Bumped `mira.amaster` from temporary 1.0.0 to 1.2.0 so the signed asset no longer collides with the placeholder 1.0.0 artifact.
- Re-packed and re-signed `mira-amaster-1.2.0.mira-plugin` with the production key `mira-plugins-2026-001`.
- 2.4 GHz receiver readback (DPI / profile / battery / firmware / lighting) hardware-verified on protocol-a-receiver.
- No changes to UI files in the main `mira-mouse` repository.

## [1.0.0] - 2026-06-19

- Added the Example Mock tutorial, read-only AMaster candidate, and empty-whitelist Logitech/Razer research descriptors.
- No hardware compatibility or signed release is claimed.
