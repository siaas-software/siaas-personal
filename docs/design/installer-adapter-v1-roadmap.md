# Installer adapter v1 compatibility, implementation and acceptance

Proposal only; depends on the [contract](installer-adapter-v1.md) and
[separation audit](../audits/personal-cli-separation.md). No application implementation,
release change or standalone CLI modification is part of this PR.

## RC3 compatibility

Baseline develop and published `v1.1.0-rc.3` both identify
`17202c5964d9282efd4a1991c548612287c65dbb`. RC3's distribution manifest schemaVersion=1
is an **artifact schema**, not installer-adapter protocol v1. Do not infer capabilities
from version strings, a source-manager filename or the presence of `--prepared`.

| Requirement | RC3 evidence / limitation | Future v1 action |
| --- | --- | --- |
| Install-only | source-manager:327–328 emits completion then launches on new installation | Separate activation from launch; no GUI in adapter path |
| Explicit paths | install root environment; launcher inferred at 83–103, candidate profile at 294 | Validate explicit root/launcher/profile and ownership |
| Stable/candidate isolation | RC scripts choose separate defaults; supplied root can override; profile preserved | Channel identity and collision rejection, including canonical path aliases |
| Completion receipt | Progress prefix/stdout and exit 1, not transactional JSON | Durable receipt/journal and structured codes |
| Prepared inputs | source.zip rehashed at 227–243, runtime separately provisioned | Verified runtime/source/manifest plus enforceable build policy |
| Idempotency | runtime-only same-version path 213–217 | Installed application manifest and integrity verification |
| Recovery | current.json rename and limited exception compensation 316–330 | Power-loss journal, recoverable launcher registration and interrupted receipt handling |
| Rollback | previous/current toggle, data migrations explicitly not reversed | Explicit generation and schema compatibility check |
| Discovery/rejection | No protocol/capabilities; ad hoc argv parsing | Integrity-covered descriptor and strict capability negotiation |

RC3 remains supported through its existing manually chosen Personal installers. CLI M2
must report UNSUPPORTED_CAPABILITY for v1 install-only against RC3, with a clear reference
to the manual installer option; it must not automatically run RC3, append ignored flags,
patch the downloaded manager, or synthesize an activated receipt from its output.
Existing RC2/RC3/stable assets and tags remain immutable. Only a future reviewed Personal
release can advertise the adapter. No particular future version number is promised.

Legacy wrappers should call the refactored engine with their established defaults and
explicit legacy launch behavior. Preserve current environment variables, stable discovery,
RC explicit selection, Electron confirmation and old on-disk dispatcher/manager matching.
Do not change default userData (`SIAAS`) merely to match product branding. Existing
installations require explicit, verified adoption before adapter management; support can
be deferred with a precise rejection, but never silently overwrite old registrations.
Do not deploy a global dispatcher that old retained generations cannot interpret.

## Implementation sequence and dependencies

| Stage | Owner / prerequisite | Deliverable and acceptance criterion |
| --- | --- | --- |
| 0. Review contract | Personal + CLI maintainers | Agree schemas, states, ownership, M2 unsupported behavior, policy enforcement feasibility and per-platform support. Versioned JSON Schemas, golden requests/receipts and rejection vectors published in Personal documentation before integration. |
| 1. Extract engine | Personal; stage 0 | Internal library under existing source-manager and wrappers, no behavior change. Existing installer/distribution/product tests pass; stable/RC/manual/Electron behavior preserved. No CLI parser/product resolution copied into engine. |
| 2. Safe discovery/validation | Personal; 1 | Offline read-only descriptor/capabilities; closed schema and exact path/channel/ownership checks; rejection happens before mutation. Future CLI can build its mock adapter client independently. |
| 3. Trusted prepare/install-only | Personal; 2 and enforceable build policy | Verified archive extraction, runtime/toolchain/lockfile validation, bounded build with consented downloads, no app/backend/service launch. Fault injection proves prior installation unchanged on build failure. |
| 4. Integrity/transactions | Personal; 3 | Installed manifest, journal, locks, generation CAS, commit/activate/recover/rollback and durable receipts. Crash at every mutation/flush/rename boundary converges or fails safely; no premature garbage collection. |
| 5. Platform and compatibility gates | Personal; 4 | Native Windows/macOS/Linux runs, concurrent isolation and legacy wrapper regression tests. Unsupported targets advertise no capability. Review code signing/quarantine/ACL behavior without bypass. |
| 6. CLI M2 integration | Separate CLI work, not this PR; 0 allows mocks, real install requires 5 | CLI resolves/verifies artifacts and descriptor, negotiates v1, passes explicit request and consent, maps errors and replays inspect after uncertain termination. RC3 rejected; no duplicate install engine. |
| 7. Future Personal release | Separate authorization; 5 and integration evidence | Release descriptor bound to immutable source inventory; compatible installer adapter declared per target. Existing released assets untouched; no release authorization from this document. |

