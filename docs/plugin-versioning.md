<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# Plugin Versioning

Use SemVer and change only the plugin manifest version line:
`plugins/<plugin>/plugin.json` -> `version`. Filenames, registry metadata, and
Mira's `plugins.lock.json` are derived from the signed release workflow.
Breaking API or DSL changes require a new Plugin API major version.

Per-plugin tags such as `plugin/<plugin-id>/v<semver>` are immutable and must
not silently replace an existing same-version asset. The unified `release/v*`
bundle is the latest production plugin set and may be overwritten intentionally.
When it is overwritten, registry metadata and the Mira app `plugins.lock.json`
must be regenerated from the release `.sha256` files by workflow automation, not
by hand-editing SHA-256 values.
