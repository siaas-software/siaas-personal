# PR #27 harness completion — disabled, native acceptance still blocked

Historical snapshot at `5334269bedb363eaa37567b539615b939d5a5fb3`.
See the [native isolation/historical follow-up](native-isolation-historical-acceptance.md) for current proof and scenario changes.

Input: `ee3644a09c0f1498c8d91caab3770c95bb62c56d`, clean branch
`feature/isolated-native-acceptance-actions`, Draft #27 targeting main. Main remains
`04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e`; no develop commits are promoted.
This follow-up supersedes implementation-status statements in the
[security review](isolated-native-acceptance-review.md), preserving that report and
its evidence as history. The seven R1–R7 protections remain covered by regression
checks; public-bootstrap and comparison gaps now have explicit implementations
and gates, rather than fabricated native results.

**Verdict: PARTIAL.** Locally testable improvements are reviewable. All six native
application targets are NOT RUN; no merge, activation, dispatch or publication is
authorized. `reviewed.json` is unchanged: executionEnabled false, both historical
slots null. There are no publicBootstrapApprovals in that file.

## Timeout, cancellation and cleanup (N3)

[ProcessAudit](../../tests/native-acceptance/native-host.mjs) now has injectable
host operations for deterministic unit tests. Production defaults are not replaced
by unit backends in the workflow. Timeout, explicit AbortSignal cancellation and
scenario interruption share one termination promise. Returning from a command
requires both that promise and child **close**, not merely exit: inherited pipes
can outlive the original child. Missing close reaches a bounded drain deadline;
termination/drain failure poisons further audit operations instead of claiming PASS.

Concurrent stop calls join one operation; starting new commands during cleanup is
rejected. Finalization shares one promise, drains outstanding command promises and
checks owned live processes, unattributed processes and new zombies before removal.
Repeated finalization preserves the same success/failure. A future identity-bound
backend must itself guarantee bounded calls; the current native backend rejects
immediately, so it cannot hang in an unsupported termination primitive.

[cleanupOwned](../../tests/native-acceptance/cleanup.mjs) provides a shared whole-cleanup
barrier per report: finish audit → dispose harness/services → remove owned root →
confirm service close. No audit means BLOCKED and no directory deletion. A failed
initial census creates no sampling timer and is attributed to preparation. Cleanup
has its own failure reason and records whether removal actually completed, without
overwriting an earlier install/update failure. Receipt persistence errors are
attributed to the active scenario. Failed terminal persistence still means missing
usable evidence and a failed job, never acceptance.

The command cancellation interface is tested, not a guarantee that a force-killed
GitHub runner executes JavaScript finally blocks. Hard job cancellation and host
loss remain native acceptance requirements. No application is launched by local tests.

## Process termination (N2): unsafe fallback removed, native backend blocked

No `taskkill /T`, PID-only kill or PPID-only termination remains. Descendant selection
retains PID/birth identities after detachment, rejects ambiguous parent birth order,
and checks current identity before asking a termination backend. That check is only
defense in depth; it does not close a check-to-signal race.

The default `nativeTerminate` throws `NATIVE_IDENTITY_TERMINATOR_UNVERIFIED` on every
platform. A successful termination attempt is never substituted for a final census
or stream drain. Deterministic tests exercise atomic-backend **contracts**, not an
implemented native backend. Even changing executionEnabled would not satisfy this gate.

| Platform | Required native implementation/evidence | Status |
| --- | --- | --- |
| Linux x64/arm64 | Acquire pidfd while establishing a verified birth identity; use the same handle for signal/liveness; prove permission failures, rapid reuse, detached npm children, exec and reparenting. Node's portable kill API is insufficient. | BLOCKED / native tests NOT RUN |
| Windows x64/arm64 | Open a process handle with minimal rights, verify creation identity against that handle, terminate that object only. Enumerate/revalidate descendants individually; no `/T` traversal. Test handle races, inaccessible processes and native binaries. | BLOCKED / native tests NOT RUN |
| macOS x64/arm64 | Justify an identity-bound mechanism or containment/ownership design under ordinary privileges. ps lstart has second precision and kill(pid) is racy; do not infer Linux/Windows handle guarantees. | BLOCKED / native tests NOT RUN |

