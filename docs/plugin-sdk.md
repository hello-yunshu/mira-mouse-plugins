<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin SDK

使用 `plugin-sdk-version.toml` 中的版本。插件拥有 matching、topology、protocol、parsing、capabilities、ranges、label keys、localized copy、narrow permission declarations 和 fixtures。Mira 主应用拥有 HID handles、timing、cancellation、rollback、standard controls、themes、settings、diagnostics 和 updates。插件不包含可执行代码或展示层代码。

## 协议族、型号与证据边界

当匹配和工作流可以用稳定的接口属性和运行时发现来表达时，优先使用协议族插件。验证模型是一种证据，而不是兼容性门禁。例如，暴露相同 feature index 的 HID++ 设备应由工作流输出来治理，而不是由 `plugin.json` 中仅针对 G705 的分支来治理。

不同文件承担不同职责：

- `devices.json` 描述 HID/接口匹配和证据范围。使用精确的 VID/PID、usage page、usage、connection 和 family name。`hardwareVerifiedModels` 仅作为证据说明保留。
- `protocol/workflows.json` 证明存在哪些输出、允许哪些 mutation。可选 feature 应由 guard 跳过，而不是变成型号特定的 UI 分支。
- `plugin.json` 声明 host 渲染的能力、placement hint、data-source 路径、mutation id、有界选项、lighting role 和能力元数据。
- `plugin.json.runtime.wakeRecovery` 可声明无线组件的活动恢复契约。插件只声明 `activitySource`、稳定的 `componentId` 和适用连接；Host 拥有各平台活动监听、退避与读取时序。当前 `system-pointer` 不要求辅助功能权限，也不能被 Host 自动推断，只有明确声明的插件才会启用。
- `locales/*.json` 拥有插件特有的标签、灯效名和选项文案。DPI、电量等通用控件可使用 host 翻译 fallback。`metadata.label` 仅作为旧 host 的 fallback。
- `tests/fixtures` 记录证明某个 parser、workflow 或 promoted write 合理性的精确 report。

只有当物理型号以无法通过 workflow guard、feature discovery 或声明式能力元数据表达的方式改变了协议布局时，才新增型号特定的文件或插件。

## 单型号插件

当某个具体鼠标型号有足够证据可用，但协议尚未准备好支持广泛品牌或协议族时，使用单型号插件。从只读开始，仅匹配已测试的 VID/PID、usage page、usage、connection type 和 model/evidence string，保持 `writesEnabled: false`，直到每个写入都具备有界输入、保留无关字节、验证回读，并能在冒烟测试中恢复原始值。

最小化 bring-up 顺序：

1. 捕获设备标识和每个可见字段的一份 report fixture。
2. 在任何广泛厂商匹配之前，先添加精确的 `devices.json` 匹配。
3. 在 UI 元数据之前，先添加 parser 字段和读取 workflow。
4. 在暴露插件特有的能力标签、灯效名或选项标签之前，先在 `locales/zh-CN.json` 和 `locales/en.json` 中添加本地化标签。
5. 仅当 workflow 输出证明支持时，才声明能力。
6. 每次只提升一个写入，且必须带有输入限制和验证断言。

在将单型号插件推广为协议族插件之前，至少证明另一个型号或接口路径，从 `protocol/*.json` 中移除型号假设，并更新 README，使已验证型号被描述为样本而非白名单。

对于 AI IDE 协作，请将 prompt 限定在单个契约层：

```text
Build a narrow Mira single-model mouse plugin from local files only.
Start read-only. Inspect plugin.json, devices.json, capabilities.json,
protocol/*.json, tests/fixtures, and README.md before editing.
Implement one capability at a time: exact match, fixture first, read workflow
before UI metadata, and no writes without bounded input plus readback evidence.
Run npm run validate and npm test. Do not change host-app files.
```
