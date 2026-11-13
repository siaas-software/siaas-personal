# Native isolation and historical compatibility — PR #27 follow-up

**Verdict: PARTIAL.** Deterministic checks and static historical review are complete;
there is no native acceptance PASS. Linux feasibility is conditional; Windows needs
its own native implementation/evidence; macOS remains BLOCKED under current
constraints. No OS primitives, test child processes, Electron, installers or
historical modules were executed as native experiments in this task.

Input HEAD: `5334269bedb363eaa37567b539615b939d5a5fb3`, clean
`feature/isolated-native-acceptance-actions`, Draft PR #27, base main
`04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e`.
The [previous completion report](native-acceptance-harness-completion.md) and all
prior validation records remain historical snapshots. No application/package,
workflow, policy, protection, release or other PR changes are included.
`executionEnabled` remains false; both historical approval slots remain null.

## Findings and code boundaries

| Finding | Evidence / location | Disposition |
| --- | --- | --- |
| F1 High, confirmed proof overstatement | `tests/native-acceptance/driver.mjs`, `probeProfile`: the generic Electron probe formerly added the target SHA to profileProofs, despite observing neither Personal's actual userData nor its complete writes. | Removed that grant. Generic success goes only to profilePreflights; install still requires profileProofs. A new deterministic test proves preflight alone cannot authorize install. No native collector currently supplies full proofs. |
| F2 High, unresolved native mechanism | `tests/native-acceptance/native-host.mjs`, `nativeTerminate` / `terminateAndDrain`: census identity checks followed by a PID syscall would still race reuse. The current implementation correctly refuses termination. | Default refusal remains unchanged. Added a non-native handle-controller contract with synthetic bridge tests; no native binding is wired. |
| F3 High, unresolved full-tree authority | `native-host.mjs`, `selectOwned` / `sample`: polling, executable paths and PPID/birth ordering are diagnostics, not complete ownership capture for detached build descendants. | Broker-issued owned-spawn tickets are required by the proposed handle contract. A native full-tree mechanism remains mandatory; path or census membership alone cannot mint authority. |
| F4 Medium, confirmed historical compatibility boundary | Stable `scripts/lib/distribution.mjs:141` validates stable versions only; RC2/RC3 `scripts/lib/distribution.mjs:152` accept RC manifests. | Stable is tested in a separate root, not used as an RC update engine. No production behavior is changed or historical approval inferred. |
| F5 Medium, orchestration scope | `tests/native-acceptance/lifecycle.mjs`, `exerciseUpgrade` / `exerciseCoexistence`: update/rollback and coexistence formerly lived inside one scheduler body. | Extracted independent test-only scenario functions, reused by the existing scheduler in the same order. Full native execution still requires both historical approvals; no new workflow selector is exposed. |
| F6 High, unresolved native isolation | `tests/native-acceptance/isolation-evidence.mjs`, `validateIsolationEvidence`: paths and complete write coverage need native observation. HOME/APPDATA strings and existence of SQLite alone do not establish that. | Added strict consistency/negative checks for future observations. These checks neither collect native evidence nor authenticate caller assertions and are not wired to grant profileProofs. |

Exact historical file hashes and line references are recorded in
[historical source review](../evidence/isolated-native-acceptance/historical-source-review.json).
The live harness entry remains blocked. The new modules are test/design support,
not a SIAAS CLI, installer engine or Installer Adapter interface.

## Linux first: handle design and limits

[identity-handles.mjs](../../tests/native-acceptance/identity-handles.mjs) implements
the deterministic controller for a **future trusted native bridge**, not syscalls.
Its capture input is an opaque owned-spawn ticket; its termination input is an
opaque controller token, never a PID. The bridge must reject unknown tickets and
return a handle acquired while process ownership is still certain. The controller:

1. Checks owned-spawn authority, platform, PID, raw birth identity and boot/session/
   namespace scope against a query on the same handle; then registers an opaque token.
2. Rechecks that handle before requesting termination. Changed identity or ambiguous
   state is rejected. Duplicate or concurrent capture cannot close or reauthorize an already-owned handle;
   reservation precedes awaited inspection.
3. Sends only the handle to requestTermination, then waits for bounded handle exit.
   Request success alone is insufficient. Concurrent cancellation/timeout callers
   join one operation; repeats reuse its success or failure.
