# CLI lifecycle implementation roadmap (proposal only)

Baseline: `develop` at `741b531376c93262c5d15354faf14747fbcf97cc`.
This document proposes future independently reviewable changes. **No phase below
has been implemented by this audit, and none is authorized to start by this PR.**
See [architecture and proposed contract](cli-lifecycle-audit.md) and
[finding IDs](cli-lifecycle-gap-matrix.md).

The work is independent of draft PR #20. Do not import its helpers, change its
branch, count its reported tests as CLI acceptance, or require it to merge first.
If future changes overlap after that PR lands, rebase and reassess in a separately
authorized implementation task. Electron Phase 2 and Qwen3 Planner work are not
dependencies of this roadmap. No phase requires paid services or GitHub Actions.

## Ordering and review boundaries

`P1 → P2 → P3`; `P1/P2 → P4`; `P2/P3 → P5`; `P3/P4/P5 → P6`.
P4 can be reviewed independently of the control implementation once profile/output
contracts are fixed. P5 must land before exposing an update or init command that
promises recoverable migrations. P1/P2 can ship internal modules without enabling
unfinished mutating commands. Each PR should have its own fixture evidence and
documented acceptance limits; an unverified native path must not become PASS by
merging a mock-only phase.

Relative complexity: **S** = localized wrapper/policy; **M** = several modules and
failure-path fixtures; **L** = coordinated ownership/data changes; **XL** = native
platform matrix and external prerequisites. These are comparisons, not calendar
estimates or commitments.

## P1 — Resolve the contract and add a thin command boundary

- **Scope/deliverables:** Agree the proposed command names, output schema, exit
  codes, profile selectors, total deadlines and bootstrap-versus-runtime boundary.
  Add a small Node parser/dispatcher and installed wrappers only in a future PR;
  preserve existing source-manager and npm entry points. Define core versus
  inference readiness and read-only doctor behavior. Map G01/G04/G20/G21/G22.
- **Dependencies:** Maintainer decisions on GUI-only scope, wrapper location,
  profile defaults and compatibility behavior. Use Node built-ins and existing
  dependencies; do not add a CLI framework/global Node requirement.
- **Acceptance:** Help/version run without profile/network/Electron; unknown flags
  fail predictably; JSON stdout is one parseable versioned result, progress is
  stderr, and secrets never appear. Existing commands retain documented behavior.
  Mutation commands not yet ready return an explicit unavailable result.
- **Required automated tests:** Parser missing/unknown/duplicate options, invalid
  timeouts/paths, exit mapping, JSON/stderr separation, redaction sentinels, wrapper
  quoting for spaces and non-ASCII. Assert help/status do not create directories or
  call network/spawn adapters. Preserve existing distribution regressions.
- **Manual verification:** Read help from a clean temp location; inspect human and
  JSON errors; verify old command examples still resolve. Review Windows wrapper
  text separately from claiming native execution.
- **Risks:** Accidentally changing scripts consumed by installers; exposing internal
  credentials in generic config output; treating npm start as desktop startup.
- **Complexity / native prerequisites:** **M**. Implementable and testable without
  Electron, real Ollama or Docker using Node subprocess fixtures.

## P2 — Canonical profile selection and protected instance discovery

- **Scope/deliverables:** One profile resolver shared by CLI/Electron/backend;
  preserve appData/SIAAS and existing candidate data. Separate installation record
  from live instance record. Design local authenticated discovery with instance
  identity/nonce, version, canonical profile and protected endpoint. Define
  operation-lock metadata and conservative stale-state diagnostics. Map
  G03/G07/G10/G13/G22. Prepare init internals, but do not promise safe migrations
  before P5.
- **Dependencies:** P1 selectors; decisions on stable/RC/dev coexistence and
  research shared ownership. Review Unix permissions and Windows ACL/named-pipe
  behavior before exposing control endpoints.
- **Acceptance:** Status is read-only for missing/invalid profiles; conflicting
  selectors fail; simultaneous starts converge on one owner; stale PID alone
  never authorizes termination or lock removal; one profile cannot control another.
  No automatic moves/deletes of existing profiles or credentials in stdout.
- **Required automated tests:** Table-driven platform defaults; relative/symlink
  aliases and conflicting path selection; stable/RC separation; concurrent atomic
  record creation; corrupted/unwritable records; PID reuse and wrong nonce; foreign
  profile sentinels; missing-profile status creates nothing. Node mock IPC servers
  must exercise wrong/missing credentials and endpoint substitution.
- **Manual verification:** Inspect effective profile and permissions in temporary
  stable and candidate layouts; verify settings/data directory agrees with CLI
  resolution when a later native host is available.
- **Risks:** Opening the wrong SQLite profile; lock recovery authorizing a reused
  PID; ACLs differing from POSIX modes; shared optional services mistaken for
  per-profile processes.
