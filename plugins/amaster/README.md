# mira.amaster

AMaster / Angry Miao compatible device plugin for Mira.

This plugin is a declarative `.mira-plugin` package. It contains device
descriptors and protocol definitions for:

- Protocol A (VID `0x3151`) over USB and 2.4 GHz receiver.
- AM35 (VID `0x0E8D`) over USB and 2.4 GHz receiver.

Bluetooth support is pending hardware evidence and is marked `blocked` in the
plugin capabilities.

Protocol A exposes bounded writes for the current DPI stage, the selected
stage's X/Y DPI, polling rate, mouse character-light color/switch, and receiver
lighting. Full-state setters preserve their pre-read structure and change only
declared fields; the short lighting setter rebuilds the exact zero-padded frame
used by the source driver. Every mutation verifies target fields by reading again.
The write encodings are source-confirmed and fixture/build-verified; the final
no-op hardware write smoke is still pending an online mouse.

AM35 writes, button remapping, firmware operations, pairing, macros, and raw
reports remain unavailable.