All platforms must distinguish owned live children, unattributed new processes,
pre-existing host zombies and new zombies. Never signal PID 1 or an unrelated process.
New unexplained zombies block cleanup; native acceptance needs parent/creation/exit
and reaping evidence. Process polling is not process containment or a filesystem/
network sandbox. No host policy or sandbox configuration is changed.

## Explicit baseline/candidate comparison

[compare.mjs](../../tests/native-acceptance/compare.mjs) is an offline stage, also
wired as a separate job in the existing manual workflow. Each target receives only
its same-run, same-attempt baseline and candidate artifacts, using pinned official
`actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093` (v4; pinned
action metadata, TypeScript download path and package manifest reviewed; no external repository/run/token inputs). It checks out only the
workflow revision and executes no application source. Maximum six comparison jobs,
one at a time, five minutes each; contents: read and three-day JSON retention remain.
The closed plan emits no matrix/targets, so this adds no execution today.

Role receipts use **schemaVersion 2**, adding the fixed repository identity and
preparation scenario. Old v1 receipts are rejected, not silently upgraded. Every
receipt is bounded/closed-schema validated, then bound to expected role, target,
architecture, application SHA and workflow SHA. Node/OS/image must agree across
roles before equivalence/regression attribution. Unknown or mismatched evidence
cannot pass. These are trusted-runner observations, not cryptographic attestation.

An individual role never marks its own comparison row PASS. If all other mandatory
scenarios and cleanup pass, it records BLOCKED/AWAITING_COMPARISON with that row
NOT RUN. Only this exact validated completion state returns zero from the role
process so the explicit comparison job can decide the workflow result. All other
blocked, missing or failed states return nonzero. A role job's success is not an
overall native verdict. The comparator produces its own closed structured receipt:

- Repository, target, architecture, workflow/baseline/candidate SHAs.
- SHA-256 of canonical JSON for both validated inputs (not the raw artifact bytes).
- Ordered scenario results, environment and role-envelope checks.
- Comparisons of ordered semantic observations: metadata versions/tag/runtime/profile mode,
  generated launcher name/profile mode, observed GUI/profile mode, interruption
  lock/stage counts. Random temporary paths/PIDs are not compared for equality.
- PASS only if every mandatory assertion, cleanup and required observation is present
  and equivalent. Missing/blocked/skipped checks remain BLOCKED; mismatches FAIL.

Known candidate application assertions against a passing baseline are classified
as **potential** application regressions only with equivalent environments. Matching
failures are shared baseline evidence; prerequisite failures and environment
mismatches are blockers. Unknown failure causes remain insufficient evidence.
A different observation is a difference requiring investigation, not proof of causality.
The compared fields do not prove pixel-level GUI equivalence or every observable
output; native reviewers must inspect scenario receipts and remaining scope limits.

CLI reproduction with real authorized receipts (not executed here):

```sh
GITHUB_WORKFLOW_SHA=<reviewed-full-sha> node tests/native-acceptance/compare.mjs \
  comparison-input/baseline comparison-input/candidate linux-x64 comparison.json
```

Invalid/missing inputs fail before producing a success receipt. Only comparison.json
is uploaded. Each input directory must contain exactly native.json. The artifact
reader now uses a bounded file descriptor read with pre/post checks; no unbounded
read follows a size stat. Same-account malicious mutation during later upload still
requires a stronger evidence boundary; this change is not an authenticity claim.

## Separate public bootstrap coverage

[bootstrap.mjs](../../tests/native-acceptance/bootstrap.mjs) validates and invokes
actual approved public RC entrypoint bytes, not a locally synthesized prepared
manager command. It has its own execution gate and separate per-role/per-platform
publication approvals; neither historical candidates nor unit fixtures grant them.
A future approval contains exact SHA, tag, release ID, entry/JSON/TSV/source SHA-256,
source size and a human approval reference. The tag must point to the application
commit and the public release must be non-draft. Annotated tags need separate review.

