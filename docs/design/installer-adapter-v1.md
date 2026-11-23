# Installer Adapter Contract v1 — normative design

Status: normative design for review, 2026-11-09. **Implementation BLOCKED; not implemented in RC3.**
Schemas are testable design artifacts, not evidence of runtime/platform conformance.
See the [separation audit](../audits/personal-cli-separation.md) and
[compatibility/roadmap](installer-adapter-v1-roadmap.md). “MUST” specifies future
conformance, not existing behavior. This is a local, same-user process protocol,
not a network service, product CLI or arbitrary command execution interface.

## Decision and ownership

Reuse and refactor Personal's source manager into an internal engine with a strict
adapter entry point. Do not fork it into a second CLI installation engine. Preserve
legacy shell/PowerShell and Electron entry points through compatibility wrappers.
CLI owns product resolution, trusted release/commit selection, artifact acquisition
and verification, orchestration and CLI-facing error wording. Personal owns source
extraction, runtime provisioning, dependency build, layout, launcher/profile handling,
activation, integrity checks and local recovery. Personal returns stable error codes;
CLI translates them without hiding partial effects. Either side rejects invalid input.

M2's minimal operation is **install-only**: build and select an installed application
without opening Electron, the backend, a browser, Ollama or research services. “Activated”
means filesystem/launcher selection is consistent, never graphical or service readiness.
No start/stop/doctor/model/research/release commands belong to adapter v1.

## Minimum protocol and scope

Installation produces and retains a verified application generation. Activation selects
that generation and registers its launcher. Startup executes the GUI/backend and may
open user data; it is a separate, explicitly excluded action. Future lifecycle management
includes stop/restart, uninstall, profile migration/restore and adoption. None is a v1
operation. The minimum consists of discovery plus prepare, commit, activate, install,
inspect and recover. Every advertised supported platform MUST implement all seven.

Application rollback is **DEFERRED**, requiring a separately negotiated future protocol
and capability: retained-generation integrity, read-only schema compatibility evidence,
quiescence and explicit user choice. v1 rejects rollback as UNSUPPORTED_CAPABILITY,
including an attempted rollback request; it never falls back to RC3's toggle behavior.
Recovery restore-previous compensates only the still-incomplete transaction while its
activation gate prevents startup. It is not post-startup downgrade or data restoration.

## Normative artifacts and versioning

The [schema directory](installer-adapter-v1/schemas/request.schema.json) contains JSON
Schema Draft 2020-12 documents. Schema IDs use the reserved `schemas.siaas.invalid`
namespace as stable offline identifiers; implementations MUST resolve the local registry,
not fetch schemas over the network. All schema objects are closed. No future response
field is silently accepted in 1.0; new fields require a separately negotiated version.
Protocol is `siaas.personal.installer-adapter`; contractVersion and schemaVersion are
`1.0`. Artifact manifests' schemaVersion=1 in RC3 is unrelated. Discovery descriptors
list supported contract versions; unknown major OR minor is UNSUPPORTED_CONTRACT.

| Artifact | Normative schema | Valid example |
| --- | --- | --- |
| Release descriptor | [descriptor](installer-adapter-v1/schemas/descriptor.schema.json) | [descriptor fixture](installer-adapter-v1/fixtures/valid-descriptor.json) |
| Capability response | [capabilities](installer-adapter-v1/schemas/capabilities.schema.json) | [blocked response](installer-adapter-v1/fixtures/valid-capabilities-blocked.json) |
| Requests | [request](installer-adapter-v1/schemas/request.schema.json) | [install](installer-adapter-v1/fixtures/valid-request-install.json) |
| Completion receipts | [receipt](installer-adapter-v1/schemas/receipt.schema.json) | [failure after activation](installer-adapter-v1/fixtures/valid-receipt-failed-after-activation.json) |
| Errors | [error](installer-adapter-v1/schemas/error.schema.json) | [policy unavailable](installer-adapter-v1/fixtures/valid-error-build_policy_unavailable.json) |
| Installed generation | [integrity](installer-adapter-v1/schemas/integrity.schema.json) | [integrity metadata](installer-adapter-v1/fixtures/valid-integrity.json) |
| Journal record | [journal](installer-adapter-v1/schemas/journal.schema.json) | [initial intent](installer-adapter-v1/fixtures/valid-journal.json) |
| Shared scalar/path definitions | [common](installer-adapter-v1/schemas/common.schema.json) | Used by all dependent schemas |

