# Installer adapter v1 compatibility, implementation and acceptance

Normative design under review; **implementation readiness: BLOCKED**. Depends on the [contract](installer-adapter-v1.md) and
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
| Rollback | previous/current toggle, data migrations explicitly not reversed | Outside minimum v1; future negotiated capability needs explicit generation and read-only schema compatibility |
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

## Implementation sequence and stage gates

Schemas/fixtures below are delivered design artifacts. Passing schema validation does
not satisfy native enforcement or transaction gates. No target is implementation READY.
Research prototypes and protocol mocks can proceed after review, but cannot advertise
support or install into existing user environments. Stages must preserve the audit's
ownership split and never introduce a second installation engine into standalone CLI.

| Gate / preconditions | Deliverables | Required tests / native acceptance | Security blockers and exit criterion |
| --- | --- | --- | --- |
| G0 Contract review; existing audit preserved | Versioned schemas, golden fixtures, error/state semantics; maintainers agree minimum and deferred lifecycle | Validate every schema/fixture; parser rejection; consistency; no native claims | Cross-field rules and ownership review accepted; design artifacts PASS alone does not establish implementation readiness |
| G1 Enforcement feasibility; G0 | OS backend decision and threat model for each advertised OS/arch; mediated download/exec/environment policy | Native hostile lifecycle-script probes, direct egress/proxy escape, child escape, GUI/backend launch, credentials and write escape canaries | BLOCKER on all six targets; exit only with evidence the backend enforces requirements without relaxing security |
| G2 Transaction feasibility; G0 | Journal/lock/flush/launcher protocol and native filesystem support list | Native crash/power-loss simulation at every intent, rename, flush, pointer/launcher/gate/receipt boundary; CAS and PID reuse | BLOCKER on all six targets; exit only after durable recovery and safe ownership/quiescence are justified on supported volumes |
| G3 Engine extraction; G1/G2 accepted for intended targets | Shared Personal engine and legacy wrappers, unchanged old behavior; no CLI product parser | Existing stable/RC/source-manager/Electron confirmation and profile tests; native Bash/PowerShell/manual launch paths | Fail on data/launcher/default changes; exit with backwards-compatibility evidence and no automatic adoption |
| G4 Adapter implementation; G3 | Discovery, strict request validation, bounded verified prepare, commit/activate/install/inspect/recover, integrity metadata and receipts | Portable semantic scenarios plus G1/G2 native probes per target; fail closed on unavailable backend; schema response conformance | Unknown fields/caps rejected before writes; zero app launch; verified retry/recovery at every boundary; no unverified target advertised |
| G5 Integration acceptance; G4 | Personal release descriptor/inventory binding and CLI mock/interoperability evidence in separately authorized CLI work | RC3 rejected; verified future descriptor negotiated; cancellation/EOF/receipt failure handled; stable/candidate concurrency on each native target | No duplicate engine, silent legacy fallback or profile mutation; native matrix completed for advertised targets |
| G6 Release decision; G5 and separate authorization | Future immutable Personal release declaring only accepted capabilities/targets | Release/source digest verification and fresh end-to-end native install-only evidence | Existing RC2/RC3/stable untouched; no release authority from this document |

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
| Recovery compensation | Restore only interrupted transaction; refuse after activated completion; never restore user data | Running app BUSY; recover gate | PID reuse/file locks, no forced kill | Running app and bundle replacement |
| Receipts/errors | stdout single JSON; child output isolated; receipt denial after activation; inspect after EOF | SIGTERM/SIGKILL distinction | Console termination/child cancellation | Signals and cancellation |
| Legacy compatibility | Existing scripts, explicit RC tag, stable resolver, dispatcher and retained manager; no fake v1 support for RC3 | Bash manual install/launch | PowerShell manual install/launch | Bash/manual launch |
| Installed acceptance | Full tree verification; launch deliberately separate from install-only | Electron sandbox stays enabled | Native launch/profile identity | Native launch/profile identity |