| Boundary | Implementation / native assertions | Current state |
| --- | --- | --- |
| Public resolution | Fixed GitHub repository, exact release ID and tag commit; bounded anonymous HTTPS reads and restricted redirect hosts | Unit-tested; public execution blocked |
| Manifest integrity | Pinned JSON/TSV bytes, six-platform map and JSON/TSV consistency, selected tuple, canonical source/runtime URL and hashes | Unit-tested; no synthetic manifest counts as public evidence |
| Public entrypoint | Download original install-rc.sh/ps1, verify pinned bytes, invoke bash or PowerShell -File with explicit RC tag and owned installation root | Implemented; NOT RUN |
| Runtime provisioning | Original public script fetches/checks official Node runtime; then installed runtime digest/version and full installed Git source are checked | Wired to real driver; NOT RUN |
| Engine / automatic GUI / launcher | Original script invokes its released manager; driver verifies installed source, visible owned window/profile, then generated launcher | Wired; NOT RUN, native backend/profile blockers apply |
| Uninstall preservation | Existing wrapper, retained generations/profile hashes and user sentinel | Wired; NOT RUN |
| Update / rollback | Separate historical lifecycle path and retained manager assertions; not attributed to bootstrap testing | Approval/profile blocked |

A bootstrap may internally invoke --prepared after public downloads; that is the
real released script behavior. Direct harness --prepared installs do not satisfy
this scenario. Failure receipts preserve which bootstrap stage failed and leave
later stages NOT RUN. No published assets are modified or test releases created.

The approved application baseline is published RC3 at
`17202c5964d9282efd4a1991c548612287c65dbb`, release 438958111, but public-bootstrap
execution approval is still absent. Candidate
`e7f8feb5185d4d64c23ace6a904b637c726b97ff` has the same version and no matching
published release. Reusing RC3 assets would test the wrong source: candidate public
bootstrap remains BLOCKED. This task does not authorize creating that release.

The stable scripts inspected at v1.0.0 resolve `https://siaas.vercel.app/api/downloads`
inside the script without a historical SHA selector. Exact-revision execution is
blocked by `UNPINNED_STABLE_BOOTSTRAP_RESOLUTION`. A pre/post check of mutable
resolution does not prevent executing an unapproved intermediate result. Do not
patch the public script or route to a fake server and claim public acceptance.
Stable coverage needs an explicitly reviewed resolution/trust strategy, not a new
production feature in this PR. Windows bootstrap PROCESSOR_ARCHITECTURE is derived only after Node architecture
and OS machine identity agree with the target; inherited emulation flags are removed.
This mapping is unit-tested, but its native Windows behavior remains NOT RUN.

## Historical candidates — documentation only, not approvals

Read-only GitHub release/ref/Contents observations, 2026-11-13:

| Candidate / exact SHA | Provenance/version | Static compatibility / expected transition | Risks and approval state |
| --- | --- | --- | --- |
| `1bce852cabbefb2459aeafc5aa42146eabd6283b` | Public stable v1.0.0, release 421455029, direct commit tag; package 1.0.0, Node 24.22.0 | Source manager accepts prepared manifest; current.json/previous/runtime and retained dispatcher. Separate stable installation beside RC candidate; do not present parallel installation as an update. | No RC profile by default; native appData/SIAAS. Electron 44.5.1, different lock. NOT APPROVED. |
| `84a1ffab4e5f339519bc80844d88ddcd573f561f` | Public v1.1.0-rc.2 prerelease, release 426735035, direct commit tag; package 1.1.0-rc.2, Node 24.22.0 | Manager has RC root/profile/launcher, --prepared/--manifest, retained generation/runtime/dispatcher. Genuine RC2 → RC3 engine update → RC2 rollback. | Electron 44.9.3, different lock; own profile proof and version-specific dependencies required. Data migration compatibility is not proven by source inspection. NOT APPROVED. |
| `17202c5964d9282efd4a1991c548612287c65dbb` | Public v1.1.0-rc.3, release 438958111 | Already the baseline; useful public-bootstrap provenance only | Same version as candidate: not a genuine update predecessor. No extra approval inferred. |

