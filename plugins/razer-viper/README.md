# Razer Mice Plugin

Experimental read-only plugin for Razer gaming mice, implementing the modern
Razer HID protocol (90-byte feature report, XOR-8 checksum) documented in the
open-source references (OpenRazer, razer-qd-hid, macrazer).

## Supported Devices

Two device families share the same command set:

- **razer-1f** – transaction id `0x1F`. Includes Basilisk V3, Basilisk V3 Pro,
  Viper V2 Pro, Viper V3 HyperSpeed, Viper V3 Pro, DeathAdder V3 Pro,
  Cobra HyperSpeed, Cobra Pro, Atheris, Orochi V2, and Naga Pro.
- **razer-3f** – transaction id `0x3F`. Includes Viper Ultimate and
  DeathAdder V2 Pro.

## Capabilities

All capabilities are read-only:

| Capability | Description |
|---|---|
| Battery | Battery level (0–255 raw) and charging status |
| DPI | Current X/Y DPI (big-endian 16-bit per axis) |
| Polling Rate | Report rate code (0x01=1000 Hz, 0x02=500 Hz, 0x08=125 Hz) |
| Firmware | Major.minor version |
| Device Mode | Normal vs. driver mode |
| Serial | ASCII serial string (up to 22 bytes) |

## Protocol

The Razer HID protocol uses 90-byte feature reports with an XOR-8 checksum
over bytes [2..87]. The transport uses HID feature reports (report ID 0x00)
with a 91-byte wire buffer; the report ID byte is stripped on read so parsers
see a 90-byte payload.

Status code `0x02` (SUCCESSFUL) in the response byte at offset 0 indicates a
valid reply. The first workflow step (firmware) is required for device
identity; all subsequent steps use `onFailure: continue` so a single
unsupported command does not abort the entire read.

## Write Support

No write capability is claimed. The `writesEnabled` flag is `false` and the
`forbidden` list blocks firmware updates, bootloader access, DFU, flash erase,
receiver pairing, and macros.