- **Complexity / native prerequisites:** **L**. Resolver/record/auth protocol can
  be tested with Node and fake platform adapters. Native Electron default paths,
  Windows ACLs and OS socket behavior remain pending P6.

## P3 — Start, stop and restart with bounded ownership

- **Scope/deliverables:** Reuse the existing Electron/backend/Ollama orchestration
  behind an authenticated control adapter. Start waits for core readiness;
  duplicate start attaches to matching owner. Stop drains mutations, closes local
  stores, stops owned children and waits for completion. Restart preserves profile
  and version, and starts only after successful stop. Add bounded lifecycle logs
  and failure summaries. Map G05/G06/G08/G09/G10/G21.
- **Dependencies:** P2 identity/auth/profile model; backend readiness/shutdown
  integration; platform child termination strategy. Do not add automatic crash
  restart loops; begin with explicit restart and actionable recovery.
- **Acceptance:** Parent/backend/owned-Ollama failures are distinguishable; no
  false success after immediate exit; deadline encompasses every wait; start failure
  cleans only its owned resources. Stop reports survivors, preserves reused Ollama,
  other profiles and research services, and repeat stop is a no-op. Interrupted
  CLI observes 130/143 where applicable without pretending SIGKILL is recoverable.
- **Required automated tests:** Use real Node child processes with fake backend
  and Ollama endpoints: spawn failure, immediate crash, delayed/malformed readiness,
  occupied port, timeout, child ignores graceful stop, descendant survival,
  Ctrl+C/SIGTERM to launcher, duplicate start, wrong identity, repeated stop and
  restart after failed stop. Record exits/owned handles and preserve unrelated
  process/profile sentinels. Temporary SQLite tests verify reopen after orderly
  closure and pending-operation failure reporting.
- **Manual verification:** On Linux test fixture processes with Ctrl+C and repeated
  restart; inspect the process tree and logs. Later repeat genuine Electron window
  close, backend crash and application restart on each OS in P6, preserving sandbox.
- **Risks:** Windows kill semantics, shutdown during active work, false ready from
  unrelated HTTP service, backend port race, losing logs on early failure.
- **Complexity / native prerequisites:** **L**. Most state machine/control code is
  testable with Node child fixtures; native quit, window focus, process-tree cleanup
  and actual SQLite integration require P6. This is application lifecycle work,
  not an expansion of PR #20's test infrastructure.

## P4 — Component diagnostics, Ollama and optional-service policy

- **Scope/deliverables:** Consolidate existing Ollama URL/version/model checks in
  status/doctor; retain missing/incompatible/occupied/timeout distinctions. Separate
  core, inference and optional research readiness. Specify default network behavior;
  add an offline option only if its scope is accepted. Standardize logs and optional
  research status codes/deadlines without making Docker mandatory. Map
  G07/G17/G18/G19/G20/G21/G22/G24.
- **Dependencies:** P1/P2; decision on shared research lifetime and default model
  storage. Existing scripts remain the starting point, not replacement services.
- **Acceptance:** Doctor never installs/pulls/starts by default; no paid or remote
  inference fallback. App can open without Ollama, while `--require-inference`
  fails clearly. Disabled optional features do not fail core status. If exposed,
  research stop/start verify completion and do not disturb other owners. Status
  and offline checks do not send private credentials to redirected/remote hosts.
- **Required automated tests:** Mock `/api/version` and `/api/tags` responses for
  unavailable, old version, malformed JSON, missing model, timeout, redirect and
  remote-model metadata; external Ollama survives stop; repeated discovery does
  not create a second owned child. Fake Docker/HTTP tests verify only selected
  services are touched, bad tokens are rejected and unavailability is nonzero when
  required. Assert no network calls in strict offline/read-only paths if adopted.
  Add log retention/redaction failure tests using temporary files.
- **Manual verification:** Run doctor against a closed fixture port and a mock
  service; inspect readable guidance and JSON without tokens. Real Ollama/model
  loading, optional Docker startup and offline generation are P6 checks.
- **Risks:** Service readiness confused with model readiness; duplicate URL policy
  drifting between modules; legacy research token fallback crossing profiles;
  optional setup initiating unexpected downloads.
- **Complexity / native prerequisites:** **M**, or **L** if research isolation is
  chosen. Most work requires no native Electron/Ollama; fake Docker suffices.
  Model-store semantics and real service children require later acceptance.

## P5 — Migration, update, backup and recovery safety

- **Scope/deliverables:** Reuse staged distribution and runtime verification;
  add quiescence, verified pre-migration/profile backup, schema compatibility
  preflight and transactional/resumable migration steps. Define backup manifest,
  retention and restore procedure (including linked-original exclusions). Keep
  current/previous app usable through activation failure. Make rollback explicit
  target selection and uninstall repeatable/ownership-safe. Map G10–G16.
