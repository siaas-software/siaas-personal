# Changelog

## 1.1.0-rc.4 (release candidate preparation; not published)

- Integrate the first-party, verified SIAAS CLI-managed Personal lifecycle on
  **Linux x64 only**, without globally installed Node/npm or automatic GUI launch.
- Install to separate owned stable/RC roots, reject unverified legacy adoption
  and downgrades, and keep previous generations during supported updates.
- Add managed process-lease/quiescence checks and a bounded cold profile backup;
  refuse unreviewed persistence-code migrations.
- Remove owned software/runtime/cache on CLI uninstall, preserving user profiles,
  backups, sibling installations and optional external Ollama.
- Preserve the existing source-only release inventory (12 assets) and historical
  stable/RC releases. Other platforms and published-release acceptance remain
  unverified.

RC4 local automated/type/build, API/SQLite, headless browser, Linux packaging and
12-asset source-integrity validation passed after repairing stale browser tests.
Earlier Linux x64 lifecycle acceptance with local fixtures remains separate;
public CLI and native GUI acceptance remain **NOT RUN/BLOCKED**.
See [RC4 notes](docs/releases/1.1.0-rc.4.md),
[readiness](docs/releases/1.1.0-rc.4-readiness.md) and
[native limitations](docs/releases/1.1.0-rc.4-windows.md).
No tag, GitHub release or stable promotion is implied.

## 1.1.0-rc.3 (unreleased)

- Package the functionality integrated on develop at
  `741b531376c93262c5d15354faf14747fbcf97cc`; no new product features.
- Include six official templates and centralized semantic palettes, preserving
  custom colors and existing project data.
- Retain explicit RC source installation, isolated profiles and the 12-asset
  source distribution contract. Native installer testing uses disposable VMs.
- Omit previous release artifacts from repeated standalone desktop builds while
  retaining dependency output directories.
- Exclude unmerged draft PRs #20 and #21.

See [RC3 notes](docs/releases/1.1.0-rc.3.md),
[readiness](docs/releases/1.1.0-rc.3-readiness.md) and
[native testing](docs/releases/1.1.0-rc.3-windows.md).
No tag, release publication or stable promotion is implied.

## 1.1.0-rc.2

- Ground structured answers in validated calculations and source evidence; keep
  general conversation and standalone arithmetic on the normal chat route.
- Prepare clear CSV/XLSX imports automatically, with focused clarification for
  ambiguous files and optional advanced mappings and relationships.
- Preserve project palettes while updating inner panels and original SIAAS icons.
- Verify source archives, installers, six platform manifests and published checksums.

See [RC2 notes](docs/releases/1.1.0-rc.2.md) and the
[publication and validation report](docs/releases/1.1.0-rc.2-publication.md).
This is a prerelease; stable promotion is not implied.

## 1.1.0-rc.1

- Add local Structured Data Analysis using SQLite and TypeScript, with XLSX/CSV
  ingestion, mappings, relationships, deterministic queries and source evidence.
- Integrate structured results with Knowledge, Chat and Ollama query planning.
- Add Production Planning and Personal Finance; retire Home Gardening and Software
  Engineering from the official catalog without removing existing user projects.
- Harden ZIP extraction, update Electron, and retain third-party parser notices.
- Add isolated source-based candidate installation and reproducible testing data.

See the [historical candidate notes and validation limits](https://github.com/siaas-software/siaas-personal/blob/v1.1.0-rc.1/docs/releases/1.1.0-rc.1.md).
RC1 instructions describe that candidate; use the RC2 documentation above for RC2.
The original notes remain preserved by the protected, immutable RC1 tag.

## 1.0.0

Existing stable SIAAS Personal release. Its tag and release assets are unchanged.

