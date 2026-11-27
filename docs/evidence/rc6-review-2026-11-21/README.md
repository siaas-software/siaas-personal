# SIAAS-FLOW-01 independent RC6 review — 2026-11-21

## Scope and inspected revisions

Templates PR #6: `81b5e2891f257adc50323b2f2adbb432249ef45b` against main.
Personal PR #44: `1f2699312705b7c85460f5754e587a5f21dd854d` against develop.
Corrections below are on the existing Personal PR branch. No upstream source change was necessary. Both PRs remain Draft/unmerged. No RC6 release branch, tag or assets were created.

Reviewed changed source, schemas, routes, migration, generated catalogs, tests, example prompts/fixtures and callers. The six older templates' assistant definitions/listings remain byte-equivalent at JSON value level. Eight-template upstream/consumer parity and pinned catalog hash match. RC5 snapshot matches the actual RC5 builtin file SHA-256. Local HTTP access is desktop-only: `localWorkspace` rejects the apparent non-desktop route fallbacks, so those fallbacks are not evidence of another supported execution path.

## Confirmed defects and corrections

- **High — concurrent user edit lost during seed migration.** `src/lib/template-store.ts:28`: the initial awaited query supplied a stale pristine row; later asynchronous update overwrote a concurrent description change. A real SQLite regression using concurrent list/update failed before correction (`migration-race-before.log`). Re-read, pristine comparison and update now occur in one synchronous database transaction, retaining tombstones and custom edits. Tests include both edits and deletion markers (`fixes-final.log`). No existing projects/Knowledge are migrated.
- **High — project UI rejected every v2 import.** `src/components/workspace.tsx:428` accepted v1 only, even though exports are now v2. Real browser test reached the import step and timed out before API submission (`project-v2-ui-before-fix.log`); source inspection identified the guard. Accept v1/v2 identifiers in the preliminary UI guard; full server schema and authorization remain unchanged. Complete project browser/API/SQLite round trip passes (`ui-0.log`).
- **Medium — stale regression expectations.** `tests/legacy-cleanup.test.ts:105` required v1 export identity; `tests/project-flows.mjs:216` required six builtins. Corrected to v2 with explicit disabled orchestration, preserving assertions on all legacy project/assistant data and v1 parsing, and eight builtin presets. No assertions were simply removed.

The orchestration object rejects unknown keys, duplicate/out-of-range indices and invalid enabled budgets. Project/assistant legacy metadata is deliberately sanitized rather than rejected, as documented. UUIDs are remapped to new assistants and export rejects orphan participants. Portable prose remains user-controlled text; it is not a grant of additional Knowledge access. Existing source registration transaction/derived-file behavior was not redesigned.

## Gemma examples

Both new presets have two assistants, model null, empty sources, disabled coordination/sharing and actual supported tool names. Expected totals/fixture identifiers are absent from the reusable answer-generating instructions; expected answers remain in acceptance docs. PDF extraction with `pdftotext -layout` confirms two readable pages and the stated missing evidence (not a Gemma test). CSV integer-cent regression confirms EUR 296.00 / 261.00 / 35.00 and the price difference. No XLSX fixture or real Gemma execution is claimed. General XLSX coverage remains in the existing structured test suite. Both live Gemma scenarios are **BLOCKED**: localhost:11434 refuses the connection. No model was installed or simulated as real Gemma.

## Environment and validation

Linux x64; application tests/builds use Node 24.22.0. Upstream dependency-free `npm test` ran on Node 24.19.0. Test roots are disposable; real user installations/data untouched. Initial npm and Next build attempts failed because default home caches/config were unwritable; retry with task-local cache and telemetry disabled passed. Initial research failures were missing separately locked `services/morphic` dependencies; its `npm ci` and research rerun passed. Packaging uses writable task-local Electron caches. Browser tests use the existing supported `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` override; no test assertions or Electron security configuration were bypassed.

### Release blocker

`node --import tsx tests/missing-docker-e2e.mjs` exits 1 at line 16 before exercising the application: actual Docker inspection result is `ready`, expected `not_installed` (`ui-2.log`). **BLOCKED by an unmet test precondition, not an application PASS and not a demonstrated application regression.** The RC6 handoff explicitly mandates this absent-Docker/Ollama gate. RC5 evidence does not validate these changes. Run the unchanged test on a host genuinely without Docker, with unreachable Ollama, against this corrected tree before integration. Do not hide/remove Docker or weaken the assertion. Other offline/simulated tests do not substitute for this gate.

Native Windows/macOS/Linux Electron runtime and real Gemma remain separate NOT RUN/BLOCKED acceptance. Packaging does not establish GUI startup. No final-candidate source release verification or anonymous RC6 downloads are claimed because integration is blocked.

## Reproduction

From the Personal checkout, use Node 24.22.0, writable `npm_config_cache`, `NEXT_TELEMETRY_DISABLED=1`, `NODE_USE_ENV_PROXY=1`, and install both root and `services/morphic` committed lockfiles. Run commands in the adjacent JSON matrices; logs are named there. UI runs use the Chromium override above. The command `npm run test:projects` is rerun after its two reviewed corrections. `git diff --check` passes. Do not reuse results for a different source tree.

## Disposition

**BLOCKED — NOT MERGED / NOT PUBLISHED.** Corrected implementation is preserved for review in PR #44. No protection changes, Actions enablement, stable-main updates, release mutations, CLI changes, or external data access. After the mandatory missing-prerequisite E2E passes on the appropriate host: recheck heads/review threads, integrate upstream by protected PR, repin final upstream merge commit, rerun consumer gates, integrate Personal by protected PR, and perform exact RC6 candidate gates before any Vault publication. Current-day immutability attestation already exists; no additional publication authorization is requested.

## Executed matrix summary

| Gate | Result |
| --- | --- |
| Upstream catalog + negatives | PASS 6/6 |
| Personal units, including race regression | PASS 196/196 |
| Typecheck; web + desktop builds | PASS |
| Template, Chat, Knowledge, Actions APIs | PASS |
| Structured + offline Hybrid; project chat API/UI | PASS |
| Project lifecycle browser; Overview; eight palettes; UI smoke | PASS |
| Research | PASS 31/31 |
| Installer; distribution | PASS 4/4; 16/16 |
| Icons; structured bundle; CLI/source-manager characterization | PASS |
| Desktop prepare; Linux directory packaging; packaged structured API | PASS |
| Missing Docker/Ollama E2E | BLOCKED: Docker ready on host |
| Both real Gemma scenarios | BLOCKED: Ollama connection refused |
| Native GUI/Windows/macOS and RC6 exact-candidate release gates | NOT RUN |

The `gates.json` matrix preserves the initial missing-browser attempt; the later UI matrices supersede that attempt and record the corrected project-flow run. Final unit/typecheck and desktop logs supersede pre-correction runs. Package is a local validation output, not a published native installer.
