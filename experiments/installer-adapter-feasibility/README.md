# Non-production installer-adapter feasibility fixtures

**Not an installer, sandbox, safe build runner or implementation of PR #23.**
Do not import into application code or pass actual installation/profile paths.
This Linux-only Python standard-library prototype creates disposable temporary roots,
a zero-dependency npm lifecycle fixture and a loopback socket. It does not invoke Personal,
Electron, real dependency installation, downloads, Docker, user launchers or profiles.

From repository root, as an ordinary user:

```sh
python experiments/installer-adapter-feasibility/probe_containment.py
python experiments/installer-adapter-feasibility/spike.py
```

Prerequisites: Linux, Python 3.12+, Node/npm on PATH for test_03, writable temporary
storage. test_10 uses TemporaryDirectory under both `/tmp` and `/workspace`; if `/workspace`
is unavailable, run other tests individually, and record cross-volume NOT RUN. Same-device
roots cause a skip, not a cross-volume PASS. No global installations or elevated privileges.
The kernel/container may block namespace probes; do not bypass that denial.

Each test can run with:

```sh
python experiments/installer-adapter-feasibility/spike.py Spike.test_07_receipt_failure_preserves_activation
```

Tests generate all fixtures locally and remove their temporary directories. Public entry
points take no installation path; `worker` is a private subprocess harness for controlled
test roots, not a supported user command. A successful runner means its assertions passed,
including negative controls that **disprove** process-group or env-only containment.
The test executable contains no production-format schema/receipt compatibility promise.

[Technical report](../../docs/design/installer-adapter-feasibility-spike.md) records the
exact per-test commands, classifications, limitations and proposed next steps.
[Captured test output](evidence/linux-x64-tests.txt) and
[containment probes](evidence/linux-x64-containment.jsonl) contain no credential values.

## Bounded experiment model

- `clean_env` constructs an allowlist; no inherited credential values are read/logged.
  npm has separate empty user/global configs and a cache within the temporary root.
- The synthetic lifecycle is a trusted negative-control payload: it writes only sibling
  temporary markers, spawns a marker process (not a GUI), and sends `fixture` to a local
  listener. No external connection or package dependency is used.
- Process-group test traps SIGTERM in a controlled parent, observes its setsid child
  survived and then explicitly terminates/reaps it. Cleanup is cooperative and bounded;
  it is not a claim that arbitrary malicious descendants can be cleaned up this way.
- The journal model hashes accumulated prior bytes and refuses corrupt/truncated records.
  It models roll-forward only, a toy generation marker and text launcher, not production
  manifests, ACLs, rollback, adoption, authenticated IPC or active application shutdown.
- Activation gate is a file asserted by tests. A real launcher honoring it is NOT tested.
- Files and directories receive fsync; same-volume os.replace is used for each file.
  Nine kill points model abrupt process death, not device/power failure. Temporary tmpfs
  and overlay mounts do not validate persistent NTFS/APFS/ext4 storage guarantees.
- Concurrent CAS uses two cooperating writers and advisory flock; all future writers
  must cooperate. It is not protection from an arbitrary same-user attacker.

Two harness defects were corrected during development: npm rejected using `/dev/null`
for both config roles, then a loopback fixture waited for peer EOF. Separate empty configs
and explicit socket completion fixed these; the final 12-test run passes. Neither failure
was reported as a Personal application defect or native containment evidence.
