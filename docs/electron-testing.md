# Electron testing infrastructure

Phase 1 uses the existing Playwright dependency and Node test runner. See the
[baseline and execution report](electron-phase1-report.md) for current evidence.
This is infrastructure work; it adds no functional UI scenario or planner change.

## Commands and prerequisites

Run from the repository root with the Node engine in `package.json` (>=22.16.0;
Node 24 recommended). Install locked dependencies with `npm ci`. Build with
`npm run desktop:build` before browser/API/native checks; web and desktop builds
share `.next`. Do not run builds concurrently with integration tests.

| Command | What it checks | Additional prerequisites |
| --- | --- | --- |
| `npm run test:infrastructure` | Readiness, setup failure, timeout, termination, process-tree cleanup and disposable SQLite isolation | Node only, loopback sockets permitted |
| `npm test` | Existing TypeScript/CJS suites (does not include `.mjs` suites) | Locked dependencies |
| `npm run test:ui` | Existing guest, project and workbench browser/API/SQLite suites; Ollama simulated | Desktop build, Chromium |
| `npm run test:desktop:smoke` | Native Electron startup/restart, actual profile path and SQLite file, authenticated readiness and unauthenticated API rejection | Desktop build, Electron binary, graphical session; Ollama simulated |
| `npm run test:desktop` / `npm run test:desktop:real` | Existing real-model Electron acceptance, unchanged functional assertions | Same native prerequisites, real Ollama, embeddinggemma:latest and supported Qwen 2.5 chat model |
| `npm run ollama:check` | Real service/model discovery only | Running real local Ollama |
| `npm run ollama:test` | Real embeddings and generation | Successful real model prerequisite check |

Browser installation: `npx --no-install playwright install chromium`. Linux also
needs the browser's OS libraries. A provisioned compatible browser can instead be
selected with `CHROMIUM_EXECUTABLE_PATH`; `CHROMIUM_PATH` remains a fallback in the
three UI smoke suites. Prefer Playwright's matching browser for reproducibility.
These overrides do not change unrelated UI scripts.

Electron installation: `npx --no-install install-electron --no`. Tests do not
implicitly download Electron. Run as a normal user with sandbox support. Linux
needs an actual display and Electron libraries; on a host with Xvfb already
installed, use `xvfb-run -a npm run test:desktop:smoke`. Do not disable the Electron
sandbox to obtain a passing result. A headless Chromium PASS is not Electron PASS.

## Fixture ownership and diagnostics

`tests/helpers/runtime.mjs` supplies lifecycle utilities to existing standalone
scripts. It does not replace Playwright or Node's assertion/test APIs. The native
launcher is shared by the existing real suite and the infrastructure smoke check.

- Every migrated suite owns an `os.tmpdir()` directory. Browser servers receive an
  explicit `SIAAS_DATA_DIR`; native launches receive `--user-data-dir=<temporary>`.
  The native test reads back Electron's actual `userData` path and checks its
  `siaas.sqlite`. Restarts reuse only that suite's profile.
- Child environments remove inherited desktop keys, origins, data/install paths,
  `ELECTRON_RUN_AS_NODE` and `OLLAMA_HOST`, then apply explicit fixture settings.
  Mock suites always use their own loopback Ollama fixture, including guest UI.
- Setup runs inside the cleanup boundary. HTTP readiness checks have a deadline,
  per-request abort, and early-child-exit detection. UI actions/navigation have
  timeouts; browser suites have a 3-minute deadline, real acceptance 15 minutes.
- Cleanup runs in reverse acquisition order, attempts all resources even after
  an error, and retries directory removal for Windows file locks. POSIX children
  have owned process groups (also used by Playwright); termination escalates to
  SIGKILL. Windows uses `taskkill /PID <owned PID> /T /F`, never an image-name kill.
  The UI aggregator forwards cancellation by IPC so Windows can execute teardown.
- SIGINT/SIGTERM and suite timeouts trigger diagnostics/cleanup then exit nonzero.
  SIGKILL, host loss, forced Task Manager termination and repeated forced signals
  cannot guarantee cleanup. Windows cannot recover an already-orphaned tree by a
  dead root PID; native crash/orphan behavior still needs Windows verification.
- Each invocation writes a unique `test-results/<suite>-<time>-<id>/`: `result.json`
  (mode, environment, owned paths/PIDs, error and cleanup outcomes), bounded process
  and renderer logs, existing screenshots, and failure screenshot/Playwright trace
  when a page/context was available. Cleanup failure changes the result to FAIL.
  Exit codes are 0 PASS, 1 FAIL, 2 BLOCKED for explicit missing prerequisites.
