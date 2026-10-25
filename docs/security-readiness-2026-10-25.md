# Security and licensing readiness — 25 October 2026

Draft PR #4 retains SQLite + TypeScript execution, the existing template format,
local-only processing and the >=8B native-agent eligibility rule. No release or
schema-breaking migration is introduced.

## Targeted fixes

| Dependency | Previous → candidate | Advisory / minimum |
| --- | --- | --- |
| Next.js | 16.3.8 → 16.4.3 | GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r, GHSA-673q-mjm6-r5xr; minimum 16.4.1 |
| Electron | 44.5.1 → 44.9.3 | GHSA-jr5w-w6x2-84p9; minimum 44.9.1 |
| electron-updater | 6.6.2 → 6.8.11 | GHSA-p2f4-r6v6-j797; builder-util-runtime >=9.7.0 |
| Zod | 4.6.5 → 4.6.7 | GHSA-mrhx-c7xc-m3w5; minimum 4.6.6 |
| Yauzl | 3.2.0 → 3.4.0 | GHSA-gmq8-994r-jv83 |
| http-cache-semantics | 4.2.0 → 4.3.0 | GHSA-ch52-4w7c-c8xp |
| Undici | affected 6.x/7.x → 6.29.1/7.30.1 | GHSA-xjj6-f33q-929c and related parser/integrity advisories |
| fast-uri | affected 3.x → 3.1.9 | URI normalization/scheme advisories |

The exact upstream records are linked by the retained npm audit JSON in the
private report. No use-server/use-cache declarations were found in app source.
Sharp 0.35.5 already met the image-optimizer workaround. These observations reduce
demonstrated exposure, not the need to patch; no exploit or blanket security
certification is claimed. Public-release updates do not use private GitLab tokens.

`extract-zip` 2.0.1 has no patched version for GHSA-jmr9-qjv8-65gv and
GHSA-7pqw-9j4j-h8q3. It is removed from the dependency graph. Ollama setup now uses
the existing Yauzl in an empty staging directory, bounds entries/bytes, writes
regular files exclusively before creating symlinks, and rejects escaping paths,
symlink parents, duplicates and unsupported entry types. Internal macOS-style
framework links are retained. SHA-256 verification still precedes extraction.
Four new tests exercise these invariants; Windows/macOS native acceptance remains
separate from Linux synthetic fixtures.

The residual npm finding is uuid <11.1.1 through ExcelJS (two moderate package
entries for GHSA-w5hq-g745-h8pq). The advisory concerns v3/v5/v6 supplied-buffer
bounds; inspected ExcelJS only calls v4 without a supplied buffer in conditional
format writing. Do not downgrade ExcelJS or force an incompatible major uuid
replacement to silence the audit. The finding is recorded, not called patched.

## Parser redistribution and notices

The pinned ExcelJS 4.4.0 document Workbook reader supplies the same bounded XLSX
load API. Importing it directly excludes unused streaming-reader dependencies
buffers, chainsaw, binary and unzipper from the compiled parser. This is not a
replacement of the analytical engine. Build validation checks their absence and
retains original parser license files plus `structured-licenses/manifest.json`.
The full npm lock still contains ExcelJS's declared transitives; their uncertain
upstream provenance is not retroactively declared resolved for other distributions.

Node/Electron/Chromium exact artifact license texts were inspected in Linux
packaging. MIT remains the application license. Native libvips obligations,
optional service images, dynamically selected models and artwork provenance
remain artifact-specific reviews; a dependency inventory is not legal clearance.

## Validation boundaries

Shared runtime changes justify rerunning unit/regression, distribution, build,
typecheck and API checks. The dated private report distinguishes retained current
logs from earlier executions whose local logs were lost when the workspace reset.
Real Ollama 0.40.11 with Qwen3 8B completed basic inference and native tool calling;
complete real analytical chat acceptance remains unverified. Simulator API tests
are not real inference tests.

Electron downloaded and its version probe passed. Graphical startup was blocked
by the host denying Chromium's process-singleton Unix socket. Windows/macOS were
not executed. Do not publish or infer release readiness from successful builds.

The parser notice check now covers all 33 bundled components. For saxes 5.0.1,
the version-pinned upstream LICENSE is retained under docs/licensing/notices;
isarray 1.0.0 supplies its full MIT text in its installed README. The build fails
if any compiled dependency has no notice, instead of silently exporting an empty entry.