4. Closes the handle on all paths. Close/permission/timeout failures are not success.
   Already-exited/zombie processes are not signaled. Results explicitly say reaping
   UNVERIFIED; the existing final census/cleanup barrier is still required.

The native bridge is a trust boundary, not an arbitrary JSON/provider input. The
`authority` field is a contract assertion, not cryptographic proof. A future broker
must protect ticket issuance/IPC and handle lifetime; the injected objects in unit
tests prove only controller behavior. Scope/birth comparisons do not make a recycled
PID safe when the handle itself was acquired too late.

Proposed Linux implementation uses existing **pidfd** facilities:
[pidfd_open](https://man7.org/linux/man-pages/man2/pidfd_open.2.html),
[pidfd_send_signal](https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html),
and handle readiness/wait semantics. Prefer a small reviewed broker using available
standard-library bindings (for example Python pidfd bindings if already present),
or a minimal reviewed native helper, over a new general dependency. None is added,
compiled or run here. Node's portable process.kill is not a substitute.

Acquire the pidfd at process creation (e.g. a supported CLONE_PIDFD strategy), or
while the broker is still the direct parent and holds the child unreaped. Merely
opening a pidfd after a census and matching `/proc/PID/stat` is insufficient: the
PID may already have been reused; start ticks can collide at tick granularity.
Keep the same kernel handle through inspect, signal and exit observation. Capture
boot ID/PID namespace and raw start identity for diagnostics; do not convert large
identifiers to lossy JavaScript numbers. Native tests must cover exit before capture,
exec, permission errors, FD reuse, PID namespace mismatch and PID reuse races.

Direct-child pidfds do not provide complete build-tree containment. npm/Electron
children can fork/detach before a polling observer sees them. A separately justified
kernel ownership mechanism (potentially an already-delegated, transaction-owned
cgroup v2 scope) or broker design must prove capture and prevent escape. Do not
create delegation, change host settings, use sudo, weaken sandboxing or assume
unprivileged namespaces/cgroups are available. Missing support means BLOCKED.
A subreaper alone does not solve capture-before-exit or provide termination authority.

## Windows and macOS design

Windows proposal: retain a process HANDLE from controlled creation, using only the
required query, synchronize and termination access; inspect creation identity using
[GetProcessTimes](https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes),
then use that same handle for termination/wait. Preserve the raw FILETIME identity.
A process opened later by PID needs safe ownership establishment; a matching CIM
string alone is insufficient. Consider creation suspended plus assignment to an
owned Job Object before resume, with breakaway/descendant behavior verified. Any
job-wide operation requires proven exclusive kernel ownership; it is not unchecked
`taskkill /T`. Test nested-job restrictions, denied handles and ordinary-user rights
separately from hosted administrator context. No P/Invoke helper is run or dependency
installed in this task. The controller's Windows tests use synthetic handles only.

macOS proposal remains **BLOCKED**. ps lstart precision and unique-ID queries do
not make a following kill(pid) atomic. kqueue process notifications observe lifecycle
but are not demonstrated identity-bound termination. Mach task ports would need
justified entitlements/permissions and process-tree ownership under unchanged OS
protections. Do not enable debugging entitlements, disable SIP/quarantine or elevate
to make this work. No generic safe replacement has been demonstrated, and the
controller rejects darwin rather than falling back to PID termination.

| Target | Primitive/design feasibility | Native tests | Remaining gate |
| --- | --- | --- | --- |
| Linux x64 | Conditional: pidfd + owned-spawn broker; no bridge implemented | NOT RUN | Safe capture, full descendants, permissions, profile/write isolation |
| Linux arm64 | Same API proposal; architecture-specific availability not inferred | NOT RUN | Independent native runner/kernel acceptance |
| Windows x64 | Conditional: retained HANDLE + verified creation/Job ownership | NOT RUN | Native binding, rights, job escape/cleanup, known folders |
| Windows arm64 | Same proposal; native binaries/architecture must be proved | NOT RUN | Independent ARM64 acceptance; no emulation inference |
| macOS x64 | BLOCKED: no justified unprivileged identity-bound backend | NOT RUN | Safe object-bound termination and full-tree design |
| macOS arm64 | BLOCKED: same; Linux results would not apply | NOT RUN | Independent native design and no Rosetta |

## Explicit profile, launcher and filesystem observations

[isolation-evidence.mjs](../../tests/native-acceptance/isolation-evidence.mjs) checks
reported observations using POSIX or Windows path semantics. It requires exact
source SHA/platform/architecture/root; distinct environment, Node home, native home,
native appData/Programs and actual **Personal** Electron userData; expected launcher;
canonical-path agreement; sandbox enabled; and a complete observer interval from
before process spawn through tree exit with zero dropped events. It rejects unknown
write ownership, outside/redirected paths, Windows stream/path aliases, absent
Personal profile writes and absent launcher writes.

The nativePrograms field denotes the resolved platform launcher directory: Windows
Programs known folder, macOS Applications directory, or the Linux legacy desktop-entry
directory. It does not invent a Windows Known Folder API for Linux/macOS.

This is a conservative consistency gate. All reported native locations must resolve
inside the disposable root and home observations must agree; an unchanged real
account home can therefore block Linux as well as Windows/macOS. It does not assume
that environment overrides change native APIs. Relaxing this requirement needs a
separate reviewed isolation justification, not silently accepting an outside path.

A trusted collector is still missing. Caller-supplied complete=true flags are not
native evidence. Post-write detection cannot undo a write to real data; **preventive
filesystem isolation must be justified before any application/build execution**.
The module does not create such isolation and cannot authorize first launch. No
current path transfers its result into the driver's profileProofs set.

| OS (both architectures) | Native observations required | Launcher/profile assertions |
| --- | --- | --- |
| Linux | Environment HOME/XDG, Node homedir, native account home/appData, actual Personal userData, full tree write capture plus preventive boundary | RC owned root/profile and launch-rc.sh; stable observed appData/SIAAS and owned home/.local/share/applications/siaas-personal.desktop |
| Windows | USERPROFILE/APPDATA/LOCALAPPDATA separately from Known Folder API results, Node homedir and actual Personal userData; junction/reparse/ADS handling; native architecture | RC launch-rc.cmd; stable observed Programs/SIAAS Personal.cmd; actual resolved paths, not environment strings |
| macOS | HOME separately from native account/Application Support paths and actual Personal userData; sandbox/quarantine unchanged, filesystem observation permissions | RC launch-rc.sh; stable home/Applications/SIAAS Personal.command; Finder integration separate from shell payload execution |

Each historical Electron version needs its own observations. The generic probe
only records profilePreflights now, and cannot authorize an install. No native
observer/backend acceptance or historical approval is implied by passing a synthetic
receipt through the validator.

## Exact historical compatibility review

All sources were fetched as Git objects and read without checkout, import, build or
execution. Tag/release provenance was rechecked through read-only GitHub APIs.

| Revision | Version / runtime / Electron | Provenance and static compatibility | Native state |
| --- | --- | --- | --- |
| `1bce852cabbefb2459aeafc5aa42146eabd6283b` | 1.0.0 / Node 24.22.0 / Electron 44.5.1 | Stable release 421455029, direct v1.0.0 tag. Manifest schema 1 accepts stable versions only. Default profile appData/SIAAS; global legacy launcher. | NOT RUN; historical approval absent |
| `84a1ffab4e5f339519bc80844d88ddcd573f561f` | 1.1.0-rc.2 / Node 24.22.0 / Electron 44.9.3 | Prerelease 426735035, direct RC2 tag. RC manifests/profile/launcher supported; retained manager/runtime metadata. | NOT RUN; historical approval absent |
| `17202c5964d9282efd4a1991c548612287c65dbb` | 1.1.0-rc.3 / Node 24.22.0 / Electron 44.9.3 | Prerelease 438958111, direct RC3 tag. Same distribution/runtime/wrapper bytes as RC2. Baseline source allowed for preparation only; execution gate closed. | NOT RUN |
| `e7f8feb5185d4d64c23ace6a904b637c726b97ff` | 1.1.0-rc.3 / Node 24.22.0 / Electron 44.9.3 | PR25 Draft HEAD; no matching published release. Entry point extracts source-state/source-build/source-desktop; distribution/runtime and lifecycle wrappers unchanged. | NOT RUN |

Verified static facts, with paths/lines/hashes in the source record:

- All four desktop/main.cjs select user-data-dir with fallback to appData/SIAAS.
  That expression is not proof of native isolation.
- managed-runtime.mjs is byte-identical across all four revisions: canonical Node
  distribution URL/hash, archive extraction, binary hash/version verification and
  filtered runtime environment. Actual provisioning is NOT RUN.
- RC2/RC3/candidate distribution.mjs is byte-identical; stable's differs by RC/version
  support. Prepared per-platform schema-1 manifests remain the manager boundary.
  Published bootstrap acceptance is a separate path, not implied by compatibility.
- current.json retains version, tag, folder, runtime and previous snapshot; RC metadata
  additionally preserves/creates root/profile. The dispatcher resolves the retained
  generation's own source manager. Candidate internal extraction leaves that layout.
- Launchers use the retained runtime/manager, explicit install root and RC user-data
  argument. Successful new installation launches the application; same-version repeat
  verifies runtime and recreates launcher without proving a genuine update.
- Rollback selects previous application/runtime and rewrites metadata/launcher; it
  does not reverse data migrations. Uninstall removes launcher/current.json and
  retains versions/user data. Shell/PowerShell wrappers are byte-identical across
  the inspected revisions. These are source-level guarantees, not native test results.

## Prepared scenarios A, B and C

| Scenario | Reused implementation / deterministic assertions | Acceptance still required |
| --- | --- | --- |
| A: RC2 install → RC3 update → RC2 rollback | `lifecycle.mjs:exerciseUpgrade` independently validates distinct increasing RC versions; old manager installation/source verification precedes target update; rollback verifies RC2, sentinel and retained dispatcher/launcher. Missing/same/reversed/wrong-channel history is rejected. | Approved RC2, source/runtime/profile integrity, real launches, failure paths and data compatibility on each OS |
| B: stable 1.0.0 + RC3 coexistence | `lifecycle.mjs:exerciseCoexistence` independently checks stable-vs-RC channels, unchanged RC metadata across stable install, separate roots/profiles/launchers and actual stable-launcher callback. It is not an update. | Approved stable, native appData and launcher destinations, no cross-profile writes or user-data interference |
| C: RC3 baseline vs PR25 candidate | Existing compare.mjs and comparison tests, exact different SHAs but same version; equivalent scenario/semantic evidence and matching environments required. | Complete native role receipts; genuine historical update in each role, not baseline→candidate same-version reinstall |

The full scheduler calls A/B in its previous order and still requires both history
approvals. Independent helpers are test-only APIs; no workflow inputs or execution
allowlists changed. Unit spies prove routing/order/failure propagation only. User
sentinels cover preservation assertions, not database migration rollback. Full
uninstall profile hashes remain separate from update/rollback data compatibility.

## Validation and next authorized work

The 105-test baseline and the final 147/147 deterministic tests passed (zero failed,
cancelled or skipped). Static validation and 55 historical Git-blob checks passed.
Current counts, changed-file inventory and SHA-256
records are in [validation](../evidence/isolated-native-acceptance/native-isolation-validation.json).
Reproduce with Node 24.22.0 and the existing development dependencies:

```sh
node --test --test-timeout=5000 tests/native-acceptance/test/*.test.mjs
node tests/native-acceptance/validate-static.mjs
node tests/native-acceptance/verify-historical-sources.mjs
git diff --check
```

The source verifier needs the four exact Git objects above locally; `git fetch
origin <full-sha>` obtains them read-only without adding an execution approval. It
checks bytes and metadata only, never imports historical modules. Gate and workflow
checks remain manual-only/contents:read with no secrets, sandbox bypass or publishing.
The four PR20 helper hashes remain unchanged. No new dependencies are added.

Before any real Linux experiment, prepare and review a native broker and preventive
filesystem boundary, then request explicit authorization for exact commands,
disposable roots, process fixtures and cleanup/evidence expectations. Required
native tests include creation/early exit, detachment/exec, timeout/cancel, concurrent
cleanup, PID/handle reuse, denied access, leftover live descendants, zombies/reaping,
actual sandboxed Personal userData and all filesystem writes. Windows/macOS need
independent authorization and evidence. This task stops at deterministic tests;
there is no authorization to execute those native tests, approve histories, merge,
dispatch or publish.
