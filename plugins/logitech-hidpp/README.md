# mira.logitech-hidpp

HID++ 2.0 plugin with protocol-level discovery instead of a model whitelist.

## Current scope

- Matches vendor `0x046D`, usage page `0xFF00`, usage `2`.
- Uses HID++ long Output/Input reports (`0x11`, 20 bytes total: report ID plus
  19-byte payload).
- Tries receiver slots `1..6`, then direct-device index `0xFF`, and reuses the
  device index echoed by the first valid Root response.
- Discovers runtime feature indices through Root `0x0000`.
- Reads Feature Set `0x0001`, Device Information `0x0003`, Device Name
  `0x0005`, Battery Level Status `0x1000`, Unified Battery `0x1004`, Mouse
  Pointer `0x2200`, Adjustable DPI `0x2201`, Extended Adjustable DPI `0x2202`,
  Pointer Speed `0x2205`, RGB Effects `0x8071`, Onboard Profiles `0x8100`, and
  Profile Management `0x8101` when present.
- Discovers Surface Tuning `0x2240`, XY Stats `0x2250`, and Wheel Stats
  `0x2251` feature indices for future support, but does not issue writes for
  those features until public semantics are clearer.
- Reads and writes Pointer Speed `0x2205` using the public HID++ read/write
  function pair (`0x00` / `0x10`).
- Reads and writes Report Rate `0x8060` and Extended Adjustable Report Rate
  `0x8061` when present.
- Reads RGB Effects `0x8071` capability info for protocol evidence, but keeps
  host-control handoff internal until zone/effect writes can be exposed as a
  coherent lighting workflow.
- Switches `0x8100` between onboard mode (`1`) and host/software mode (`2`)
  through a bounded, readback-verified mutation.
- Reads HID++ Onboard Profiles `0x8100` using the device-reported sector size,
  verifies CRC-CCITT, and discovers the active profile and DPI index.
- Discovers and reads Profile Management `0x8101` when present, exposing
  profile count, capability info, and the active profile index. Current-profile
  switching (`function 0x30`) is exposed as a readback-verified mutation;
  generic control-byte pass-through remains internal.
- Skips unsupported optional features instead of issuing commands to index zero.

The feature byte includes client id `1`, and responses are matched against the
device index, feature index, and function/client byte. HID++ error responses
(`feature index 0xFF`) are rejected by the host runtime.

## Profile Management (`0x8101`)

This feature is not fully documented in the public Logitech HID++ specification.
The plugin keeps the surface deliberately narrow: it reads public-shaped metadata
and exposes only current-profile switching through readback verification.
Solaar's control call (`feature 0x8101`, function `0x60`, payload `0x03` or
`0x05`) is tracked for RGB handoff behavior, but not exposed as a generic UI
write.

| Command | Function | Purpose |
|---------|----------|---------|
| `profile-mgmt-get-info` | `0x00` | Feature version, max profile count, name length |
| `profile-mgmt-get-count` | `0x10` | Number of stored profiles |
| `profile-mgmt-get-current` | `0x20` | Currently active profile index |
| `profile-mgmt-set-current` | `0x30` | Activate a profile by index |
| `profile-mgmt-control` | `0x60` | Internal control byte command for future RGB/Profile handoff work |

When a device exposes `0x8101`, the read workflow surfaces `profileMgmtInfo`,
`profileMgmtCount`, and `profileMgmtCurrent`. Additional profile editing should
still be confirmed against captured traces before promotion to user-facing
writes.

## Upstream HID++ references

To keep this plugin in sync with evolving public knowledge of the HID++
protocol, the upstream reference projects are vendored as Git submodules and
feature IDs are referenced by name instead of by hard-coded decimal values:

```
vendor/solaar      → https://github.com/pwr-Solaar/Solaar.git     (master)
vendor/cpg-docs    → https://github.com/Logitech/cpg-docs.git     (master)
```

- `vendor/solaar/lib/logitech_receiver/hidpp20_constants.py` is the source of
  truth for feature IDs (e.g. `PROFILE_MANAGEMENT = 0x8101`).
- `vendor/cpg-docs/hidpp20/features/` contains Logitech's public feature
  specifications, when available.
- `protocol/features.json` is generated from those two sources.
- `protocol/workflows.json` refers to features as `"featureRef": "NAME"`, and
  both the Node.js validator and the Rust runtime expand it to the numeric
  `featureId` at load time.

### Syncing feature IDs

After checking out the repository with submodules:

```sh
git submodule update --init --recursive
```

Pull upstream master and regenerate the local registry:

```sh
cd vendor/solaar && git pull origin master && cd ../..
cd vendor/cpg-docs && git pull origin master && cd ../..
node scripts/sync-hidpp-features.mjs
```

Review the diff to `protocol/features.json`, then run the validator and tests:

```sh
node scripts/validate.mjs
npm test
```

For CI, `node scripts/sync-hidpp-features.mjs --check` fails if
`protocol/features.json` is out of sync with the vendored upstream sources.

### Other references

- [Logitech cpg-docs HID++ 2.0](https://github.com/Logitech/cpg-docs/tree/master/hidpp20) — public packet structure and documented feature specs.
- [Solaar](https://github.com/pwr-Solaar/Solaar) — `lib/logitech_receiver/hidpp20_constants.py` for feature IDs and `hidpp20.py` / `rgb_power.py` for observed traffic.
- [openlogi-hidpp](https://crates.io/crates/openlogi-hidpp) / upstream [lus/logy](https://github.com/lus/logy) — Rust HID++ implementation used as a cross-check.

Future updates to undocumented features should be reconciled against new Solaar
releases or captured device traces before being promoted to user-facing writes.

Protocol reserves are tracked separately from enabled workflows and mutations in
[`../../docs/protocol-reserve-inventory.md`](../../docs/protocol-reserve-inventory.md).
The generated HID++ feature registry is intentionally broader than the current
UI surface; only feature names referenced by workflows and capability metadata
are enabled.

## Evidence and limitations

The generic workflow is hardware-verified with a G705 Mouse through a
`046d:c547` receiver on macOS. That device is a validation sample, not a model
restriction. Runtime support is determined from the HID++ collection and the
feature indices each connected device actually exposes.

The workflow currently selects the first responding receiver slot. Multiple
simultaneously exposed paired devices remain unsupported. In onboard mode, DPI
and polling-rate edits patch the active profile, preserve unknown bytes, update
CRC, and verify the complete sector. Profile format `5` also enables the
verified secondary-slot lighting patch. Other lighting layouts remain guarded.
When onboard mode is unavailable, standard feature writes remain the fallback.

## Adding another HID++ model

Do not add a model-specific allowlist for normal HID++ mice. Add evidence
instead:

1. Capture the HID collection identity and at least one read fixture.
2. Run the signed package path and record the feature indices the device
   exposes.
3. Add parser/workflow support only when the feature shape is stable.
4. Add or update `plugin.json` capability metadata and `locales/*.json` labels
   only after workflow output proves the capability exists.
5. Keep unsupported optional features guarded by zero-index or missing-output
   checks; do not move that logic into the host UI.

Create a separate single-model plugin only if the device has a layout that
cannot be represented by HID++ feature discovery, workflow guards, and
declarative capability metadata.

Run the signed-package path with:

```sh
MIRA_PLUGIN=mira.logitech-hidpp \
  cargo run -p mira-plugin-runtime --example enumerate_hid
```

Set `MIRA_WRITE_SMOKE=1` to repeat the currently read DPI and polling rate and
require successful readback without changing the user's settings.
