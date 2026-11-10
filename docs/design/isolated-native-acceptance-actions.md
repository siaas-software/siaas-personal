# Isolated manual native acceptance — disabled preparation

**Status: PARTIAL; reviewable test infrastructure, no native acceptance claimed.**
Execution remains disabled. No merge, Actions run, release or settings change is
authorized. This branch contains no application changes or develop ancestry.

## Baselines and authority

| Reference | Exact inspected commit |
| --- | --- |
| main / infrastructure parent | `04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e` |
| develop / application baseline | `17202c5964d9282efd4a1991c548612287c65dbb` |
| PR #25 / application candidate | `e7f8feb5185d4d64c23ace6a904b637c726b97ff` |
| PR #26 / reviewed infrastructure source | `aed0af7920cfeedc37a6a7dcbf272bf8561da0c8` |
| PR #20 / helper source | `1496298a6619708e56bba1b1a2d08c0b542b2d80` |

The user explicitly authorized this preparation branch directly from main and a
new Draft PR targeting main. This is a task-specific routing exception to
[CONTRIBUTING.md](../../CONTRIBUTING.md), not a change to standing GitFlow policy.
No existing PR is retargeted, modified or merged. Only the eleven workflow/test
files selected from PR #26 were copied as files; its commit/history was not merged
or cherry-picked. Its obsolete report/evidence were not copied as current results.
Four vendor source files retain their exact PR #20 bytes and SHA-256 provenance.

Main and develop still differ in 173 files, including application changes.
The incoming diff of PR #26 against main would contain 186 files. This branch has
main as its parent and excludes those changes. Root AGENTS.md, CONTRIBUTING.md,
package manifests, production code and existing disabled workflows are unchanged.

## Workflow and dependency closure

[Workflow](../../.github/workflows/personal-engine-native-acceptance.yml): only
`workflow_dispatch`, fixed repository, `contents: read`, pinned official actions,
no production secrets/OIDC/deployment/release scopes and no automatic trigger.
The plan also requires `refs/heads/main`. GitHub must first register the workflow
on default main; preparation on this feature branch does not satisfy registration.

[reviewed.json](../../tests/native-acceptance/reviewed.json) has
`executionEnabled: false`, plus **null stable and previousCandidate historical
approvals**. No input/variable can open either gate. A future change must be
separately authorized/reviewed; simply changing the flag is not acceptance-ready.

Inputs are ten fixed platform selections, the exact baseline/candidate SHAs above
and `PREPARATION_ONLY`. Arbitrary refs, paid/self-hosted labels, extra input fields
and unexpected workflow contexts are rejected. The workflow revision is recorded
separately from application revisions. An actor must verify that exact workflow
revision before any future dispatch; mutable branch selection alone is insufficient.

Each platform has separate baseline and candidate jobs/VMs. Each job checks out
one tested revision and separately approved historical sources. There is no shared
application build directory or dependency cache between comparison jobs.
Maximum matrix size is twelve; `max-parallel: 1`, `fail-fast: false`, concurrency
cancellation disabled, plan timeout 5 minutes, native timeout 120 minutes, artifact
retention 3 days. Full selection has a ceiling of 1,440 native runner-minutes plus
plan time. This is a resource bound, not an execution or billing authorization.

The runtime closure is the workflow; `reviewed.json`, `plan.mjs`, `prepare.mjs`,
`run.mjs`, `safety.mjs`, `native-host.mjs`, `driver.mjs`, `lifecycle.mjs`, `evidence.mjs`;
and the five files under `vendor/pr20/` (four helpers plus provenance). The validator,
unit test, this document and local evidence support development/review only.
All imports are local or Node built-ins until the native probe/smoke resolves the
application checkout's locked Electron/Playwright dependencies. The static validator
uses js-yaml already present in the existing lockfile; no dependency was added.

The vendor graph is desktop-smoke → electron/runtime → playwright-electron.
The orchestrator also reuses runtime's bounded wait. The Playwright workaround is
specifically guarded for version 1.63.0 and its internal source anchor; an update
requires re-review. Only known exported paths are used; generic browser/model
helpers are not invoked. The fixture Ollama endpoint is loopback-only and downloads
no models. It does not establish inference acceptance.

## Native scenarios implemented, never executed in this preparation

[Scenario scheduler](../../tests/native-acceptance/lifecycle.mjs) and
[native driver](../../tests/native-acceptance/driver.mjs) exercise real source-manager
commands and real packaged application processes. Test-only manifests bind a
`git archive` ZIP to its approved commit and actual package version. Their canonical
release URL is a schema field; `--prepared` supplies local source bytes. They are
not published release manifests and no assets are uploaded. Managed Node downloads
retain the production verifier and official HTTPS checksum source.

