# CLI lifecycle architecture and gap audit

Audit date: 2026-11-07. Repository: `siaas-software/siaas-personal`.
Baseline: `develop` at `741b531376c93262c5d15354faf14747fbcf97cc`
(`package.json` version `1.1.0-rc.2`). Audit branch: `audit/cli-lifecycle`.

**Audit-only verdict: PARTIAL lifecycle coverage.** SIAAS already has a source
distribution CLI, platform bootstrap/update wrappers, desktop launch scripts,
Ollama diagnostics, and optional research-service commands. A new CLI should
consolidate these capabilities, not replace them on the assumption that none exist.
The principal gaps are authenticated application discovery/control, readiness
semantics, bounded shutdown, profile consistency, and safe migration/recovery.
This audit does not establish native release acceptance or authorize implementation.

Companion documents: [gap matrix](cli-lifecycle-gap-matrix.md) and
[implementation roadmap](cli-lifecycle-roadmap.md).

## Scope and method

Inspected tracked scripts, package commands, Electron main/preload/helpers, Next
runtime/proxy/API integration, SQLite initialization, Ollama management, research
services, tests, and documentation. Findings below refer to the pinned baseline,
not the checkout's original `work` branch, stable `main`, or released RC2 artifacts.
The three requested paths did not exist before this audit.

