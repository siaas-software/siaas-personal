# Electron test infrastructure — Phase 1 report

Date: 2026-11-06. Verdict: **PARTIAL**. The Templates/Settings sidebar failure is
resolved with a test-only correction supported by source, documentation and history.
Aggregate UI smoke still fails later at the obsolete `Project color` selector.
Native Electron, Windows cleanup and real inference remain unverified. Phase 1 is
not complete; PR #20 remains draft. No Phase 2 work is included.

## Initial baseline and audit (historical evidence retained)

Started from fresh `develop` commit `741b531376c93262c5d15354faf14747fbcf97cc` on
`feature/electron-test-infrastructure-phase1`. The supplied checkout was older;
it was clean and switched only after fetching the current integration branch.
Fresh `main` was inspected read-only; it remains the default/stable branch.
Active rulesets require PRs and resolved conversations on `main`/`develop`, with
zero approving reviews and no bypass actors; `v*` updates/deletions are protected.
There were no open PRs at inspection. PR #6 is closed/unmerged; GitHub identifies
it as the release-preparation PR, rather than the post-RC2 audit title in the task.
This discrepancy does not change the chosen baseline.

Published `v1.1.0-rc.2` is immutable, non-draft and prerelease (release ID 426735035;
tag object `84a1ffab4e5f339519bc80844d88ddcd573f561f`). No release/tag/main/develop
mutation, merge or workflow activation is part of this work.

Read AGENTS/CONTRIBUTING and inspected package/lock, desktop runner/build/main,
UI smoke and its three suites, API/integration/database tests, installer and
package smoke, all four disabled workflows, developer and Windows test guides.

| Area | Baseline | Verified gap | Phase 1 disposition |
| --- | --- | --- | --- |
| Dependencies | Lock v3 matches manifests; Playwright 1.63.0, Electron 44.9.3, Node >=22.16.0 | Inconsistent browser overrides; Electron package may exist without binary | Reuse dependencies; consistent overrides/preflight; lockfile unchanged |
| Desktop build | Clean standalone build; env files removed; parser/notices bundled | Shared `.next` means web/desktop builds must be ordered | Preserve build; document sequence |
| Browser/UI | Existing real HTTP/SQLite and simulated Ollama tests | Some readiness loops silently fall through; guest drops server output | Shared bounded readiness and logs |
| Native isolation | Temporary XDG_CONFIG_HOME in real suite; main already honors user-data-dir | XDG alone does not isolate Windows/macOS data or instance locks | Explicit temporary user-data-dir and path assertion; runtime unchanged |
| Cleanup | finally blocks, kill then exit wait | Missed-exit races, unbounded close, setup outside try, no timeout/signal ownership | Bounded cleanup, owned process trees, fault injection |
| Diagnostics | Fixed screenshot directories, partial logs | Overwrites, no consistent status/cleanup report or failure trace | Unique artifacts with mode/status/environment, logs, failure traces |
| Ollama | API/browser mocks and real native suite exist | Native infrastructure requires real models; guest can contact inherited/default service | New infrastructure-only native smoke with mock; real suite retained/labelled; guest mock |
| Display/platform | Graphical session implicit; native root launch disables sandbox | Missing display produces opaque launch failures; native platform evidence absent | Explicit BLOCKED preflight; no Electron sandbox bypass; Windows instructions |
| Installer | Node tests for archive/download/service reuse; separate packaged smoke | These do not establish native install/package acceptance | Existing tests run; no installer/packaging changes |
| CI | ci, verify, release, desktop-release workflows all disabled | No active test job; repository policy forbids activation | Keep disabled; document reusable free-tool commands |
| Functional baseline | Existing project UI assertion expects first sidebar-bottom button Templates | Current app renders Settings | Reproduced on original script; assertion preserved; remains FAIL |

## Initial infrastructure changes

Shared lifecycle utilities wrap the existing scripts without replacing their
assertions, scenarios, mocks or Playwright APIs. Native startup smoke adds only
startup/restart, profile/SQLite and local API guard checks. The existing native
real suite remains explicitly real; `test:desktop` retains that behavior and gains
an explicit `test:desktop:real` alias. Six Node infrastructure tests cover missing
display, failed/hung readiness, already-exited child, setup error, timeout and
termination cleanup. No application source, planner or production launcher changed.

Changed files:

