# First-party M2 integration — native acceptance BLOCKED

This branch retains PR29's repeated-uninstall correction and applies the
install-cli/update-cli source-manager changes from PR28
9e1374637c3fb074537f14cc7955a684c1e5fd9e without changing that Draft. Base develop
is da8988061b275444f4a02c869b7b22bc4df983a7. CLI issue #2's approved November 14,
2026 model permits official source builds with ordinary user permissions. Mandatory
namespace/cgroup/complete hardened Adapter v1 enforcement is not required here.

CLI-managed metadata marks generations, keeps an explicit root/profile even for
stable, rejects channel switches/unmanaged adoption, and omits launch. The
uninstall-cli action preserves data and uses PR29's no-record ownership correction.
Managed launchers coordinate through the operation lock. Mutations inspect native
same-user executable identities and profile arguments; ambiguity fails without
signalling any process. Current declaration is limited to proposed linux-x64.
No release assets/tool inventory changes or historical modifications are made.

The actual Go integration test provisioned Node and invoked this manager in an
owned temporary root with a trusted local future-version source fixture. It failed
before build with `EACCES: permission denied, readlink '/proc/1/exe'`. PID1 is
same-user and argv text alone cannot establish executable identity. No permission
exception or host-policy change was made. Native install is BLOCKED; subsequent
update/uninstall scenarios are NOT RUN. This is unrelated to namespace availability.

Executed with Node 24.22.0:

- npm ci from committed lock: PASS, 584 packages.
- Actual npm run desktop:build: PASS; [log](../evidence/m2-working/desktop-build.log).
- Targeted CLI guard/distribution/source-manager/installer/characterization tests:
  20/20 PASS; [log](../evidence/m2-working/tests.log). Build/GUI fixtures in the
  characterization suite remain mocks for native application acceptance.
- Typecheck: PASS. Native Windows/macOS/ARM64: NOT RUN.

The Go branch contains the opt-in real-build test and failed engine log. Successful
CLI binary install/update/uninstall, native running-instance races, data backup/
compatibility, failure recovery, ownership drift and interruption acceptance remain
unverified. Neither the marker nor these tests claim hardened Adapter v1 conformance,
native target readiness or a completed M2. Existing historical evidence is preserved.

Next requirement: an authorized Linux runner with complete same-user process
identity visibility, or a reviewed alternative instance-ownership mechanism, followed
by the real lifecycle suite. No app, backend or external Ollama was started/stopped.
No Actions, settings, merge, release or tag operation. Keep Draft / NO-GO for M2.
