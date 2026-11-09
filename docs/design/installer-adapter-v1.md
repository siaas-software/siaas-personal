# Installer Adapter Contract v1 — proposal

Status: design review only, 2026-11-09. **Not implemented in RC3.**
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

## Discovery and transport

Proposed entry point inside a future verified Personal source release:

```sh
"/verified/node/bin/node" "/verified/personal/scripts/installer-adapter.mjs" capabilities --json
"/verified/node/bin/node" "/verified/personal/scripts/installer-adapter.mjs" execute --request "/private/install-request.json"
```

These are proposed invocations, not RC3 commands. Windows uses verified `node.exe`
and absolute Windows paths with the same argument array; callers MUST NOT concatenate
shell commands. The verified source tree supplies the adapter and imports, so discovery
itself executes trusted release code. It MUST need no npm install, GUI, network, root
creation, profile access or other mutation. Do not probe old source-manager with novel
flags: RC3 ignores options it does not parse. Absence of a trusted descriptor/entry
point means unsupported, never fallback to legacy install that launches the GUI.

Future releases include an integrity-covered descriptor binding product, source digest,
relative entry point, supported majors and capabilities. CLI must verify that descriptor
as part of the trusted release before executing; a mutable file from an unknown origin
is not a trust anchor. Runtime discovery must agree with the descriptor and actual OS.

Example capability response (illustrative future Linux x64 implementation):

```json
{
  "protocol": "siaas.personal.installer-adapter",
  "supportedVersions": ["1.0"],
  "product": "siaas-personal",
  "platform": "linux",
  "arch": "x64",
  "operations": ["prepare", "commit", "activate", "install", "inspect", "recover", "rollback"],
  "capabilities": ["install-only", "explicit-paths", "isolated-channels", "durable-receipts", "installed-integrity", "journal-recovery", "prepared-archives", "build-network-consent"],
  "unsupportedCapabilities": ["gui-start", "offline-build", "profile-restore", "cross-build", "native-installer"]
}
```

Unknown major/minor versions, operations, required capabilities and request keys MUST
fail before install-root creation or other mutations. Discovery and completion JSON are bounded to 64 KiB; logs must not be interleaved on stdout. Version 1.0 has closed request
objects; future minor requests require explicit discovery, not silent interpretation.
Responses may add noncritical fields within a negotiated major; required semantics
cannot change. No operation may advertise a capability until its target platform passes
conformance. Platform naming: win32/darwin/linux, x64/arm64; reject host mismatch.

## Request schema and example

UTF-8 JSON, maximum 64 KiB, no duplicate keys, NaN, comments or trailing content.
All objects closed. Paths are absolute native paths, no URLs. UUIDs identify operations
and installations. Digests are 64 lowercase hexadecimal characters; commit is 40 hex;
sizes are positive safe integers. Missing required fields fail validation.

| Field | Required type / constraint |
| --- | --- |
| protocol, contractVersion | Exact strings `siaas.personal.installer-adapter`, `1.0` |
| operation | Enum from discovered operations |
| operationId, installationId | UUID strings; durable request binding, stable installation identity |
| requiredCapabilities | Unique string array; every entry must be advertised |
| target | `{product, version, commit, channel, platform, arch}`; product exact; channel stable/candidate; stable semver or explicit rc.N consistent with channel |
| paths | `{installRoot, launcher, profile, receipt}`; launcher is `{kind, path}`; kind desktop-entry/command/cmd matching OS; no implicit defaults |
| prepared | For prepare/install only: `{source, runtime, manifest}`; each `{path, size, sha256}` identifies a local regular file; manifest binds source/runtime identity and target |
| buildPolicy | For prepare/install only: `{mode, policyId, policySha256, consentId}`; mode `approved-network`; no permissive default |
| transactionId | Required for commit/activate/recover, optional nowhere else; opaque Personal-issued UUID from a receipt |
| expectedGeneration | Required integer >=0 for every mutation, including prepare/install; compare-and-swap precondition, 0 for absent installation |
| rollbackTarget | Required only for rollback: `{generation, installedManifestSha256}`; explicit retained selection, not “previous” toggle |
| recoveryAction | Required only for recover: `resume` or `restore-previous`; no force unlock |

inspect requires protocol/version/operation/operationId/installationId/paths only;
all other operations require target, requiredCapabilities and expectedGeneration too.
commit/activate/recover use the persisted, hash-bound original target/paths and cannot
substitute inputs or build policy. rollback uses an explicit retained generation.
These field rules plus the scalar constraints above are the proposed normative schema;
machine-readable JSON Schemas and golden vectors are acceptance deliverables before
implementation integration, not existing release assets.

Example install request (digests are syntactically valid placeholders, never usable
verification values; replace from verified artifacts for a future adapter release):

