<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# AMaster 协议证据

研究日期：2026-08-08。最新官方基线为 AM Master macOS `1.3.8`
（包日期 2026-06-23），输入包 SHA-256：
`b5824f7cc76dfc3b8ec98f56ebd0ab65491b7353b26bf2bb83647f3150ee21e8`。
证据为静态逆向/source-confirmed；本文不复制逆向源码、厂商二进制、图标、截图或应用资源。

| Fact | Source location | Method / constants | Confidence | Status |
|---|---|---|---|---|
| Protocol A 接口与 65 字节 HIDAPI feature-report 封装 | `decompiled/mouseApi.py`; reverse analysis sections for device discovery and I/O | report ID 0; 64-byte payload | high | source-confirmed |
| Protocol A 校验和 | `decompiled/mouseApi.py`; command builders | `0xFF - sum(bytes) & 0xFF` | high | source-confirmed |
| Protocol A 查询与接收器转发命令 ID | `decompiled/mouseApi.py`; targeted method/disassembly evidence | IDs recorded in `commands.json` | high | source-confirmed |
| AM35 外层 0x06/0x07 报告与 59 字节分片 | `AM35_transport_targets.dis`; `AM35_get_race_response.dis` | type 0x00 direct, 0x80 receiver; Input Report 0x07 | high | source-confirmed |
| AM35 内层 05 5A 封装与查询 ID | `AM35_transport_targets.dis` | little-endian length and command ID | high | source-confirmed |
| AM35 鼠标灯光 getter/setter | `AM35_audit_targets.dis`; `AM35_light_mode_write.dis` | raw 14/15/16 = switch/type/speed; `B3 30 <switch> <type> <speed>` | high | source-confirmed; fixture-verified |
| AM35 鼠标颜色 apply | `AM35_audit_targets.dis` `save_light` | color frame 后固定发送 `C0 30 80 01 10 01 FF FF FF` | high | source-confirmed; fixture-verified |
| AM35 sleep parser | `AM35_offset_targets.dis` `get_sleep_time` | Host 去 Report ID 后 TFG=8/10/12，BT=16/18/20 | high | source-confirmed; fixture-verified |
| AM35 button inventory parser | `AM35_offset_targets.dis` `get_key` | Host 去 Report ID 后 resId=9、keyType=10、payload=11 | high | source-confirmed; fixture-verified |
| AM35 firmware / serial parser | `AM35_offset_targets.dis` `get_version` / `get_sn` | firmware=7/8；serial=13×15 | high | source-confirmed; fixture-verified |
| 接收器灯光类型值 | control flow is insufficiently resolved | no reliable enumeration | low | unknown; values preserved and unnamed |
| 应用层接收器链路 | no native follow field found in reviewed evidence | two independent writes would be needed | medium | inferred; not exposed |
| Protocol A DPI 设置器 | `decompiled/mouseApi.py` `setMouseDPI()` | command `0x54`; preserve the 64-byte DPI structure and update declared stage/value fields | high | source-confirmed; fixture/build-verified |
| Protocol A 设置项设置器 | `decompiled/mouseApi.py` `setMouseInfo()` | command `0x53`; preserve the full settings structure and replace bytes 1-6/checksum as the driver does | high | source-confirmed; fixture/build-verified |
| Protocol A 接收器灯光设置器 | `decompiled/mouseApi.py` `setMDLight()` and receiver-path evidence | command `0x08`; effect/speed/brightness/option/RGB; checksum follows the eight-byte head | high | source-confirmed; fixture/build-verified |

对于已记录的接收器型号，Protocol A 读取兼容性已通过硬件验证。
现有 AM35 bounded writes 已由官方 1.3.8 源码语义确认，并通过仓库 validator、
fixtures 与离线测试验证；它们仍未在 AM Infinity Mouse .97 真机上完成写入/回读，
因此 `am35-direct` / `am35-receiver` 继续保持 `source-confirmed`，不得表述为
hardware-verified。

本轮没有开放 button mapping write (`C2 30`)、macro、reset (`CE 30`)、firmware
update、bootloader/DFU、flash erase 或 receiver pairing。`C0 30` 只作为
`set-mouse-light-color` 的内部 postWrite，不构成 UI 能力。