The schemas define required fields, types, enums and per-operation exclusions; fields
not in `required` are optional (v1 records deliberately use explicit nulls instead).
The prose additionally defines filesystem, provenance, equality and ordering requirements
that JSON Schema cannot express. Fixtures with placeholder hashes demonstrate shape,
not authentic archives. See [validation and semantic obligations](installer-adapter-v1/validation.md).
No schema validation result authorizes execution or establishes ownership.

## Discovery and transport

Proposed future commands (these files/commands do not exist in RC3):

```sh
"/verified/node/bin/node" "/verified/personal/scripts/installer-adapter.mjs" capabilities --json
"/verified/node/bin/node" "/verified/personal/scripts/installer-adapter.mjs" execute --request "/private/install-request.json"
```

Pass argument arrays, never concatenate a shell command. Windows uses verified node.exe
and native absolute paths. CLI MUST verify the external release descriptor, source ZIP,
runtime and extracted adapter/imports before discovery executes code. The descriptor is
an external, integrity-covered sidecar, not embedded in the archive whose digest it
contains (avoids self-hash recursion). Trusted immutable-release metadata binds sidecar,
source digest, target commit/version and policy digest. Sidecar hash alone is not provenance.
Descriptor entryPoint is a safe relative path within verified source; its digest must match.

Discovery is read-only/offline and does not install npm packages, create roots, touch
profiles or run a build. It returns capabilities only after checking the platform's
accepted enforcement backend and matching the verified descriptor. Missing or unaccepted
backend yields availability=blocked, empty operations/capabilities and structured blockers.
A descriptor describes potential support; it does not override local readiness. A malformed
or untrusted descriptor must not be executed. Missing descriptor/entry point means unsupported;
never probe legacy manager with ignored flags or launch it as fallback.

Input, capability output, descriptor, error, request and receipt each have a 65,536-byte
UTF-8 limit, measured before parsing, including whitespace. Reject BOM, invalid UTF-8,
duplicate keys at any nesting, comments, NaN/Infinity, lone Unicode surrogates, trailing content and depth >32.
Integers must fit 0..9007199254740991 (positive where specified). UUIDs are canonical
lowercase RFC 4122 variant/version 4 strings; identities are not authentication tokens.
Digest strings are 64 lowercase hex; commits are 40 lowercase hex. Accepted platform/arch
pairs are linux/win32/darwin × x64/arm64; reject cross-build or translated host ambiguity.
Journal records also have a 64 KiB limit; integrity metadata is bounded to 64 MiB and
100,000 entries, depth 32. Implementations must reject limits, never silently truncate.

stdout contains one response JSON object and a newline, no subprocess output. Progress
and bounded, redacted build logs use stderr (16 MiB total per transaction; truncation is
marked). Secrets, user content and raw exception/environment dumps are prohibited.
Discovery outputs the capability schema, or a standalone structured error for invalid
invocation/unavailable trustworthy identity; execute outputs a receipt. An unparseable request
uses operation=invalid and null identities/paths, never echoes untrusted IDs or writes the
supplied receipt path. Classify unsupported version/capability/platform before generic
schema failure where parsable; otherwise INVALID_REQUEST. Unknown fields fail closed.

## Request semantics and ownership

Every execution request includes protocol/schema/contract version, operation, UUID
operationId and installationId, explicit paths and requiredCapabilities. prepare/install
also require target, expectedGeneration, four prepared file records (source, runtime,
manifest, buildPolicy) and buildConsent. commit/activate/recover require target,
expectedGeneration and transactionId, but reject prepared inputs/consent: those are
persisted and hash-bound to the original transaction. recover additionally requires
recoveryAction=resume or restore-previous. inspect rejects all mutation-only fields.
All requiredCapabilities must be known and currently advertised; none may be ignored.

The target binds Personal product, release commit/version/channel and host platform.
Stable semantic versions cannot contain -rc.N; candidate versions must. Caller paths are
installRoot, launcher kind/path, profile and receipt; no implicit defaults or overrides
from environment. Launcher kind is desktop-entry on Linux, cmd on Windows, command on
macOS. Request, descriptor, verified manifest and installed metadata identities MUST agree.
The manifest's provenance and source/runtime content remain independently verified.

