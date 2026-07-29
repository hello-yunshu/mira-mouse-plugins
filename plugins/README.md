# Mira Mouse Plugins

本目录每个子目录对应一个插件。每个插件自包含，遵循相同的布局：

```
<plugin-id>/
├── plugin.json          # 元数据、能力、权限
├── devices.json         # 支持的 USB/Bluetooth 设备 ID
├── capabilities.json    # 运行时能力映射（读/写分组）
├── locales/             # 按语言划分的用户可见标签和选项文案
├── protocol/            # 命令、解析器、传输和工作流
│   ├── commands.json
│   ├── parsers.json
│   ├── transports.json
│   ├── workflows.json
│   └── features.json    # HID++ feature registry（仅 Logitech）
├── tests/               # 插件级测试
├── README.md            # 插件专属文档
└── LICENSE              # 许可证文件
```

## 插件索引

| Plugin ID | 名称 | 证据 | 写入 | 说明 |
|---|---|---|---|---|
| [`mira.amaster`](./amaster/) | AMaster / 怒喵兼容设备 | hardware-verified | enabled | Angry Miao 协议支持 |
| [`mira.example-mock`](./example-mock/) | Mira Example Mock | fixture-verified | disabled | 用于测试运行时的示例 / mock 插件 |
| [`mira.logitech-hidpp`](./logitech-hidpp/) | Logitech HID++ | hardware-verified | enabled | Logitech HID++ 2.0 协议，包含 Onboard Profiles（`0x8100`）和 Profile Management（`0x8101`） |
| [`mira.razer-viper`](./razer-viper/) | Razer Viper Research | inferred | disabled | Razer Viper 协议研究笔记 |

## 新增插件

1. 在 `plugins/` 下创建新目录。
2. 添加必需文件：`plugin.json`、`devices.json`、`capabilities.json`、`protocol/*.json`、`README.md`、`LICENSE`。
3. 运行 `npm run validate` 和 `npm test`。
4. 对基于 HID++ 的插件，考虑在 `vendor/` 下 vendoring 上游参考资料，并添加 `features.json` registry。

对于只针对某一个具体鼠标型号的窄范围插件，请遵循
[`../docs/plugin-sdk.md`](../docs/plugin-sdk.md) 中的单型号说明。从只读开始，
仅匹配已测试硬件，并在 UI 元数据之前先添加 fixture。

不要把验证样本变成运行时型号白名单。一个宽泛的协议族插件应匹配稳定的
接口/协议形状，并从 workflow 输出派生能力。只有当协议尚不能安全推广时才
使用单型号插件，且其精确型号范围必须在 `devices.json`、fixture 和插件
README 中记录。

协议文件也可能包含 source-confirmed 或 public-reference 的、为未来开发保留
的材料。请将当前 UI 契约与这些储备分开：一个 command、parser 或 HID++
feature registry 条目在被 workflow 或 mutation 引用之前，不是已启用能力。见
[`../docs/protocol-reserve-inventory.md`](../docs/protocol-reserve-inventory.md)
，并在提升储备协议材料之前运行 `npm run inventory:protocol`。

## UI 契约

Host UI 从声明式元数据渲染插件能力。插件必须声明语义契约，并将协议细节
留在自己的 workflow 和 mutation 文件中。详细 schema 参考
[`../docs/plugin-sdk.md`](../docs/plugin-sdk.md)（Host 仓库的镜像）。

### 通用规则

- `placements` 决定能力出现的位置：hero、control、status 或 details。
- `control` 决定准备哪种 host 渲染的 widget。
- `metadata.fields[]` 声明每个 field 的 `source`、`mutation`、`param`、`editor`、
  `visibleWhen`、`range`、`options`/`optionSource`/`labelSource`、`format`、`labelKey`。
- `metadata.stateMapping` 将 snapshot 字段映射到设备 capabilities 路径。
- `metadata.statusDisplay` 声明状态栏展示。

### 灯光能力（LightingZone）

- `LightingZone` 必须声明 `metadata.zones[]`，每个 zone 含 `id`、`labelKey`、`fields[]`。
- 灯光 field 通过 `lightingRole: "primary-color"` 标识主颜色入口（field 级别，非 zone 级别）。
- Host 据此构建「顶部灯光带 + 最右普通颜色子块」双入口布局，详见
  Host 仓库 `docs/plugin-sdk.md` 中的「灯光双入口布局契约」。
- `effect` field 固定在最左，`primary-color` field 固定在最右。
- 普通灯光子块总数最多 6 个（1 effect + 最多 4 candidate + 1 primaryColor）。
- 顶部灯光带不计入 6 个普通子块上限。
- 顶部灯带和最右颜色子块必须绑定同一 field、同一 mutation、同一最新设备状态。
- AM35 灯光通过声明式 normalization 转换为统一 `mouseLighting` 对象，
  Host 不写 `if am35`。

### 其他能力

- `battery` capability 必须声明 `metadata.batteryHistory.validConnections`；仅这些连接
  方式的读数会被 host 记录和分析。不要让 host 根据 USB、品牌或固定百分比猜测可信度。
- `DpiStages` 必须声明 `metadata.stageLayout`（含 `selectMutation`、`setMutation`、
  `valueSource`、`colorSource`、`dotsSource`）。

Host 不应仅从设备数据推断协议专属命令、灯效名、颜色语义或可写操作。请先
添加或更新元数据契约，再让插件协议将其映射到设备。
