# Phase 1 native regression acceptance — follow-up

**Native acceptance: BLOCKED. Keep PR #25 Draft.** Linux x64 command-level
checks pass, but Electron startup is blocked by the host before application
readiness. None of the six targets has complete native installation acceptance.
No new application regression was established; unexecuted scenarios remain
insufficient evidence, not PASS.

## Baseline and available infrastructure

Checked repository `siaas-software/siaas-personal`, branch
`refactor/personal-installation-engine-phase1`, with a clean working tree at
`71676c6cda1629b594b4cbca2be9941169de77f3`. This is the exact production revision
tested. The follow-up adds only reports/evidence. Original develop baseline:
`17202c5964d9282efd4a1991c548612287c65dbb`; main remained
`04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e`.

The [previous extraction report](personal-installation-engine-phase1.md) and
the complete PR diff were inspected. Existing characterization, application and
distribution results remain evidence for that exact revision; they were not
rerun or relabeled as native GUI acceptance in this follow-up. The desktop code,
package/lockfile and stable/RC bootstrap scripts are byte-identical between the
baseline and tested revision.

PR #20's existing `desktop-smoke.mjs` and three helper files were read from pinned
commit `1496298a6619708e56bba1b1a2d08c0b542b2d80` into an external diagnostic
directory and executed unchanged, resolving this checkout's locked dependencies.
No merge, branch modification or duplicate test framework was introduced. That
smoke uses `chromiumSandbox: true`, explicit temporary userData, and mocked Ollama;
it is a startup/profile probe, not an installation or model acceptance suite.

The selected environment exposes only a Debian Linux x64 executor. Read-only
GitHub runner enumeration and Actions-permission requests both returned HTTP 403
`Resource not accessible by integration`. This does **not** establish that no
remote runners exist. No accessible native Windows/macOS/arm64 runner was supplied
or discovered; none was provisioned. The four workflow files remain `.disabled`.
No workflow was dispatched or enabled. PR #20/#21/#23/#24 heads and update times
are recorded in the [PR snapshot](../evidence/engine-phase1-native/pr-snapshot.json).

## Native target matrix

| Target | Runner / OS | Node / Electron | Commands executed | Native acceptance |
| --- | --- | --- | --- | --- |
| Linux x64 | Managed Cloud executor; Debian 13.6 trixie, kernel 6.18.57, UID 1000 | Node 24.22.0; Electron 44.9.3, matching package-lock | PR #20 smoke; direct baseline/refactored/control Electron; five command-level comparisons below | **BLOCKED** |
| Linux arm64 | No accessible runner | Not observed | None | **NOT RUN** |
| Windows x64 | No accessible runner | Not observed | None | **NOT RUN** |
| Windows arm64 | No accessible runner | Not observed | None | **NOT RUN** |
| macOS x64 | No accessible runner | Not observed | None | **NOT RUN** |
| macOS arm64 | No accessible runner | Not observed | None | **NOT RUN** |

The ambient Node was 24.19.0; all recorded Node probes explicitly used
`/workspace/rc3-toolchain/node-v24.22.0-linux-x64/bin/node`. Electron 44.9.3
was installed successfully using the project's existing checksum-verifying
installer, configured HTTPS proxy/CA trust and an external writable cache:

```sh
export PATH=/workspace/rc3-toolchain/node-v24.22.0-linux-x64/bin:$PATH
export NODE_USE_ENV_PROXY=1
export electron_config_cache=/workspace/engine-native-evidence/electron-cache
node node_modules/electron/install.js
node /workspace/engine-native-evidence/pr20/tests/desktop-smoke.mjs
python3 /workspace/engine-native-evidence/native-probe.py
```

Dependency installation exited 0; the archive was also independently rehashed
against the locked Electron package's checksums ([download evidence](../evidence/engine-phase1-native/electron-installation.json)).
The smoke exited 2 (**BLOCKED**) because neither
DISPLAY nor WAYLAND_DISPLAY is set, and neither Xvfb nor xvfb-run is installed.
Its [original result](../evidence/engine-phase1-native/pr20-desktop-smoke-result.json)
records that it allocated no profile or child process before the prerequisite
failure. No production security setting was modified to get past the check.

