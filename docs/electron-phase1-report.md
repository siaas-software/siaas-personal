# Electron test infrastructure — Phase 1 report

Date: 2026-11-07. Verdict: **PARTIAL — early-launch cleanup corrected; native acceptance BLOCKED**.
Aggregate `npm run test:ui` now passes guest, the entire project workflow and
workbench (exit 0). Sidebar, palette, model-guidance and downstream template
expectations are reconciled with source, documentation and history. A real Linux
Electron launch now reaches the executable but aborts on its sandbox prerequisite.
The early-launch failure path is corrected and covered by deterministic regression
tests, including the real Playwright launcher with a non-Electron executable.
Windows/macOS and real inference remain unverified; PR #20 stays draft.
No application changes or Phase 2 work are included.

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

## Sidebar investigation and correction — 2026-11-06 (historical follow-up)

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

## Complete existing UI smoke reconciliation — 2026-11-06

Validated test and evidence commit:
[`a541c305cd7a0a5522a155100aad5a65c42faa28`](https://github.com/siaas-software/siaas-personal/commit/a541c305cd7a0a5522a155100aad5a65c42faa28).
The following report/guide commit changes documentation only.

Continued from `8686df67ceefc93964201d12012c1a22b5d324eb` on the same feature
branch and PR #20, under explicit authorization to reconcile the entire existing
project scenario. This supersedes the previous follow-up's deferred palette/model
test maintenance and red aggregate result; its logs and archives remain unchanged.
Fresh remote reads found `develop` unchanged at `741b531376c93262c5d15354faf14747fbcf97cc`
and `main` at `04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e` (merged README alignment
PR #19). Neither branch was modified. One initial fetch returned HTTP 503; the
retry succeeded. The feature branch retained the existing infrastructure and sidebar fix.

### Root causes, independent evidence and exact corrections

| Mismatch | Intended behavior and evidence | Test correction and coverage |
| --- | --- | --- |
| `Project color` text input and arbitrary `#18283c` expectation | `workspace.tsx:1825–1855` exposes eight named palette radio buttons; `project-colors.ts` defines Slate as `#E9EDF1`. `tests/project-palettes.test.ts` covers the palette contract; the developer reference documents ordinary palette editing. This implementation already exists in initial snapshot `39e1666`. | Select the Slate radio, assert exact persisted color and description, wait for its exact rendered background, and retain exact matching export/import color checks. Project configuration still runs through the UI. |
| Recommended/best-installed badges and `.model-recommendation` count | `hardware-advisor.tsx:141–191` presents Lightweight/Balanced/Advanced compatible-size profiles, not ranked models. `model-catalog.tsx` renders `ModelHardwareNote` per model. `hardware.ts` and `tests/hardware.test.ts` establish conservative FP16 estimates when quantization is unknown, separate RAM/disk constraints, and compatible-size semantics. The developer reference places hardware advice and model selection in Models. All these guidance behaviors are present at `39e1666`; no later removal commit exists in the imported history. | Check all three profile names, the seven exact bundled Qwen 2.5 catalog IDs, per-model compatibility text and warning class, and agreement with the Lightweight size display. Exercise 16 → 8 → 4 → 16 GB RAM. Verify all profiles have no compatible sizes/counts at 4 GB. Keep installed status independent of fit. Search, pagination, model selection, instruction preservation, configuration edits, reload and selected-model persistence remain exercised. |
| Zero documents after template import | README Templates and `tests/template-api.mjs` specify portable public website URLs, excluding private documents. `templateAssistantSchema` explicitly permits `sources` and strips unknown document fields; `importLocalTemplate` registers each URL as an assistant-owned document. The import behavior and public URLs are present at `39e1666`. The observed extra document was the configured public source, not a leaked file. | Compare exported sources to the selected original template by assistant name. For every assistant after both import paths, require the exact source URL set, correct ownership and enabled state, and absence of private/injected content. Keep export privacy checks and injected `documents` fields; assert all exported models reset to null and exactly three assistants are created. |
| Fixed total of three templates after project deletion | `listTemplates` seeds the pinned built-ins and preserves user-saved templates; project deletion does not delete them. The count was last edited in `59de009`. `e35eeaa` adopted six official templates, recorded in `templates-source.json`, README and template API tests. The scenario then creates two custom templates. | Require initial catalog count + two, exact preservation of every original built-in ID, and the two exact custom template names. Existing built-in/custom deletion, project survival, deleted-template rejection and restart tombstone checks remain. This detects unexpected additions and losses without retaining an obsolete catalog total. |
| White rendered project card | `POST /api/projects` still stores `#FFFFFF` for an empty project. `workspace.tsx:947–955` deliberately renders `resolveProjectPalette(color).background`; the palette resolver's stated contract and `tests/project-palettes.test.ts` preserve stored legacy colors while mapping their display. Both behaviors date to `39e1666`. The nearest palette for white is Lavender, `#F0EAFE`. | Keep the exact persisted-white assertion, expect exact Lavender RGB on the card, and recheck that rendering did not mutate stored white. Keep empty-assistant count, responsive layout and importing into the empty project. |

The bundled Qwen entries have no quantization metadata. Their documented FP16
RAM budgets are 7.5 GB (0.5B), 10.4 GB (1.5B) and 14.7 GB (3B): all three fit
16 GB, only 0.5B fits 8 GB, none fit 4 GB. At the fixture's 100 GB free disk,
32B/72B require 155/347 GB, so their exact warning is insufficient **disk**, which
takes precedence over RAM. The first reconciliation attempt incorrectly expected
RAM for those two sizes; its failure is retained and the test expectation was
corrected against the documented budgets. No production helper is imported to
compute expected UI answers, and the real bundled catalog/API is still exercised.

No genuine application regression was found in these mismatches. The test
changes do not mock additional application routes, skip scenarios, suppress
exceptions, loosen deadlines or change application code. Remaining actions now
execute through the end: cancel/confirm assistant deletion; sibling isolation;
project deletion with conversation/file cleanup; empty-project creation and import;
built-in/custom template deletion; invalid color rejection; server restart; saved
template survival and deleted-template absence. Added equality checks verify all
remaining project and assistant records survive restart unchanged. Both 1440px
and 390px layout checks and their screenshots are retained.

### Current execution results

Environment: Debian 13 x64, Node 24.19.0, npm 11.9.0, system Chromium
154.0.8037.57. Browser runs used `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
Locked `npm ci` and the desktop build completed before the checks below. No
dependency or lockfile change. Mock Ollama supports discovery; browser/server/SQLite
operations are real, but none of these results proves real model inference.

Evidence: [complete UI reconciliation archive](evidence/electron-phase1-ui-reconciliation.zip).
`logs/` contains command logs, exit codes/times, source-history evidence and cleanup
verification. `test-results/` retains failed-attempt traces/screenshots and final
successful screenshots, renderer/server logs and fixture JSON. Successful runs
discard traces by the existing helper's policy; their screenshots and logs remain.
Both earlier evidence archives are untouched.

| Command / attempt | Outcome | Evidence and limit |
| --- | --- | --- |
| `npm ci --cache /workspace/work/npm-cache` | PASS | `logs/npm-ci.log`; 586 packages, exit 0 |
| `npm run desktop:build` | PASS | `logs/build.log`, command JSON; includes template snapshot validation and parser bundling |
| `npm run typecheck` | PASS | `logs/typecheck.log`; exit 0 |
| `npm test` | PASS | `logs/unit.log`; 175 passed, 0 failed/skipped |
| `npm run test:infrastructure` | PASS | `logs/infrastructure.log`; 6 passed, 0 failed/skipped |
| `npm run test:installer` | PASS | `logs/installer.log`; 4 passed, 0 failed/skipped; not a native install |
| Project attempt: palette/guidance | FAIL, corrected | `logs/project-guidance.log`; initial new expectation missed disk-priority warnings |
| Project attempt: guidance/disk corrected | FAIL, corrected | `logs/project-guidance-disk.log`; exposes obsolete zero-document assertion after import |
| Project attempt: import/catalog corrected | FAIL, corrected | `logs/project-import.log`; exposes obsolete rendered-white expectation |
| `node tests/project-flows.mjs`, final | PASS | `logs/project-complete.log`; complete workflow and restart, exit 0 |
| `npm run test:ui`, final | **PASS** | `logs/ui-final.log`; guest, project-flows and workbench all execute in the aggregate, exit 0 |
| `node tests/template-api.mjs` | PASS | `logs/template-api.log`; six presets, source ownership, privacy, portable exports/imports and legacy compatibility |
| `npm run test:desktop:smoke` | BLOCKED | `logs/desktop-smoke.log`; no graphical session, exit 2; Electron never launched |
| `npm run ollama:check` | BLOCKED | `logs/ollama-check.log`; discovery exits 1, real service unreachable and required models absent |
| `test:desktop` / `test:desktop:real`, `ollama:test` | NOT RUN in this follow-up | Missing native display and real Ollama prerequisites; earlier native preflight failures remain historical evidence |
| Native Windows/macOS, packaged installation acceptance | NOT RUN | No corresponding host/package; no release/package operation performed |
| `git diff --check`, changed Markdown links, evidence archive integrity | PASS | Verified before commit |

Final aggregate artifacts:

- `guest-ui-1793998170007-a84d9294`: PASS.
- `project-flows-1793998174589-3de614ec`: PASS, two standalone server processes
  (before/after restart), seven workflow screenshots.
- `workbench-ui-1793998190140-8b7532f8`: PASS.

Each final fixture reports successful teardown, exited owned server processes and
removed temporary profiles. The cleanup verification also checks these directories
are absent; it does not infer native Windows cleanup from Linux results.

This follow-up changes only `tests/project-flows.mjs`, this report,
`docs/electron-testing.md` and the new evidence archive. PR #20 remains draft with
**Phase 1 PARTIAL** because native Windows/Linux and real-Ollama acceptance are
still incomplete. The existing browser/UI baseline is now green. No merge, RC2
change, workflow activation, publication or Phase 2 work was performed.

## Linux native acceptance attempt — 2026-11-07

Tested application baseline: `70a8ee8dce9929b23d77b1801d459e21310a0db8`, on the
existing feature branch. The only executable change in this follow-up is
`chromiumSandbox: true` in `tests/helpers/electron.mjs`. Infrastructure/evidence
commit: `e873b31d9f853d75a262aead4fd2fe93ac6a0f2f`. The
[native evidence archive](evidence/electron-phase1-native-linux.zip) retains the
actual attempts. All previous evidence archives and UI assertions remain unchanged.

### Environment and justified infrastructure correction

- Debian 13.6, Linux 6.18.57 x86_64, Node 24.19.0, npm 11.9.0; ordinary UID 1000.
  Locked `npm ci` completed on November 6 before the environment resumed on
  November 7; dependencies and checkout persisted. Subsequent commands and their
  UTC times/exits are retained in `logs/*.command.json`.
- Electron 44.9.3 was initially missing its executable. The existing
  `npx --no-install install-electron --no` command installed the locked runtime
  through the configured proxy with normal checksum/TLS verification. The first
  network-restricted attempt failed (`fetch failed`, exit 1); the approved network
  retry passed (exit 0). No package manifest or lockfile changed.
- `ldd node_modules/electron/dist/electron` exits 0 with no missing library.
  NSS, GTK3, GBM, ALSA and X11 libraries are present. Xvfb, sudo and the scoped
  system-package installer are absent; no system package was installed.
- No inherited DISPLAY or Wayland session was available. The managed desktop
  capability reports enabled/state unknown, but no desktop JS tool is exposed
  for environment `ccarenv_b64_Y2NhcmVudl84YWZlMTcyN2JjOTg4MTkxYTRlM2Y0MjFhNjEwNzZhMA`.
  The existing Xorg dummy driver provided a real temporary X11 display `:91`;
  `xdpyinfo` succeeded. It used a private Xauthority cookie and `-nolisten tcp`.
  The server and authentication file were removed after each attempt.
- The command environment has `NoNewPrivs: 1`, seccomp mode 2 and no effective
  capabilities. `unshare -Ur true` fails: `cannot open /proc/self/uid_map:
  Read-only file system`. The installed `chrome-sandbox` is UID 1000/mode 0755.
  No privilege, setuid, namespace, kernel or sandbox setting was changed.

Source inspection found that Playwright 1.63.0's Electron launcher
(`node_modules/playwright-core/lib/coreBundle.js`, around line 44250) prepends
`--no-sandbox` on Linux unless `options.chromiumSandbox` is true. The shared helper
did not set it. Explicitly enabling it is necessary to honor the requested native
sandbox policy; merely checking non-root UID and the application's BrowserWindow
`sandbox: true` does not prevent that command-line default. The diagnostic launch
log proves the corrected arguments contain no `--no-sandbox`. No production code,
functional assertion, dependency, timeout or failure handling was changed.

### Actual command results

| Command / attempt | Outcome | Evidence / exit code |
| --- | --- | --- |
| `npm ci --cache /workspace/work/npm-cache` | PASS | `npm-ci.log`, 586 packages, exit 0 |
| `npm run typecheck` | PASS | `typecheck.log`, exit 0 |
| `npm run desktop:build` | PASS | `desktop-build.log`, exit 0; template check/parser bundle included |
| `npm test`, initial restricted attempt | FAIL | `unit.log`, exit 1; loopback-dependent tests failed |
| `npm run test:infrastructure`, initial restricted attempt | FAIL | `infrastructure.log`, exit 1 |
| `npm run test:installer`, initial restricted attempt | FAIL | `installer.log`, exit 1; direct diagnostic confirms `listen EPERM 127.0.0.1` |
| `npm test`, with permitted loopback networking | PASS | `unit-network.log`, exit 0; 175 passed, 0 failed/skipped |
| `npm run test:infrastructure`, with permitted loopback networking | PASS | `infrastructure-network.log`, exit 0; 6 passed, 0 failed/skipped |
| `npm run test:installer`, with permitted loopback networking | PASS | `installer-network.log`, exit 0; 4 passed, 0 failed/skipped; unit tests only |
| `npm run test:ui` | **PASS** | `ui.log`, exit 0; guest, complete project workflow and workbench; Chromium override `/usr/bin/chromium` |
| `npm run test:desktop:smoke` on authenticated Xorg | **FAIL (command); native acceptance BLOCKED** | `desktop-smoke.log`, exit 1; executable aborts before window/readiness |
| Same native command with `DEBUG=pw:browser` | **FAIL (command); native acceptance BLOCKED** | `desktop-smoke-diagnostic.log`, exit 1; exact native sandbox error and executable arguments |
| `node --check tests/helpers/electron.mjs` | PASS | `helper-syntax.log`, exit 0 |
| Existing `realOllamaPrerequisites()` | BLOCKED | `ollama-prerequisites.log`, exit 2; loopback service unreachable |
| `npm run ollama:check` | BLOCKED | `ollama-check.log`, exit 1; discovery only, service unreachable |
| `npm run ollama:test`, `npm run test:desktop:real` | NOT RUN | Real-service/model prerequisites unavailable; native launch also blocked |
| Native Windows/macOS, packaged installation | NOT RUN | No corresponding host/package; no release operation |

The failing native process emitted:

> FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166: The SUID sandbox
> helper binary was found, but is not configured correctly. Rather than run
> without sandboxing I'm aborting now. You need to make sure that
> /workspace/siaas-personal/node_modules/electron/dist/chrome-sandbox is owned
> by root and has mode 4755.

This is an actual Electron executable attempt (diagnostic PID 3481), not a
Chromium substitute. It does **not** establish application startup. The test's
exit 1 is retained as FAIL; the acceptance blocker is the host's unavailable
Electron sandbox setup. No attempt was made to disable sandboxing or reconfigure
the host after this evidence. Xvfb would not resolve this sandbox failure.

### Cleanup evidence and limits

The early Electron abort also exposed an infrastructure defect: Playwright's
launch path raises an unhandled `Process failed to launch!` rejection before the
shared runner finishes. Both native artifact directories are empty: no native
`result.json`, screenshot or trace was generated. There was no page/context to
capture. This absence is retained explicitly in the archive manifest and must
not be interpreted as successful teardown. The two suite commands really exited
1; no synthetic PASS or replacement native result was written.

Automatic early-launch cleanup **FAILS** in this case: two empty profiles remained
(`/tmp/siaas-desktop-smoke-acbvQG` and `/tmp/siaas-desktop-smoke-zFTPQK`). After
confirming they were empty and belonged to these attempts, only those exact
directories were removed with `rmdir`. `logs/cleanup-observation.json` records
their removal, no remaining live processes from this Electron installation,
the diagnostic Electron PID gone, both owned Xorg PIDs gone, and deleted display
authentication. No unrelated user-data directory was supplied to cleanup.
Manual removal does not count as automatic native cleanup acceptance. Hardening
this early-launch failure path remains a Phase 1 follow-up; no global rejection
handler, swallowed failure or dependency patch was introduced here.

Native startup, restart, actual `app.getPath('userData')`, SQLite creation/isolation,
authenticated readiness, unauthorized API rejection, normal shutdown and
interactive SIGINT/Ctrl+C are **NOT RUN past the launch blocker**. They must be
verified on a host supporting Electron's sandbox. The six passing Node lifecycle
tests separately exercise timeout/throw/signal cleanup, owned child termination
and preservation of an unrelated SQLite sentinel; they are not native evidence.

The three successful browser fixtures retain their real `result.json` files,
server/renderer logs and screenshots in this archive. Their reported temporary
paths were checked absent after teardown. Successful browser traces are discarded
by the unchanged helper policy. Existing historical failure traces remain in the
older archives. Nothing from a personal profile/database was archived.

### Remaining acceptance and verdict

Real Ollama was not found on PATH and no service answered at
`http://127.0.0.1:11434`. Installed models cannot be established through an
unreachable service. Later execution needs an existing compatible local Ollama,
`embeddinggemma:latest`, and at least one of `qwen2.5:1.5b`, `qwen2.5:7b` or
`qwen2.5:14b`, with sufficient hardware/disk. Run `ollama:check`, then
`ollama:test` and `test:desktop:real`; no inference service or model was installed.

**Phase 1 remains PARTIAL; PR #20 stays draft.** The browser baseline is green.
Linux native acceptance is BLOCKED, with a separately recorded automatic
early-launch cleanup failure. A suitable sandbox-capable Linux desktop/Xvfb host
must execute native startup/restart and interactive cancellation, retain native
JSON/logs, and verify owned processes and profile/database deletion plus unrelated
data preservation. Windows needs its own native runs, taskkill/tree and file-lock
verification. macOS and native packaged installation remain unverified. Real
inference remains BLOCKED. No application functionality, RC2, main, workflow,
release or Phase 2 work changed.

## Early Electron launch failure cleanup — 2026-11-07 follow-up

Baseline: `fbb04d9f9134c148965e2deac4c160160d2c6daf`. This follow-up corrects only
test infrastructure, adds regression tests and retains its evidence in
[the early-launch archive](evidence/electron-phase1-early-launch-cleanup.zip).
The preceding native failure and manual cleanup remain historical evidence; no
previous archive was replaced. Infrastructure/evidence commit:
`60136571b564743a072e63acc03fb9e3e3664fd2`. Application code, browser assertions,
package manifests and the lockfile are unchanged.

### Root cause and correction

Playwright 1.63.0 starts four `waitForLine` promises in its Electron launcher:
X display failure, Node debugger endpoint, Chromium debugger endpoint and debugger
disconnect. It first awaits the Node endpoint. On immediate child exit all four
can reject, but some sibling handlers are attached only after that first await.
An unhandled sibling rejection terminates the in-process Node driver before the
awaited API rejection reaches `runTest`'s catch/finalization. Adding another catch
around the same `electron.launch()` call alone cannot fix this race.

The retained negative control invokes the original installed Playwright launcher
with Node as an intentionally invalid Electron executable under
`--unhandled-rejections=strict`. Node rejects Electron's CLI argument and exits;
the launcher then reproduces `Process failed to launch!`, absent `result.json`
and an empty leaked profile. Only that negative-control profile needed manual
removal. No native Electron was used for this reproduction.

The minimal launcher correction is one inserted, scoped `Promise.allSettled`
observer for the three sibling promises, attached before the first await. Every
original endpoint await, launch rejection/rethrow and Playwright-owned process
kill remains in place. The real launcher now completes its failure cleanup and
rejects back to the shared runner. Rejections are still FAIL, not converted into
success. No process-level exception/rejection handler or suppression is installed.

`tests/helpers/playwright-electron.mjs` applies that insertion in memory using
Node's synchronous module-load hook only while loading the Electron test adapter.
It requires pinned Playwright 1.63.0 and one exact source anchor, and fails with a
normal recorded error if the version/source differs or Playwright was already
loaded. The hook is removed in `finally`. Installed dependency files are untouched
(before/after SHA256 checked), and browser suites keep their normal imports.
This narrowly scoped dependency workaround is explicit technical debt: revalidate
or remove it when an upstream-fixed Playwright version is adopted. It avoids a
dependency upgrade, an on-disk patch and a broad test-worker redesign. Native
success remains unverified on this host.

`launchElectron` now records executable, owned profile, sandbox setting and each
launch outcome/error. Playwright's failure log includes the launched PID, arguments,
stderr and process exit/cleanup; Playwright owns that child until launch resolves.
After resolution the shared runner tracks the child as before. A test-only injected
launcher exercises failures without requiring Electron. `chromiumSandbox: true`
and all application security settings remain unchanged.

The shared runner writes its FAIL report before diagnostics/teardown, then writes
the completed cleanup report. Diagnostic exceptions are recorded without aborting
resource cleanup. Errors from individual cleanup callbacks remain FAIL and do not
prevent subsequent directory removal/reporting. Child records include command,
arguments, PID and exit state, with duplicate registration prevented. A rejection
without an Error value is also FAIL rather than accidentally passing. Only
registered children and directories created by this run are cleaned; no broad
process-name termination or inherited data-directory deletion is introduced.

The report guarantee applies to handled failures while Node can execute and write
the artifact directory; SIGKILL, host loss and unwritable storage cannot be made
recoverable by this runner. Such conditions must never be reported as PASS.

### Regression coverage and automatic cleanup evidence

`tests/fixtures/electron-launch-failure.mjs` runs eight deterministic fault modes,
each repeated three times in separate strict-rejection subprocesses:

1. Failure after creating a temporary profile and synthetic database file.
2. Launch rejection before any process or page exists.
3. Launch rejection with no Error value.
4. Launch rejection with a registered, live owned child.
5. Failure before page creation after an application connection is returned.
6. A synchronous diagnostic failure during finalization.
7. A failing cleanup callback, with later profile deletion still required.
8. The actual Playwright launch path using Node as an invalid Electron executable.

All 24 final fault invocations exit 1 and produce completed **FAIL** JSON reports,
as expected. Assertions verify unique profiles, removed owned directories, stopped
owned children, process logs, recorded launch errors, preserved sandbox options,
and byte-for-byte preservation of unrelated SQLite and profile sentinel files.
For the real-launcher fault, the PID in Playwright's log must no longer be running.
The explicitly injected cleanup callback error remains recorded as FAIL; it does
not prevent subsequent cleanup. No corrected fault run requires manual cleanup.
The six pre-existing readiness/lifecycle tests also remain and pass.

These are Node/process fault-injection checks, **not native Electron acceptance**.
No Electron renderer/page exists in them, so no native screenshot or trace can be
produced. Their `result.json` and child/launch logs are retained. Browser smoke
screenshots and result files are retained separately in the same archive. The
unpatched negative-control failure and its missing artifact are explicitly listed
in the manifest; no replacement native result was fabricated.

### Validation and verdict

Environment remains Debian 13.6 x64 / Node 24.19.0 / npm 11.9.0, using the locked
dependencies installed in the previous follow-up. Loopback networking was permitted
for test servers. Command timestamps and exit codes accompany the logs.

| Command / check | Actual outcome |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm test` | PASS, exit 0; 175 passed, none failed/skipped |
| `npm run test:infrastructure` | PASS, exit 0; 14 passed, none failed/skipped, including 24 repeated early-launch fault invocations |
| `npm run desktop:build` | PASS, exit 0; template validation and parser bundling included |
| `npm run test:ui` | PASS, exit 0; full guest/project/workbench aggregate |
| `npm run test:installer` | PASS, exit 0; 4 unit tests |
| Unpatched Playwright negative control | FAIL, exit 1 as expected; original unhandled rejection and leak reproduced/retained |
| Corrected synthetic fault invocations | Expected FAIL, exit 1; automated assertions of artifacts/cleanup PASS |
| Installed Playwright bundle hash before/after adapter load | PASS; unchanged on disk, adapter reusable |
| Native `test:desktop:smoke` | NOT RUN this follow-up; acceptance remains BLOCKED by unchanged host sandbox prerequisites |
| Native Windows/macOS, real-model acceptance | NOT RUN; previous prerequisites/limitations remain |

No further native launch was attempted: the existing Electron helper is still
user-owned/mode 0755, `NoNewPrivs=1` and seccomp mode 2 remain, and `unshare -Ur true`
still fails on the read-only `/proc/self/uid_map`. No display is inherited. The
previous real native stderr identifies the SUID sandbox prerequisite; changing
only test error handling does not make this host suitable for native acceptance.
No sandbox/host setting, model, inference service or installed dependency file was
changed in this follow-up.

**Phase 1 remains PARTIAL; PR #20 remains draft.** The early-launch cleanup defect
is resolved for the reproduced dependency failure and deterministic fault cases.
Native Linux startup/restart, authentication/SQLite isolation, normal shutdown,
Ctrl+C and profile/process cleanup must still be run on a sandbox-capable host.
Windows additionally needs taskkill/tree and file-lock verification; macOS and
real Ollama inference remain unverified. Real inference still needs a compatible
local service, `embeddinggemma:latest` and a supported Qwen 2.5 chat model. No merge,
RC2/main/workflow/release modification or Phase 2 work occurred.

## Risks, blockers and Phase 2 prerequisites

1. The entire existing aggregate UI smoke now passes, with the original failures
   retained as historical evidence. This resolves the browser baseline gate only;
   it does not establish native Electron or real-model acceptance.
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
7. The early-launch cleanup/reporting gap is corrected with deterministic evidence
   above. The pinned, test-only Playwright adapter needs revalidation on dependency
   upgrades; its passing Node tests do not establish native lifecycle acceptance.

Phase 2 requires the remaining native gates resolved with retained evidence, agreement
on a focused functional scenario list and expected behavior, and a separate real
inference acceptance environment where required. This PR is reviewable Phase 1
infrastructure, not a claim that every Phase 1/native acceptance criterion passed.
