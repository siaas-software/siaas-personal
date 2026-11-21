# RC5 targeted regression correction — 21 November 2026

Initial checkpoint: **PARTIAL implementation; release validation BLOCKED by unavailable execution environment**. This historical checkpoint is superseded by the [completed executable validation](rc5-validation-2026-11-21.md). The user explicitly authorized these two targeted corrections, preserving PR #42, and subsequent publication only after mandatory gates pass. This draft is based on #42 at `ce7dc5deb45a0da61ef395a8f297a4f591f800c8`.

## Direct-chat lifecycle decision

The integrated direct chat owns its request in the mounted chat view: explicit Cancel, navigation out of that view, and page closure abort its request. The optional project chat instead uses persisted server runs. Keep that distinction; do not introduce background direct-chat orchestration just to satisfy an older monitoring test.

Overview must still show active requests, complete metrics and correct assistant/project associations. The corrected test observes an active direct chat from a second authenticated page, retaining all existing metric/filter/recovery/responsive checks. Separate navigation and explicit-cancel scenarios assert actual Ollama socket closure, persisted partial text with error status, cancelled telemetry without invented token counts, reload retention and a deterministic follow-up proving lease reuse.

A narrow application defect was found: the assistant executor previously added cancellation inside the fetch adapter, after streamLocal installed its monitor. The monitor saw only the timeout signal, so cancellation could be misclassified as a connection error. streamLocal now accepts the caller signal and combines it with its unchanged 180-second deadline before the monitored transport. The executor passes that signal directly. No router, prompt, execution deadline, access boundary or output limit changes.

## Missing Docker/Ollama contract

The streaming chat opens HTTP 200, then reports model unavailability as an NDJSON error. The suite now requires exactly the error event (no generated deltas, success, fabricated evidence or artifacts) and exact persisted user/error messages. Selecting an unavailable model still must return HTTP 503. Optional feature activation without Docker still must return HTTP 409.

Offline preparation now checks both inline text and actual uploaded TXT bytes. It requires ready lexical-v1 metadata, nonempty chunks without embeddings, idempotent processing, deterministic arithmetic after failure, evidence-backed retrieval of only the authorized documents, zero inference token counts, exact conversation retention and byte-identical TXT download after server restart. Research preferences remain disabled and no research installation state may appear before or after restart. The old skip-as-success for a host with Docker is replaced by an explicit prerequisite assertion.

## Validation status

| Check | Current correction |
| --- | --- |
| Source review against integrated API/database contracts | Completed |
| JavaScript parsing of modified E2E bodies | PASS syntax only; not a Node/Electron execution |
| Overview E2E and missing Docker/Ollama E2E | NOT RUN — executor unavailable |
| Unit tests, TypeScript, formatter | NOT RUN — executor unavailable |
| Desktop/web builds, API/UI regression and packaging/distribution | NOT RUN — executor unavailable |
| Exact-commit 12 source assets and checksum verification | NOT RUN for this correction |
| GitFlow integration and prerelease publication | BLOCKED until executable gates pass |
| Anonymous RC5 downloads | NOT RUN — RC5 unpublished |
| Native Windows/macOS, native Electron and real Ollama | Remain separate post-publication acceptance per RC policy |

The prior [formatting report](rc5-format-validation-2026-11-21.md) and every earlier log are retained. Their PASS results are historical and do not validate this new code. No failing assertion was removed to manufacture success. No merge, tag, public asset, RC4, main, website, unrelated repository or automation change is made by this draft.

## Resume

Fetch this draft and run the pinned formatter, both corrected E2E suites after desktop build, full mandatory automated/type/build/API/UI/packaging/distribution checks, and inspect any failure. Preserve cancellation and persistence assertions rather than broadening expected outcomes.

After all executable gates pass, reconcile RC4 ancestry with reviewable conflict resolution, integrate through protected PRs into develop and derive release/1.1.0-rc.5. Regenerate all twelve assets from that exact release commit and verify draft uploads before immutable prerelease publication with Latest disabled, then verify anonymous bytes. Old review ZIPs are not final release artifacts.

Publication access was previously denied by automatic approval review of a usage-limit gate. Browser control is no longer available in this session, and connected GitHub tools do not expose release creation/binary upload. Do not bypass these restrictions; leave verified final assets unpublished if access remains unavailable.
