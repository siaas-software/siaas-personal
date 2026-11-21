# RC5 integration verification — 20 November 2026

**Status: PARTIAL; draft work, not released.** Scope: integrate #37/#38 into the existing #34 → #35 → #40 → #41 source stack. #39's foundation was already absorbed into #41 and was not replayed. #36 is refreshed after source validation. Baseline develop: `47551f23e850da9a4482df5f4dcea5d513d0d08d`; original #41: `41f16a52779a54a908c088df631062c18b0aa2b1`. See the containing commit for the exact reviewed source.

## Implemented and corrected

Both direct and project chat use the same assistant executor. Source integration fixes TypeScript boundary types, native Action canonicalization, missing start-event message IDs, error completion status, partial response preservation, model usage reporting, truncation detection, server cancellation, async persisted project progress, concurrency, membership revocation, stale leases and scoped artifacts. Existing RC4 browser expectations were reconciled with current project navigation and five built-in Actions plus Data Cell. The advanced structured UI now uses the accessible project-opening button. Next 16.4.6 is retained from the earlier candidate dependency correction.

## Executed evidence

Environment: isolated Linux x64, Node 24.22.3, lockfile npm installation, Next 16.4.6 production desktop build. Playwright uses Chrome headless shell 153.0.8010.12 through `CHROMIUM_EXECUTABLE_PATH`. Synthetic fixture documents/models only. Commands run from the app root after `npm run desktop:build`.

| Check | Result | Evidence and limits |
| --- | --- | --- |
| `npm ci`; Morphic dependency installation | PASS | Existing lockfiles, no new mandatory runtime |
| `npm run typecheck`; `npm test` | PASS | 190 tests, 0 failures/skips |
| `npm run desktop:build` | PASS | Production routes, structured parser and notices bundled |
| `npm run test:chat` | PASS | Ordinary chat/RAG, capability eligibility, three-tool protocol, reports and persistence; mocked Ollama |
| `npm run test:knowledge` | PASS | Linked import/refresh/reconnect, availability, duplicate handling, isolation, cleanup |
| `npm run test:actions:api` | PASS | Built-in immutability, custom metadata boundaries, builder and scoped model paths |
| `node tests/template-api.mjs` | PASS | Six presets, portable exports, configuration and legacy compatibility |
| `node tests/structured-api.mjs --hybrid --ui` | PASS | Chat returns 4, exact invoice 256.65, budget 35 EUR/1 row, duplicate aggregation 25 EUR/2 rows; zero Ollama requests, no model, ambiguity and scope denial; composer Enter and reload |
| `node --import tsx tests/project-chat-api.mjs --ui` | PASS | Direct/delegated parity, configured/no-model zero calls, hostile preferences/handoff, native scope, separate histories, async cancellation reaches model socket, truncation/error metrics, concurrent runs, membership revocation, report denial, stale recovery, SQLite reopen/cascade; real PDF/DOCX/TXT extraction without embedding model |
| `npm run test:structured:ui` | PASS | Advanced structured UI, mapping controls, palettes, narrow viewport, model-plan rejection and deterministic totals; rerun after correcting stale selector |
| `npm run test:ui` | PASS | Guest, projects/templates, workbench, responsive layout, persistence |
| `npm run test:research` | PASS | 31 tests; consent, local-source policy, external-query privacy, URL boundaries, failure/cancellation |
| `npm run test:distribution` | PASS | 16 tests, six target manifests, staged install/rollback and retained state |
| `npm run test:installer` | PASS | 4 tests, loopback, downloads, integrity and reuse |
| `SIAAS_HEADLESS=1 npm run test:actions:ui` | BLOCKED | Electron installed; host denies process-singleton Unix socket (`Operation not permitted`). No sandbox weakening |
| Real Ollama/Gemma multi-tool workflow | BLOCKED | No local Ollama endpoint/runtime available in this session; mocks do not establish model reliability |
| Native Windows/macOS, populated profile reinstall and RC isolation | NOT RUN | Requires target hosts. Historical RC4 acceptance does not cover this integrated candidate |

Execution logs (terminal line endings/trailing whitespace normalized) are under `docs/evidence/rc5-2026-11-20/`. The first advanced structured browser attempt failed on a retired project-card selector; its correction and rerun are recorded separately. Native packaging and exact candidate source-artifact verification are tracked by #36 after source integration.

## Benchmarks and provenance

The original archive `benchmark_router_riferimento_2026-11-11.zip` was retrieved and SHA-256 verified: `b6872626077bfb3304b89849d8f72a3ab9530c755ddef3aa1ecf953e8bfcc0a3`. Its manifest identifies unchanged Python reference code and Windows Qwen3:8b CPU-only results. It is not the SIAAS implementation. The November 17 candidate benchmark remains historical evidence for its exact source revision. No new latency comparison or speedup claim is made for this integration; rerunning correctness/UI regressions is necessary because the shared executor changed. A matched Windows three-path comparison and real Gemma multi-tool run remain outstanding.

## Security and compatibility assessment

Local origin/session-key checks, loopback inference, validated plans, decimal engine, table partitions, source hashes and assistant isolation remain in place. Configured website acquisition retains DNS/public-address checks, connection pinning, per-redirect validation, MIME/body limits, explicit refresh and snapshot timestamps. Offline excerpts are acquired content, not a live-web guarantee. Arbitrary model code, cloud inference and document-write tools are not introduced. All native capabilities resolve an allowlisted canonical Action. Project handoff is explicitly shared untrusted text; it never extends source access.

Project runs add a table under existing SQLite schema v4. Fixture reopening/cascades and template upgrades pass; native populated-profile acceptance remains necessary. Synchronous deterministic work observes existing operation/time budgets and cannot be preempted mid-operation. Lexical retrieval remains a bounded-result scan and may miss synonyms; scanned/complex PDFs have no OCR/layout guarantee. PDF filling and an autonomous dynamic supervisor are subsequent milestones.

The current full npm audit reports eight moderate dependency findings (including transitive development/build packages), zero high and zero critical. ExcelJS/uuid remain in production; minimatch and its affected parents are in the packaging toolchain. No automatic major-version downgrade was applied. These remain documented dependency risks.

No protected branch, release tag, RC4 artifact, public download or paused automation is changed. Final release approval remains required after outstanding acceptance.
