<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Hardware Evidence Matrix

| Plugin | Device model | VID/PID | Firmware | Connection | Feature | Read | Write | Readback | Evidence | Verifier | Date | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mira.amaster | unknown | unknown | unknown | unknown | none | no | no | no | blocked | not supplied | 2026-06-18 | No hardware was available |
| mira.logitech-hidpp | G705 Mouse (validation sample, not whitelist) | 046d:c547 | not reported | Lightspeed receiver | HID++ identity, battery, DPI, report rate, onboard profile, lighting | yes | DPI 1800→1850→1800; 500→1000→500 Hz; red→green→red | full 255-byte sector and CRC after every write | protocol-verified | local signed-package workflow | 2026-06-21 | Pass; final CRC restored to 0x02d5 |

Empty or unknown fields never authorize a compatibility claim.