Both tested revisions must match the same reviewed package-lock SHA-256, while
historical locks are recorded separately. All tracked installed source files must
match the expected Git blob hashes. Symlink
and submodule source entries are rejected. The runtime executable digest must match
its installation metadata. Unexpected tracked-file changes during a build fail
verification and require investigation, not an allowlist relaxation.

| Scenario | Implemented assertions | Current execution state |
| --- | --- | --- |
| Legacy install | Real `source-manager.mjs install --prepared --manifest`, managed runtime/build/activation; exact installed tree | NOT RUN |
| Automatic startup | Owned packaged process, visible native window and expected SQLite profile after install | NOT RUN |
| Sandboxed smoke | Original PR #20 smoke on installed source; actual userData, SQLite, API guard, restart | NOT RUN |
| Profile/metadata | Observed profile database, version/tag/runtime, lock removal, dispatcher status | NOT RUN |
| Launcher | Actual generated RC shell/CMD file; Linux stable desktop entry via gio | NOT RUN |
| Repeat install | Unchanged metadata, no additional GUI startup (existing legacy behavior) | NOT RUN |
| Real update | Install genuinely older approved candidate, update with tested engine, verify current/previous sources and sentinel | BLOCKED: history approval absent |
| Rollback | Existing rollback wrapper, original source generation and profile preserved; no unsolicited startup | BLOCKED: history approval absent |
| Retained manager | Dispatcher status and launcher after rollback select retained generation | BLOCKED: history approval absent |
| Stable/RC isolation | Install approved stable separately, different roots/launchers/profiles, unchanged candidate metadata | BLOCKED: stable approval absent |
| Stable launcher | Generated stable launcher execution with observed GUI/profile | BLOCKED: stable approval absent |
| Uninstall | Existing wrappers, launcher/current metadata removed, versions retained, full profile file hashes unchanged | NOT RUN |
| Unrelated data | Sentinel outside installation roots stays byte-identical | NOT RUN |
| Invalid source | Corrupt prepared archive rejected; no current metadata, leftover lock or source stage | NOT RUN |
| Exclusive lock | Operation rejected without stealing/deleting existing lock | NOT RUN |
| Interruption | Interrupt at dependency-install progress; no activation, preserve unrelated data, record legacy remnants | NOT RUN |
| Adapter rejection | `capabilities` remains an unsupported legacy command | NOT RUN |
| Cleanup | Process identities/census plus owned-root deletion verified; unknown processes/zombies block | NOT RUN |

Both approved application revisions have version 1.1.0-rc.3. They cannot form a
real update pair. `historicalRevisions.stable` and `.previousCandidate` must each
receive a separately approved full SHA, actual package version and approval
reference through a reviewed code change. There is no user-supplied history ref.
Same-version/downgrade histories fail before installation. Historical runtime and
profile contracts must also be compatible; unfamiliar contracts fail closed.

The current preflight blocks the whole native suite without both histories. This
avoids presenting a partial set as completed engine acceptance. No native execution
is authorized by fixture SHAs used in scheduler unit tests.

The suite does not fetch a public installer and claim it tested unpublished PR code.
Positive public stable/RC download-bootstrap tests, Finder/Start-menu interaction,
Electron's update-confirmation dialog, and manual stale-lock repair are additional
acceptance gaps. macOS `.command` payload is executed through its shell, not Finder.
Windows wrappers are run without execution-policy bypass. Denied script/GUI access
is a prerequisite blocker. Interrupted stage/lock retention is recorded as existing
legacy behavior; no automatic recovery or Adapter v1 guarantee is invented.

## Profile, process and evidence safety

The execution gate and hosted/manual/main/revision checks precede any native work.
A fresh canonical directory under RUNNER_TEMP owns test HOME/USERPROFILE, XDG,
APPDATA, caches, profiles, installations and sentinels. A native Electron probe uses
an explicit disposable profile and sandboxed renderer, reads appData, and checks
Node's actual homedir. If legacy default `appData/SIAAS` would escape the owned root,
the suite stops before invoking any legacy installer. Windows/macOS environment
variables may not redirect native known folders: **this is unverified and can block
those platforms**. No account creation, elevation or production profile override is
used to work around it. Source inspection supplements, but does not prove, isolation.

