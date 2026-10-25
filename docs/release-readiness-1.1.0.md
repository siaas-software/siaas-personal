# Proposed coordinated source release: 1.1.0

**Proposal only. NOT READY for stable publication.** Current package version and
published tag remain 1.0.0; no version/tag/release is created here. The additive
analysis engine, Knowledge UI and templates justify a minor version. There is no
intended breaking schema change, but old releases cannot process new XLSX/CSV kinds.

## Integration order

1. Templates PR #1, then #2. The documentation branch incorporates #1 with the
   README conflict resolved; merging #2 first would also introduce its implementation.
2. Personal PR #4 into develop, then #5. The documentation branch incorporates #4
   with both license-notice sections preserved. Review #4 first; #5 is now stacked.
3. After remaining acceptance gates, prepare release/1.1.0 from develop, bump
   package.json and package-lock.json together and review a release PR into main.
4. Private documentation PR #3 records evidence independently. Website PR #1 can
   be reviewed now; integrate/publicize it only with separately approved publication.

No target branch is merged by this task. Preserve protected tags and the current
mandatory-PR policy. After integration verify the resulting tree, catalog checks,
versions and affected tests; avoid rerunning unrelated infrastructure.

## Draft release notes / changelog

- Add local XLSX/CSV ingestion, multi-sheet profiling, confirmed mappings and
  explicit dataset relationships in assistant Knowledge.
- Add bounded deterministic filtering, grouping, joins, decimal calculations and
  traceable results, integrated with local Ollama planning and descriptive RAG.
- Add Production Planning and Personal Finance guidance, with model unset and no
  private data or local paths in exports. Both use the same generic engine.
- Update vulnerable runtime/framework dependencies; replace unsafe ZIP extraction
  and exclude unused legacy streaming code from the parser bundle.
- Preserve existing guest-only operation, Knowledge, Actions, data isolation,
  source installation and optional Beta separation. No Docker/Python is required
  by standard analysis; no cloud spreadsheet processing is introduced.

## Gates and platform matrix

| Gate | Status |
| --- | --- |
| Unit/API/build and deterministic analysis | PASS; see private report for exact current logs |
| Real Ollama connectivity/basic inference/native tools on Qwen3 8B | PASS observed; complete real analytical chat NOT VERIFIED after a failed acceptance attempt |
| Linux source preparation/install and packaging | PASS observed; some original raw logs lost on workspace reset, explicitly recorded |
| Graphical Electron/website desktop/mobile/theme/accessibility | BLOCKED by host Unix-socket restriction |
| Windows/macOS native install/start/update/rollback | NOT TESTED; scripts reviewed and cross-platform tests are not native execution |
| Native binary/source/model/artwork redistribution clearance | NOT VERIFIED for all possible distributed artifacts |

## Installation, update and rollback

Use the existing official PowerShell/Bash workflows after publication. Windows
entry point remains `irm https://siaas.vercel.app/install.ps1 | iex`. Other platforms
use the documented Bash entry point. The managed runtime pin remains Node 24.22.0;
users do not need a separately managed database, Docker or Python for standard use.

Updates must verify source and runtime checksums, stage dependencies/build/package,
and activate only after success. Close the application before maintenance. File
lock/antivirus errors require closing conflicting processes and retrying; never
recommend disabling protection. Keep an external backup of the Electron profile
and originals. Rollback switches application/runtime, not database migrations.
Avoid reindexing new spreadsheet formats with an older application. Uninstall
unregisters the launcher and preserves user data/application versions.

## Required source artifacts and verification

After authorized release integration, run `npm run release:source` from the clean
reviewed commit. Required artifacts: `SIAAS-Personal-1.1.0-source.zip`,
`SIAAS-Personal-1.1.0-install.json`, `install-siaas.ps1`, `install-siaas.sh`,
`SHA256SUMS.txt`, release notes and platform/test evidence. No .exe/.dmg workflow.

- [ ] Resolve real analytical chat acceptance and graphical/platform gates.
- [ ] Review remaining uuid advisory applicability and licensing findings.
- [ ] Confirm version, source tag and runtime.json agreement.
- [ ] Generate hashes from exact final files and verify clean extraction.
- [ ] Verify public GitHub asset names, URLs, byte sizes and digests after publication.
- [ ] Verify installer resolution and managed Node checksums on supported OSes.
- [ ] Verify update/rollback with disposable profiles and representative backups.
- [ ] Retain MIT and all applicable component notices; no model weights included.
- [ ] Adopt reviewed template catalog SHA explicitly; existing app snapshot already
      pins template implementation 7ec5a819be9051242f1b9f94317629f593f1d265.
- [ ] Separately approve website deployment; preserve noindex/robots/prelaunch.
- [ ] Update website draft labels only after actual availability is verified.

Unsupported: automatic formula recalculation, optimization scheduling, currency
conversion without explicit data, exhaustive row lineage, arbitrary SQL/code,
and universal correctness of AI interpretation. Verified numeric tables must
remain distinguishable from generated explanations. A build is not release approval.