Lexical path schemas are only a first filter. Native validation MUST use directory/file
handles to validate and operate without symlink/junction/reparse races, reject root/device/
UNC/alternate stream paths in v1, traversal, control characters, case/normalization aliases,
unsupported volumes and unexpected ownership/ACLs. No path may escape a declared owned
root through a link. Prepared input files are regular files, never live mutable trees.
Receipt must not overlap any input, launcher, staging, generation or profile. Profile must
not be inside replaceable generation storage. Source/input locations are read-only.
Install root/profile/launcher ownership is bound to installationId and OS principal;
check channel bindings before any change. Stable and candidate cannot share roots,
profiles or launcher registrations, including alias paths. Unmarked existing installations
or populated profiles are rejected, not adopted. Explicit new owned empty profile directory
creation is allowed; no profile database is opened or migrated.

## States, receipts and errors

| Operation | Preconditions | Durable completion |
| --- | --- | --- |
| prepare | Verified request/inputs/policy; exclusive locks; matching revision | prepared: built staging and integrity manifest flushed, active generation unchanged |
| commit | Same transaction in prepared state; reverified staging; matching revision | committed: verified generation moved to retained storage; not selected |
| activate | Same transaction committed; active app absent; matching revision | activated: pointer, dispatcher, launcher and binding consistent, gate safely released |
| install | Same requirements as prepare | Composes prepare → commit → activate; never starts Personal |
| inspect | Valid explicit owned selection; no mutation | Observed durable state/integrity; missing installation is failed/NOT_INSTALLED |
| recover | Exclusive transaction ownership; intact journal; no app ever started through incomplete activation | resume incomplete steps, or restore-previous compensation; no data restoration |

Failure is an operation result, not a durable installed state. Receipt state=failed
includes lastDurableState=none/prepared/committed/activated, actual effects and error.
Recovery compensation succeeds with state=restored, the last durable forward state and
actual prior activeGeneration. An identical activated retry reports changed=false only
after integrity verification. No GUI/backend/service launch is permitted in any operation.
`effects.profileDataModified` and `guiStarted` are always false. User-data bytes stay intact.
`revision` records selection CAS revision; `generation` identifies the transaction's built
generation and may be null before allocation. activeGeneration=0 means absent.

Prepared/committed/activated success receipts require matching lastDurableState and
verified installedManifestSha256. On restored success, the compensated selection is
verified; installedManifestSha256 can identify the retained transaction generation or
be null if no generation was built. `changed` describes effects of this invocation, not
whether an installation exists. inspect never changes state, so changed=false. Effect
flags describe effects reached in this transaction (even if later compensated), not a
claim that every effect remains selected; activeGeneration/revision are authoritative.

Mutation success requires durable journal completion and external receipt persistence.
Persist authoritative completion record first, atomically replace caller receipt second,
then emit stdout. If external persistence fails after activation, emit failed with
lastDurableState=activated, actual effects and RECEIPT_WRITE_FAILED, exit 6; keep the
journal's activated fact. Never downgrade it to “not installed”. inspect is read-only:
it emits a receipt on stdout but never writes the caller path or repairs journal. recover
or an identical mutating retry can persist a recovered receipt. Missing stdout, EOF or
cancellation without receipt means unknown; CLI must inspect, not assume failure/no effects.

| Exit | Codes (normative error schema binds each code to this exit) |
| --- | --- |
| 0 | Verified requested durable state; error=null |
| 2 | INVALID_REQUEST, UNSUPPORTED_CONTRACT, UNSUPPORTED_CAPABILITY, UNSUPPORTED_PLATFORM |
| 3 | INPUT_INTEGRITY_FAILED, INSTALLED_INTEGRITY_FAILED, UNTRUSTED_PATH |
| 4 | BUSY, GENERATION_CONFLICT, OPERATION_ID_CONFLICT, PROFILE_CONFLICT, NOT_INSTALLED |
| 5 | BUILD_POLICY_UNAVAILABLE, BUILD_FAILED, DOWNLOAD_DENIED, PREREQUISITE_MISSING |
| 6 | ACTIVATION_FAILED, RECOVERY_REQUIRED, RECEIPT_WRITE_FAILED |
| 7 | CANCELLED, with actual durable state |
| 1 | INTERNAL_ERROR, redacted diagnostic UUID only |

