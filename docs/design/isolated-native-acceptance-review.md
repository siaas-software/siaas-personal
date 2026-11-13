# PR #27 security and acceptance review

Historical review snapshot at `ee3644a09c0f1498c8d91caab3770c95bb62c56d`.
Current implementation status: [harness completion](native-acceptance-harness-completion.md).

**Verdict: PARTIAL.** The corrections are ready for infrastructure review only.
Native acceptance, merge and execution are not authorized or established.
`executionEnabled` remains false; historical approvals remain null. No application,
installer, package, policy, existing release workflow, tag or other PR is changed.

## Inspected state and evidence

Repository: `siaas-software/siaas-personal`, default/base `main`. PR #27 is OPEN,
Draft, branch `feature/isolated-native-acceptance-actions`. Review input HEAD:
`a68cf60ee8b04c234f0ad524907009f21eb26ea9`, initially clean, 19 added files.
Main: `04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e`;
develop/application baseline: `17202c5964d9282efd4a1991c548612287c65dbb`.
PR #25 remains `e7f8feb5185d4d64c23ace6a904b637c726b97ff`;
PR #26 remains `aed0af7920cfeedc37a6a7dcbf272bf8561da0c8`.
PR #20/#21/#23/#24/#25/#26 HEADs and update timestamps were read without mutation.
The four vendored helpers were compared byte-for-byte with GitHub Contents at
PR #20 `1496298a6619708e56bba1b1a2d08c0b542b2d80`, including SHA-256 checks.
Local PR20 objects were unavailable; the read-only GitHub comparison supplied the evidence.

The original 34 harness tests passed. Eight focused repro tests on the unmodified
implementation produced seven failures and one pass: historical manager selection,
final live-process detection, recycled-parent attribution, three wrongly accepted
cleanup scalar types, and string PID acceptance failed; object cleanup types were
already rejected. These are synthetic infrastructure tests, not native execution.

Commands (Node 24.22.0, Linux x64):

```sh
node --test tests/native-acceptance/test/*.test.mjs
node tests/native-acceptance/validate-static.mjs
git diff --check
```

After corrections: **56/56 local harness tests PASS**, zero skipped; static YAML,
permissions, pins, ten platform selections, three shell blocks, 15 JavaScript modules,
four helper hashes and 12 local links PASS. No native application test was run.

Current results and file hashes: [review validation](../evidence/isolated-native-acceptance/review-validation.json).
[Original validation](../evidence/isolated-native-acceptance/validation.json) is
preserved as the initial snapshot; its hashes are not current-tree assertions.

## Confirmed findings and smallest corrections

Locations refer to the corrected files/functions; the review-input SHA above retains
all original implementations. Severity describes potential enabled execution, not
an exploit or native run observed with the closed gate.