## Electron sandbox diagnosis and comparison

To distinguish prerequisite detection from native executable behavior, a bounded
direct probe then invoked the actual Electron binary, without Playwright-added
arguments, on both application entry points and a minimal Electron control.
Every invocation included `--enable-sandbox` and a disposable `--user-data-dir`.
The control calls `app.enableSandbox()` and would emit `CONTROL_READY` after
readiness; that marker was never reached.

All three exited by **SIGTRAP** (Python return code `-5`) with the same diagnostic:

```text
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166
The SUID sandbox helper binary was found, but is not configured correctly.
Rather than run without sandboxing I'm aborting now.
```

The diagnostic identifies `node_modules/electron/dist/chrome-sandbox`; its observed
owner/mode is **agent:agent 0755**. The system Chromium helper is
**nobody:nogroup 4755**, also not a root-owned helper. No chmod/chown or elevated
launch was attempted. Read-only host diagnostics show `NoNewPrivs: 1`,
`Seccomp: 2`, and no effective capabilities. An unprivileged
`unshare --user --map-root-user true` probe fails to write `/proc/self/uid_map`
with `Read-only file system`. A nonzero namespace limit alone is not proof that
the namespace sandbox is usable. See [host diagnostics](../evidence/engine-phase1-native/host.txt).

The direct application attempts use identical desktop code and the same locked
Electron binary. The independent control reproduces the host failure without
Personal code. This is an **environment blocker**, not an observed extraction
regression. It does not establish that application initialization would pass on
a suitable host. The missing graphical session is a second independent blocker.

No sandbox-disable flag, security environment override, production edit, elevated
privilege or repository-setting change was used. The direct diagnostic environments
inherit only PATH/locale/display variables and explicitly set temporary XDG paths,
TMPDIR, SIAAS_INSTALL_DIR and the managed Node path. Credentials and Node injection
options are not forwarded. Core dumps were disabled for these diagnostic children.

## Command-level results and acceptance coverage

The native Node/Bash commands below ran against both commits, without mocks.
Their stdout and exit codes matched exactly. These are limited command/negative
path checks; a deliberately rejected install is not a successful installation.

| Check | Observed result on both revisions | Classification |
| --- | --- | --- |
| `source-manager.mjs status` on empty temporary root | Exit 0, `null`; legacy root creation | **PASS**, empty-state compatibility only |
| `source-manager.mjs capabilities` | Exit 1, existing expected-command error | **PASS**, no adapter discovery added |
| `source-manager.mjs install --manifest <invalid.json>` with schemaVersion 999 | Exit 1, existing progress/error; no current.json or leftover operation lock | **PASS**, early failure and lock cleanup |
| `bash scripts/install.sh` with relative SIAAS_INSTALL_DIR | Exit 1, absolute-path rejection before network/write | **PASS**, stable entry-point validation |
| `bash scripts/install-rc.sh` without SIAAS_RELEASE_TAG | Exit 1, explicit-RC-tag rejection before network/write | **PASS**, RC entry-point validation |

The [recorded commands/results](../evidence/engine-phase1-native/native-probe-results.json)
contain exact argv, working directories, exit codes and profile requests;
[comparison results](../evidence/engine-phase1-native/command-comparison.json)
record the five successful comparisons. The
[diagnostic source](../evidence/engine-phase1-native/native-probe.py) is the exact
environment-specific script executed, not a portable installer test framework.
For reproduction, copy it to a fresh external evidence directory and set its
`repo`, `out` and `node` paths for that disposable host; do not overwrite archived
evidence. Obtain the baseline git object and locked Electron binary first.

