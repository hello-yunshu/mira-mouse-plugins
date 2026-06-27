<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin Signing and Release

Production Ed25519 material is read only from the protected `plugin-release` environment. PRs and forks receive no key. Release CI creates a deterministic package, signs the canonical manifest/checksum message, emits SHA-256/SBOM/evidence, creates a draft, redownloads into a clean job, verifies on all three platforms, then publishes and updates the signed index. Without a production key, output is `unsigned-preview` only.

The unified `Plugin Release` workflow may overwrite the latest `release/v*`
bundle. That is intentional: the release should reflect the current production
plugin set. After uploading assets, the workflow dispatches registry publication
and Mira lock synchronization so downstream SHA-256 values are regenerated from
the published `.sha256` files. When `MIRA_APP_TOKEN` is configured, the sync
workflow validates the generated lock update and commits it directly to the Mira
app repository `main` branch.

Do not manually copy plugin SHA-256 values into the Mira app repository. If a
Mira build reports a plugin lock mismatch, rerun the sync workflow or run the
Mira repository command:

```bash
cargo run --package xtask -- plugins update-lock --release-tag <release-tag>
```