- `package.json`
- `tests/helpers/runtime.mjs`
- `tests/helpers/electron.mjs`
- `tests/desktop-smoke.mjs`
- `tests/desktop-e2e.mjs`
- `tests/ui-smoke.mjs`
- `tests/guest-ui.mjs`
- `tests/project-flows.mjs`
- `tests/workbench-ui.mjs`
- `tests/test-infrastructure.test.mjs`
- `tests/fixtures/runtime-failure.mjs`
- `docs/electron-testing.md`
- `docs/electron-phase1-report.md`
- `docs/developer-reference.md`
- `docs/evidence/electron-phase1.zip` (execution logs and synthetic failure artifacts)

## Initial execution (before sidebar correction)

Environment for all executed rows: Debian 13 x64 cloud, Linux 6.18.57, Node
24.19.0, npm 11.9.0. Browser checks used system Chromium 154.0.8037.57 via
`CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`; Playwright remained lockfile 1.63.0.
Loopback sockets and dependency downloads required the execution tool's network
permission. No DISPLAY/WAYLAND_DISPLAY, Xvfb or installed Electron binary was
available. Ollama at localhost:11434 was unreachable. A system-browser run does
not verify the default downloaded Playwright browser installation path.

Logs are included in the [evidence archive](evidence/electron-phase1.zip) under `logs/`; unique fixture
artifacts are under `test-results/`. Commands ran at the repository root. Repeated
runs after helper edits had the same results; final logs are retained.