Do not require draft #20 or #21 to merge. Reuse reviewed findings where appropriate;
#20 infrastructure and #21 lifecycle proposal have independent scopes. Future removal
work is justified only by new reachability/consumer evidence, not the presence of “CLI”
in names. The present audit recommends no application code deletion.

## Cross-platform conformance matrix

Every row is a required future test, **not run/PASS evidence in this documentation PR**.
Run portable fixtures on all advertised targets and native filesystem/process checks on
the actual OS. Matrix targets: Linux x64/arm64, Windows x64/arm64, macOS x64/arm64.
RC3 manifest coverage for six targets does not establish build/native acceptance.
An untested target MUST remain undiscovered/unsupported for adapter v1.

| Test group | Portable/fault fixtures | Linux native | Windows native | macOS native |
| --- | --- | --- | --- | --- |
| Protocol/discovery | Unknown versions/keys/capabilities, malformed JSON, duplicate keys, missing inputs; assert no writes/network | Executable path/permissions | Unicode argv, PowerShell caller, no cmd injection | Spaces/Unicode and translated-process architecture |
| Input integrity | Corrupt source/runtime/manifest, version/commit mismatch, substitution during copy, zip traversal/bomb/symlink | Ownership/modes, symlink races | Junction/reparse, case aliases, reserved names, ACLs | Case-folding/normalization, links, quarantine |
| Build trust | Lifecycle network attempt outside policy denied; absent cached binary fails; token/env canary never reaches child/log | Containment enforcement; no GUI with DISPLAY present | Job/process containment; no Electron/backend child | Containment and signing/quarantine preserved |
| Isolation | Stable + candidate concurrent installs; roots/launchers/profiles collide through aliases; no shared registration | Desktop entry quoting and owner lock | Start Menu/cmd escaping and profile locks | .command/app paths and profile locks |
| Idempotency | Identical retry/new operation, conflicting operationId, edited/missing app file/runtime/npm/launcher | File types/modes verified | Locked files/ACL integrity | Bundle files/signature policy |
| Recovery | Kill before/after each journal write/rename/pointer/launcher/receipt; corrupt/truncated journal; full disk | fsync/rename and separate launcher volume | Power loss/rename failure/AV sharing violations | Cross-volume registration and atomic rename behavior |
| Rollback | Explicit old target twice, missing old runtime, schema incompatible/unknown; never restore user data | Running app BUSY | PID reuse/file locks, no forced kill | Running app and bundle replacement |
| Receipts/errors | stdout single JSON; child output isolated; receipt denial after activation; inspect after EOF | SIGTERM/SIGKILL distinction | Console termination/child cancellation | Signals and cancellation |
| Legacy compatibility | Existing scripts, explicit RC tag, stable resolver, dispatcher and retained manager; no fake v1 support for RC3 | Bash manual install/launch | PowerShell manual install/launch | Bash/manual launch |
| Installed acceptance | Full tree verification; launch deliberately separate from install-only | Electron sandbox stays enabled | Native launch/profile identity | Native launch/profile identity |

Native launch is separate acceptance work after install-only completes; core adapter tests
must prove zero launch. Real Ollama inference/model acceptance is a separate product gate,
not a dependency for validating installer receipts. No --no-sandbox, TLS disabling,
Actions enablement or forced process termination is allowed to turn failures into PASS.

## Open risks and decisions

- Enforceable build network/process isolation is a real implementation dependency. Agree
  supported mechanisms on each OS; otherwise fail policy unavailable. A list of domains
  or `npm ci` alone is not sufficient, and changing npm script execution may change builds.
- Decide exact installed-manifest coverage and protect records without claiming resistance
  to a malicious same-user principal. Local build outputs may differ by host/toolchain.
- Define filesystem durability guarantees and native launcher ownership/locking. A pointer
  and external launcher cannot share one atomic rename; journal recovery is mandatory.
- Define read-only profile-schema compatibility metadata before rollback after GUI use.
  Missing compatibility data means rejection, not unsafe data downgrade.
- Decide whether later releases support adoption of existing source/native installations,
  offline builds or profile restore; all are explicitly unsupported until separately tested.
- CLI M2 implementation was not audited here. Coordinate request/error schemas with its
  maintainers; the proposal unblocks design and mocks, not installation of RC3 through CLI.

## Documentation validation

Validate local Markdown links, pinned source line bounds, JSON examples, referenced paths,
consistent protocol/state/operation names and documentation-only diff. Run `git diff --check`.
Do not run installation/build/native tests just to validate these documents; no implementation
conformance is claimed. Keep English engineering prose per the repository language policy.

Checks executed for this proposal: 6 local Markdown links resolved, 16 pinned source
line anchors checked against the inspected commit, and 3 JSON examples parsed.
`git diff --check` passed. The pinned PR #21 document was read through GitHub at its
recorded head; its proposal was not copied into develop or treated as implemented.
No dependencies, application files, workflows, tests or historical reports changed.
