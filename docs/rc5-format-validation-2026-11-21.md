# RC5 formatting validation — 21 November 2026

**BLOCKED for publication.** Formatting is complete; two executable regression suites fail. These failures are not environmental exclusions under the [RC publication policy](rc-publication-policy.md). Publication is authorized by the user on 20 November and reconfirmed on 21 November; lack of authorization is not the blocker.

## Scope and provenance

Baseline: PR #36 at `ea8e1d5c324263a2f313eee9efa6cfd04990d42f`. Formatting: PR #42 at `5c3d8a0554469b55185b6e7894d9a38325246429`, tree `3c1a84748980cf8885006f7a139599cd85982ce1`. The pinned Prettier 3.9.9 checked 173 tracked first-party TS/TSX/JS/CJS/MJS/CSS files in src, desktop, scripts and services; 37 changed. `--debug-check` and subsequent `--check` passed. No logic, dependencies, test assertions, fixtures, templates, generated catalogs or shell/PowerShell installer changes.

All synthetic examples were retained: `tests/rc2-import.test.ts` and `tests/hybrid-chat-checks.mjs` use them, and the Windows guides document them. Historical structured/Windows documentation remains referenced by RC2 publication/acceptance evidence. Release evidence, license texts, architecture records and active guidance are not disposable examples. No file met both obsolete and demonstrably unreferenced criteria; zero deletions.

## Executed validation

Linux x64, Node 24.22.3; existing lockfile-installed dependencies. Headless Chromium supplied through CHROMIUM_EXECUTABLE_PATH/CHROMIUM_PATH. Tests use temporary synthetic stores and mocked local models, not real inference. Commands below are from the exact formatted application tree. Evidence-only follow-up commits do not alter that tree.

| Command | Result |
| --- | --- |
| `npm test` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:research` | PASS |
| `npm run test:distribution` | PASS |
| `npm run test:installer` | PASS |
| `node --test tests/cli-quiescence.test.mjs tests/source-manager-characterization.test.mjs` | PASS |
| `npm run icons:check` | PASS |
| `npm run build` | PASS |
| `npm run desktop:build` | PASS |
| `npm run test:chat` | PASS |
| `npm run test:knowledge` | PASS |
| `npm run test:actions:api` | PASS |
| `node tests/template-api.mjs` | PASS |
| `node tests/structured-api.mjs --ui` | PASS |
| `node tests/structured-api.mjs --hybrid --offline --ui` | PASS |
| `node --import tsx tests/project-chat-api.mjs --ui` | PASS |
| `npm run test:ui` | PASS |
| `node tests/experimental-api.mjs` | PASS |
| `node tests/licenses-integration.mjs` | PASS |
| `node tests/structured-bundle.test.mjs` | PASS |
| `npm run desktop:prepare` | PASS |
| `npx --no-install electron-builder --config electron-builder.cjs --linux --x64 --dir --publish never --config.electronDist=node_modules/electron/dist` | PASS |
| `node tests/hardware-finder-ui.mjs` | PASS |
| `node tests/overview-e2e.mjs` | FAIL |
| `node tests/template-palettes-ui.mjs` | PASS |
| `node tests/licenses-integration.mjs --ui` | PASS |
| `node --import tsx tests/research-e2e.mjs` | PASS |
| `node --import tsx tests/missing-docker-e2e.mjs` | FAIL |
| Packaged structured API using `SIAAS_TEST_SERVER_ROOT=dist/linux-unpacked/resources/server SIAAS_TEST_NODE=dist/linux-unpacked/resources/runtime/node node tests/structured-api.mjs` | PASS |
| Prettier AST/idempotence checks; git diff whitespace check | PASS |

Counts: 190/190 application tests; 31/31 research tests; 16/16 distribution tests; 4/4 installer tests; 17/17 CLI quiescence/source-characterization tests. Production HTTP/UI checks retain arithmetic 4, invoice 256.65, budget 35 EUR and duplicate aggregation 25 EUR with zero model requests; stopped Ollama, changed linked CSV rejection, scope boundaries and persisted replies pass. Desktop prepare and unpacked Linux packaging pass. This does not establish native Electron launch.

## Executable failures and diagnosis

1. `tests/overview-e2e.mjs:170` times out looking for **Send message**. The existing shared composer uses **Your question**. A temporary, uncommitted diagnostic copy changed only this selector: it then failed the active-generation assertion at line 180 (0 versus 1). Instrumentation showed one active generation before navigation and an interrupted/error record after opening Overview. `workspace.tsx` aborts chat on component cleanup. Both source behavior and original test are byte-identical to PR #36 before formatting. Decide whether navigation should retain the running chat (behavior correction) or cancellation is intended (update the test contract and cover monitoring without unmounting chat). Do not simply weaken the active-generation assertion.
2. `tests/missing-docker-e2e.mjs:160` expects HTTP 503, but the current chat route starts an HTTP 200 stream and emits an explicit Ollama-unreachable error. A diagnostic confirmed persisted user/error messages, no fabricated answer and no evidence. The old test also expects an empty conversation and requires Ollama to process a TXT document, which conflicts with current offline preparation. Reconcile the test with the agreed streaming/offline contract and retain assertions for safe failure, no generated content, persistence and no Docker startup. Original test/route unchanged by formatting.

The diagnostic copies were removed; no test file was edited or skipped to manufacture PASS. Full original and diagnostic logs are retained. The current task authorizes formatting and obsolete-file removal only, so these test/behavior changes need an explicit scope extension before integration or publication.

## Environmental and publication limits

Native Linux Electron/Actions/package smoke remains BLOCKED by the previously recorded process-singleton socket restriction; no infrastructure change, so it was not retried. Native Windows and macOS and real Ollama/Gemma inference are NOT RUN/BLOCKED on this host and remain post-publication acceptance under policy. They are distinct from the two executable FAIL results above.

The current full npm audit reports eight moderate vulnerabilities, zero high and zero critical; no dependency changes were made. No new latency or performance claim is made.

GitHub browser release access was also rejected by automatic approval review: it could not verify that the previous usage-limit gate had been resolved. The connected GitHub tools support code/PR work but not release creation or binary uploads. No alternate path was used to bypass the browser rejection. No merge, protected branch change, tag or release was created. Stable main, immutable RC4, website, unrelated repositories and scheduled automations are untouched. RC4 history reconciliation remains pending until executable gates pass.

## Publication continuation and manual acceptance

After resolving the two test contracts/behaviors within an approved scope: rerun failed and affected suites, reconcile RC4 ancestry, integrate through protected PRs into develop, derive release/1.1.0-rc.5, regenerate all twelve source-release assets from that exact commit, verify hashes/manifests, upload to a draft and verify before immutable publication. Publish prerelease=true and Latest=false; then download and verify every asset anonymously. Prepared local review assets are not published downloads and cannot substitute for these gates.

Windows acceptance: verify installer SHA-256; install into an isolated RC5 root; launch/navigate/create assistant; repeat exact deterministic chat cases with and without Ollama; check duplicate preservation and changed-file invalidation; restart/reinstall with conversations, assistants and linked CSVs; verify stable/RC4/RC5 profile isolation. Then test real qwen3/Gemma generation, capabilities, timeout/cancellation, optional project chat and the matched CPU-only benchmark. See the [Windows checklist](releases/1.1.0-rc.5-windows.md).

[Raw logs and command results](evidence/rc5-format-2026-11-21/).