Source-manager SHA-256: stable
`79ee04a43f70cb8439f7ffef0b3264a29e2d602ecf6c81aeb11df013cd251afd`;
RC2 `7cdf5d24dc8808464562be419bf9ff4ca06a4e41ac0a1612e4642f1a7b2e680c`.
Lockfile SHA-256: stable
`175c8c25db0a0126705547faa0bb3a5ded5d7b30adf2343b2318cb868fd8b004`;
RC2 `0e791bf0c19592f87de694d3829612bc184a3fd99c6342224cac239d77a9f808`.
These sources were read, not executed. The harness still requires approval and a
native profile proof for each historical SHA before its manager can run.

## Per-platform profile acceptance prerequisites (N1)

For every generation, capture separately: filtered environment values; Node
os.homedir(); native home/appData/known-folder queries; actual Personal
app.getPath('userData'); generated launcher destination/content; and actual writes.
The generic Electron probe is only preflight. A directory/string match or SQLite
existence alone cannot prove exclusive application writes. OS-native observation
must demonstrate no write to real profiles, installations or launcher locations.

| Target | Native observations and expected disposable destination | Status |
| --- | --- | --- |
| Linux x64/arm64 | HOME/XDG versus Node homedir and Electron appData. RC: owned install/profile and launch-rc.sh. Stable: observed native appData/SIAAS plus owned HOME/.local/share/applications/siaas-personal.desktop. Verify X11/sandbox and real launcher environment; file-write monitoring must cover the complete process tree. | NOT RUN; isolation unverified |
| Windows x64/arm64 | USERPROFILE/APPDATA/LOCALAPPDATA versus native known folders (including RoamingAppData/LocalAppData/Programs), Node homedir, actual Electron userData and shell destination. RC launch-rc.cmd; stable SIAAS Personal.cmd in observed Programs destination. Junction/reparse, process architecture and GUI/session tests required. Overrides alone are insufficient. | BLOCKED pending native proof |
| macOS x64/arm64 | HOME versus native account home, Application Support and actual Electron userData. RC launch-rc.sh; stable owned HOME/Applications/SIAAS Personal.command, with shell execution distinguished from Finder. System Events, quarantine, symlinks and sandbox remain intact; arm64 must not use Rosetta. | BLOCKED pending native proof |

No temporary user/account, elevation, known-folder rewrite, OS-policy change or
production profile override is used to make these checks pass. Historical probes
are still missing. Unsupported isolation must stop before installation. Native
write monitoring and Finder/Start-menu/Electron update-confirmation acceptance
remain outside the locally demonstrated results.

## Validation and remaining gates

Reproduce locally with existing dependencies and Node 24.22.0:

```sh
node --test --test-timeout=5000 tests/native-acceptance/test/*.test.mjs
node tests/native-acceptance/validate-static.mjs
git diff --check
```

The original 56 tests passed before changes. Final local suite: **105/105 PASS**,
zero failures/skips. Static validation passed for 21 JavaScript modules, four Bash
blocks, ten platform selections, four vendored helper hashes and 21 local links.
New tests cover timeout/cancellation,
close versus exit, concurrent/repeated cleanup, initialization and partial failures,
PID reuse and unsupported native termination, structured comparison identities and
negative evidence, public-manifest integrity and public-entrypoint invocation via
spies. Synthetic positive fixtures are labeled as such; no native PASS is inferred.
[Completion evidence](../evidence/isolated-native-acceptance/completion-validation.json)
records final counts, commands and file hashes.

One development test initially stalled because a fixture changed its backend copy
instead of the audit backend. It was corrected; subsequent runs use a five-second
test timeout. The owned stalled Node test child was terminated via a Linux pidfd;
its Node parent reaped it. The outer executor shell became a zombie adopted by
host PID 1 (PID 4460 at observation). This is a local test/executor reaping limitation,
not an application regression or proof of full cleanup. No zombie was signaled;
no host policy was changed. Native acceptance remains NOT RUN.

Before execution: approve historical/public revision tuples; implement and accept
identity-bound termination and real profile/write isolation; resolve candidate
publication and stable bootstrap strategy; verify Actions/runner/quota/policy;
review exact workflow revisions and authorize protected integration and dispatch
separately. No current change grants any of these approvals.
