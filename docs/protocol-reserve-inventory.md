<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# 协议储备库存

本文件用于将面向未来开发而存在的协议材料与
当前已启用的协议材料区分开来。宿主 UI 只能渲染已声明的
插件能力与可写 mutation。仅凭某个命令或解析器出现在
`protocol/*.json` 中并不足以将其暴露给 UI。

## 状态规则

| Status | Meaning | May affect UI? |
|---|---|---|
| 已启用读取路径 | Referenced by `protocol/workflows.json` under a read workflow `steps[]`. | Yes, through normalized snapshot output. |
| 已启用 mutation | Referenced by `protocol/workflows.json` under `mutations`. | Yes, through `writable_mutations` and capability metadata. |
| 已启用 transport 内部项 | Referenced by `protocol/transports.json`. | No direct UI surface; it only supports a transport. |
| 保留协议原语 | Defined in commands/parsers but not referenced by workflows, mutations, or transports. | No. It must stay invisible until validated and explicitly connected. |
| feature registry 储备项 | Present in a generated feature registry but not referenced by workflows. | No. It is a lookup source for future workflows only. |

在将任何保留项移入 workflow 或 mutation 之前：

1. 新增或更新 hardware/fixture 证据。
2. 为输出起一个与物理目标相匹配的名称：mouse、receiver 或 host-control。
3. 对于写入，约束每一个输入，必要时保留未知字节，并添加回读断言。
4. 更新本库存并运行 `npm run validate`。

## AMaster

当前计数（来自 `node scripts/protocol-inventory.mjs`）：

| Category | Entries |
|---|---|
| Commands | 46 total; 42 enabled by read workflows, mutations, or transports; 4 reserved. |
| Parsers | 29 total; 28 enabled by read workflows, mutations, or transports; 1 reserved. |
| Mutations | 15 enabled. |

已启用但不直接面向 UI 的项：

| Entry | Kind | Why it is enabled |
|---|---|---|
| `receiver-start` | command | Internal `protocol-a-receiver` transport handshake. |
| `receiver-poll` | command | Internal `protocol-a-receiver` transport polling. |
| `receiver-set-length` | command | Internal `protocol-a-receiver` payload-length setup. |
| `receiver-read` | command | Internal `protocol-a-receiver` payload read. |
| `receiver-status` | parser | Internal `protocol-a-receiver` status parser. |

保留的协议原语：

| Entry | Kind | Reason to keep | Activation rule |
|---|---|---|---|
| `mouse-light-switch` | command/parser | Protocol A `0x87` 存在于 source-confirmed 命令集中，但硬件写入/回读显示它不等价于当前接收器链路上的鼠标灯光开关。 | Do not add to read workflows or mutations until the physical target is proven and the output name is unambiguous. |
| `mouse-light-switch-write` | command | 同一 `0x87` 原语的写入模板。 | Do not expose as `set-mouse-light-switch`; mouse lighting on/off currently uses `set-mouse-lighting` with `settings.mouseLightEnabled` readback. |
| `profile-write` | command | 保留的旧 Protocol A profile 写入模板，用于未来 profile 编辑研究。 | Add only with a matching read command, bounded profile range, and readback assertion. |
| `am35-serial` | command | AM35 序列号查询材料，用于未来设备身份工作。 | Add only after the response parser and privacy behavior are defined. |

AMaster 灯光边界：

- 鼠标灯光颜色/启用状态来自 `settings.mouseLightStartColor`、
  `settings.mouseLightEndColor` 与 `settings.mouseLightEnabled`。
- 接收器灯光来自 `receiverLighting`，由
  `set-receiver-lighting` 控制。
- 保留的 `0x87` 开关原语不得用作鼠标灯光状态或
  接收器灯光状态，直到真实硬件证据证明其目标。

## Logitech HID++

当前计数（来自 `node scripts/protocol-inventory.mjs`）：

| Category | Entries |
|---|---|
| Commands | 42 total; 37 enabled by read workflows or mutations; 5 reserved. |
| Parsers | 31 total; 29 enabled by read workflows or mutations; 2 reserved. |
| Feature registry | 195 generated entries; 18 currently referenced by workflows. |
| Mutations | 9 enabled. |

保留的协议原语：

| Entry | Kind | Reason to keep | Activation rule |
|---|---|---|---|
| `onboard-memory-write-start` | command | Onboard Profiles 内存写入封装已就绪，但完整写入生命周期未对外暴露。 | Enable only with chunk sizing, commit/abort behavior, backup/restore, and readback verification. |
| `onboard-memory-write-chunk` | command | 用于未来 profile 内存编辑的分块写入原语。 | Same as above; never expose without a complete transaction. |
| `onboard-memory-write-end` | command | 用于未来 profile 内存编辑的结束/提交原语。 | Same as above; must not be callable alone. |
| `profile-mgmt-control` | command/parser | HID++ Profile Management 控制原语，保留用于未来的模式/控制操作。 | Enable only after public semantics and hardware readback are clear. |
| `profile-mgmt-set-current` | parser | 存在用于 current-profile 写入回复的解析器，但当前 mutation 通过读取 `profile-mgmt-get-current` 进行校验。 | Keep reserved unless a direct write-reply workflow needs it. |
| `rgb-control-set` | command | HID++ RGB Effects host-control 写入模板，保留用于未来 handoff 工作；但当前 UI 不应暴露独立的 host-control 开关。 | Enable only as part of a coherent zone/effect lighting workflow with hardware evidence and readback verification. |

Feature registry 储备项：

- `protocol/features.json` 是有意写得很宽泛的，由 vendored
  公开引用生成。
- 当前被引用的 feature 名称为：
  `ADJUSTABLE_DPI`, `BATTERY_STATUS`, `COLOR_LED_EFFECTS`,
  `DEVICE_FW_VERSION`, `DEVICE_NAME`, `EXTENDED_ADJUSTABLE_DPI`,
  `EXTENDED_ADJUSTABLE_REPORT_RATE`, `FEATURE_SET`, `MOUSE_POINTER`,
  `ONBOARD_PROFILES`, `POINTER_SPEED`, `PROFILE_MANAGEMENT`, `REPORT_RATE`,
  `RGB_EFFECTS`, `SURFACE_TUNING`, `UNIFIED_BATTERY`, `WHEEL_STATS`, and
  `XY_STATS`.
- 所有其他 feature registry 条目均为查询用储备项。它们不意味着 UI
  支持，在某条 workflow 引用它们并声明 capability/mutation 契约之前，
  不得将其视为能力。
