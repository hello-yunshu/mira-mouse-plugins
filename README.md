# Mira Mouse Plugins

This repository holds declarative device plugins for [Mira](https://github.com/hello-yunshu/mira-mouse).

Each plugin is a signed `.mira-plugin` ZIP container that contains only declarative files:
`plugin.json`, `devices.json`, `capabilities.json`, protocol definitions, fixtures, tests and documentation.

## Plugins

- `mira.amaster` — AMaster / Angry Miao compatible mice over USB and 2.4 GHz receiver.
- `mira.logitech-hidpp` — Logitech HID++ 2.0 reads, with exact-device gated writes.

## Development

```bash
npm install
npm run validate
npm test
```

## Host UI placement

Capabilities should explicitly declare `region`, `group`, `order`, and `icon`
in `placements`. Mira keeps the page sections stable and distributes every
visible item at equal width across one full row. Existing `span` values remain
accepted for compatibility but do not change equal-row dashboard widths.
These are host-rendered placement hints, not arbitrary HTML, CSS, or scripts.
Host-owned control skeletons may accept bounded content declarations such as a
`metadata.summary` list. Plugins choose labels, data sources, and item count;
Mira keeps the component structure, spacing, limits, and styling fixed.
Control groups and status items are limited to six per dashboard region,
ordinary control options to eight, and summary items to four.

## License

AGPL-3.0-or-later. See `LICENSE`.