| ID / severity | Exact location | Supporting evidence / confirmed defect | Correction and local validation |
| --- | --- | --- | --- |
| R1 High | `tests/native-acceptance/driver.mjs:100` / `:105`; `tests/native-acceptance/lifecycle.mjs:38` | Every install previously selected `trees.target/scripts/source-manager.mjs`, even when seeding a historical generation. A command spy reproduced the wrong path. This did not establish old-manager metadata/dispatcher creation. | Seed with the generation's own manager and cwd; update with the tested manager. Verify old installed source before update. Routing regression test checks both command paths. Historical native execution remains blocked. |
| R2 High | `tests/native-acceptance/native-host.mjs:141`, `ProcessAudit.finish` | A final sample containing an owned live process returned success if no unattributed process/zombie existed. Reproduced with an injected final sample. | Reject/record `OWNED_LIVE_REMAINS` before directory disposal. Tests cover late live processes, unattributed processes, zombies and a clear sample. |
| R3 High | `tests/native-acceptance/native-host.mjs:53` / `:58` | PPID alone adopted a child born before a recycled owned parent. Synthetic PID 42/birth 900 with child 43/birth 800 reproduced unsafe attribution. | Require strictly newer child creation time. Equal/unparseable times are left unattributed, not signaled. Numeric, Windows ISO and macOS ps timestamp fixtures test ordering. This is not native PID-race acceptance. |
| R4 High | `tests/native-acceptance/evidence.mjs:12`, `validateReport` | Generic scalar validation accepted `removed: "false"`, `"true"`, `1`, and string PIDs; truthiness could satisfy PASS. | Require boolean removal, integer PIDs, typed observation/process fields and strict reason codes; reject unresolved terminal process events in PASS. Negative tests reproduce all cases and failed/blocked/not-run scenarios. |
| R5 Medium | `.github/workflows/personal-engine-native-acceptance.yml:112`; `tests/native-acceptance/evidence.mjs:53` | Upload validation trusted the report's own role/target. Another valid role/target report could pass under the current job's artifact name. | Pass expected matrix target/role to the validator; bind target, role, architecture and both SHAs. Local tests reject substitution and absent expected role; static check enforces workflow wiring. |
| R6 High | `tests/native-acceptance/driver.mjs:72` / `:105` | Only target Electron is probed; historical generations could previously install based on that proof. Source inspection/environment strings cannot establish historical native known-folder behavior. Coverage omission is confirmed; actual escape is unverified. | Require a proof keyed to each generation SHA. Target probe supplies only its own proof. Historical proof implementation remains blocked; a test proves rejection occurs before any command. No historical revision was added. |
| R7 High | `tests/native-acceptance/lifecycle.mjs:4`; `tests/native-acceptance/run.mjs:64` | Public bootstrap and cross-job comparison were documented gaps but absent from mandatory receipt rows. All implemented source-manager scenarios could otherwise yield an overbroad PASS. | Add explicit mandatory NOT RUN rows and an incomplete-coverage BLOCKED verdict. Scheduler tests verify those rows remain unset; evidence rejects missing/unfinished rows. No fake bootstrap/comparison result is supplied. |

## Native risks and unresolved implementation limits

These are **blocked for execution**, not claims of observed application regressions.
No native backend or historical approval is introduced by this review.

| ID / severity | Location | Evidence and classification | Minimum next action |
| --- | --- | --- | --- |
| N1 High | `tests/native-acceptance/driver.mjs:72`, `:141`, `:162` | UNVERIFIED native isolation on all six targets. Node homedir and probe appData are checked, but environment variables alone do not redirect Windows/macOS known folders. A SQLite file plus visible window does not prove that the legacy app exclusively used that profile. | Before execution, demonstrate native paths per authorized generation, actual legacy app userData and absence of writes outside owned roots. Block if native default escapes. Preserve sandbox/OS protections. |
| N2 High | `tests/native-acceptance/native-host.mjs:29`, `:123` | UNVERIFIED cleanup safety: POSIX identity-check/signal TOCTOU, second-resolution macOS identities, sampling gaps for detached descendants, and Windows `taskkill /T` traversal beyond individually checked descendants. The R3 ordering fix cannot close these native races. | Review native identity/termination primitives and test detach/reuse/tree changes on each OS. Do not claim only individually verified processes are killed by `/T`; keep execution disabled. |
| N3 Medium | `tests/native-acceptance/native-host.mjs:108`; `tests/native-acceptance/run.mjs:77` | Confirmed asynchronous timeout cleanup is launched without awaiting its promise; overlapping stop/finalization effects have NOT RUN native evidence. If ProcessAudit construction fails, the root cleanup row can also overstate identity checking, although overall run is FAIL. | Add deterministic orchestration tests before changing this sequencing; require one completed termination/drain barrier and truthful per-scenario failure attribution. No speculative native cleanup rewrite in this review. |
| N4 Medium | `tests/native-acceptance/evidence.mjs:73`; `.github/workflows/personal-engine-native-acceptance.yml:120` | UNVERIFIED same-account concurrent mutation between stat/read/validation/upload; a separate validator process is not an authenticity boundary against the tested code's runner account. Existing single-file/type/hash/size checks are not a signature. | Treat application/dependencies as trusted reviewed code, use disposable separate VMs; review bounded descriptor reads and immutable evidence handoff before adversarial integrity claims. Malformed, oversized, linked and extra-file cases are locally rejected. |
| N5 High | `tests/native-acceptance/driver.mjs:41`, `:181`, `:192`; `tests/native-acceptance/lifecycle.mjs:81` | Confirmed acceptance gaps: public bootstrap resolution/download, Finder/Start-menu interaction, Electron update confirmation, full interruption recovery, and baseline/candidate result comparison. No native success is established. | Approve and implement separate genuine bootstrap tests; compare equivalent native results across roles. Preserve explicit NOT RUN/BLOCKED states until those tests exist and execute. |