| Command | Result | Evidence / limit |
| --- | --- | --- |
| `npm ci --cache /workspace/work/npm-cache` | PASS | `npm-ci.log`; 586 packages; no lock changes |
| `npm run typecheck` | PASS | `typecheck.log` |
| `npm test` | PASS | `unit.log`; 175 passed, 0 failed/skipped |
| `npm run desktop:build` | PASS | `build.log`; includes templates:check and parser bundling |
| `npm run test:infrastructure` | PASS | `infrastructure.log`; 6 passed; child/grandchild and sentinel checks |
| `npm run test:chat` | PASS | `chat.log`; real standalone HTTP/SQLite, mocked Ollama |
| `npm run test:knowledge` | PASS | `knowledge.log`; mocked embeddings |
| `npm run test:actions:api` | PASS | `actions.log`; mocked Ollama |
| `npm run test:structured:api` | PASS | `structured.log`; mocked Ollama; no planner modification |
| `node tests/template-api.mjs` | PASS | `templates-api.log`; simulated discovery |
| `node tests/structured-bundle.test.mjs` | PASS | `parser-bundle.log`; 33 component notices |
| `npm run test:installer` | PASS | `installer.log`; 4 unit tests; not native installation |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:ui` | FAIL | `ui.log`; guest PASS, project fails Settings vs Templates; aggregate stops before workbench |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node tests/workbench-ui.mjs` | PASS | `workbench.log`; independently executed after aggregate stopped |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node tests/.phase1-baseline.mjs` | FAIL | `ui-baseline.log`; exact original project-flows script extracted with git show from baseline; temporary copy removed |
| `npm run test:desktop:smoke` | BLOCKED | `desktop-smoke.log`, result JSON; missing display; exit 2 |
| `npm run test:desktop` | BLOCKED | `desktop-real.log`, result JSON; missing display; exit 2; no native scenarios executed |
| `npm run ollama:check` | BLOCKED | `ollama-check.log`; exits 1, reports unreachable service and absent models; no inference |
| `npm run ollama:test` | NOT RUN | Prerequisite discovery failed; no real inference claim |
| `node --import tsx tests/real-structured-api.mjs` | NOT RUN | Real >=8B tool-capable model unavailable; outside infrastructure changes |
| Native Windows/macOS and `npm run test:package` | NOT RUN | No corresponding host/package; distribution acceptance separate |
| `git diff --check` | PASS | Final diff checked |

## Isolation and cleanup evidence

The guest test made an actual SQLite write in its temporary server profile,
reloaded and passed. Workbench made real HTTP/SQLite writes with mocked inference.
Their `result.json` files list distinct temporary directories and child PIDs,
successful browser/mock/server disposal, exited processes and removed directories.
The failing project suite also saved its screenshot, Playwright trace and server
log, then completed cleanup successfully.

Fault-injection subprocesses create a real SQLite file, spawn a child which ignores
SIGTERM and a grandchild, then throw, time out or receive SIGTERM. The Node parent
asserts exit 1, FAIL artifact with successful cleanup, absent temporary directory,
no running child/grandchild, and unchanged unrelated sentinel `siaas.sqlite`.
On Linux a zombie is treated as exited, not as running. The observed Linux checks
passed; they do not prove Windows taskkill behavior or actual native Electron
cleanup. The smoke test is designed to read back native userData and SQLite paths,
but those assertions were not executed here.

## Sidebar investigation and correction — 2026-11-06

Work continued on the existing feature branch at
`a2fcf460465e5d188a0bafd1f2603ae9cd16abdf`, preserving both infrastructure commits.
Fresh remote reads confirmed `develop` at `741b531376c93262c5d15354faf14747fbcf97cc`,
`main` at `1bce852cabbefb2459aeafc5aa42146eabd6283b`, default branch `main`, and
PR #20 as the only open PR, draft, targeting `develop`. Rulesets 25665792 and
25666094 remain active with no bypass actors; the branch rule requires PRs and
resolved conversations, with zero approving reviews. All four workflow files
remain disabled. No release, tag, repository setting or protected branch was changed.

### Root cause and source/history evidence

**Obsolete test expectation**, not an observed application regression or an
environment-dependent sidebar difference:

- Before this correction, `tests/project-flows.mjs:70` asserted that the first
  `.sidebar-bottom button` read `Templates`. The exact unmodified feature script
  reproduced `actual Settings / expected Templates` in `logs/ui-before.log`.
- [workspace.tsx](../src/components/workspace.tsx), lines 784–805, places Templates
  inside the main `<nav>` and Settings in `.sidebar-bottom`. They call
  `navigate("templates")` and `navigate("workspace")`, respectively; those modes
  render the `Templates.` and `Settings.` headings. Neither button's placement
  depends on the desktop bridge, OS, model availability, locale or viewport.
- [Actions documentation](actions-en.md) explicitly places Actions in the main
  navigation between Projects and Templates. [README](../README.md#templates)
  describes Templates → Use template; [developer reference](developer-reference.md)
  places the version below Settings in the sidebar and documents Settings panels.
  [Language policy](documentation-language.md) keeps both navigation labels in English.
- Existing `tests/actions-ui.mjs:104–108` expects Templates in main navigation.
  `tests/guest-ui.mjs:28–30` navigates Settings to Application updates;
  `tests/licenses-integration.mjs` covers Settings and its offline viewer.
  `tests/template-palettes-ui.mjs` navigates Templates and creates projects.
  These corroborate the intended behavior; only the suites listed below were rerun.
- `git blame` attributes both the sidebar implementation and the conflicting
  assertion to the initial application snapshot
  `39e1666d8f0e7fe20e44919b96bd2ffe3d60a8d9` (2026-10-22). Inspection of subsequent
  workspace diffs found no sidebar move. [Migration documentation](repository-migration.md)
  explicitly says earlier commits were not imported. Thus the mismatch predates
  Phase 1 and is present at the repository history boundary; the original move
  date cannot be established from this repository. Failure on `develop` alone
  was not used as evidence that the test was wrong.

### Exact correction and scope

Only `tests/project-flows.mjs` changes executable behavior: locate Templates by
exact accessible button name within `.sidebar nav`, and Settings by name within
`.sidebar-bottom`. Click Settings and verify its heading and active class; then
click Templates, verify its heading/active class and Settings becoming inactive.
Reuse the Templates locator later in the existing scenario. No button ordering
is assumed. Project creation, export/import, private-data exclusion, deletion,
restart and model assertions remain in place; none are skipped or disabled.
No application source, lifecycle helper, dependency, lockfile or native test changed.

The final run passes these navigation assertions and creates the template project
with three assistants before failing at the next existing selector:
`config.getByLabel('Project color', { exact: true }).fill(...)` (now line 102).
The failure screenshot shows the named palette radio buttons implemented at
`workspace.tsx:1825–1855`, also present in `39e1666`. This is an executable test
failure, not BLOCKED and not a passing project suite.

A temporary diagnostic patch selected Slate and updated the matching color
expectations. It reached another pre-existing timeout at the expectation of two
`.model-recommendation` elements. `hardware-advisor.tsx:141–159` instead describes
compatible parameter-size profiles, and `model-recommendation.tsx` renders
`model-hardware-note`. Those implementations also originate in `39e1666`.
The diagnostic palette patch was removed; its diff and failure trace are retained
and are explicitly not part of the final test. Broader palette/model expectation
reconciliation should be a separate focused test-maintenance change with its own
behavior review, preserving the full workflow. Downstream project assertions have
not all executed and are not claimed to pass.

### Revalidation and evidence

Same Debian 13 x64 / Node 24.19.0 / npm 11.9.0 / Chromium 154.0.8037.57 environment
as above. Commands ran at the repository root with loopback permission. All browser
commands below used `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. A build attempted
before restoring this older checkout's dependencies failed on missing `decimal.js`,
`exceljs` and `papaparse`; `npm ci` restored locked dependencies and the build then
passed. Both attempts are retained. No manifest or lockfile changed.

