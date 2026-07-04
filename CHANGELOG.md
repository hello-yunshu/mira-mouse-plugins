<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Changelog

## [0.1.1] - 2026-07-04

- 文档清理：删除面向维护者的发布/版本管理文档（plugin-signing-and-release、plugin-versioning）。
- README 改进：新增"适配新设备"版块，简化技术细节，对用户和开发者更友好。
- 文档结构化：中文版作为主语言放在 docs/ 根目录，英文版放在 docs/en/。
- 删除过时文档：GOVERNANCE、SECURITY、CODE_OF_CONDUCT、ROADMAP、SUPPORT、TRADEMARKS、THIRD_PARTY_NOTICES。

## [Unreleased]

- 为 AMaster 的 performance、sleep、profile、lighting、firmware、device-settings、receiver 和 button-mapping 能力补全了声明式 UI 元数据，包括按连接方式绑定的 sleep binding。
- 新增了带回读验证的 HID++ software/onboard control-mode mutation 和插件声明的 UI 元数据，允许 host 在没有 Logitech 专属组件的情况下渲染该控件。
- 新增了声明式 HID++ `0x8100` 元数据，并使用设备上报的 sector size 进行整扇区读取，包括对齐的 final-block 读取和 CRC-CCITT 校验。
- 扩展了 Logitech HID++ polling-rate 能力元数据，当设备暴露 extended report-rate 路径时纳入 2000、4000 和 8000 Hz 选项。
- 使 DPI 和 report-rate mutation 优先写入当前 onboard profile，同时保留所有无关字节；标准 HID++ 写入仍作为 fallback。
- 通过第二个 LED slot 启用了受 guard 保护的 profile-format-5 lighting 写入。
- 在用户可见的能力和 mutation 表面移除了独立的 Logitech HID++ RGB host-control 开关，直到 zone/effect lighting 写入能够被一致地暴露。
- 在 G705 上对 DPI、report rate 和 lighting 进行了硬件验证并支持往返恢复；G705 仍为协议验证样本，不是型号白名单。
- 将 `mira.logitech-hidpp` 推广为不带型号/PID 白名单的 Logitech HID++ long-report 集合，支持 receiver slot `1..6` 和直连 index `0xFF` 的有界 device-index discovery。
- 在 G705 验证样本上硬件验证了通用 workflow：设备标识/名称、Unified Battery、当前 DPI 和 report rate。
- 新增了带回读验证的标准 HID++ 写入，用于当前 DPI 和 report rate。可用 mutation 从各设备暴露的 feature index 派生。
- 新增了 Output/Input transport 响应/错误匹配、动态 feature-index 引用和 unsupported-feature guard。
- 修正了 Battery Level Status 使其直接使用上报的百分比，并将 Device Information（`0x0003`）与 Device Name（`0x0005`）分离。
- 移除了未验证的 direct-usb usage collection 以及未验证的 firmware 和 pointer-speed 声明。
- 修正了 HID++ report 大小为总计 20 字节（`0x11` report ID 加 19 字节 payload），与 receiver report descriptor 一致。
- 通过 `046d:c547` receiver slot `1` 硬件验证了一只 G705 Mouse：设备名称/信息、Unified Battery（`0x1004`）电量 66%、Adjustable DPI（`0x2201`）1800 DPI（默认 800 DPI）。

## [1.0.1] - 2026-06-28

- 加固了插件 release workflow：gate 现在导出 `plugins_count`，publish job 在触碰 GitHub release 之前会校验下载的 `.mira-plugin` asset 数量是否匹配，不匹配则拒绝上传。
- 在 overwrite 模式下，publish job 现在会在上传新构建之前删除所有已存在的 release asset，这样 renamed-version 产物（如 `0.7.0 → 0.7.2`）不会再在 `--clobber` 之后留下残留文件。
- 为 AMaster 和 Logitech HID++ 的 DPI 能力添加了防御性的 `min`/`max`/`step` 元数据。Mira host 已经从 `protocol/workflows.json` 的 mutation input 中补全这些值，因此这对不执行 workflow 补全的 host 是静态 fallback。

## [1.4.0] - 2026-06-21

- `mira.logitech-hidpp` 0.3.0：用单个 `be-u16` `dpiValue` 字段替换了拆分的 `dpiHigh`/`dpiLow` u8 字段，利用了 Mira runtime 新增的 DSL `be-u16`/`be-u16-array` field kind。
- 将 DPI workflow 输出从 `dpiValue` 重命名为 `dpi`，使 runtime 的 `standard_reading` 将其映射为 `DeviceSnapshot.dpiStages` 中的单个 active stage，让 Mira UI 无需完整 stage 列表即可渲染和编辑当前 DPI。
- 使 `standard_reading` 对缺失的 `stageColors`/`stageCount`/`currentStage` 具有容忍性，并添加了 `dpi.dpiValue` fallback 路径，使单 DPI 设备能正确显示。
- 将 `be-u16` 加入插件 validator 的允许 encoding 列表。
- 移除了不支持的 `polling-rate` 能力（HID++ 2.0 没有标准 polling-rate feature），并添加了 `pointer-speed` 作为只读能力。
- 全部四种拓扑（unifying、lightspeed、bolt、usb-direct）现在都暴露对齐的 `dpi` 输出。

## [1.3.1] - 2026-06-21

- 新增了 Bluetooth 和 2.4 GHz sleep time 的 read-modify-write-readback mutation，保留所有无关设置字节。
- 将当前连接模式的 sleep timeout 作为可编辑设置暴露给 Mira。

## [1.3.0] - 2026-06-20

- 新增了针对当前 DPI stage、per-stage DPI、polling rate、mouse character lighting 和 receiver lighting 的声明式 read-modify-write-readback mutation。
- 为 full-state setter 保留未知字节，重建了精确的 short lighting frame，并添加了 input schema、有界 settle delay 和字段级 readback 断言。
- 保持 AM35、button mapping、application-layer lighting linkage、firmware、pairing、macro 和 raw write 处于禁用状态。
- Fixture 和构建验证通过；硬件写入冒烟测试仍待完成，因为匹配到的 receiver 在最终验证时报告其鼠标离线。

## [1.2.0] - 2026-06-19

- 将 `mira.amaster` 从临时 1.0.0 提升到 1.2.0，使签名 asset 不再与占位 1.0.0 产物冲突。
- 使用生产 key `mira-plugins-2026-001` 重新打包并重新签名 `mira-amaster-1.2.0.mira-plugin`。
- 在 protocol-a-receiver 上硬件验证了 2.4 GHz receiver 回读（DPI / profile / battery / firmware / lighting）。
- 未修改主 `mira-mouse` 仓库中的 UI 文件。

## [1.0.0] - 2026-06-19

- 新增了 Example Mock 教程、只读 AMaster 候选和空白名单的 Logitech/Razer 研究 descriptor。
- 不声称任何硬件兼容性或签名 release。