```json
{
  "protocol": "siaas.personal.installer-adapter",
  "contractVersion": "1.0",
  "operation": "install",
  "operationId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "installationId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "requiredCapabilities": ["install-only", "explicit-paths", "installed-integrity", "journal-recovery"],
  "target": {"product": "siaas-personal", "version": "1.2.0-rc.1", "commit": "1111111111111111111111111111111111111111", "channel": "candidate", "platform": "linux", "arch": "x64"},
  "paths": {
    "installRoot": "/home/example/.local/share/personal-candidate",
    "launcher": {"kind": "desktop-entry", "path": "/home/example/.local/share/applications/personal-candidate.desktop"},
    "profile": "/home/example/.local/share/personal-candidate-data",
    "receipt": "/home/example/private/install-receipt.json"
  },
  "prepared": {
    "source": {"path": "/home/example/private/source.zip", "size": 1234, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    "runtime": {"path": "/home/example/private/node.tar.gz", "size": 5678, "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
    "manifest": {"path": "/home/example/private/manifest.json", "size": 987, "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
  },
  "buildPolicy": {"mode": "approved-network", "policyId": "personal-build-v1", "policySha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "consentId": "local-consent-001"},
  "expectedGeneration": 0
}
```

CLI resolves all paths explicitly. Personal canonicalizes existing ancestors and rejects
relative paths, traversal, symlink/junction/reparse escapes, dangerous roots, unexpected
owners/ACLs, aliases/case collisions, source/profile/launcher/receipt overlaps and another
installation's registration. A profile cannot be nested in replaceable version/staging
storage. Stable/candidate must have distinct roots, profiles and launchers; sharing or
channel conversion is unsupported v1. Existing unmarked profiles/launchers require a
separate future adoption flow; never silently claim ownership. No chmod/ACL relaxation,
elevation, global PATH modification or writing outside declared owned destinations.

## States, receipts and exits

prepare validates and copies inputs into private staging, builds and verifies output;
commit moves a verified generation into retained storage without selecting it;
activate switches the selected generation and owned launcher; install composes all
three. No step launches the app or opens/migrates its SQLite profile. Profile selection
is recorded, with owned directory creation only where authorized. inspect reads receipts,
journal and integrity without creating directories or invoking a migrating constructor.

| State | Durable fact | Allowed next step |
| --- | --- | --- |
| prepared | Verified staged build and installed-file manifest; active generation unchanged | commit or recover/discard owned uncommitted staging |
| committed | Complete immutable-by-convention generation retained; not necessarily current | activate or recover |
| activated | Selected generation, launcher, dispatcher and profile binding agree and are reverified | inspect; explicit install/rollback transaction |
| failed | Operation failed; last durable state and actual effects included | inspect/recover as indicated; never assume untouched installation |

stdout contains exactly one bounded JSON completion receipt, including validation errors;
subprocess/progress output goes to stderr with redaction. Atomically persist the same
receipt at the validated caller path and an authoritative copy in the owned transaction
journal; do not write to an unvalidated receipt path. A killed process may emit nothing:
CLI treats EOF/timeout/missing receipt as unknown and invokes inspect, not success/retry.
Receipt-write failure is nonzero even if activation succeeded; journal is recovery truth.
Receipt fields below are required; transactionId/installedManifestSha256 may be null
before a transaction exists; error is null on success. paths has the request's exact schema.

```json
{
  "protocol": "siaas.personal.installer-adapter",
  "contractVersion": "1.0",
  "operationId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "installationId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "transactionId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "state": "failed",
  "lastDurableState": "committed",
  "generation": 3,
  "activeGeneration": 2,
  "changed": true,
  "guiStarted": false,
  "integrity": "verified",
  "installedManifestSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "paths": {
    "installRoot": "/home/example/.local/share/personal-candidate",
    "launcher": {"kind": "desktop-entry", "path": "/home/example/.local/share/applications/personal-candidate.desktop"},
    "profile": "/home/example/.local/share/personal-candidate-data",
    "receipt": "/home/example/private/install-receipt.json"
  },
  "effects": {"generationCommitted": true, "pointerSwitched": false, "launcherReplaced": false, "profileDataModified": false},
  "error": {"code": "ACTIVATION_FAILED", "phase": "activate", "retryable": false, "recoveryRequired": true},
  "recovery": {"actions": ["resume", "restore-previous"], "automatic": false}
}
```

Success receipts use state and lastDurableState prepared/committed/activated, error=null,
and accurate effects. A verified identical reinstall reports activated, changed=false,
without rebuilding or rewriting launchers. `integrity` is verified/failed/not-checked;
lastDurableState additionally allows none. activeGeneration may be null. inspect returns
the observed state with changed=false; absent installation uses failed/none and NOT_INSTALLED.