Retryable never overrides recoveryRequired. Empty recovery.actions means no safe automatic
recovery is known. The adapter must not guess a repair from damaged/unowned metadata.
Unsupported lifecycle operations are UNSUPPORTED_CAPABILITY; malformed unknown operation
strings are INVALID_REQUEST. Neither causes any mutation.

## Trust boundary: prepared inputs do not mean a trusted/offline build

CLI verifies repository/release identity, commit, manifest provenance, source/runtime
size/digests and download redirects before invoking Personal. Personal rehashes inputs
and binds manifest/target/runtime/lockfile versions; it copies to private staging with
exclusive creation, rechecks after copy, and extracts only there. Reject traversal,
absolute paths, links escaping the tree, devices, duplicate/case-colliding entries,
archive bombs and resource-limit violations. Never trust a caller-supplied path or
hash alone as proof of publisher identity. Artifact verification cannot make malicious
publisher code safe; execution requires explicit trust in the selected release.

The adapter must verify its executing runtime and its own released code before using
prepared inputs. Runtime archive validation includes provenance checks and all extracted
runtime/tooling files, not only node's binary. Prepared data never supplies executable
hooks, shell commands, npm flags or arbitrary environment overrides.

Source installation executes npm lifecycle scripts and build/package tooling. Lockfile
integrity covers package bytes, not every download performed by those scripts. Electron,
builder tools and native optional packages can fetch additional binaries. A hashed source
ZIP does not close that supply-chain boundary or promise reproducible output.

Before prepare, Personal reports an integrity-covered build policy identifying supported
OS/toolchain, pinned npm/lockfile and permitted scripts, dependency registries and all
binary download origins/digests, resource limits and environment allowlist. CLI obtains
explicit user consent to that policy and supplies policy/consent identity. Personal must
verify it and use an enforceable process/network containment mechanism. Allowlist text
alone cannot constrain arbitrary lifecycle code. If the host cannot enforce the declared
policy, return BUILD_POLICY_UNAVAILABLE; do not silently relax it. Offline builds are
unsupported until complete dependency/binary inputs and denial of egress are tested.

Strip inherited credentials and injection variables from build processes (including
publication tokens, NODE_OPTIONS/NODE_PATH, npm user configuration and alternate
registries). Supply a private npm configuration/cache; retain approved proxy/CA trust via
explicitly reviewed configuration, without logging secrets. No TLS bypass, Electron
sandbox bypass, global installs, model pulls or background service startup. Build
subprocesses may write only transaction-owned build/cache/temp paths. Install-only
requires enforcement/acceptance of no app launch, not simply omission of a final spawn.

## Installed integrity and idempotency

Personal records an installed manifest after building: sorted relative file paths,
types, sizes, SHA-256, executable modes, safe link targets, runtime/npm/build tool identity,
source/lockfile/policy digests, version/commit and platform. Define platform-specific
metadata (ACL ownership, executable signature/quarantine policy) without hashing volatile
user data. Profile, logs and caches live outside immutable application content. Verify
all covered app/manager/runtime files and owned launcher contents on inspect, activation
and reinstall; future startup/rollback contracts must also verify them. Executable
existence is insufficient.

Local hashes detect drift against a protected installation record, not a hostile user
who can rewrite both files and receipts. Authenticate release inputs independently and
protect records with same-user permissions; do not claim attestation or bit-reproducible
builds. Changes to receipt/manifest ownership or unsupported filesystem semantics fail.

Each mutation gets a unique operationId; exact retries reuse it. Bind the entire request
(including receipt path) to RFC 8785 canonical JSON SHA-256, excluding only operationId.
Reusing an ID with a different path/body is OPERATION_ID_CONFLICT. commit/activate/recover
use fresh operation IDs and the transactionId issued by prepare/install. Transaction
target, paths, input/policy hashes and installation identity cannot be changed between
steps. Validate a known identical retry before rejecting a stale CAS value, but reverify
journal, current revision and integrity; it succeeds only if the current selection still
matches the transaction's completed result. Never replay over an unrelated selection.

`expectedGeneration` is the historical field name for the **selection revision CAS**,
not a directory generation ID. Revision starts at 0 and increases only after verified
activation completion; failed/uncompleted transactions keep their base revision. Generation
IDs are separately monotonic, allocated under the root lock, never reused (gaps allowed).
prepare/commit/activate retain the same expectedGeneration until activation completes.
recover uses the transaction's base revision; receipt recovery after completed activation
is allowed only when current revision/result match that transaction. A fresh identical
install can return unchanged only with the current revision and full content/launcher
verification. Revision overflow or inconsistent metadata is RECOVERY_REQUIRED, not wrap.

