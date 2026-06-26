# Mira Mouse Plugins

This directory contains one subdirectory per plugin. Each plugin is self-contained and follows the same layout:

```
<plugin-id>/
├── plugin.json          # metadata, capabilities, permissions
├── devices.json         # supported USB/Bluetooth device IDs
├── capabilities.json    # runtime capability mapping (read/write groups)
├── locales/             # user-facing labels and option text by locale
├── protocol/            # commands, parsers, transports and workflows
│   ├── commands.json
│   ├── parsers.json
│   ├── transports.json
│   ├── workflows.json
│   └── features.json    # HID++ feature registry (Logitech only)
├── tests/               # plugin-level tests
├── README.md            # plugin-specific documentation
└── LICENSE              # license file
```

## Plugin index

| Plugin ID | Name | Evidence | Writes | Notes |
|---|---|---|---|---|
| [`mira.amaster`](./amaster/) | AMaster / Angry Miao compatible devices | hardware-verified | enabled | Angry Miao protocol support |
| [`mira.example-mock`](./example-mock/) | Mira Example Mock | fixture-verified | disabled | Example / mock plugin for testing the runtime |
| [`mira.logitech-hidpp`](./logitech-hidpp/) | Logitech HID++ | hardware-verified | enabled | Logitech HID++ 2.0 protocol, including Onboard Profiles (`0x8100`) and Profile Management (`0x8101`) |
| [`mira.razer-viper`](./razer-viper/) | Razer Viper Research | inferred | disabled | Research notes for Razer Viper protocol |

## Adding a new plugin

1. Create a new directory under `plugins/`.
2. Add the required files: `plugin.json`, `devices.json`, `capabilities.json`, `protocol/*.json`, `README.md`, `LICENSE`.
3. Run `npm run validate` and `npm test`.
4. For HID++ based plugins, consider vendoring upstream references under `vendor/` and adding a `features.json` registry.

For a narrow plugin that targets one exact mouse model, follow the single-model
notes in [`../docs/plugin-sdk.md`](../docs/plugin-sdk.md). Start read-only,
match only tested hardware, and add fixtures before UI metadata.

Do not turn a validation sample into a runtime model whitelist. A broad
protocol plugin should match the stable interface/protocol shape and derive
capabilities from workflow output. A single-model plugin is appropriate only
when the protocol is not yet safe to generalize, and its exact model scope must
be documented in `devices.json`, fixtures, and the plugin README.

Protocol files may also contain source-confirmed or public-reference material
reserved for future development. Keep the current UI contract separate from
those reserves: a command, parser, or HID++ feature registry entry is not an
enabled capability until a workflow or mutation references it. See
[`../docs/protocol-reserve-inventory.md`](../docs/protocol-reserve-inventory.md)
and run `npm run inventory:protocol` before promoting reserved protocol
material.