| Exit | Stable codes / meaning |
| --- | --- |
| 0 | Requested durable state reached, persisted receipt and integrity verified |
| 2 | INVALID_REQUEST, UNSUPPORTED_CONTRACT, UNSUPPORTED_CAPABILITY, UNSUPPORTED_PLATFORM |
| 3 | INPUT_INTEGRITY_FAILED, INSTALLED_INTEGRITY_FAILED, UNTRUSTED_PATH |
| 4 | BUSY, GENERATION_CONFLICT, OPERATION_ID_CONFLICT, PROFILE_CONFLICT, NOT_INSTALLED |
| 5 | BUILD_POLICY_UNAVAILABLE, BUILD_FAILED, DOWNLOAD_DENIED, PREREQUISITE_MISSING |
| 6 | ACTIVATION_FAILED, RECOVERY_REQUIRED, ROLLBACK_INCOMPATIBLE, RECEIPT_WRITE_FAILED |
| 7 | CANCELLED before next durable boundary; receipt still reports actual durable state |
| 1 | INTERNAL_ERROR; redacted diagnostic reference, no raw secret-bearing exception |

Never return 0 on a partial launcher write or executable spawn alone. No fallback on
unsupported capability. Retryable describes whether the same request may be retried
without policy changes; recoveryRequired takes precedence and requires inspect/recover.

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
all covered app/manager/runtime files and owned launcher contents on inspect/reinstall,
activation, launch and rollback; executable existence is insufficient.

Local hashes detect drift against a protected installation record, not a hostile user
who can rewrite both files and receipts. Authenticate release inputs independently and
protect records with same-user permissions; do not claim attestation or bit-reproducible
builds. Changes to receipt/manifest ownership or unsupported filesystem semantics fail.

Each invocation gets its own operationId; retries reuse that ID, while commit/activate use new IDs and the same transactionId. Resolve an existing identical journal entry before testing a now-stale expectedGeneration, then revalidate the observed generation; unrelated generation changes still fail closed. Bind operationId to a canonical JSON request digest (RFC 8785), excluding only operationId
and paths.receipt, and a stable installation identity. Reuse with different inputs fails.
An identical replay rechecks installed content and reconciles journal state; it does not
blindly trust a previous receipt. A fresh operation selecting the same generation/inputs
can also return unchanged after full verification. Corruption returns
INSTALLED_INTEGRITY_FAILED; no silent success or destructive repair. Generations are
monotonic, and each mutation verifies expectedGeneration under an exclusive root lock.
Protect a shared launcher with an ownership lock too, so different roots cannot race.

## Interruptions, activation and rollback

Use a durable write-ahead journal with transaction/owner identity, request digest,
phase intent/completion, old/new generation, exact previous launcher/dispatcher bytes,
profile binding and touched paths. Flush data and journal before atomic renames; record
filesystem/platform durability guarantees. Stage on the same volume as generation
storage; reject unsupported atomicity rather than assuming cross-volume rename works.
Launcher and root may live on different volumes: activation is a recoverable multi-step
transaction, never described as a single atomic filesystem operation.

Acquire locks before mutations; readers/launchers must refuse or reconcile an incomplete
activation, not run a mixed generation. No PID-only stale-lock deletion: use OS-backed
locking plus transaction and process-start identity, with recovery only after exclusive
ownership is proven. If an installed app is running, v1 refuses BUSY; it does not kill
unrelated processes or implement stop. Graceful quiescence is later explicit Personal
lifecycle work. Network downloads/build subprocesses are cancellable and bounded; clean
up only owned children and paths. After SIGKILL/power loss, inspect reports the last
durable boundary and pending effects, never assumes a finally block executed.

| Interruption point | Required recovery |
| --- | --- |
| Input copy/build before prepared | Active installation untouched; discard only verified owned staging, or restart prepare with input revalidation |
| Prepared or committed, before selection | Keep old active generation; resume next step after full revalidation; committed generation may be retained |
| Current pointer switched, launcher/dispatcher incomplete | Prevent launches; complete matching registrations or restore saved pointer and registrations; preserve journal until verified |
| Activation complete, receipt missing | inspect reconstructs a verified activated receipt from journal; no second build or launch |
| Recovery itself interrupted | Replay idempotently from journal; fail closed on missing/corrupt journal or ambiguous ownership |

Rollback is an explicit transaction selecting a retained generation and its matching
runtime/manager/launcher. Verify it and profile-schema compatibility first; reject unknown
compatibility. It never toggles blindly and never rolls back application data. Installation
v1 does not open/migrate profiles; after later GUI startup, schema compatibility must be
checked without invoking migrating constructors. Future profile backup/restore is a
separate consented contract, not implied by rollback. Retain previous verified generation
and recovery records until activation and receipt are durable; never garbage-collect a
transaction's recovery inputs. Uninstall/purge and automatic data restore are out of v1.
