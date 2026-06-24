# Mira Mouse Plugins

This directory contains one subdirectory per plugin. Each plugin is self-contained and follows the same layout:

```
<plugin-id>/
├── plugin.json          # metadata, capabilities, permissions
├── devices.json         # supported USB/Bluetooth device IDs
├── capabilities.json    # runtime capability mapping (read/write groups)
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