New evidence: [sidebar-resolution archive](evidence/electron-phase1-sidebar-resolution.zip).
It contains `logs/`, source/history diffs, and synthetic fixture `test-results/`
including screenshots, traces and cleanup JSON. The original
[Phase 1 archive](evidence/electron-phase1.zip) is unchanged.

| Command | Actual outcome | New archive evidence / limitation |
| --- | --- | --- |
| `npm ci --cache /workspace/work/npm-cache` | PASS | `logs/npm-ci.log`; 586 packages |
| `npm run typecheck` | PASS | `logs/typecheck.log` |
| `npm test` | PASS | `logs/unit.log`; 175 passed, 0 failed/skipped |
| `npm run test:infrastructure` | PASS | `logs/infrastructure.log`; 6 passed, 0 failed/skipped |
| `npm run desktop:build` | FAIL then PASS | `logs/build-before-npm-ci.log`, `logs/build.log`; locked dependency restoration resolved setup failure |
| `npm run test:installer` | PASS | `logs/installer.log`; 4 unit tests, not native installation |
| `npm run test:ui` before edit | FAIL | `logs/ui-before.log`; original Settings/Templates mismatch |
| `npm run test:ui` with final sidebar edit | FAIL | `logs/ui-final.log`; guest PASS, sidebar checks pass, project stops at Project color; aggregate workbench NOT RUN |
| `node tests/project-flows.mjs` with temporary palette diagnostic | FAIL | `logs/project-palette-corrected.log`, `logs/diagnostic-palette.patch`; model recommendation timeout; diagnostic reverted |
| `node tests/workbench-ui.mjs` separately | PASS | `logs/workbench.log`; existing browser/API/SQLite workflow |
| `node tests/template-api.mjs` | PASS | `logs/template-api.log`; six presets, ownership, portable export/import, private-data exclusion, persistence; simulated discovery |
| `node tests/template-palettes-ui.mjs` | PASS | `logs/template-palettes-ui.log`; six template cards/previews, project creation, exports, responsive contrast and restart persistence |
| `npm run test:desktop:smoke` | BLOCKED | `logs/desktop-smoke.log`; missing graphical session, exit 2; Electron not launched |
| `npm run test:desktop` | BLOCKED | `logs/desktop-real.log`; same preflight, exit 2; no native scenarios executed |
| `npm run ollama:check` | BLOCKED | `logs/ollama-check.log`; discovery exits 1: service unreachable, required models absent |
| Real inference, native Windows/macOS, packaged acceptance | NOT RUN | Prerequisites unavailable; no model downloads or package/release operations |
| `git diff --check` and changed Markdown links | PASS | Checked before commit |

Initial, final and diagnostic project runs all report successful resource cleanup,
exited owned server processes and removed temporary profiles. Browser/API successes
do not establish native Electron or real-model acceptance.

Follow-up changed files: `tests/project-flows.mjs`, this report,
`docs/electron-testing.md` (current blocker and Linux verification instructions),
and `docs/evidence/electron-phase1-sidebar-resolution.zip`.

## Risks, blockers and Phase 2 prerequisites

1. The sidebar mismatch is resolved. Aggregate smoke remains red at the later
   project-palette selector; the diagnostic run also exposed model-advice drift.
   Review and reconcile those expectations separately without removing scenarios,
   then execute the complete project workflow and aggregate UI smoke.
2. Execute native mock smoke and lifecycle tests on Windows and graphical Linux,
   including interactive cancellation and process/profile cleanup. Native Windows
   taskkill and file-lock behavior remain unverified. macOS is also unverified.
3. Real Electron acceptance still contains historical UI selectors and may reveal
   additional drift once prerequisites exist. Its scenarios were preserved.
4. Use real Ollama/models/hardware for real acceptance; mocks prove HTTP/persistence
   contracts only. No model downloads were performed. Follow the exact
   [Windows steps](electron-testing.md#exact-windows-verification).
5. Older API/package suites retain their own lifecycle code. Forced OS termination,
   host loss, and Windows orphaning after root death cannot guarantee cleanup.
   Ephemeral port reservation has a small bind race; errors fail with diagnostics.
6. CI remains disabled by repository policy. A future runner needs separate
   authorization; no paid tool or new dependency is necessary.

Phase 2 requires the first two blockers resolved with retained evidence, agreement
on a focused functional scenario list and expected behavior, and a separate real
inference acceptance environment where required. This PR is reviewable Phase 1
infrastructure, not a claim that every Phase 1/native acceptance criterion passed.
