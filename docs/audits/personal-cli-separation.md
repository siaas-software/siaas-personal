# Personal / standalone CLI separation audit

Date: 2026-11-09. Scope: tracked Personal source at develop
`17202c5964d9282efd4a1991c548612287c65dbb`, also the published RC3 commit.
This is a static audit, not an installation or native acceptance run.
[Contract proposal](../design/installer-adapter-v1.md) and
[implementation roadmap](../design/installer-adapter-v1-roadmap.md) are future work.

## Conclusion and method

No active implementation of a standalone or former embedded SIAAS CLI was found
in this tree. There is no root package `bin` registration, general `siaas` command
router, or direct dependency on a SIAAS CLI package. The source manager is an active
Personal installer/lifecycle engine and must remain. A filename, subprocess or
transitive package containing `cli` is not evidence of embedded product ownership.
This conclusion concerns the inspected tree, not every historical commit or the
uninspected standalone CLI implementation.

Inspected tracked application/desktop code, scripts and helpers, package scripts,
root/optional-service manifests, lockfile consumers, build/packaging configuration,
all four disabled workflows, distribution/lifecycle/product tests, installation
and release documentation, and the draft PR #21 audit. Searches included `cli`,
`siaas-cli`, `commander`, `yargs`, `oclif`, `bin/siaas`, command dispatch, process
spawning and profile/update paths. Generated licensing inventory was distinguished
from direct dependencies; recorded evidence was retained. The phase-1 inspection
made no code changes.

Source links below are pinned to the inspected commit. Line ranges in prose are
inclusive. Classifications: **A** active legacy CLI to remove/migrate; **B** legitimate
Personal tooling; **C** historical evidence; **D** obsolete reference/test/dependency;
**E** shared behavior needing an ownership boundary. No A implementation or
confirmed orphan CLI dependency/test was identified; D recommendations concern
terminology, not deletion of working installer code.

## Findings, impact and actions

