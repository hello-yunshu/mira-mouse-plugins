<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# AMaster 协议证据

研究日期：2026-06-18。本地来源：`MIRA_AMASTER_RESEARCH_DIR`，只读。本文不复制任何逆向工程源码、厂商二进制、图标、截图或应用资源。本地 bundle 清单记录了 2,168 个文件。

| Fact | Source location | Method / constants | Confidence | Status |
|---|---|---|---|---|
| Protocol A 接口与 65 字节 HIDAPI feature-report 封装 | `decompiled/mouseApi.py`; reverse analysis sections for device discovery and I/O | report ID 0; 64-byte payload | high | source-confirmed |
| Protocol A 校验和 | `decompiled/mouseApi.py`; command builders | `0xFF - sum(bytes) & 0xFF` | high | source-confirmed |
| Protocol A 查询与接收器转发命令 ID | `decompiled/mouseApi.py`; targeted method/disassembly evidence | IDs recorded in `commands.json` | high | source-confirmed |
| AM35 外层 0x06/0x07 报告与 59 字节分片 | `disassembly/AM35Global.dis`; `AM35model.dis` | type 0x00 direct, 0x80 receiver | high | source-confirmed |
| AM35 内层 05 5A 封装与查询 ID | `disassembly/am35_target_methods.txt`; reverse analysis | little-endian length and command ID | high | source-confirmed |
| AM35 命名鼠标模式 0/1/2 | `disassembly/AM35model.dis`; reverse analysis | steady/breathing/neon | medium | source-confirmed; neon write unknown |
| 接收器灯光类型值 | control flow is insufficiently resolved | no reliable enumeration | low | unknown; values preserved and unnamed |
| 应用层接收器链路 | no native follow field found in reviewed evidence | two independent writes would be needed | medium | inferred; writes blocked |
| Protocol A DPI 设置器 | `decompiled/mouseApi.py` `setMouseDPI()` | command `0x54`; preserve the 64-byte DPI structure and update declared stage/value fields | high | source-confirmed; fixture/build-verified |
| Protocol A 设置项设置器 | `decompiled/mouseApi.py` `setMouseInfo()` | command `0x53`; preserve the full settings structure and replace bytes 1-6/checksum as the driver does | high | source-confirmed; fixture/build-verified |
| Protocol A 接收器灯光设置器 | `decompiled/mouseApi.py` `setMDLight()` and receiver-path evidence | command `0x08`; effect/speed/brightness/option/RGB; checksum follows the eight-byte head | high | source-confirmed; fixture/build-verified |

对于已记录的接收器型号，Protocol A 读取兼容性已通过硬件验证。上述有界写入（bounded writes）仍需在鼠标在线时补一次空操作硬件写入/回读记录。所有 AM35 写入以及任何未列出的状态变更操作仍被阻止。