PR [#20](https://github.com/siaas-software/siaas-personal/pull/20) was read only
to identify the independent draft effort: `feature/electron-test-infrastructure-phase1`
against `develop`, observed head `1496298a6619708e56bba1b1a2d08c0b542b2d80`.
No commits, test helpers, results, or fixes from that branch are incorporated here.
Its reported acceptance is not evidence for this audit. No application source,
tests, dependencies, lockfiles, workflows, release tags, or release assets are changed.
GitHub Actions remains outside the validation path; checked-in workflow files
have `.yml.disabled` suffixes. No workflow was enabled or dispatched.

Classification distinguishes source evidence from execution: **IMPLEMENTED** means
the scoped behavior is present, not universally accepted on every OS; **PARTIAL**
means an implementation exists with a material limitation; **MISSING** requires
inspection of command dispatch/call sites, not absent prose; **UNVERIFIED** means
evidence does not establish the behavior; **NOT APPLICABLE** means outside the
local desktop lifecycle. Severity is separate from classification.

## Evidence index

All links below pin source to the baseline. Line ranges and named functions in
the matrix refer to this version; they must be rechecked after code changes.

| ID | Source and relevant references |
| --- | --- |
| E01 | [package.json](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/package.json#L5): `scripts`, `engines`, `private`; no `bin` command registration. [runtime.json](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/runtime.json): Node 24.22.0 distribution pin. |
| E02 | [scripts/source-manager.mjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/scripts/source-manager.mjs#L22): roots/record validation 22–49; platform launcher 64–130; atomic record 131–140; detached launch 141–160; pruning 161–189; install/activation 191–331; dispatch/lock/rollback/uninstall/update wait/error 333–423. |
| E03 | [scripts/install.sh](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/scripts/install.sh#L1) 1–48 and [scripts/install.ps1](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/scripts/install.ps1#L1) 1–60: bootstrap validation/runtime/build; `scripts/install-rc.sh:3–51`, `scripts/install-rc.ps1:2–65`: explicit candidate selection and separate roots; `scripts/update.sh:1–9`, `scripts/update.ps1:1–12`, `scripts/{rollback,uninstall}.{sh,ps1}`: installed-manager wrappers. |
| E04 | [scripts/lib/distribution.mjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/scripts/lib/distribution.mjs#L22) 22–31, 81–183: platform/assets/stable discovery/manifest validation; [scripts/lib/managed-runtime.mjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/scripts/lib/managed-runtime.mjs#L20) 20–73 download policy, 74–138 environment/hash/version checks, 140–187 staged provisioning. |
| E05 | [scripts/desktop.mjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/scripts/desktop.mjs#L1) 1–17; `scripts/build-desktop.mjs:5–44`; `next.config.ts:3–15`; `scripts/prepare-package.mjs:13–75,100–116`; `electron-builder.cjs:19–46`: startup/build/package boundaries and private runtime. |
| E06 | [desktop/main.cjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/desktop/main.cjs#L20) 20–51 profile/single instance/quit; 54–133 backend spawn and readiness; 134–230 renderer/IPC security; 263–290 detached update; 292–344 Ollama setup and update check. |
| E07 | [desktop/ollama-manager.cjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/desktop/ollama-manager.cjs#L19) 19–65 loopback/probes; 70–117 executable discovery; 126–181 reuse/start/readiness; 183–236 install/cancel/close. `desktop/install-ollama.cjs:20–143,152–160`, `desktop/safe-zip.cjs`, `desktop/ollama-assets.json`: installation and integrity controls. |
| E08 | [src/lib/ollama.ts](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/src/lib/ollama.ts#L25) 25–54 local URL/preview policy; 75–151 model status; `scripts/check-ollama.ts:1–23`, `scripts/test-ollama.ts:1–52`: diagnostic/inference commands. |
| E09 | [src/lib/local/database.ts](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/src/lib/local/database.ts#L57) 57–150 path/schema/migrations; 151–163 close/transactions; 267–295 stale conversation recovery; 466–489 file migration; 749–758 lazy singleton. `src/lib/structured/store.ts:15–20`: additive derived tables; `src/lib/local/inference-telemetry.ts:14–26,48–49`: separate telemetry database and interrupted-state recovery. |
| E10 | [scripts/backup-desktop.cjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/scripts/backup-desktop.cjs#L4) 4–25: SQLite backup/retention; `scripts/prepare-package.mjs:61–65` copies helper. No invocation found in E02 or E06. |
| E11 | [src/proxy.ts](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/src/proxy.ts#L3) 3–17: key/host/origin protection; `src/lib/runtime.ts:1–5`: desktop/hosting gate; `src/lib/http.ts:47–63`: desktop workspace and mutation-origin gate; `desktop/preload.cjs:1–23`: bounded renderer bridge. |
| E12 | [scripts/research-services.mjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/scripts/research-services.mjs#L17) 17–92 config/auth; 93–117 status/stop; 119–193 setup/start; `scripts/docker-prerequisites.mjs`; `services/compose.yml:1–24`; `services/morphic/server.mjs:23–52,107`; `src/lib/local/experimental-features.ts:48–77,127–153`; `src/lib/local/research-services.ts:29–45,179–226`. |
| E13 | [desktop/updates.cjs](https://github.com/siaas-software/siaas-personal/blob/741b531376c93262c5d15354faf14747fbcf97cc/desktop/updates.cjs#L9) 9–23: stable metadata check, timeout, pending guard, failure reporting; `.env.example`; `docs/installation-en.md:37–78`; `README.md:105–115,198–213`. |

## Discovered command surfaces

| Surface | Existing commands and actual scope |
| --- | --- |
| Source manager | `node scripts/source-manager.mjs install`, `update`, `check`, `launch`, `status`, `rollback`, `uninstall`; internal `update-detached <pid>`. Install/update accept `--manifest <file>` and `--prepared <dir>`. This is an existing CLI, although there is no registered general `siaas` command, help parser, or common option schema. |
| OS entry points | `install.sh` / `install.ps1` bootstrap managed Node and a source build. `install-rc.*` use `SIAAS_RELEASE_TAG`. Update/rollback/uninstall wrappers dispatch into the installed release's manager. POSIX `update.sh` forwards its first argument; PowerShell restricts actions to update/rollback/uninstall/check/status. |
| Next development/production | `npm run dev` and `npm start` bind Next to `127.0.0.1`; `npm run build` produces the web build. These are web entry points, not independently provisioned desktop sessions. They do not synthesize the desktop key/origin or Electron process ownership. |
| Electron development | `npm run desktop:dev` builds then runs `npm run desktop`; `desktop:install` installs dependencies/Electron then builds; `desktop` launches Electron with the current Node executable. Despite its name, `desktop:dev` runs a standalone production backend, not Next hot reload. |
| Packaging | `desktop:build`, `desktop:prepare`, `desktop:package`; source-manager builds unpacked with `--dir --publish never`. Release/checksum/icon/template scripts are developer/release tooling, not application start/stop commands. |
| Ollama | `npm run ollama:check` reports connectivity and installed embedding/chat models with exit 1 when requirements are unmet. `ollama:test` runs real embedding and chat. Neither installs models. The Electron setup IPC separately discovers, starts or offers installation of Ollama. |
| Optional research | `research:setup`, `research:start`, `research:stop` require `reasoning` or `web`; `research:status` can inspect both. Docker and model downloads belong to these optional features, not baseline desktop startup. |
| Backup helper | `node scripts/backup-desktop.cjs <data-directory>` exists as a low-level SQLite helper; it is not an exposed complete profile backup/restore contract. |

Documentation inspected includes `README.md`, `docs/developer-reference.md`,
`docs/installation-en.md`, `docs/migration-en.md`, `docs/research-en.md`,
`docs/rc2-validation.md`, `docs/releases/1.1.0-rc.2-windows.md`, and
`docs/security-readiness-2026-10-25.md`. Historical tests include simulated API
and distribution checks and some real inference evidence; they are not current
native lifecycle acceptance. English follows `docs/documentation-language.md`.

## Architecture and lifecycle behavior

### Installation, startup and readiness

Bootstrap verifies source size/hash and official runtime checksums, selects an OS
and architecture, and invokes the source manager with prepared artifacts (E03–E04).
The manager serializes mutations with a directory lock, stages a dependency install
and build, validates the executable's presence, atomically changes `current.json`,
retains one previous application/runtime, and launches the desktop (E02). Build
failure before activation preserves the previous record. Launch occurs **after**
activation/pruning; a spawn failure or immediate desktop failure is not a verified
post-activation rollback. Build subprocesses have no overall timeout.

Electron selects its profile, takes a single-instance lock, reserves then releases
an ephemeral loopback port, and starts its owned Node/Next child. The released-port
handoff leaves a small bind race. Readiness is an authenticated successful GET of
the root page with bounded attempts, not an explicit check of SQLite, schema,
models, and component identity (E06). The source manager only waits for the
Electron `spawn` event, discards its stdio and detaches; success is launch requested,
not desktop ready. The root-page loop can take substantially longer than 30 seconds:
each attempt can consume a one-second HTTP timeout plus a 250 ms delay.

SQLite initializes lazily through `localClient()` / `localDatabase()` when used by
routes. WAL, foreign keys, busy timeout, a future-schema guard and additive schema
creation exist. Schema/data migration in the constructor is not enclosed in one
transaction; e.g. the legacy `ALTER TABLE` precedes the final `user_version=4`.
An interruption can leave partially applied work. File migration copies, updates
the record, removes the old file and retries failures on later startup (E09).
Transactions protect individual application operations, but do not make this
entire initialization sequence crash-atomic.

### Stop, restart, ownership and recovery

Normal Electron quit sends `kill()` to the tracked backend and closes the Ollama
manager. Reused Ollama has no owned child and is left running; this is tested.
Owned children receive termination requests, but there is no awaited exit,
bounded escalation, process-tree guarantee or application-level drain/SQLite-close
handshake. No explicit SIGINT/SIGTERM handler is present in the desktop launcher
or main lifecycle, and Node child termination on Windows must not be equated with
POSIX graceful signals (E05–E07). This is a cleanup risk, not proof of a leak on
every normal exit.

There is no application stop/restart command or authenticated cross-invocation
control endpoint/instance record. Single-instance focus is useful but does not
prove CLI idempotent readiness. Backend unexpected exit displays an error and quits;
no automatic restart supervisor exists. Explicit recovery already includes
version rollback, runtime hash checks and repair instructions, expired conversation
leases, and inference telemetry marked interrupted on reopen (E02/E04/E09).

GUI update blocks while observed renderer mutations or setup are active, asks for
confirmation, and spawns an updater that waits up to 120 × 500 ms for the parent
PID to disappear. It does not establish that every descendant/writer has exited;
PID existence is not identity. Direct manager update/rollback does not enforce the
GUI's activity checks. The backup helper is packaged but not invoked by these
paths. Rollback explicitly does not reverse data migrations (E02/E06/E10).

### Profiles, configuration and local-first boundaries

| Setting | Effective behavior / precedence |
| --- | --- |
| `SIAAS_INSTALL_DIR` | Source installation root; defaults to `%LOCALAPPDATA%/SIAAS Personal Source` on Windows and `~/.local/share/siaas-personal-source` elsewhere. It is not the SQLite profile. Bootstrap requires an absolute path; manager uses `resolve`. |
| `--user-data-dir=<path>` | Electron profile override; default `app.getPath("appData")/SIAAS`, preserving the old product name. Source candidate records supply `<install-root>/profile`. |
| `SIAAS_DATA_DIR` | Backend/research direct-script data root; defaults to `~/.siaas`. Electron overrides it for the backend with its actual `userData`. Setting this variable alone does not change Electron's profile. `scripts/desktop.mjs` does not forward arbitrary CLI arguments. |
| Runtime flags | `SIAAS_RUNTIME=desktop` enables local workspace subject to `VERCEL !== "1"`. `SIAAS_DESKTOP_KEY` and `SIAAS_DESKTOP_ORIGIN` are generated per Electron launch. `SIAAS_NODE_EXECUTABLE` selects development Node; packaged backend uses private Node. |
| Build/runtime internals | `SIAAS_BUILD_DESKTOP=1` selects standalone output; `SIAAS_DESKTOP_DEV`, `HOSTNAME`, `PORT`, `NODE_ENV`, `NEXT_TELEMETRY_DISABLED` are set by the desktop path. `SIAAS_SOURCE_NODE` and `SIAAS_SOURCE_MANAGER` support installed updates. Do not expose internal authentication variables as ordinary user flags. |
| Ollama | `OLLAMA_BASE_URL` defaults to `http://127.0.0.1:11434`; remote hosts, credentials, paths and redirects are rejected in client probes. Manager sets child `OLLAMA_HOST`; inherited `OLLAMA_MODELS` may choose storage, otherwise Ollama's own default remains. App profile isolation does not imply model-store isolation. |
| Research | `SIAAS_DATA_DIR`, saved `research-services.json` and legacy `~/.siaas/research-services.json`; explicit token override wins. Backend additionally accepts `SIAAS_LAYA_URL` / `SIAAS_MORPHIC_URL`; CLI uses validated fixed loopback origins. Compose uses global name `siaas-research` and fixed ports, so separate profiles do not isolate these services. `SIAAS_SEARXNG_IMAGE` overrides the pinned image. |
| Environment loading | Next handles its environment files; Ollama diagnostic scripts explicitly load `.env.local`. Desktop launcher/source manager do not use a shared configuration loader. Managed-runtime subprocesses sanitize Node/npm override variables. Desktop build strips `.env*` from standalone output; packaging excludes database artifacts. |

Local-first controls are real: loopback backend, random desktop key, host/origin
checks, sandboxed/context-isolated renderer, trusted-frame IPC, local Ollama URLs,
no paid inference fallback, and explicit managed-Ollama download confirmation.
Do not weaken these to implement terminal control. The new control interface needs
its own protected local authentication, not a printed desktop secret (E06–E11).

Ollama service version readiness and model readiness are separate today. Discovery
reuses a compatible service, detects an occupied/unrecognized port, checks installed
binaries across platforms, and starts an existing binary before polling `/api/version`.
An incompatible first discovered installation is reported, not overwritten.
The UI still loads when Ollama is missing/unavailable; chat/retrieval then report
unavailability. Offline use with installed models is supported in the code, but
not freshly proven with a real model here. Source-managed desktop launch can
asynchronously check GitHub for updates. Optional web research, install/update and
model downloads need network access; local-first does not currently mean zero
outbound requests under all modes.

### Diagnostics and optional services

Source operations emit `SIAAS_PROGRESS` JSON mixed with subprocess output; `status`
and `check` return different JSON structures. Errors usually exit 1; the Ollama
installer uses 2 for a missing directory. No common error taxonomy exists.
Backend output is only an in-memory 3,000-character tail. GUI updates append
`update.log`; owned Ollama appends `ollama.log`; Morphic appends
`morphic-service.log`. No common rotation/redaction/export policy was found.

Research has genuine status/stop controls, including an authenticated Morphic
shutdown and feature-specific Compose stop. Its status prints Unavailable but can
exit 0; setup/start acknowledge requests rather than awaited readiness. Shutdown
errors can be swallowed. Containers use `restart: unless-stopped` and the desktop
quit path does not stop them. These are distinct services with an unresolved
shared-versus-profile ownership policy, not evidence that core app stop exists.

## Proposed minimal CLI contract (recommendation only)

Use a thin Node entry point over existing modules, with native `node:util.parseArgs`
and existing platform wrappers. Do not add a CLI framework, daemon framework,
global Node requirement, service installer or paid dependency. `siaas` is a proposed
installed wrapper name, **not a command available at this baseline**. Source
development may invoke the same future entry point through Node/npm. Preserve old
scripts as compatibility entry points with documented semantics.

### Shared contract

- Selection: `--install-dir <absolute-path>` selects distribution; `--profile
  <absolute-path>` selects data. Precedence: explicit option, matching environment
  setting, installed record, established platform default. Reject conflicting
  profile selections rather than silently choose a different workspace. Preserve
  stable/RC separation and resolve canonical paths before ownership checks.
- `--help` and `--version` are local, read-only, exit 0, and require no profile,
  Electron, Ollama or network. Unknown commands/options and missing values exit 2.
- Human output is concise English. `--json` emits one versioned result on stdout
  (`schemaVersion`, `command`, `ok`, `state`, component results, warnings, error
  code); progress/diagnostics go to stderr. Never emit keys, research tokens,
  prompts, documents or raw environment dumps. Avoid publishing absolute private
  paths in portable diagnostic exports without consent.
- Exit codes: **0** requested operation succeeded; **1** unexpected/internal
  failure; **2** usage/configuration; **3** requested readiness unmet (stopped,
  absent or degraded required component); **4** conflict/busy/ownership mismatch;
  **5** timeout; **6** filesystem, integrity or migration safety refusal;
  **7** required prerequisite/network dependency unavailable. Observed interruption
  exits 130 (Ctrl+C) or 143 (SIGTERM) where supported; forced process termination
  cannot guarantee output. JSON error codes carry finer distinctions.
- `--timeout <seconds>` is a total deadline for start/stop/restart/doctor/update,
  validated and bounded. Suggested defaults: start 180, stop 30, restart 210,
  doctor 10, update 1800. Independent network calls cannot reset the deadline.
- Control is local, profile-scoped and authenticated through a private Unix socket
  or Windows named pipe (a protected loopback equivalent is acceptable after
  review). Validate instance nonce/identity and ownership; never kill by port or
  executable name, and never trust a PID alone. Keep the desktop key private.
  Windows ACLs and graceful IPC replace assumptions about POSIX signals/modes.

### Essential application commands

All rows inherit the shared output, exit, selection and security rules above.

| Command / purpose | Arguments/options | Expected output and exits | Idempotency/failure behavior | Platform and security considerations |
| --- | --- | --- | --- | --- |
| `siaas init` — prepare selected profile | Common selectors; no download/install options | `initialized` or `already_initialized`, schema version; 0, 2, 4, 6, 7 | Preserve data on repeat; refuse busy/incompatible profile; transactional migration only after recoverable backup policy exists | Resolve Electron-compatible defaults on all OSes; restrictive directory/ACL creation; no models, cloud account or telemetry setup |
| `siaas start` — launch desktop and await core readiness | Common selectors, `--timeout`, `--require-inference`; detached by default | `ready` plus separate inference state; 0 once core is ready, 3 if required inference absent, 4 conflict, 5 deadline, 6/7 unsafe/missing prerequisites | Reuse authenticated matching instance; do not start duplicates; track/clean only children created by failed attempt; report if app remains running when inference requirement fails | Needs native GUI/Electron; reuse external Ollama without owning it; no implicit download or firewall/sandbox changes |
| `siaas stop` — close selected app and await cleanup | Common selectors, `--timeout`; no broad `--force` in v1 | `stopped` or `already_stopped`, owned-child outcome; 0, 4, 5, 6 | Repeated stop succeeds; request drain and owned-child termination; do not remove state or claim success before exit; timeout reports survivors | Graceful IPC on Windows; retain externally owned Ollama and separately managed research services; no data deletion |
| `siaas restart` — stop then start same app/profile | Common selectors, `--timeout`, `--require-inference` | Both stage outcomes, final state; start/stop codes | No new start if stop fails; stopped app starts normally; repeat converges to one instance; preserve profile and installed version | No hidden update/migration beyond explicitly accepted startup policy; no global process termination |
| `siaas status` — observe installation and live components | Common selectors, `--json`, `--require-inference` | Installation, instance identity, backend/database readiness, Ollama service/models, optional service states; 0 core ready, 3 otherwise; 4 identity conflict, 6 invalid record | Read-only, repeatable; absent profile is `not_initialized`; never creates directories, opens SQLite through a migrating constructor, or starts services | Probe authenticated owner when running; read-only metadata when stopped; no token output or external network |
| `siaas doctor` — explain readiness/configuration failures | Common selectors, `--json`, `--timeout`, `--require-inference`; no automatic fix | Named checks and actionable local guidance; 0 checks satisfied, 3 unhealthy, 5 timeout, 6 integrity refusal, 7 prerequisite absent | Read-only checks; no install, migration, model pull, inference or repair as a side effect; distinguish unsupported checks from failures | Check runtime/profile permissions/loopback/service compatibility; never bypass OS protections or contact public services by default |

Core readiness means an authenticated matching app, responsive backend and usable
supported profile/schema, not merely an open TCP port. Missing Ollama/models is a
reported degraded inference capability; it does not prevent opening the workspace.
`--require-inference` makes that degradation nonzero without triggering downloads.
Status/doctor may report optional services disabled without failing core readiness.

### Distribution maintenance (retain existing capabilities)

Initial installation must remain possible **before** `siaas` or Node exists:
retain the reviewed `install.sh` / `install.ps1` and explicit RC bootstrap routes.
Do not invent a required `siaas install` prerequisite. They should eventually emit
the same result/error semantics while retaining trusted artifact checks and explicit
download consent. Their inputs remain `SIAAS_INSTALL_DIR` and, only for candidate
installation, `SIAAS_RELEASE_TAG`; output states installed/unchanged or actionable
failure, with 0/2/4/5/6/7/1 as applicable. Same-version retries must validate the app
as well as runtime before reporting success; platform prerequisites stay explicit.

| Command / purpose | Arguments/options | Output/exits | Repeat/failure behavior | Platform/security |
| --- | --- | --- | --- | --- |
| `siaas update` — check/apply stable update | Common selectors, `--check`, `--timeout`, `--yes` for unattended apply | Installed/latest/result and backup reference; check returns 0 even if update exists; apply 0/4/5/6/7, plus common 1/2 | Check never installs; repeated current version is validated no-op; apply acquires operation lock, quiesces app, snapshots profile, stages, verifies and activates; keep recovery state on failure | Explicit outbound access/downloads; preserve runtime pin/hash/URL checks; exclude RC from stable discovery; preserve Windows file-lock handling |
| `siaas rollback` — select retained application/runtime | Common selectors, `--to <retained-version>` required, `--yes` | Selected version and unchanged data-schema warning; 0/4/6/7, plus common 1/2 | Explicit target makes repeat a no-op instead of current toggle behavior; refuse incompatible schema before activation; never silently restore or reverse data | No download or global Node changes; stop/quiesce first; retain safe current version if selection fails |
| `siaas uninstall` — unregister selected installation | Common selectors, `--yes`; no purge flag | `unregistered` / `already_unregistered`, retained data locations; 0/4/6, plus common 1/2 | Repeated invocation succeeds without touching another channel's launcher; retain records needed for safe recovery and all personal data | Remove only registrations owned by this installation; preserve models/versions/profile and other stable/RC registrations |

No automatic data restore, purge, lock deletion or generic `repair --force` belongs
in the minimal contract. Doctor should explain safe recovery until ownership and
backup completeness can be proven. Application rollback and profile restore remain
different operations.

### Optional tooling

Keep `npm run dev`, build/package, tests, icons/templates and release preparation
as developer commands with their existing prerequisites; do not fold publication
into lifecycle commands. Keep `ollama:test` as explicit real inference tooling.
If later justified, add `siaas logs [--component app|ollama|update|research]
[--tail <lines>]`: bounded redacted local output, exit 0 or 3 when unavailable,
read-only/repeatable, no upload and no tokens; resolve OS-specific log paths.
An optional `siaas research <setup|start|stop|status> <reasoning|web>` adapter may
reuse current service scripts after ownership is defined. Use the same readiness
codes and deadlines, explicit setup/download consent, and preserve feature opt-ins;
repeat start/stop must converge without resetting unrelated services. Docker remains
optional on every platform. Neither optional command is a prerequisite for the
essential CLI.

## Validation performed

Host: Linux x86_64, Node `v24.19.0`, npm `11.9.0`; existing `node_modules` reused.
The tested runtime differs from the distribution pin `24.22.0`. No dependency
installation, application launch, model pull, Docker action, build or release ran.
Tests use temporary fixtures, mock fetch or a local mock HTTP server.

| Actual command/check | Result | Interpretation/limitation |
| --- | --- | --- |
| `git fetch origin develop`; `git switch -c audit/cli-lifecycle FETCH_HEAD` | PASS; baseline above | Fetch first failed at sandbox proxy connection; retry outside sandbox succeeded. PR #20 branch was not fetched or checked out. |
| `node --test tests/distribution.test.mjs tests/docker-prerequisites.test.mjs tests/source-manager.test.mjs tests/source-rollback.test.cjs tests/installer.test.cjs tests/research-lifecycle.test.mjs` | Initial sandbox run exit 1; 2 file-level passes, 4 file-level failures | Runner summarized files rather than individual cases. Not a product failure diagnosis. |
| `node --test --test-reporter=tap tests/installer.test.cjs`; `node tests/installer.test.cjs`; `node tests/source-manager.test.mjs` | Diagnostic failures, exit 1 | Direct installer run identified mock-server `listen EPERM 127.0.0.1`; manager fixture failed its first child invocation. |
| `node --test --test-reporter=tap tests/distribution.test.mjs tests/docker-prerequisites.test.mjs tests/source-manager.test.mjs tests/source-rollback.test.cjs tests/installer.test.cjs tests/research-lifecycle.test.mjs` outside sandbox | **PASS, exit 0: 22 tests, 0 failures, 0 skips** | Real manager exercised with fake npm/build/executable and temporary data; real Docker/Ollama/Electron not used. Relaxed execution was required for fixture subprocesses and loopback listener. |
| `node --import tsx --test tests/local-database.test.ts tests/ollama.test.ts` | PASS, exit 0: 2 file-level results | Repeated below with individual test reporting. |
| `node --import tsx --test --test-isolation=none tests/local-database.test.ts tests/ollama.test.ts` | **PASS, exit 0: 11 tests, 0 failures, 0 skips** | SQLite temp fixtures; mocked Ollama, not real inference. No native Electron claim. |
| `npm run typecheck -- --incremental false` | **FAIL, exit 1: five TS2307 diagnostics** | Existing dependency tree lacks resolvable `decimal.js` (engine/profile/store) and `exceljs` (two tests). Both are declared dependencies. Dependencies were not installed or changed; this is an environment limitation, not a clean typecheck or demonstrated source defect. `--incremental false` avoids changing tracked `tsconfig.tsbuildinfo`. |
| `for script in scripts/*.sh; do bash -n "$script" || exit; done` | PASS, exit 0 | Bash syntax only; no scripts installed or updated anything. PowerShell/native behavior not run. |
| `node --check` for `scripts/source-manager.mjs`, `scripts/desktop.mjs`, `scripts/research-services.mjs`, `desktop/main.cjs`, `desktop/ollama-manager.cjs` | PASS, exit 0 | Syntax, not execution acceptance. |
| Temporary-root probe of `node scripts/source-manager.mjs <action>` with `SIAAS_INSTALL_DIR` pointing into a Python `TemporaryDirectory` | `status`: exit 0, `null`, creates root; `--help`, `stop`, `restart`: exit 1, usage error | Confirms dispatch/status semantics without touching installed app or user profile; temporary root automatically removed. |
| Documentation link/line-reference checks and `git diff --check` | PASS | Local targets and pinned-source line bounds checked; final diff limited to the three audit documents. |

Existing test evidence is named in the matrix; test presence does not imply it was
run here. `npm test`, UI/API aggregates, native `test:desktop`, real `ollama:test`,
package builds, cross-platform installers and crash/power-loss migration tests were
not run. This documentation task does not need dependency repair or the Electron
test infrastructure branch to finish. No existing tests were edited or added.

## Unresolved decisions and acceptance questions

1. Is the initial installed CLI limited to graphical desktop control? This audit
   recommends yes; a headless backend mode would need a separate security/product
   decision, not an accidental interpretation of `npm start`.
2. Should optional research services be shared across profiles or isolated? Current
   fixed ports/Compose name and legacy-token reuse imply sharing. Stop/update and
   uninstall must not assume ownership merely because a profile exists.
3. What is the intended profile discovery policy for stable, explicit RC and source
   development? A single canonical resolver is required before init/control ships.
4. What must a recoverable backup include: `siaas.sqlite`, `telemetry.sqlite`,
   managed originals/derived files/configuration and separately linked originals?
   Current helper covers only the first database. Define restore compatibility and
   available disk-space checks before promising rollback safety.
5. Should starting an owned Ollama retain its default shared model directory or use
   explicitly selected storage? Preserve external services/models until decided.
6. Is strict no-network startup a desired option? Automatic metadata checks currently
   coexist with local inference; an offline flag would need a precise scope.
7. Which native OS/architecture combinations will be supported and accepted for
   stop/signals/IPC/permissions/file locks? Asset availability and mocked platform
   tests are not that evidence.

Implementation remains deferred. The roadmap isolates work that can be reviewed
and tested with Node, temporary SQLite and fake services from later native checks.
