<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin SDK

Use the version in `plugin-sdk-version.toml`. A plugin owns matching, topology,
protocol, parsing, capabilities, ranges, label keys, localized copy, narrow
permission declarations, and fixtures. Mira owns HID handles, timing,
cancellation, rollback, standard controls, themes, settings, diagnostics, and
updates. Plugins contain no executable or presentation code.

## Family, model, and evidence boundaries

Prefer a protocol-family plugin when the match and workflow can be expressed by
stable interface properties and runtime discovery. A validation model is
evidence, not a compatibility gate. For example, a HID++ device that exposes the
same feature indices should be governed by workflow output, not by a G705-only
branch in `plugin.json`.

Use these files for different jobs:

- `devices.json` describes HID/interface matching and evidence scope. Use
  precise VID/PID, usage page, usage, connection, and family names. Keep
  `hardwareVerifiedModels` as evidence notes only.
- `protocol/workflows.json` proves which outputs exist and which mutations are
  allowed. Optional features should be skipped by guards instead of becoming
  model-specific UI branches.
- `plugin.json` declares host-rendered capabilities, placement hints,
  data-source paths, mutation ids, bounded options, lighting roles, and
  capability metadata.
- `locales/*.json` owns plugin-specific labels, effect names, and option text.
  Common controls such as DPI or battery may use host translation fallback.
  `metadata.label` is only a fallback for older hosts.
- `tests/fixtures` records the exact reports that justify a parser, workflow,
  or promoted write.

Add a new model-specific file or plugin only when the physical model changes the
protocol layout in a way that cannot be represented by workflow guards,
feature discovery, or declarative capability metadata.

## Single-model plugins

Use a single-model plugin when one exact mouse model has enough evidence to be
useful, but the protocol is not ready for broad brand or family support. Start
read-only, match only the tested VID/PID, usage page, usage, connection type,
and model/evidence string, and keep `writesEnabled: false` until each write has
bounded inputs, preserves unrelated bytes, verifies readback, and can restore
the original value during smoke testing.

Minimal bring-up order:

1. Capture device identity and one report fixture per visible field.
2. Add exact `devices.json` matching before any broad vendor match.
3. Add parser fields and read workflows before UI metadata.
4. Add localized labels in `locales/zh-CN.json` and `locales/en.json` before
   exposing plugin-specific capability labels, effect names, or option labels.
5. Declare capabilities only when workflow output proves support.
6. Promote one write at a time, only with input limits and verification
   assertions.

Before generalizing a single-model plugin into a family plugin, prove at least
one other model or interface path, remove model assumptions from
`protocol/*.json`, and update the README so the verified model is described as a
sample rather than a whitelist.

For AI IDE work, keep prompts scoped to one contract layer:

```text
Build a narrow Mira single-model mouse plugin from local files only.
Start read-only. Inspect plugin.json, devices.json, capabilities.json,
protocol/*.json, tests/fixtures, and README.md before editing.
Implement one capability at a time: exact match, fixture first, read workflow
before UI metadata, and no writes without bounded input plus readback evidence.
Run npm run validate and npm test. Do not change host-app files.
```
