<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Hardware Evidence Matrix

| Plugin | Device model | VID/PID | Firmware | Connection | Feature | Read | Write | Readback | Evidence | Verifier | Date | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mira.amaster | AM INFINITY 8K MOUSE | 3151:5007 | not reported | 2.4 GHz receiver | Protocol A identity, battery, DPI, polling rate, sleep time, mouse lighting, receiver lighting | yes | bounded writes declared; current-device smoke pending when mouse is online | workflow readback for declared fields; latest local pass had no matching HID device attached | hardware-verified read path plus source/fixture-backed bounded writes | local signed-package workflow | 2026-06-26 | Package verifies; live hardware not attached in latest pass |
| mira.logitech-hidpp | G705 Mouse (validation sample, not whitelist) | 046d:c547 | not reported | Lightspeed receiver | HID++ identity, battery, DPI, report rate, onboard profile, lighting | yes | DPI 1800→1850→1800; 500→1000→500 Hz; red→green→red | full 255-byte sector and CRC after every write | protocol-verified | local signed-package workflow | 2026-06-21 | Pass; final CRC restored to 0x02d5 |

Empty or unknown fields never authorize a compatibility claim.