Child environments use an explicit allowlist; GitHub/cloud credentials, NODE_OPTIONS,
NODE_PATH and Electron override variables are excluded. Proxy/CA trust is retained;
credential-bearing proxies are rejected. Checkout credentials are not persisted.
Read-only tokens, environment filtering and approved SHAs are not hostile-code
containment: reviewed dependency/build scripts still run with the runner account's
filesystem/network access. Hosted Windows is administrator-context and does not
establish ordinary-user acceptance. No paid or self-hosted fallback is selected.

The [native observer](../../tests/native-acceptance/native-host.mjs) records PID,
parent, creation identity, executable and state. Linux uses /proc, Windows CIM,
macOS ps; native GUI observation uses X11 tools, window handles or System Events.
Missing tools/permissions block rather than changing sandbox/OS policy. macOS
process birth timestamps have one-second precision; native race/PID reuse acceptance
is not established. Sampling is diagnostic ownership tracking, not process containment.

Cleanup signals only currently matching owned identities. It never kills by name,
argument substring or PID 1. Previously unseen unattributed live processes and new
zombies block cleanup; they are reported without being killed. A quiescence sample
follows termination. Windows taskkill and POSIX termination are explicit cleanup
mechanisms; they are not evidence of a normal application-menu quit. Graceful close
is separately exercised by the reused smoke. If cleanup cannot be established,
owned install files are retained for job disposal rather than deleted under running
processes. Job hard termination can prevent evidence or cleanup; missing results
never count as PASS. Two role jobs must be compared before declaring compatibility.

[evidence.mjs](../../tests/native-acceptance/evidence.mjs) permits only native.json,
closed top-level/scenario/observation record fields, bounded arrays/strings and a
1 MiB total file limit. Extra files, symlinks, hardlinks and canonical-path escapes
are rejected before upload. A PASS requires every mandatory scenario and cleanup
assertion. Upload occurs only after that validator succeeds; failed/blocked JSON
is also valid diagnostic evidence. Raw stdout/environment, browser traces, request
keys, profiles, dependencies and binaries are excluded. SHA/role is rebound to the
reviewed configuration and workflow SHA before upload. This is not a cryptographic
proof against malicious same-user code forging evidence; source/dependency review
and ephemeral VM separation remain required trust assumptions.

## Runner feasibility and unresolved prerequisites

| Platform | Standard candidate | Native result / additional gate |
| --- | --- | --- |
| Linux x64 | ubuntu-24.04 | NOT RUN; Xvfb, xwininfo, xprop, gio, sandbox and resource headroom |
| Linux arm64 | ubuntu-24.04-arm | NOT RUN; same, native dependencies/CPU |
| Windows x64 | windows-2022 | NOT RUN; native known-folder isolation, GUI/CIM and wrapper policy |
| Windows arm64 | windows-11-arm | NOT RUN; same, native Node/Electron rather than emulation |
| macOS x64 | macos-15-intel | NOT RUN; native profile isolation, System Events permission, process identity |
| macOS arm64 | macos-15 | NOT RUN; same, no Rosetta, RAM/disk headroom |

Preflight requires 10 GiB free disk and 4 GiB free RAM, with at least 2 GiB free
before each installation. Actual full-generation storage/runtime demand has not
been measured; resource exhaustion must block. The hosted labels are candidates,
not confirmed repository access. Existing read-only API checks returned HTTP 403
for Actions policy and billing: UNKNOWN. Standard public hosted compute is documented
as free, but storage quotas, scheduling and action permissions need confirmation.

## Local validation and future authorization

With the existing locked development dependencies and Node 24.22.0:

```sh
node --test tests/native-acceptance/test/harness.test.mjs
node tests/native-acceptance/validate-static.mjs
git diff --check
```

Unit tests exercise input rejection, environment/path ownership, installed-file
hash checks, process identity parsing/selection, artifact validation and scenario
ordering/failure propagation. The scheduler fake models only the harness API; it is
not a simulated native PASS. The closed-entry-point test invokes only the disabled
gate and verifies that it writes BLOCKED evidence without application execution.
Local temporary fixtures are removed. No application/native build was run here.
See [local validation](../evidence/isolated-native-acceptance/validation.json).

Before activation: approve histories and the exact application/workflow revisions;
review/fix native isolation and observer limitations; complete outstanding acceptance
scope; confirm permissions/quotas; adopt a narrowly scoped manual Actions policy;
separately authorize protected main integration and registration; then authorize
specific targets and dispatch. The current main-based preparation permission grants
none of those actions. Standing policy files remain unchanged. PR #20/#25/#26 remain
untouched. Removal, if ever merged, must use another reviewed protected PR; no tag,
release, user data or existing release workflow needs changing.
