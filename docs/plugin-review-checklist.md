<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin Review Checklist

- [ ] Exact interface-qualified matches and conflict scan pass.
- [ ] Validation samples are documented as evidence, not hard runtime model whitelists.
- [ ] Capabilities, localization, permissions, risk, and evidence agree.
- [ ] `locales/zh-CN.json` and `locales/en.json` cover plugin-specific capability labels, effect names, and option labels exposed by `plugin.json`.
- [ ] Capability metadata uses host-rendered controls, bounded placement hints, data-source paths, and mutation ids instead of brand-specific UI assumptions.
- [ ] Writes preserve unknown fields, read back, compare, and fail visibly.
- [ ] Stable writes link exact hardware records.
- [ ] Adversarial and fault Fixtures pass.
- [ ] Two clean packages have the same SHA-256.
- [ ] No code, remote content, secret, research material, or manufacturer asset exists.