## Transaction journal and activation ordering

The [journal schema](installer-adapter-v1/schemas/journal.schema.json) defines bounded
append-only intent/done records. Sequence starts at 0, increases by one; each record hashes
the preceding canonical JSON record (first previousRecordSha256=null). Verify the chain,
installation/transaction/request binding and OS owner before use. The immutable requestSnapshot stores the full validated request
bytes privately, with matching digest; it supplies original prepared/policy bindings for
recovery, never an alternate command or executable hook. A journal directory is
private, same-volume with generations, locked and not writable by build children.
Backup objects reference private, hash-verified original pointer/launcher/dispatcher bytes;
null means the registration was absent. Never store secrets or profile data in the journal.

Portable code can validate schema/hash chain, request equality, transition order, manifest
content and deterministic recovery decisions. It cannot promise crash durability, native
ACL/handle safety, flush semantics or containment without platform acceptance. Truncated
last record is ignored only when every earlier record is complete and its intent permits
reconciliation of actual owned files; any ambiguous/missing backup or chain mismatch
fails closed with RECOVERY_REQUIRED. It must not guess that the interrupted action failed.

1. Validate without writes; acquire OS-backed root and launcher ownership locks in canonical
   order. Check root principal/installationId, revision and channel. Prove the selected app
   is not running; otherwise BUSY. PID alone is insufficient. Persist transaction intent
   and owner process-start identity before staging; no PID-only forced lock removal.
2. Copy verified inputs into owned staging, rehash/extract safely, run contained build.
   Verify the entire generated tree, manifest and toolchain; flush files and parent
   directories, persist prepared completion. Active selection remains untouched.
3. Journal commit intent, rename generation within the accepted same-volume filesystem,
   flush directory, reverify and persist committed completion. Cross-volume commit is
   unsupported. Keep previous and transaction generations; no automatic GC in minimum v1.
4. Journal activation intent and backup hashes, install a durable activation gate that all
   adapter-owned launchers/dispatchers honor, and recheck quiescence under ownership locks.
   An attempt to run while gated refuses; it must not execute a mixed generation.
5. Stage and flush new launcher/dispatcher registrations under ownership locks, then replace
   each with per-file intent/done records and native safe replacement. Write current pointer
   with the generation/profile binding while gate stays closed. These are distinct writes
   across potentially different volumes, **not one atomic filesystem transaction**.
6. Re-read pointer, launcher/dispatcher, ownership and installed manifest. Record activated
   completion and increment revision durably; then release the gate durably. On a crash
   before gate removal, recovery validates completion and only removes that owned gate.
7. Persist caller receipt and emit completion. Receipt failure cannot undo a completed
   activation fact. Keep journal/backups for explicit recovery; no cleanup that destroys
   recovery inputs. Never launch Personal.

| Last verified journal fact | Recovery decision |
| --- | --- |
| Build intent, no prepared completion | Active unchanged; inspect hashes/owned staging, resume prepare with original inputs/policy or restore-previous by discarding owned staging |
| Prepared | Reverify, resume commit or compensate without touching active selection |
| Committed | Reverify, resume activation or compensate while retaining generation for diagnosis |
| Activation intent, partial launcher/pointer writes | Gate stays closed; reconcile each intent against old/new verified bytes, complete or restore every owned registration |
| Activated completion, gate or receipt pending | Reverify selected result; release gate/persist receipt only; no restore-previous after gate release/startup possible |
| Corrupt chain, missing backup, changed owner or unrelated revision | Refuse automatic recovery; RECOVERY_REQUIRED and preserve evidence |

restore-previous is allowed only before activated completion/gate release and only for
this transaction's saved selection, with no profile changes. After activated completion,
recover may only finalize gate/receipt. Compensating an initially absent installation
removes only transaction-created registrations/pointer, retains user data and records
activeGeneration=0. Compensation writes its own intent/done records, so repeated crashes
resume compensation. It is never a general rollback or automatic profile restoration.

Cancellation before commit terminates only owned contained child trees and leaves the
prior installation active. During activation, first reach a verified compensation or
completion boundary with gate closed, then emit CANCELLED with actual effects. SIGKILL,
power loss and receipt loss require inspection; no finally-block guarantee is assumed.
Native process groups/job handles and child escape prevention require platform evidence.
A busy application or inability to prove quiescence fails BUSY, not forced termination.

