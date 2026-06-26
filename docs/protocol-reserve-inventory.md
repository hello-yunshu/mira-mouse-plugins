<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Protocol Reserve Inventory

This file separates protocol material that exists for future development from
protocol material that is enabled today. The host UI must render only declared
plugin capabilities and writable mutations. A command or parser being present in
`protocol/*.json` is not enough to expose it.

## Status Rules

| Status | Meaning | May affect UI? |
|---|---|---|
| Enabled read path | Referenced by `protocol/workflows.json` under a read workflow `steps[]`. | Yes, through normalized snapshot output. |
| Enabled mutation | Referenced by `protocol/workflows.json` under `mutations`. | Yes, through `writable_mutations` and capability metadata. |
| Enabled transport internal | Referenced by `protocol/transports.json`. | No direct UI surface; it only supports a transport. |
| Reserved protocol primitive | Defined in commands/parsers but not referenced by workflows, mutations, or transports. | No. It must stay invisible until validated and explicitly connected. |
| Feature registry reserve | Present in a generated feature registry but not referenced by workflows. | No. It is a lookup source for future workflows only. |

Before moving any reserved item into a workflow or mutation:

1. Add or update hardware/fixture evidence.
2. Give the output a name that matches the physical target: mouse, receiver, or host-control.
3. For writes, bound every input, preserve unknown bytes where needed, and add readback assertions.
4. Update this inventory and run `npm run validate`.

## AMaster

Current count from `node scripts/protocol-inventory.mjs`:

| Category | Entries |
|---|---|
| Commands | 46 total; 42 enabled by read workflows, mutations, or transports; 4 reserved. |
| Parsers | 29 total; 28 enabled by read workflows, mutations, or transports; 1 reserved. |
| Mutations | 15 enabled. |

Enabled but not directly UI-facing:

| Entry | Kind | Why it is enabled |
|---|---|---|
| `receiver-start` | command | Internal `protocol-a-receiver` transport handshake. |
| `receiver-poll` | command | Internal `protocol-a-receiver` transport polling. |
| `receiver-set-length` | command | Internal `protocol-a-receiver` payload-length setup. |
| `receiver-read` | command | Internal `protocol-a-receiver` payload read. |
| `receiver-status` | parser | Internal `protocol-a-receiver` status parser. |

Reserved protocol primitives:

| Entry | Kind | Reason to keep | Activation rule |
|---|---|---|---|
| `mouse-light-switch` | command/parser | Protocol A `0x87` exists in the source-confirmed command set, but hardware write/readback showed it is not equivalent to the mouse lighting switch on the current receiver path. | Do not add to read workflows or mutations until the physical target is proven and the output name is unambiguous. |
| `mouse-light-switch-write` | command | Write template for the same `0x87` primitive. | Do not expose as `set-mouse-light-switch`; mouse lighting on/off currently uses `set-mouse-lighting` with `settings.mouseLightEnabled` readback. |
| `profile-write` | command | Old Protocol A profile write template kept for future profile editing research. | Add only with a matching read command, bounded profile range, and readback assertion. |
| `am35-serial` | command | AM35 serial query material kept for future device identity work. | Add only after the response parser and privacy behavior are defined. |

AMaster lighting boundary:

- Mouse lighting color/enabled state comes from `settings.mouseLightStartColor`,
  `settings.mouseLightEndColor`, and `settings.mouseLightEnabled`.
- Receiver lighting comes from `receiverLighting` and is controlled by
  `set-receiver-lighting`.
- Reserved `0x87` switch primitives must not be used as mouse lighting state or
  receiver lighting state until real hardware evidence proves their target.

## Logitech HID++

Current count from `node scripts/protocol-inventory.mjs`:

| Category | Entries |
|---|---|
| Commands | 42 total; 37 enabled by read workflows or mutations; 5 reserved. |
| Parsers | 31 total; 29 enabled by read workflows or mutations; 2 reserved. |
| Feature registry | 195 generated entries; 18 currently referenced by workflows. |
| Mutations | 9 enabled. |

Reserved protocol primitives:

| Entry | Kind | Reason to keep | Activation rule |
|---|---|---|---|
| `onboard-memory-write-start` | command | Onboard Profiles memory-write framing is prepared, but full write lifecycle is not exposed. | Enable only with chunk sizing, commit/abort behavior, backup/restore, and readback verification. |
| `onboard-memory-write-chunk` | command | Chunk write primitive for future profile memory edits. | Same as above; never expose without a complete transaction. |
| `onboard-memory-write-end` | command | End/commit primitive for future profile memory edits. | Same as above; must not be callable alone. |
| `profile-mgmt-control` | command/parser | HID++ Profile Management control primitive is reserved for future mode/control operations. | Enable only after public semantics and hardware readback are clear. |
| `profile-mgmt-set-current` | parser | Parser exists for current-profile write replies, but current mutation verifies by reading `profile-mgmt-get-current`. | Keep reserved unless a direct write-reply workflow needs it. |
| `rgb-control-set` | command | HID++ RGB Effects host-control write template is kept for future handoff work, but the current UI should not expose a standalone host-control toggle. | Enable only as part of a coherent zone/effect lighting workflow with hardware evidence and readback verification. |

Feature registry reserve:

- `protocol/features.json` is intentionally broad and generated from vendored
  public references.
- Currently referenced feature names are:
  `ADJUSTABLE_DPI`, `BATTERY_STATUS`, `COLOR_LED_EFFECTS`,
  `DEVICE_FW_VERSION`, `DEVICE_NAME`, `EXTENDED_ADJUSTABLE_DPI`,
  `EXTENDED_ADJUSTABLE_REPORT_RATE`, `FEATURE_SET`, `MOUSE_POINTER`,
  `ONBOARD_PROFILES`, `POINTER_SPEED`, `PROFILE_MANAGEMENT`, `REPORT_RATE`,
  `RGB_EFFECTS`, `SURFACE_TUNING`, `UNIFIED_BATTERY`, `WHEEL_STATS`, and
  `XY_STATS`.
- All other feature registry entries are lookup reserves. They do not imply UI
  support and must not be treated as capabilities until a workflow references
  them and a capability/mutation contract is declared.
