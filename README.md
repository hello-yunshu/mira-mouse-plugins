<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
<p align="center">
  <img src="https://raw.githubusercontent.com/hello-yunshu/mira-mouse/main/public/app-icon.png" width="96" height="96" alt="Mira logo">
</p>

<h1 align="center">Mira Mouse Plugins</h1>

<p align="center">
  Mira 的声明式鼠标设备插件仓库。
</p>

<p align="center">
  <a href="#插件矩阵">插件矩阵</a> ·
  <a href="#插件包结构">插件包结构</a> ·
  <a href="#开发">开发</a> ·
  <a href="#协议储备">协议储备</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <img alt="Plugin format" src="https://img.shields.io/badge/format-.mira--plugin-7C3AED?style=flat-square">
  <img alt="Declarative" src="https://img.shields.io/badge/runtime-declarative-111827?style=flat-square">
  <img alt="No native code" src="https://img.shields.io/badge/plugins-no_native_code-10B981?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-7C3AED?style=flat-square">
</p>

## 简介

这个仓库保存 [Mira](https://github.com/hello-yunshu/mira-mouse) 的设备插件。每个插件都是一个签名的 `.mira-plugin` ZIP 容器，只包含声明式文件：设备匹配、能力元数据、协议命令、解析器、传输、工作流、测试和文档。

插件不包含原生代码、脚本、网页或 WASM。Mira 主应用读取插件声明，负责 HID 句柄、权限、运行时校验、界面骨架、主题、诊断和更新。插件决定“支持什么设备、读写什么字段”；主应用决定“如何安全一致地呈现”。

## 插件矩阵

| 插件 | 目标 | 证据状态 | 写入 | 说明 |
|---|---|---|---|---|
| [`mira.amaster`](plugins/amaster/) | AMaster / 怒喵兼容设备 | hardware-verified | enabled | Protocol A 与 AM35 路径；鼠标灯光和接收器灯光分开声明。 |
| [`mira.logitech-hidpp`](plugins/logitech-hidpp/) | Logitech HID++ 2.0 设备 | hardware-verified | enabled | 特性发现、DPI、回报率、配置、RGB 控制；不靠固定型号白名单。 |
| [`mira.example-mock`](plugins/example-mock/) | 运行时示例 | fixture-verified | disabled | 用于测试主应用和插件运行时。 |
| [`mira.razer-viper`](plugins/razer-viper/) | Razer Viper 研究草案 | inferred | disabled | 研究笔记和窄范围 bring-up 占位。 |

当前 `registry/index.json` 仍处于 blocked 状态，生产发布 key 和稳定发布流程就绪前不会声明正式插件市场。

## 插件包结构

典型插件目录：

```text
plugins/<plugin-id>/
├── plugin.json              # 插件元数据、权限、能力、UI placement
├── devices.json             # 设备匹配：VID/PID、usage、连接方式、证据
├── capabilities.json        # 导出字段和能力分组
├── protocol/
│   ├── commands.json        # HID 命令模板
│   ├── parsers.json         # 回包解析和派生字段
│   ├── transports.json      # HID / proxy / RACE 等传输
│   ├── workflows.json       # 读流程和 mutation
│   └── features.json        # HID++ 特性 registry，仅 Logitech 使用
├── README.md
└── LICENSE
```

核心边界：

- `commands/parsers/features` 可以包含未来储备。
- 只有被 `workflows.steps` 或 `mutations` 引用的内容，才是当前启用能力。
- 只有插件 `plugin.json` 声明的 capability metadata，才会进入主应用 UI。
- 写入必须是有界输入、预读、必要时保留未知字段，并通过回读断言验证。

## 开发

```bash
npm install
npm run validate
npm test
```

查看协议启用/预留库存：

```bash
npm run inventory:protocol
```

同步 Logitech HID++ 公共特性 registry：

```bash
npm run sync:hidpp
npm run sync:hidpp:check
```

打包插件：

```bash
npm run pack -- plugins/amaster dist/mira-amaster.mira-plugin
```

## 协议储备

为了支持未来开发，插件可以保留 source-confirmed 或 public-reference 的协议原语，但必须明确标注为储备。当前库存见：

- [协议储备库存](docs/protocol-reserve-inventory.md)
- [AMaster 协议证据](docs/amaster-protocol-evidence.md)
- [硬件证据矩阵](docs/hardware-evidence-matrix.md)
- [插件评审清单](docs/plugin-review-checklist.md)

`npm run validate` 会检查储备项是否写入库存文档，避免“预留协议”悄悄变成“当前能力”。

## 与主应用协作

Mira 主应用保持稳定 UI 框架；插件提供 labels、data source、mutation id、选项、summary 和 placement hints。Placement 是受限声明，不是任意 HTML/CSS/脚本。

主应用仓库：

- [Mira Mouse](https://github.com/hello-yunshu/mira-mouse)
- [插件 SDK](docs/plugin-sdk.md)
- [插件测试](docs/plugin-testing.md)
- [插件签名与发布](docs/plugin-signing-and-release.md)
- [插件版本策略](docs/plugin-versioning.md)

## 许可证

代码和构建定义采用 AGPL-3.0-or-later。原创文档采用 CC-BY-SA-4.0。详见 [`LICENSE`](LICENSE)、[`NOTICE`](NOTICE) 和第三方声明。