Native launch is separate acceptance work after install-only completes; core adapter tests
must prove zero launch. Real Ollama inference/model acceptance is a separate product gate,
not a dependency for validating installer receipts. No --no-sandbox, TLS disabling,
Actions enablement or forced process termination is allowed to turn failures into PASS.

## Issue register and readiness verdict

| ID | Classification | Scope / evidence / disposition |
| --- | --- | --- |
| B1 | BLOCKER | Linux x64/arm64: namespace/cgroup/broker design plausible but no implementation or hostile-build acceptance; system availability is not assumed. G1 required. |
| B2 | BLOCKER | Windows x64/arm64: Job Objects alone do not enforce network/filesystem policy; restricted token/AppContainer/broker compatibility with build tools, ACL/handle and child escape tests absent. G1 required. |
| B3 | BLOCKER | macOS x64/arm64: supported sandbox/helper or VM strategy unresolved; no reliance on deprecated/private sandbox tooling; signing/quarantine/native architecture acceptance absent. G1 required. |
| B4 | BLOCKER | All six: native flush/rename/registration/gate durability, locking, symlink/junction race resistance, quiescence and power-loss recovery unverified. G2 required. |
| B5 | BLOCKER | All six: release build policy must enumerate authenticated dependency/tool downloads, allowed exec actions and resource limits and prove enforcement. An allowlist file/consent ID is insufficient. |
| B6 | BLOCKER | All six: engine extraction and adapter not implemented; semantic scenarios and schema equality/ownership rules need executable conformance after G1/G2. Schema fixtures are not runtime tests. |
| D1 | DEFERRED | Application rollback needs separate negotiation, retained-generation integrity, explicit target, quiescence and read-only profile-schema compatibility. v1 rejects it; does not block the minimum installation scope. |
| D2 | DEFERRED | GUI startup, stop/restart, uninstall, profile migration/restore and legacy adoption are separate contracts. Existing manual workflows remain. |
| D3 | DEFERRED | Offline builds, cross-build/native installer consumption, network-share storage and automatic garbage collection are unsupported v1. |
| A1 | ACCEPTED LIMITATION | Same-user ownership/hashes detect drift; cannot defend against an administrator or malicious same-user rewriting both content and records. No remote attestation or bit-reproducible build claim. |
| A2 | ACCEPTED LIMITATION | RC3 has no adapter protocol. CLI M2 may develop mocks, but must reject v1 installation against RC3. |
| A3 | ACCEPTED LIMITATION | Application and launcher activation spans multiple writes/volumes. Journal+gate recovery, not a single atomic filesystem transaction. |
| A4 | ACCEPTED LIMITATION | This PR tests schemas/parser fixtures only. No native containment, installation, power-loss or application acceptance was run. |

Readiness is **BLOCKED for implementation on every target** until G1/G2 mechanisms
and acceptance strategy are demonstrated and reviewed; subsequent G3–G5 implementation
and conformance must pass before release support. The contract is sufficiently concrete
for review, protocol mocks and isolated feasibility experiments, not a claim of a safe
installer. Targets may later graduate individually, with unavailable ones explicitly blocked.

## Validation evidence

The original proposal at f4bd118 checked 6 local links, 16 pinned source anchors and
3 JSON examples. That historical result remains scoped to the original revision.
The consolidation adds [reproducible validation](installer-adapter-v1/validation.md),
8 Draft 2020-12 schemas and 89 golden fixtures: 48 valid, 29 schema-negative and
12 malformed/limit/parser-negative. All pass the expected acceptance/rejection outcome
with Python jsonschema 4.26.0. Twelve semantic scenarios are explicitly NOT RUN pending
implementation/native acceptance; they are not included in the 89 passing fixture count.
PASS: 27 local Markdown links resolved; operation/capability/error-code terminology and
fixture-index completeness checked; `git diff --check` passed.
The completed separation audit is byte-preserved; no repeat audit or new removal claim.
