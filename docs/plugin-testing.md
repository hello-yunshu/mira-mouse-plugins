<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# 插件测试

运行 `npm run validate` 和 `npm test`，然后使用锁定的已发布 Mira CLI
执行 `validate`、`test`、`pack` 和 `inspect`。在干净目录中打包两次，
并要求两次产物 SHA-256 完全一致。

Fixtures 覆盖成功、校验和、封装、分片、转发、超时、
畸形包、拔出、回读不匹配以及未知字段保留等场景。
仅通过 fixtures 只能算作 `fixture-verified`。

在提升（promote）某个型号或能力之前：

1. 确认 `devices.json` 与预期的接口范围一致，且不会
   把验证样本意外变成型号白名单。
2. 确认可选协议特性是由工作流守卫或 feature
   discovery 跳过的，而非由宿主侧的品牌或型号分支跳过。
3. 确认 `plugin.json` 中每个插件专属能力标签、效果名称与
   选项标签在两个插件 locale 文件中均有条目。
4. 确认每个启用的写入在 patch 已有
   report 或 memory sector 时，具备有界输入、预读状态、回读
   断言与未知字段保留。
5. 将真实硬件运行记录在 `docs/hardware-evidence-matrix.md`；空
   字段保持 unknown，不要扩大兼容性声明。
