# M2 prerequisite: preserve stable registration after repeated RC uninstall

This is a small Personal-engine safety correction, **not complete CLI M2 or
Installer Adapter v1**. The separate Go CLI branch adds public release auditing
and safe refusals; it does not invoke this manager for product lifecycle actions.

Baseline develop: `da8988061b275444f4a02c869b7b22bc4df983a7`, containing merged
PR25. PR28 `9e1374637c3fb074537f14cc7955a684c1e5fd9e` remains Draft and unchanged.
Its no-autolaunch install/update slice was inspected, but not copied into this
branch or treated as safe CLI capability. PR23/24 security/transaction blockers
remain unresolved. Published stable/RC releases and tags are unchanged.

## Confirmed defect and correction

`source-desktop.mjs:launcherFile` uses current metadata to distinguish the local
RC launcher from the default stable launcher. The first RC uninstall removes
current.json. A second direct invocation previously selected and removed the
stable launcher from another root. This was reproduced with actual filesystem
operations in the existing temporary fixture: the second uninstall returned 0,
then the stable launcher read failed with ENOENT.

`source-manager.mjs` now calls launcherFile/removes the launcher only when an active
installation record exists. With no record, it does not infer ownership of a global
registration. Existing versions, profiles, runtime and unrelated files are retained.
No new command, capability marker, default path, GUI behavior or installer workflow
is introduced. A launcher left behind without metadata needs explicit recovery;
this change intentionally does not adopt or guess such ownership.

The differential characterization test still runs the immutable RC3 baseline and
current engine. It explicitly asserts the old deletion versus corrected preservation,
while keeping transcript/build/launch/metadata comparisons. The coexistence test
now repeats RC uninstall against the current manager and checks unchanged stable
launcher bytes, stable metadata, stable user sentinel and candidate profile sentinel.

This fixes one known repeated-uninstall defect. It does **not** authenticate an
arbitrary installation record, implement CLI-managed adoption, quiesce running
Personal, verify native launcher paths, handle adversarial filesystem races, or
provide a new durable recovery contract.

## Local validation

Linux x64, Node 24.22.0. Existing dependency tree from the exact matching committed
package-lock was reused through a local uncommitted node_modules symlink. Initially
installer tests lacked yauzl in the fresh worktree; the lock-matching dependency
reuse resolved that environment failure without dependency/lock changes.

```sh
node --test tests/source-manager-characterization.test.mjs tests/distribution.test.mjs tests/source-manager.test.mjs tests/installer.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --import tsx --test tests/*.test.ts tests/*.test.cjs
git diff --check
```

- Existing baseline characterization/distribution/source-manager tests PASS;
  installer suite PASS after resolving the dependency path (4 tests).
- New regression before the production fix: FAIL, expected ENOENT demonstrating
  deletion of the unrelated stable launcher.
- Corrected targeted suite: 18/18 PASS, zero skipped.
- Typecheck PASS; application suite 175/175 PASS, zero skipped.
- Test fixtures create owned temporary roots, simulate home/platform, and use fake
  npm/builder/GUI executables. Data/launcher assertions execute against real files;
  these remain **MOCK ONLY for native application installation acceptance**.
- Windows/macOS/ARM64 native lifecycle: NOT RUN. Linux native successful CLI
  install/update/uninstall: BLOCKED by missing safe adapter/execution boundary.

[Validation evidence](../evidence/m2-lifecycle/validation.json) records commands and
results. The existing fixture finally blocks remove their temporary trees; this is
not proof of adversarial descendant containment or native GUI cleanup. No real
Personal user profiles or external Ollama services were touched.

## Why complete lifecycle execution remains blocked

On this Linux host, unprivileged namespace creation fails at `/proc/self/uid_map`
(read-only filesystem); the cgroup hierarchy is not writable and the user session
bus is absent. The current source build invokes npm lifecycle scripts, so merely
omitting the manager's explicit Electron launch cannot prove the required execution,
network, credential and write boundaries. No host security settings were changed.

The mandatory requirements in PR23/24 need an accepted native backend and recovery
implementation. Update also needs owned-instance quiescence and profile/data
compatibility; uninstall is outside minimum Adapter v1 and needs separate negotiated
ownership semantics. Current public releases expose none of that. A reduced trust
model or prebuilt distribution would need explicit review, not silent substitution.

Verdict: correction ready for technical review; **NO-GO for complete M2**. Continue
on an authorized isolated native host, reuse the existing Personal engine, then
publish capabilities only after actual install/update/uninstall acceptance and
separate release authorization. No merge, Actions activation/dispatch, setting
change, release/tag or modification of the referenced PRs is included.
