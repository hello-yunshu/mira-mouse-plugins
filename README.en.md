<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
<p align="center">
  <img src="https://raw.githubusercontent.com/hello-yunshu/mira-mouse/main/public/app-icon.png" width="96" height="96" alt="Mira logo">
</p>

<h1 align="center">Mira Mouse Plugins</h1>

<p align="center">
  Declarative mouse device plugins for Mira.
</p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="#plugin-matrix">Plugin Matrix</a> ·
  <a href="#adding-a-new-device">Adding a Device</a> ·
  <a href="#package-layout">Package Layout</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img alt="Plugin format" src="https://img.shields.io/badge/format-.mira--plugin-7C3AED?style=flat-square">
  <img alt="Declarative" src="https://img.shields.io/badge/runtime-declarative-111827?style=flat-square">
  <img alt="No native code" src="https://img.shields.io/badge/plugins-no_native_code-10B981?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-7C3AED?style=flat-square">
</p>

## Overview

This repository contains declarative device plugins for [Mira](https://github.com/hello-yunshu/mira-mouse). Each plugin is a signed `.mira-plugin` package made only of declarative files: device matching, capability metadata, protocol commands, parsers, transports, workflows, and tests.

Plugins never contain native code, scripts, web pages, or WASM. Plugins declare what a device supports; the Mira host decides how to present it safely and consistently.

## Plugin Matrix

| Plugin | Target | Evidence | Writes | Notes |
|---|---|---|---|---|
| [`mira.amaster`](plugins/amaster/) | AMaster / Angry Miao compatible devices | hardware-verified | enabled | Protocol A and AM35 paths; mouse lighting and receiver lighting are separate capabilities. |
| [`mira.logitech-hidpp`](plugins/logitech-hidpp/) | Logitech HID++ 2.0 devices | hardware-verified | enabled | Feature discovery, DPI, report rate, profiles, and lighting capability reads; no fixed model whitelist. |
| [`mira.example-mock`](plugins/example-mock/) | Runtime sample | fixture-verified | disabled | Test plugin for the host app and runtime. |
| [`mira.razer-viper`](plugins/razer-viper/) | Razer Viper research draft | inferred | disabled | Research notes and narrow bring-up placeholder. |

## Adding a New Device

Want your mouse supported by Mira? Two paths:

1. **Open a device-support request**: file an issue on [Mira Issues](https://github.com/hello-yunshu/mira-mouse/issues) with the device info (VID/PID, connection, testable features). Maintainers will evaluate adaptation.
2. **Write a plugin yourself**: read the [Plugin SDK](docs/plugin-sdk.md) for the contract, then start from the `example-mock` plugin.

Plugins match by **protocol family** first, not per-model whitelists. For example, the Logitech HID++ plugin uses `0x046D` + HID++ collection + runtime feature discovery to decide capabilities; the G705 is just one validation sample. Use a single-model plugin only when the protocol is not ready for family-wide support — start read-only, then promote writes one by one.

## Package Layout

```text
plugins/<plugin-id>/
├── plugin.json              # metadata, permissions, capabilities, UI placement
├── devices.json             # VID/PID, usage, connection, evidence
├── capabilities.json        # exported fields and capability groups
├── locales/
│   ├── zh-CN.json           # plugin labels, effect names, and option copy
│   └── en.json
├── protocol/
│   ├── commands.json        # HID command templates
│   ├── parsers.json         # response parsing and derived fields
│   ├── transports.json      # HID / proxy / RACE transports
│   ├── workflows.json       # read workflows and mutations
│   └── features.json        # HID++ feature registry, Logitech only
├── README.md
└── LICENSE
```

Key rules:

- Only entries referenced by `workflows.steps` or `mutations` are enabled today; unreferenced primitives are reserves.
- Only capabilities declared in `plugin.json` may surface in the host UI.
- Plugin-specific copy belongs in `locales/*.json`; `plugin.json` keeps `labelKey` plus only necessary fallback labels.
- Writes must have bounded inputs, pre-read state, unknown-field preservation where needed, and readback assertions.

## Development

```bash
npm install
npm run validate
npm test
```

Common commands:

```bash
npm run inventory:protocol     # protocol inventory
npm run sync:hidpp             # sync Logitech HID++ feature registry
npm run pack -- plugins/amaster dist/mira-amaster.mira-plugin  # package a plugin
```

## Protocol Reserves

Plugins may keep source-confirmed or public-reference protocol primitives for future work, but reserves must be documented. `npm run validate` checks the reserve inventory so reserved material does not silently become current capability.

- [Protocol reserve inventory](docs/protocol-reserve-inventory.md)
- [AMaster protocol evidence](docs/amaster-protocol-evidence.md)
- [Hardware evidence matrix](docs/hardware-evidence-matrix.md)
- [Plugin review checklist](docs/plugin-review-checklist.md)

## Working With The Host App

Mira keeps a stable host-rendered UI framework. Plugins provide labels, data sources, mutation IDs, options, summaries, and placement hints. Placement is a constrained declaration, not arbitrary HTML, CSS, or scripts.

Host app: [Mira Mouse](https://github.com/hello-yunshu/mira-mouse)

Further docs: [Plugin SDK](docs/plugin-sdk.md) · [Plugin testing](docs/plugin-testing.md)

## License

Code and build definitions are licensed under AGPL-3.0-or-later. Original documentation is licensed under CC-BY-SA-4.0. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and third-party notices.
