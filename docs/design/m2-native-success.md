# Managed Linux lifecycle: native success and remaining scope

The `/proc/1/exe` blocker was a process-selection bug. `cli-quiescence.mjs` now
validates only owned instance leases; there is no global process enumeration or
PID-specific exception. Fresh roots require owner metadata, an exclusive CLI lock
and no retained generations. Unknown partial roots and older managed records lacking
the instance protocol fail closed. Known PID/birth/boot/executable bindings distinguish
live, stale and reused identities without trusting command-line strings or signalling.

`source-desktop.mjs` keeps the operation lock until the managed child exits. Failed
lease capture retains the lock; supervisor interruption requires explicit stale-lock
inspection. Uninstall-cli removes the selected root's software, runtime and build
cache while preserving profile and backups. Legacy installer/uninstall semantics
are otherwise preserved. `cli-profile.mjs` creates a cold backup while the stopped
installation's lock is held; no automatic restore or destructive schema rollback.

The real Go test built/installed 1.1.1-rc.1, repeated it, built/updated RC.2, rejected
a downgrade, deliberately failed an RC.3 build and verified unchanged current state
and data. The compiled CLI then uninstalled twice with exit 0, proving owned software
removal and profile/backup/sibling-sentinel preservation. These were actual local
first-party source builds; no npm, builder or application mock replaced the engine.
The test does not launch Electron; native GUI/descendant shutdown remains NOT RUN.

The companion CLI PR5 contains source/binary hashes and complete real engine logs
under docs/evidence/m2-native-success. Its direct backend install/update tests are
not a public-release binary install/update PASS. Published legacy releases remain
unsupported; publication/merge is not authorized. Prior failure evidence is retained.

Validation: Node24.22.0/Linux x64, targeted suite 28/28 PASS, typecheck PASS;
[tests](../evidence/m2-native-success/tests.log). Final process/backup suite 10/10
PASS, overlapping those tests; [log](../evidence/m2-native-success/lease-tests.log).
Deterministic tests cover PID reuse, mismatches, missing identity, inaccessible known
candidates, fresh/partial roots and old protocol rejection. Native fixtures cover an
owned /bin/sleep lease through exit and launcher lock conflict/cleanup using /bin/true.
Neither fixture is graphical Electron acceptance or a full descendant-containment test.

Limitations: raw unmanaged executable launches are not adopted; stale operation locks
and partial uninstall require explicit recovery. Changes to src/lib/local are refused
by Go until data migration compatibility is reviewed. Cold copy is bounded to 1 GiB,
rejects symlinks/devices and does not claim online SQLite or power-loss safety. The
native data test uses a profile sentinel; real application database migration testing
is not claimed. Windows/macOS/ARM64 lifecycle NOT RUN. External Ollama is untouched.

CONDITIONAL GO for technical review of this demonstrated Linux backend path;
public M2 acceptance remains incomplete. Both PRs remain Draft. No OS policy,
namespace/cgroup infrastructure, Actions, settings, merge, release or tag change.