| Required scenario | Linux x64 evidence in this follow-up | Other five targets |
| --- | --- | --- |
| Successful legacy installation | **BLOCKED**: native startup prerequisite fails; only early rejection paths executed | NOT RUN |
| Automatic launch after install | **BLOCKED**: direct Electron startup fails; no successful install performed | NOT RUN |
| Launcher generation and execution | **NOT RUN**: no native installed generation/launcher created | NOT RUN |
| Stable/candidate installation isolation | **NOT RUN**: rejection checks are not isolation acceptance | NOT RUN |
| Runtime userData/profile selection | **BLOCKED**: requested paths recorded, no app.getPath observation | NOT RUN |
| Existing installed metadata compatibility | **NOT RUN**: empty status is not populated-generation acceptance | NOT RUN |
| Repeat install/update | **NOT RUN**: no running native installation | NOT RUN |
| Rollback/uninstall | **NOT RUN**: no native installed generations | NOT RUN |
| User data preservation | **NOT RUN**: no populated native profile to exercise | NOT RUN |
| Failure handling and cleanup | **PASS** for early rejection/lock removal; **BLOCKED** for complete Electron process reaping | NOT RUN |
| Retained source-manager generations | **NOT RUN** natively; previous differential fixture coverage remains separate | NOT RUN |
| No new adapter capabilities | **PASS** for native legacy rejection plus unchanged public command set | NOT RUN |

Successful full installs were not started after the mandatory startup prerequisite
failed. Public stable/RC bootstrap scripts select published sources, not an
unpublished PR commit; running those downloads alone would not establish PR #25
acceptance. A future native run must bind its prepared source/manifest evidence
to both exact tested commits through the existing source-manager entry point,
and test public bootstrap compatibility separately, without altering released
assets or claiming a published archive contains this refactoring.

## Paths and cleanup

The direct probe owned `/tmp/siaas-native-acceptance-ndea_d5r` only. Requested
baseline/refactored userData directories were respectively:

```text
/tmp/siaas-native-acceptance-ndea_d5r/baseline/probe/profile
/tmp/siaas-native-acceptance-ndea_d5r/refactored/probe/profile
```

Both directories were created during failed startup, but **actual application
profile selection was not verified**. Temporary install roots were the sibling
`probe/installation` directories. XDG config/cache/data/runtime and TMPDIR were
also beneath the owned tree. No launcher was generated; actual stable/candidate
launcher paths are therefore N/A in this follow-up. All paths, versions, commands
and cleanup outcomes for unavailable targets are N/A, not inferred from Linux.

[Cleanup evidence](../evidence/engine-phase1-native/cleanup.json) confirms the
entire temporary tree was removed and no live member remained in the owned
process groups. However, exited zygotes PIDs **11250, 11279 and 11308** remain in
state **Z**, adopted by PID 1. The parent must reap those zombies; sending signals
cannot reap them. No PID 1 or unrelated process was signalled. **Complete process
cleanup is BLOCKED**, not PASS. This residue arose in baseline, refactored and
control attempts alike. Do not extrapolate it into a production cancellation bug.

Only diagnostic files and the downloaded dependency/cache remain in the workspace;
no Personal installation, real launcher or real user profile was used. No fresh
Electron attempt was made merely to repeat the same blocked result.

## Issue classification and readiness

| Finding | Class | Required resolution |
| --- | --- | --- |
| Identical sandbox fatal error in baseline/refactored/control | Environment blocker | Ordinary-user native host with working Chromium sandbox; no security bypass |
| No graphical session or Xvfb | Environment blocker | Authorized desktop/native test host |
| PID 1 does not reap three exited diagnostic zygotes | Environment blocker | Host lifecycle/reaping support; retain explicit cleanup accounting |
| No accessible Windows/macOS/arm64 runners; runner API forbidden | Insufficient evidence | Obtain native runners and execute each required scenario; 403 is not proof of absence |
| No successful real install/launcher/update/rollback cycle | Insufficient evidence | Baseline-versus-refactored native cycles with exact source identity and disposable profiles |
| Legacy repeated-uninstall fallback, stale-lock and limited compensation semantics | Existing baseline limitations | Preserve during extraction; separately scoped behavior review if changes are desired |
| New extraction regression | None established in executed comparisons | Remains unverified for blocked/unexecuted scenarios |

**PR #25 should remain Draft for this acceptance objective.** The extraction is
reviewable, but neither full native acceptance nor promotion to Ready for review
on the basis of native evidence is justified. Remaining acceptance covers all
twelve requested scenarios on all six targets, including sandbox-enabled GUI,
native launcher execution, actual profile observation, data preservation and
complete owned-process cleanup. PR #23/#24's adapter enforcement gates remain
separate and BLOCKED; no Installer Adapter v1 implementation is included.
