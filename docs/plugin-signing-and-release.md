<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin Signing and Release

Production Ed25519 material is read only from the protected `plugin-release` environment. PRs and forks receive no key. Release CI creates a deterministic package, signs the canonical manifest/checksum message, emits SHA-256/SBOM/evidence, creates a draft, redownloads into a clean job, verifies on all three platforms, then publishes and updates the signed index. Without a production key, output is `unsigned-preview` only.

