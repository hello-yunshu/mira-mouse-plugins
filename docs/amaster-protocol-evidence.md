<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# AMaster Protocol Evidence

Research date: 2026-06-18. Local source: `MIRA_AMASTER_RESEARCH_DIR`, read only. No reverse-engineered source, manufacturer binary, icon, screenshot, or application resource is copied here. The local bundle manifest recorded 2,168 files.

| Fact | Source location | Method / constants | Confidence | Status |
|---|---|---|---|---|
| Protocol A interface and 65-byte HIDAPI feature-report framing | `decompiled/mouseApi.py`; reverse analysis sections for device discovery and I/O | report ID 0; 64-byte payload | high | source-confirmed |
| Protocol A checksum | `decompiled/mouseApi.py`; command builders | `0xFF - sum(bytes) & 0xFF` | high | source-confirmed |
| Protocol A query and receiver-forward command IDs | `decompiled/mouseApi.py`; targeted method/disassembly evidence | IDs recorded in `commands.json` | high | source-confirmed |
| AM35 outer 0x06/0x07 reports and 59-byte fragments | `disassembly/AM35Global.dis`; `AM35model.dis` | type 0x00 direct, 0x80 receiver | high | source-confirmed |
| AM35 inner 05 5A framing and query IDs | `disassembly/am35_target_methods.txt`; reverse analysis | little-endian length and command ID | high | source-confirmed |
| AM35 named mouse modes 0/1/2 | `disassembly/AM35model.dis`; reverse analysis | steady/breathing/neon | medium | source-confirmed; neon write unknown |
| Receiver light type values | control flow is insufficiently resolved | no reliable enumeration | low | unknown; values preserved and unnamed |
| Application-layer receiver link | no native follow field found in reviewed evidence | two independent writes would be needed | medium | inferred; writes blocked |
| Protocol A DPI setter | `decompiled/mouseApi.py` `setMouseDPI()` | command `0x54`; preserve the 64-byte DPI structure and update declared stage/value fields | high | source-confirmed; fixture/build-verified |
| Protocol A settings setter | `decompiled/mouseApi.py` `setMouseInfo()` | command `0x53`; preserve the full settings structure and replace bytes 1-6/checksum as the driver does | high | source-confirmed; fixture/build-verified |
| Protocol A receiver lighting setter | `decompiled/mouseApi.py` `setMDLight()` and receiver-path evidence | command `0x08`; effect/speed/brightness/option/RGB; checksum follows the eight-byte head | high | source-confirmed; fixture/build-verified |

Protocol A read compatibility is hardware-verified for the recorded receiver model. The bounded writes above remain pending a no-op hardware write/readback record with the mouse online. All AM35 writes and every unlisted state-changing operation remain blocked.