- **Dependencies:** P2 ownership and P3 stop/readiness. Agree whether backups include
  telemetry/config/managed originals; decide disk-space limits, checksum verification
  and unsupported downgrade handling. Existing helper alone is insufficient.
- **Acceptance:** Failed backup/migration/build/activation never reports success;
  no destructive automatic downgrade; no mutation of live foreign profiles;
  schema/version record and database remain recoverable after injected interruption.
  Same-version repair validates the app as well as runtime. Repeated uninstall
  never removes stable registration after candidate unregister. Logs state which
  app/data state is active and how to recover, without claiming app rollback restores
  data. Update has a total deadline and does not prune needed recovery artifacts.
- **Required automated tests:** Temp SQLite fixtures for supported older schema,
  future schema, repeated init, interrupted legacy ALTER, busy writer, migration
  failure, disk-full/unwritable backup and restore integrity. Exercise process
  interruption between file-copy/record-update/remove steps and activation stages.
  Extend existing fake source-manager tests with live-instance refusal, no-op
  target rollback, missing executable, launch failure, stale lock, repeated stable/RC
  unregister and preservation of unknown files/linked-original sentinels. Avoid
  downloads by injecting manifests, artifacts and fake build processes.
- **Manual verification:** On disposable profiles, upgrade, inspect backup, validate
  documented restore into a separate directory, and open with a compatible app.
  Test source install paths with spaces; on Windows verify locked files and antivirus
  interference produce safe errors rather than forced deletion. Inspect retained
  app/runtime/profile identities before and after failed update.
- **Risks:** Data loss from incomplete snapshots or unsafe migration retry; restored
  database mismatching files; concurrent launch during activation; Windows rename
  and executable locks; backup disk exhaustion. Never test with the user's real
  profile or immutable RC2 assets.
- **Complexity / native prerequisites:** **L**. Migration/backup/update protocol
  can largely run with Node/SQLite and fixture installers. Native file-lock,
  packaged update and real startup verification remain P6 requirements.

## P6 — Native lifecycle acceptance and user documentation

- **Scope/deliverables:** Run the final CLI on Windows, Linux and macOS for the
  explicitly supported architectures. Publish local evidence with commands,
  versions, profile identifiers, outcomes and limitations. Update installation,
  recovery and developer guides to the accepted contract. Map G23/G24 and close
  only findings supported by evidence.
- **Dependencies:** P3/P4/P5, appropriate OS/GUI hosts, supported Node/Electron,
  real Ollama and predownloaded supported embedding/chat models. Docker is needed
  only for optional-service acceptance. PR #20, Electron Phase 2 and planner changes
  are not prerequisites; any reuse of future infrastructure needs separate review.
- **Acceptance:** Fresh isolated init/start/status/stop/restart succeeds; duplicate
  start converges; selected profile persists; wrong control credentials/API clients
  fail; window close/Ctrl+C/termination cleanup is observed; external Ollama survives;
  owned service/runner descendants exit as designed; failed update/rollback/uninstall
  preserve data. Offline core/inference behavior matches documented network policy.
  Unsupported/unavailable platform checks remain explicitly UNVERIFIED.
- **Required automated tests:** Re-run targeted contract/distribution/SQLite tests
  on each supported OS; then drive real installed CLI subprocesses with isolated
  profiles and genuine Electron, recording readiness, exit and cleanup. Add
  real-Ollama smoke only with explicit model prerequisites. Do not simulate a PASS
  when executable, sandbox, model or GUI prerequisites are absent.
- **Manual verification:** Windows PowerShell/CMD quoting, ACLs, named pipe and
  locked executable/database cases; macOS launcher/appData/permissions and normal
  security prompts; Linux launcher/process groups and sandbox prerequisites. Inspect
  processes/ports/profile sentinels after normal and failed exit. Disconnect external
  network after model preparation and verify supported offline operations. Review
  logs for credentials and personal content before sharing.
- **Risks:** OS-specific differences and hardware/model latency; synthetic fixtures
  hiding native issues; attempts to bypass OS protections to make tests pass. Keep
  native limitations visible and preserve all released artifacts.
- **Complexity / native prerequisites:** **XL** relative to the other phases.
  Native Electron and real Ollama are necessary only for the corresponding
  acceptance rows, not for starting the earlier implementation phases.

## Review and release gates

Every future implementation PR should state the findings addressed, precise scope,
checks actually run and remaining native limitations. Review docs/output contracts
before introducing commands that mutate data. Use local checks; do not activate
Actions or publish a release as part of this plan. No PR merge is requested here.

For this audit, the concrete outcome is three English documentation files, pinned
source evidence, a classified matrix, a minimal proposed contract and this staged
plan. The current targeted validation is **22 lifecycle/distribution tests and 11
SQLite/Ollama tests passing**; full typecheck is limited by missing preinstalled
dependencies, and native acceptance remains unverified. **Audit-only; implementation
deferred.**
