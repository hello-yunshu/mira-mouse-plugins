<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Razer 读取覆盖表

本文记录 razer-viper 插件每个启用 GET 命令的协议来源、解析路径、覆盖型号与 fixture 对应关系。所有命令均为只读，状态列标注为 `source-confirmed`（基于公开协议实现，未经实机回归验证）。

协议来源缩写：
- **OpenRazer** — OpenRazer 驱动（`razerkbd.c` / `razerdevice.c` 等）
- **razer-qd-hid** — razerqdhid 用户态 HID 实现
- **MacRazer** — macrazer macOS 驱动

两个设备族共享同一命令集，仅 transaction id 不同：`razer-1f`（0x1F）、`razer-3f`（0x3F）。覆盖型号共 13 个：Basilisk V3、Basilisk V3 Pro、Viper V2 Pro、Viper V3 HyperSpeed、Viper V3 Pro、DeathAdder V3 Pro、Cobra HyperSpeed、Cobra Pro、Atheris、Orochi V2、Naga Pro（以上 razer-1f）；Viper Ultimate、DeathAdder V2 Pro（以上 razer-3f）。连接方式为 `usb` 与 `wireless-receiver`。

| Domain | Parameter | Command | Parser | Workflow | Models | Connection | Source | Fixture | UI/Details | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| battery | level (u8 @9, 0-255 原始值) | battery-level | battery-level | razer-1f-read, razer-3f-read | 全部 13 型号 | usb, wireless-receiver | OpenRazer, razer-qd-hid | basilisk-v3-battery.json | hero 区, percent 格式 | source-confirmed |
| battery | charging (u8 @9, 0x01=充电中) | charging-status | charging-status | razer-1f-read, razer-3f-read | 全部 13 型号 | usb, wireless-receiver | OpenRazer, MacRazer | basilisk-v3-charging.json | hero 区, batteryHistory 仅 wireless | source-confirmed |
| dpi | dpiXHi/dpiXLo/dpiYHi/dpiYLo (u8 @9-12, big-endian) | dpi | dpi | razer-1f-read, razer-3f-read | 全部 13 型号 | usb, wireless-receiver | OpenRazer, razer-qd-hid | basilisk-v3-dpi.json | control/performance 组 | source-confirmed |
| dpi | activeStage (@9), stageCount (@10) | dpi-stages | dpi-stages | razer-1f-inventory, razer-3f-inventory | 全部 13 型号 | usb, wireless-receiver | OpenRazer | basilisk-v3-dpi-stages.json | inventory (refresh: on-open) | source-confirmed |
| pollingRate | raw (u8 @8, 0x01=1000Hz, 0x02=500Hz, 0x08=125Hz) | polling-rate | polling-rate | razer-1f-read, razer-3f-read | 全部 13 型号 | usb, wireless-receiver | OpenRazer, razer-qd-hid | basilisk-v3-polling-rate.json | control/polling 组, hertz 格式 | source-confirmed |
| serial | raw (bytes @8, 22 字节 ASCII) | serial | serial | razer-1f-read, razer-3f-read | 全部 13 型号 | usb, wireless-receiver | OpenRazer, MacRazer | basilisk-v3-serial.json | details 区 (设备标识, 非独立 capability) | source-confirmed |
| firmware | major/minor (u8 @8/@9) | firmware | firmware | razer-1f-read, razer-3f-read | 全部 13 型号 | usb, wireless-receiver | OpenRazer, razer-qd-hid, MacRazer | basilisk-v3-firmware.json | details 区 (首步, 必需) | source-confirmed |
| deviceMode | mode (@8), param (@9) | device-mode | device-mode | razer-1f-read, razer-3f-read | 全部 13 型号 | usb, wireless-receiver | OpenRazer | basilisk-v3-device-mode.json | details 区 (device-settings capability) | source-confirmed |

## 协议说明

- 90 字节 feature report，report id 0x00，传输层在读取时剥离 report id，解析器看到 90 字节负载。
- offset 0 = status（0x02 = SUCCESSFUL）；offset 1 = transaction id；offset 2-3 = remaining packets；offset 4 = protocol type；offset 5 = data size；offset 6 = command class；offset 7 = command id；offset 8+ = arguments。
- XOR-8 校验和覆盖 offset 2..87，写入 offset 88；offset 89 保留为 0x00。
- firmware 为 read 工作流首步且必需；其余步骤使用 `onFailure: continue`，单个命令失败不会中止整个读取。

## Fixture 说明

fixture 为 90 字节整数数组（0-255），对应 basilisk-v3（transaction id 0x1F）的成功响应。参数样例值：

- battery-level: 0xD4 (212) → 212/255 ≈ 83%
- charging-status: 0x01（充电中）
- dpi: X/Y = 0x4C38 = 19512
- dpi-stages: activeStage=0, stageCount=2，stage0=19512, stage1=10000
- polling-rate: 0x01（1000Hz）
- serial: "BS12345678901234567890"（22 字节 ASCII）
- device-mode: mode=0（正常模式）
- firmware: major=2, minor=1（版本 2.1，见 basilisk-v3-firmware.json）
