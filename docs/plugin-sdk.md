<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin SDK

Use the version in `plugin-sdk-version.toml`. A plugin owns matching, topology, protocol, parsing, capabilities, ranges, labels, narrow permission declarations, and Fixtures. Mira owns HID handles, timing, cancellation, rollback, standard controls, themes, settings, diagnostics, and updates. Plugins contain no executable or presentation code.

## Single-model plugins

Use a single-model plugin when one exact mouse model has enough evidence to be
useful, but the protocol is not ready for broad brand or family support. Start
read-only, match only the tested VID/PID, usage page, usage, connection type,
and model string, and keep `writesEnabled: false` until each write has bounded
inputs, preserves unrelated bytes, verifies readback, and can restore the
original value during smoke testing.

Minimal bring-up order:

1. Capture device identity and one report fixture per visible field.
2. Add exact `devices.json` matching before any broad vendor match.
3. Add parser fields and read workflows before UI metadata.
4. Declare capabilities only when workflow output proves support.
5. Promote one write at a time, only with input limits and verification
   assertions.

For AI IDE work, keep prompts scoped to one contract layer:

```text
Build a narrow Mira single-model mouse plugin from local files only.
Start read-only. Inspect plugin.json, devices.json, capabilities.json,
protocol/*.json, tests/fixtures, and README.md before editing.
Implement one capability at a time: exact match, fixture first, read workflow
before UI metadata, and no writes without bounded input plus readback evidence.
Run npm run validate and npm test. Do not change host-app files.
```