## Platform enforcement feasibility and mandatory refusal

No native enforcement prototype was run in this documentation task. These are candidate
mechanisms and acceptance requirements, not established support. All six targets remain
BLOCKED for implementation readiness until the roadmap's security/transaction gates pass.

| Target | Mechanism to evaluate | What remains unproven / mandatory response |
| --- | --- | --- |
| Linux x64 | User/mount/PID/network namespaces, cgroup-owned child trees, deny egress except a digest-verifying broker; private filesystem view and no GUI sockets | Kernel/user-namespace availability, seccomp/namespace escape resistance, exec/download broker, fsync+rename and desktop launcher locks: BUILD_POLICY_UNAVAILABLE or RECOVERY_REQUIRED |
| Linux arm64 | Same design with native arm64 toolchain/binaries | All x64 gates plus architecture-specific package/download coverage; x64 fixtures are not evidence |
| Windows x64 | Restricted token/AppContainer or equivalent audited broker, Job Object with kill-on-close and breakaway denied, ACL/handle-based filesystem access, WFP/broker-enforced egress | Job Object alone does not restrict network/files; npm/Electron compatibility, reparse races, FlushFileBuffers/replacement/file sharing and launcher locks unverified; fail closed |
| Windows arm64 | Same native containment with arm64-aware tools | Native execution/download/signature coverage and emulation ambiguity unverified; no x64 acceptance inheritance |
| macOS x64 | Supported sandboxed helper or isolated VM/build service with mediated downloads, restricted filesystem/GUI access and owned process cancellation | No assumed stable public sandbox-exec solution; npm/build/signing compatibility, durable APFS replacements and launcher registration unverified; fail closed |
| macOS arm64 | Same supported helper/VM approach with native arm64 toolchain | Entitlements, translated-process rejection, quarantine/signing and APFS recovery unverified; Intel results insufficient |

A broker must verify content against policy digests before making downloads available,
block direct sockets/DNS/proxy escape, and prevent arbitrary fetch-execute or GUI/backend
startup by build descendants. A domain allowlist or consent receipt cannot enforce this.
The exact execution allow policy for build tools vs generated app entry points is a BLOCKER;
absence of DISPLAY alone is insufficient. No untrusted build child can write the journal,
active generation, launcher or profile. If the platform cannot enforce these properties,
prepare fails BUILD_POLICY_UNAVAILABLE before running dependency scripts.

Native acceptance must justify filesystem durability on supported local volumes (not
network shares), handle-based ownership and symlink checks, safe launcher replacement,
process quiescence and cancellation. No relaxation of TLS, Electron sandbox, OS security
or release controls is permitted. Application rollback, startup and data migration stay
outside these minimum guarantees.

## Integrity metadata and build policy completeness

The integrity schema's files list covers the complete generation-relative application,
manager/imports and private runtime/npm tree. v1 generations own their runtime content;
shared mutable runtime caches cannot be trusted as installed content. List is sorted by
Unicode codepoint of normalized slash-relative paths, with no duplicate/aliased entries,
unlisted executable files or out-of-tree links. Directories and link targets are included;
user profile/cache/log content is excluded and must live outside the generation. mode is
the normalized four-digit POSIX mode on POSIX; Windows uses 0000 and validated ACL policy
hashes instead. Executable status must agree with target semantics. Launcher is separately
hashed and ownership checked. Hash the canonical integrity record externally in the journal
and receipts; it cannot contain its own digest. SignaturePolicySha256 identifies the
reviewed target policy, not proof that verification ran.

The verified buildPolicy input must bind target, source/lockfile/toolchain digests, allowed
package lifecycle/build commands and executable hashes, registries and every additional
binary-download digest, private writable paths, env allowlist, cancellation policy and
maximum compressed/expanded bytes, entries, CPU/memory/process/time/log limits. The release
must supply finite limits compatible with the protocol caps; absent or unenforceable
limits are BUILD_POLICY_UNAVAILABLE. The policy must cover archive extraction before
any subprocess can see extracted files. An implementation-specific policy schema and
broker/backend are G1 deliverables; no opaque policy hash alone satisfies this requirement.
ConsentId is an orchestration reference to prior explicit consent, not a credential or
authentication proof. All policy/input bytes must match it and the release descriptor.