An unexplained **new** zombie blocks cleanup. Initial host zombies are only a
baseline; their presence is not evidence of an application cleanup regression.
The census records PID, PPID, executable, birth identity and state. Native work must
explain reparenting/PID 1 reaping separately from live owned processes and application
defects. Unit tests classify synthetic rows; no actual zombie cleanup is claimed.
File deletion follows a successful final census; a polling gap still cannot prove
containment. Host/job termination can prevent receipts entirely: missing evidence
must remain NOT RUN/BLOCKED.

## Gate, trust boundary and evidence review

The plan validates fixed repository, hosted/manual/main context, exact full baseline
and candidate SHAs, fixed platform subsets and PREPARATION_ONLY input. The code gate
fails before history lookup, revision network queries or matrix outputs. The runner
has an independent closed gate. A future code change, policy approval and separate
execution authorization are needed; no workflow input enables execution today.

Only workflow_dispatch exists. Permissions are contents: read; checkout credentials
are not persisted. No production secrets, OIDC, publishing/deployment scopes,
automatic triggers or security bypass were added. Official action pins, timeouts,
concurrency, retention and six candidate runner labels are unchanged. Read-only
GitHub observations found zero registered workflows and zero runs, with both
repository rulesets active. Runner access/quota and native sandbox support remain
UNKNOWN/NOT RUN, not inferred from an API permissions error.

Approved SHA membership is necessary but not a sandbox. npm/build scripts can write
and use the network as the runner account. Source/revision and dependency review,
credential exclusion and disposable VMs remain trust prerequisites. Runtime hashes
are checked using the existing official HTTPS checksum boundary; this review adds
no signing/provenance claim or relaxed TLS setting.

Evidence schema version remains 1 because it has never been activated/published;
this revision tightens types and expands required scenarios. The file must be the
sole regular, non-hardlinked `native.json`, no larger than 1 MiB; arrays have 2,000
records maximum, strings 4,096 characters maximum. Pretty-printed output size is
checked too. Raw subprocess output/environments, profiles, binaries and trace
bundles are excluded. SHA-256 review hashes are reproducibility records, not proof
against a malicious same-user artifact writer. Failed/blocked diagnostic JSON may
upload successfully without changing the failed native job's status.

## Source manager versus public bootstrap

Prepared-source tests exercise approved Git archive bytes, a synthetic local
manifest, the manager's runtime/build/activation path, generated launchers and
legacy rollback/uninstall wrappers. They do **not** exercise public download
resolution, published-manifest provenance, public bootstrap runtime provisioning,
or install.sh/install.ps1/install-rc entry-point argument behavior. Wrappers are
selected from the tested target and dispatch into the installed generation; that
is distinct from running each historical wrapper. Historical seeding now uses the
historical manager, but native compatibility is still NOT RUN.

An overall PASS is deliberately unreachable with the current missing public-bootstrap
and comparison rows, even if future approvals supply histories and the code gate
is changed. A future design should distinguish per-role source-manager results,
public-bootstrap results and an explicit combined comparison verdict. This review
adds blockers rather than implementing that unapproved native architecture.

## Platform status and next review sequence

| Platform | Native result | Outstanding evidence |
| --- | --- | --- |
| Linux x64 | NOT RUN | Sandbox/X11, actual profiles, detached processes/PID races, complete lifecycle |
| Linux arm64 | NOT RUN | Same, native architecture/dependencies |
| Windows x64 | NOT RUN | Native known folders, GUI, CIM identity and `/T` safety, wrapper policy |
| Windows arm64 | NOT RUN | Same, native binaries rather than emulation |
| macOS x64 | NOT RUN | Native appData, System Events, birth identity precision, launcher integration |
| macOS arm64 | NOT RUN | Same, no Rosetta |

1. Review these local fixes and unresolved findings while the PR remains Draft.
2. Separately approve historical revisions; complete per-generation profile proofs,
   termination orchestration, bootstrap and cross-role comparison implementation.
3. Review runner/policy/quotas and native test prerequisites. Approve exact workflow
   and application revisions before protected integration or enabling execution.
4. Authorize dispatch separately, obtain six native result sets and investigate
   failures without weakening sandboxing. Only that evidence can support acceptance.

No merge or execution authorization follows from infrastructure review readiness.