| ID / class | Evidence | Finding and impact | Recommendation |
| --- | --- | --- | --- |
| S01 B | [package.json:5](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/package.json#L5), scripts/dependencies through end | Personal-only npm scripts, private package, no root `bin`; desktop/build/test/research commands are internal tools. | Retain; do not add a second product CLI in Personal. |
| S02 B/E | [source-manager.mjs:191](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/source-manager.mjs#L191), 191–328, 333–423 | Real install/update/rollback/uninstall engine. New install activates and launches at 327–328. `status` creates root before reading; progress is mixed with subprocess output. | Reuse engine behind a strict adapter; do not remove or expose existing stdout as receipts. |
| S03 B/E | [source-manager.mjs:197](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/source-manager.mjs#L197), 197–243, 265–288 | `--prepared` only supplies `source.zip`; runtime provisioning still runs, npm/build/package may download and execute dependencies. | Define independent prepared-input and build-execution trust boundaries. Not an offline install contract. |
| S04 B/E | [source-manager.mjs:83](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/source-manager.mjs#L83), 83–159, 292–328 | Root configurable by environment; launcher inferred; candidate profile derived/preserved. No arbitrary explicit profile/launcher request schema. | Personal owns path resolution, ownership and safe activation. Explicit v1 selectors required. |
| S05 B/E | [source-manager.mjs:213](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/source-manager.mjs#L213), 213–217, 316–330, 363–418 | Same-version checks runtime only and rewrites launcher. Atomic current record is not a transaction across launcher/dispatcher/runtime-path. Directory lock lacks durable recovery protocol; rollback toggles previous/current and does not reverse data. | Add installed-tree integrity, journal and explicit rollback target before advertising idempotency/recovery. |
| S06 B | [install-rc.sh:3](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/install-rc.sh#L3), 3–51; [install-rc.ps1:41](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/install-rc.ps1#L41), 41–64 | Explicit RC bootstrap, source/runtime checks and separate default root; invokes manager with prepared input. Stable install.sh/ps1 remain standalone bootstrap entry points. | Retain all four installers. Candidate defaults are useful, but caller-overridden root can collide: v1 must enforce isolation. |
| S07 B | [update.sh:3](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/update.sh#L3), 3–9; [update.ps1:1](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/update.ps1#L1), 1–12; rollback/uninstall wrappers | Invoke installed manager with managed Node; legitimate Personal lifecycle, not standalone CLI remnants. | Preserve compatibility; migrate implementation only behind existing entry points. |
| S08 B/E | [desktop/main.cjs:22](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/desktop/main.cjs#L22), 22–25, 231–290 | Electron selects userData and calls manager after native update confirmation; detached updater waits for PID. | Keep renderer authentication, confirmation and desktop ownership. Do not interpret PID exit or spawn as readiness. |
| S09 B | [electron-builder.cjs:1](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/electron-builder.cjs#L1); scripts/desktop.mjs, build-desktop.mjs, prepare-package.mjs; next.config.ts | Linux executable named `siaas` is Electron, not standalone SIAAS CLI. Private runtime/parser/notices are desktop packaging. | Retain names for compatibility; qualify documentation as desktop executable. No rename justified by name collision alone. |
| S10 B | [package-lock.json:67](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/package-lock.json#L67), 67–82, 321–339, 3769–3790 | commander belongs to @electron/asar; postject/commander to @electron/windows-sign; yargs/cliui to electron-builder. | Retain transitive build dependencies; do not manually prune lockfile or licensing inventories. |
| S11 B | [research-services.mjs:119](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/scripts/research-services.mjs#L119); scripts/docker-prerequisites.mjs, check-ollama.ts, test-ollama.ts; services/morphic/package.json | Docker/npm/Ollama command use is optional-feature management and diagnostics. | Keep in Personal. Adapter install must not implicitly start optional services or pull models. |
| S12 B | [source-manager.test.mjs:10](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/tests/source-manager.test.mjs#L10), 10–55; tests/distribution.test.mjs, installer.test.cjs, source-rollback.test.cjs, product-identity.test.cjs | Linux fake-build test covers rollback/build failures/RC separation; other fixtures cover distribution and profiles. Not obsolete CLI tests; not cross-platform crash acceptance. | Preserve and extend in future implementation. Tests expecting legacy toggle rollback stay on legacy surface. |
| S13 C/B | [.github/workflows/desktop-release.yml.disabled:1](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/.github/workflows/desktop-release.yml.disabled#L1); ci/release/verify.yml.disabled | Disabled Personal build/release automation; no active standalone CLI workflow found. | Keep disabled; not adapter acceptance evidence or authorization to enable Actions. |
| S14 C | [RC3 notes:21](https://github.com/siaas-software/siaas-personal/blob/17202c5964d9282efd4a1991c548612287c65dbb/docs/releases/1.1.0-rc.3.md#L21); docs/evidence, docs/licensing, RC2/RC3 release reports | Reports record historical CLI references, tests and licensing. RC3 explicitly excludes draft CLI lifecycle work. | Preserve verbatim. Do not rewrite past results to claim adapter support. |
| S15 C/D/E | [PR #21 audit](https://github.com/siaas-software/siaas-personal/blob/9ea36d30c7b5adcfad0ce5c53ec5a3aee7d7c647/docs/audits/cli-lifecycle-audit.md#L1) and its gap matrix/roadmap | Documentation-only proposal based on 741b531. “Existing CLI” means command-line surface; proposed `siaas init/start/...` is future design, not implementation in develop. This terminology can confuse product ownership. | Keep PR untouched. In a later review, qualify Personal installer internals and place product command parsing/orchestration in standalone CLI. Retain useful profile/recovery findings; no dependency on merging #21 or #20. |

## Ownership and removal decision

Personal must own application build, installed layout, profile/launcher registration,
local integrity, recovery and rollback. CLI must own user commands, product/channel
resolution, verified acquisition, orchestration and user-facing diagnostics. Manifest
validation occurs on both sides: CLI verifies provenance; Personal rechecks bytes,
identity and compatibility before execution. Release publishing stays outside adapter.

There is no evidence-based removal list of embedded CLI code at this baseline.
Do not delete source-manager, installers, Linux `siaas`, dependency CLIs or tests.
The concrete cleanup recommendation is terminology clarification in future lifecycle
documentation and any future promotion of PR #21, with historical evidence intact.
Potential duplicated resolution logic is a boundary/refactoring issue, not dead code.

## Review context and limits

Default branch is main. Fresh develop equals RC3; main differs by the integrated
RC development work (173 changed paths at inspection), not by a hidden CLI branch.
Read-only ruleset checks show active main/develop PR protections and immutable v*
tag update/deletion protection with no bypass. PR #20 head is
`1496298a6619708e56bba1b1a2d08c0b542b2d80`; PR #21 head is
`9ea36d30c7b5adcfad0ce5c53ec5a3aee7d7c647`; both are draft and remain untouched.
No standalone CLI repository was modified or used as implementation evidence.
No application tests or installations were run for this documentation-only audit.
