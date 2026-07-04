<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# 贡献指南

## 基本要求

- 使用公开的 Mira Plugin API，添加精确的、接口限定的设备匹配。
- 在获得型号特定的硬件回读证据之前，保持写入禁用（`writesEnabled: false`）。
- 用 Fixtures 覆盖所有失败路径。
- 切勿提交 `.research`、厂商材料、稳定标识符、密钥或签名 key。

## 注释与文档风格

注释和文档风格请遵循主仓的
[comment-and-doc-style.md](https://github.com/hello-yunshu/mira-mouse/blob/main/docs/comment-and-doc-style.md)。
面向用户的插件标签、灯效名和选项文案应放在 `locales/zh-CN.json` 与
`locales/en.json`；通用标签可走主应用 fallback，`plugin.json` 只保留
`labelKey` 和必要 fallback。

## 提交前检查

```bash
npm run validate
npm test
```

新增或修改协议储备时，运行 `npm run inventory:protocol` 确认储备已写入
库存文档，避免"预留协议"悄悄变成"当前能力"。

