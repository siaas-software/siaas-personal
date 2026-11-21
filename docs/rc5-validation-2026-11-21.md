# RC5 executable validation — 21 November 2026

Tested application: PR #43 at `6bde809ec6ec0425d6f222c612af13eda6e56df3`. Only pinned Prettier formatting of its two corrected E2E scripts was needed; no assertion, feature, template or fixture was removed. Node 24.22.3, Linux x64; production desktop server/SQLite and downloaded Chromium headless shell. Runtime and native-host limitations remain distinct from test failures.

## Targeted regression gates

- **PASS** `node tests/overview-e2e.mjs`: active monitoring, completion metrics, navigation and explicit cancellation, actual mock-model socket closure, cancelled telemetry, persisted partial error response, reload and lease reuse.
- **PASS** `node --import tsx tests/missing-docker-e2e.mjs`: unavailable Docker/Ollama, streamed error without fabricated output, exact persisted history, offline inline/uploaded TXT, authorized retrieval, arithmetic, restart and no research startup.
- **PASS** pinned Prettier debug-check/write/check and `git diff --check`.
- **PASS** packaged production API with `SIAAS_TEST_SERVER_ROOT=dist/linux-unpacked/resources/server SIAAS_TEST_NODE=dist/linux-unpacked/resources/runtime/node node tests/structured-api.mjs`.

## Full executable matrix

| Command | Result | Seconds |
| --- | --- | --- |
| `npm test` | PASS | 13.49 |
| `npm run typecheck` | PASS | 2.83 |
| `npm run test:research` | PASS | 10.78 |
| `npm run test:distribution` | PASS | 7.55 |
| `npm run test:installer` | PASS | 0.53 |
| `node --test tests/cli-quiescence.test.mjs tests/source-manager-characterization.test.mjs` | PASS | 41.95 |
| `npm run icons:check` | PASS | 0.34 |
| `npm run build` | PASS | 7.04 |
| `npm run desktop:build` | PASS | 15.13 |
| `npm run test:chat` | PASS | 4.39 |
| `npm run test:knowledge` | PASS | 1.61 |
| `npm run test:actions:api` | PASS | 2.87 |
| `node tests/template-api.mjs` | PASS | 1.6 |
| `node tests/structured-api.mjs --ui` | PASS | 6.09 |
| `node tests/structured-api.mjs --hybrid --offline --ui` | PASS | 4.37 |
| `node --import tsx tests/project-chat-api.mjs --ui` | PASS | 3.85 |
| `npm run test:ui` | PASS | 14.03 |
| `node tests/experimental-api.mjs` | PASS | 2.31 |
| `node tests/licenses-integration.mjs` | PASS | 0.98 |
| `node tests/structured-bundle.test.mjs` | PASS | 0.27 |
| `npm run desktop:prepare` | PASS | 7.09 |
| `npx --no-install electron-builder --config electron-builder.cjs --linux --x64 --dir --publish never --config.electronDist=node_modules/electron/dist` | PASS | 6.73 |
| `node tests/hardware-finder-ui.mjs` | PASS | 5.26 |
| `node tests/template-palettes-ui.mjs` | PASS | 31.22 |
| `node tests/licenses-integration.mjs --ui` | PASS | 2.65 |
| `node --import tsx tests/research-e2e.mjs` | PASS | 4.06 |
| `npm run test:actions:ui` | BLOCKED | 1.87 |

Unit suite: 190 passed, zero failed/skipped. The Actions native UI launch exits before assertions because the host denies Electron's process-singleton socket (`Operation not permitted`); this is BLOCKED, not PASS. No protection or assertion was disabled. Other headless UI suites and Actions API pass. Existing native desktop/package checks have the same documented host limitation and were not rerun again.

## Release disposition and boundaries

Executable application gates pass. Native Windows/macOS/Linux Electron, real Ollama and matched Windows benchmarks remain post-publication acceptance under [the RC policy](../rc-publication-policy.md). No new performance results are asserted. Existing dependency findings and historical evidence are preserved; no dependency upgrade was introduced.

Publication remains conditional on protected GitFlow integration and exact-commit twelve-asset verification. GitHub publication access and anonymous downloads are separate gates, not inferred from these local results. Preserve stable main and all RC4 tags/assets. The user has already authorized integration and RC publication; no additional authorization is needed.

[Reproducible commands, result matrices and logs](evidence/rc5-validation-2026-11-21/). Browser commands use `CHROMIUM_EXECUTABLE_PATH` and `CHROMIUM_PATH` pointing to the compatible headless shell. Logs use only synthetic test data.

## RC4 ancestry reconciliation

The candidate merge preserves `d8bf6e61a4d47920a00cc4e069a90cf26ac2d80f` as an additional parent. Resolved package manifests retain tested RC5 version/dependencies; the structured browser test retains the already-integrated accessible selector and #42 formatting. RC4 historical logs and three release documents are restored byte-for-byte from the tag. CHANGELOG keeps the published RC4 heading and the original preparation record. No application, dependency, script, test or template content differs from the validated #43 tree after this reconciliation. RC4's published tag/assets and stable main are untouched.