- Inspect a failure trace with `npx --no-install playwright show-trace <trace.zip>`.
  Fixtures contain synthetic data. Traces include temporary desktop request keys;
  review artifacts before sharing. Profiles/databases are deleted, not uploaded.

Lifecycle adoption is intentionally limited to `desktop-e2e`, `desktop-smoke`,
`guest-ui`, `project-flows`, and `workbench-ui`. Other API/installer/package scripts
retain their existing fixtures. Installer unit tests do not establish native
installation acceptance; packaged tests remain a separate distribution gate.

## Exact Windows verification

Use an ordinary Windows desktop session, PowerShell, Git, Node 24/npm, writable
TEMP and installed Electron/Chromium runtime prerequisites. Keep normal OS and
PowerShell protections. This tests the feature checkout, not an installed release.
No Docker, paid service or global framework is required. Downloads need network
and disk space; no model is downloaded by the infrastructure checks.

```powershell
git fetch origin
git switch feature/electron-test-infrastructure-phase1
git pull --ff-only origin feature/electron-test-infrastructure-phase1
node --version
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npx.cmd --no-install install-electron --no
if ($LASTEXITCODE -ne 0) { throw 'Electron installation failed' }
npx.cmd --no-install playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Application tests failed' }
npm.cmd run desktop:build
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
npm.cmd run test:infrastructure
if ($LASTEXITCODE -ne 0) { throw 'Infrastructure tests failed' }
npm.cmd run test:desktop:smoke
if ($LASTEXITCODE -ne 0) { throw 'Native infrastructure smoke did not pass' }
```

Run UI smoke separately and record its exit code: the baseline project-sidebar
assertion currently fails (see report). Workbench can be run independently when
that failure stops the aggregate. Do not change assertions simply to obtain PASS.

```powershell
npm.cmd run test:ui
$SiaasUiExit = $LASTEXITCODE
node tests/workbench-ui.mjs
$SiaasWorkbenchExit = $LASTEXITCODE
"UI=$SiaasUiExit; Workbench=$SiaasWorkbenchExit"
```

For real inference, start the installed Ollama application/service. Model downloads
are optional, separate from mocked checks and may consume several GB. If these
models are not installed and you choose to download them, use:

```powershell
ollama pull embeddinggemma:latest
ollama pull qwen2.5:1.5b
```

Then run the real checks, preserving their separate outcomes. These validate the
existing real suite, not Qwen3 analytical planner acceptance.

```powershell
$env:OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
npm.cmd run ollama:check
if ($LASTEXITCODE -ne 0) { throw 'Real Ollama prerequisites are not ready' }
npm.cmd run ollama:test
$SiaasInferenceExit = $LASTEXITCODE
npm.cmd run test:desktop:real
$SiaasDesktopExit = $LASTEXITCODE
"Real inference=$SiaasInferenceExit; Real Electron=$SiaasDesktopExit"
Remove-Item Env:OLLAMA_BASE_URL
```

Inspect `test-results` JSON reports: each removed directory should no longer
exist and owned PIDs should have stopped. PIDs can be reused; inspect command lines
and creation times before interpreting a later PID match. Never terminate another
user process to make this check pass. Repeat native smoke with Ctrl+C to verify
interactive Windows teardown; the portable fault test exercises the signal handler
synthetically on Windows because `process.kill` forcibly terminates there.

## CI and Phase 2 boundary

`AGENTS.md` and `CONTRIBUTING.md` require GitHub Actions to remain disabled. All four
workflow files retain `.disabled`; no hosted CI, workflow activation or billing
change is included. The commands above are reusable locally or in an explicitly
authorized future runner. A future free Linux/Windows job should run locked install,
typecheck, application and infrastructure tests, desktop build, UI smoke and native
mock smoke (Linux with Xvfb), retaining `test-results` on failure. Real inference
must stay a separate opt-in acceptance job with known local models/hardware.

Before Phase 2, obtain passing native smoke and lifecycle evidence on Windows and
Linux, resolve/review the existing UI baseline mismatch, establish a known-good
real-model environment when inference coverage is intended, and agree on the
functional scenario list and acceptance criteria. Native/macOS/package checks
remain distinct. No CLI Lifecycle, planner, research/Docker or release work is
part of this phase.
