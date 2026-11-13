# CLI-managed Personal installation — first executable slice (Draft)

Tracking: [SIAAS CLI M2 #2](https://github.com/siaas-software/siaas-cli/issues/2).
This is a **compatibility bootstrap slice**, not Installer Adapter Contract v1 and not a release approval.

## Behavior introduced

- The existing legacy `install` and `update` actions retain current GUI auto-launch behavior.
- New explicit source-manager actions `install-cli` and `update-cli` accept only `--prepared DIR --manifest FILE`, run the existing verified runtime/source/build/activation logic and do **not** call `launch()` after activation.
- `update-cli` refuses when there is no prior installation; the previously built generation is retained in the old installation record. The existing no-downgrade check remains.
- Future release installer scripts may set `SIAAS_CLI_INSTALLATION=1` to select the new action without changing the legacy default.
- Future release source generation emits a `siaas-cli-install-v1.json` capability **hint** into the release assets. Its presence alone is not authentication or proof of conformance; any CLI consumer MUST verify trusted release provenance, exact integrity metadata, appropriate script/content bindings and platform policies before executing anything.
- The new entry point does not automatically launch Electron. It **does** provision a runtime, run npm lifecycle/build and modify launcher/install metadata. Those actions are not sandboxed by this change.

## Evidence

- Existing `tests/source-manager-characterization.test.mjs` gains disposable filesystem/test-double scenarios for install-cli → update-cli, repeat, no auto-launch and unchanged legacy launch behavior; and rejection of malformed requests and updates without an installed generation.
- In-session in-memory behavior probes of the exact edited source-manager code, using injected fake state/build/launcher functions, passed four checked cases: install-cli (0 launches), install legacy (1 launch), update-cli without installation (rejects before lock/build), and malformed CLI arguments (rejects before lock/build). **These are mock-level checks, not real Node/Electron/OS execution.**
- Full repository test suite with pinned Node 24.22.0, native shell/PowerShell bootstrap tests, actual Electron and cross-platform matrix **NOT RUN**; review should not infer PASS.

## Safety gaps before enabling user-facing CLI install/update

1. Existing bootstrap source/build executes npm scripts. No accepted native process/network containment mechanism or transactional power-loss recovery has been implemented; see Personal PR [#23](https://github.com/siaas-software/siaas-personal/pull/23) and [#24](https://github.com/siaas-software/siaas-personal/pull/24).
2. Existing launchers use platform-specific default paths; stable/RC root and profile isolation must be enforced by the Go CLI, not assumed from arbitrary `SIAAS_INSTALL_DIR`. No automatic legacy adoption.
3. Live application quiescence, migration-safe backup and retained-generation integrity are not guaranteed; do not expose update-cli for running installations.
4. Existing legacy uninstall can remove a stable launcher after repeated direct RC uninstall; CLI uninstall needs a separate ownership-safe, idempotent command and tests before exposure.
5. The future release metadata marker is not itself an accepted normative Adapter v1 descriptor. Explicitly review any simplified bootstrap trust model and risk acceptance before declaring installation supported. Published Personal RC3 and stable 1.0.0 remain unchanged; they must be rejected as CLI-install-only unsupported rather than silently launched.
6. Artifact/source release tooling inventory changes need an independent release-policy review; no tags or assets are modified by this PR.

**Gate:** keep this draft until compatibility, security policy and native acceptance are demonstrated. No merge/release authorization; leave historical artifacts and other PRs untouched.
