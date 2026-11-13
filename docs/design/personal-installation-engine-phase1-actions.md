# PR #25 — GitHub Actions runner feasibility and dispatch gate

**Verdict: BLOCKED at the runner/dispatch audit.** No workflow was dispatched,
no hosted runner was provisioned, and no new native acceptance result was obtained.
This report records the feasibility matrix before proceeding to workflow creation.
The conditional execution phase cannot currently be satisfied within the authorized
PR-branch-only scope. PR #25 remains Draft.

## Verified starting point and permissions

On 2026-11-10, repository `siaas-software/siaas-personal` was public, not archived
or disabled. The clean working branch was
`refactor/personal-installation-engine-phase1` at the expected
`1dd07a24717006631861d82a4ad1dd8f7de321a7`. Its production extraction remains the
one introduced in `71676c6cda1629b594b4cbca2be9941169de77f3`.
Baseline develop remains `17202c5964d9282efd4a1991c548612287c65dbb`; default branch
main remains `04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e`.

The PR diff, [extraction report](personal-installation-engine-phase1.md),
[native follow-up](personal-installation-engine-phase1-native.md), existing tests,
workflow trees on the PR and main, and repository rulesets were inspected.

| Read-only check | Observed result | Meaning |
| --- | --- | --- |
| Repository metadata | Public; default `main`; role metadata includes admin/push/pull | Role metadata does not establish the integration token's Actions permissions |
| `GET /repos/siaas-software/siaas-personal/actions/workflows` | HTTP 200; `total_count: 0` | No registered workflow available for dispatch |
| `GET .../actions/permissions` | HTTP 403, `Resource not accessible by integration` | Actions enablement/allowed-action policy NOT VERIFIED; not proof Actions is disabled |
| `GET .../actions/permissions/workflow` | Same 403 | Default workflow token permissions NOT VERIFIED |
| `GET .../actions/permissions/selected-actions` | Same 403 | Selected action allowlist NOT VERIFIED |
| `GET .../actions/runners` | Same 403 | Self-hosted runner inventory inaccessible; this endpoint does not enumerate standard hosted capacity |
| Git trees on PR and main | Only four `.yml.disabled` workflow files | No eligible default-branch manual workflow; existing release workflows unchanged |
| Rulesets | Branch and version-tag rulesets active | No settings/refs were changed or probed by writing |

The [audit record](../evidence/engine-phase1-actions/audit.json) preserves endpoint
responses, exact refs and infrastructure availability. No publishing credential
was used as an Actions credential. No token values or credential headers were logged.

The task specifically authorizes investigating/preparing an isolated manual
workflow, overriding AGENTS.md's general prohibition on adding hosted CI for
this limited purpose. AGENTS.md is **not** the reason for this stop. The blockers
are the verified default-branch/registration state, inaccessible Actions policy,
missing native test wiring and the user's explicit dispatch-authorization boundary.

## Runner feasibility matrix, before workflow creation

GitHub's official [standard public runner table][runner-table] documents native
labels for all six requested targets. This public repository qualifies for the
documented free **standard hosted compute** category. Catalog presence is not
proof of repository policy, queue access, a runnable graphical session, native
dependency compatibility or a successful test.

| Target | Candidate standard label | Catalog resources | Feasibility and acceptance limits |
| --- | --- | --- | --- |
| Linux x64 | `ubuntu-24.04` | 4 CPU, 16 GB RAM, 14 GB SSD | Native candidate. Image inventory lists Xvfb. Verify user namespaces/sandbox and available disk without changing host security controls |
| Linux arm64 | `ubuntu-24.04-arm` | 4 CPU, 16 GB RAM, 14 GB SSD | Native candidate. Image inventory lists Xvfb. Verify both host and Node/Electron are arm64 and native build dependencies work |
| Windows x64 | `windows-2022` | 4 CPU, 16 GB RAM, 14 GB SSD | Native candidate. Verify actual GUI session, PowerShell launcher execution, file-lock cleanup. Hosted Windows runs with administrator privileges/UAC disabled by image design; that does not demonstrate ordinary-user installation acceptance |
| Windows arm64 | `windows-11-arm` | 4 CPU, 16 GB RAM, 14 GB SSD | Native candidate. Reject x64-emulated Node/Electron evidence; verify all native dependencies, GUI session and cleanup. Same administrator-context limitation |
| macOS x64 | `macos-15-intel` | 4 CPU, 14 GB RAM, 14 GB SSD | Native Intel candidate; use the standard `-intel` label, not paid `-large`. Verify launcher execution, permissions and session availability |
| macOS arm64 | `macos-15` | 3 CPU, 7 GB RAM, 14 GB SSD | Native Apple Silicon candidate; not paid `-xlarge`. Record translation state, memory/disk headroom and native dependency behavior |

**Repository execution feasibility: BLOCKED/unverified for every row. Native
Actions acceptance: NOT RUN for every row.** No runner label is proven usable for
this repository merely by this table. No platform was silently omitted or replaced
by cross-compilation or a simulated `process.platform` value.

Image labels are version-specific, but image contents still roll forward. A future
run must capture the actual ImageOS/ImageVersion, OS build, CPU, process architecture,
Node and Electron versions. The current [runner image catalog][images] and pinned
Ubuntu inventories list Xvfb for [x64][ubuntu-x64] and [arm64][ubuntu-arm64]; this is
evidence of tooling availability in the catalog, not sandbox execution evidence.
Use preinstalled `xvfb-run -a` only after checking it exists and validating sandboxed
Electron on that runner. Do not install privileged helpers, change sysctls/AppArmor,
chmod/chown a SUID helper or disable the sandbox to obtain PASS.

### Costs and constraints

- GitHub documents standard hosted runner use in public repositories as free.
  No paid larger runner, custom image, self-hosted machine, runner group or paid
  infrastructure was provisioned. Do not substitute `-large`/`-xlarge` labels.
- Repository/organization quotas, queue/concurrency limits and artifact/storage
  policy were not established through the available credential. Catalog resource
  sizes do not prove sufficient free disk for two retained application generations.
  Fail preflight when required memory/disk headroom is absent; no paid fallback.
- Check any artifact-storage allowance before execution. Bound diagnostics and
  retention rather than assuming free compute implies unlimited artifact storage.
  Do not upload installers, application builds, user profiles or dependency caches.
- Windows' default administrator context is a runner limitation, not authorization
  to elevate a test to bypass a sandbox failure. macOS arm64 has no nested
  virtualization and no stable UDID; no signing secret or entitlement changes are
  in scope. Catalog beta/deprecation changes require rechecking labels before use.

## Why a PR-branch-only dispatch cannot proceed

GitHub's official [manual workflow documentation][manual] states:

> To trigger the `workflow_dispatch` event, your workflow must be in the default branch.

The [event-specific rule][dispatch] likewise says the trigger only receives events
when the workflow file is on the default branch. Here that branch is main, whose
tree contains only disabled files; the workflow API also lists zero registered
workflows. Adding a new dispatch-only file solely to PR #25's branch does not meet
that prerequisite. Selecting a branch with a dispatch `ref` is not a substitute
for establishing the eligible default-branch workflow.

The requested scope prohibits merging, changing repository settings, modifying
release workflows and dispatching without explicit authorization. No main-branch
registration, alternative event trigger, manual ref push or settings workaround
was attempted. A 403 was not worked around with a release-upload secret.

**Workflow path: none created. Trigger configuration: none installed.** A proposed
future path is `.github/workflows/personal-engine-native-acceptance.yml`, with only
`workflow_dispatch`. No placeholder workflow that runs mocked tests and reports
native success was added. The feasibility gate remains closed; creation and native
execution are deferred pending a separately authorized default-branch registration
route and verified Actions policy. This does not modify the existing disabled files.

## Existing infrastructure and required wiring

PR #20 at `1496298a6619708e56bba1b1a2d08c0b542b2d80` remains unmerged and untouched.
The target branch **does not contain** `tests/desktop-smoke.mjs`,
`tests/helpers/electron.mjs`, `tests/helpers/playwright-electron.mjs` or
`tests/helpers/runtime.mjs`. Previous execution of external read-only copies is
not availability in the target git tree. A future workflow cannot call these paths
without an explicitly reviewed, pinned reuse step or bringing the relevant test
files into the branch. A whole PR merge is not required or performed here.

Available characterization/regression tests should be retained. However:

- All seven source-manager characterization cases skip on non-Linux hosts and use
  fake npm/build/application executables on Linux. They remain useful differential
  tests, not evidence of native Electron installation on six platforms.
- The target's `tests/desktop-e2e.mjs` requires real Ollama models, does not explicitly
  set Playwright `chromiumSandbox: true`, and contains a root-only sandbox-disable
  argument. It must not be dispatched unchanged under this task's constraints.
- PR #20's sandbox-preserving smoke proves startup/profile/API checks when it runs;
  it does not by itself cover build/install/update/rollback/launcher acceptance.
  Reuse its lifecycle helpers with provenance, not a second test framework, when
  implementing the missing native scenarios.
- Stable/RC bootstrap scripts resolve published releases. Running them alone cannot
  establish that the unpublished PR code was exercised. Bind prepared source inputs
  to the exact baseline/refactored commits through the existing source-manager entry
  point; check public bootstrap behavior separately without editing released assets.
- No production engine changes or Installer Adapter v1 capabilities are needed or
  authorized for this test wiring.

## Reviewable execution specification once prerequisites are resolved

This is a design/checklist, **not an installed workflow or executed test**:

1. Use only `workflow_dispatch`, fixed standard labels from the matrix and a validated
   full refactored SHA. Fix baseline to `17202c5964d9282efd4a1991c548612287c65dbb`.
   Record workflow revision separately from application revisions. Require explicit
   user authorization identifying the runnable workflow/ref and selected targets
   before any dispatch. Do not add push, PR, schedule, workflow_run or reusable-call
   triggers as a registration workaround.
2. Pin reviewed action revisions; set `permissions: contents: read` and leave other
   GITHUB_TOKEN scopes disabled. Checkout with persisted credentials disabled.
   Do not map secrets, request OIDC or deployment/package/release permissions, or
   pass checkout authentication into npm/build/application children.
3. Use one workflow concurrency group with cancellation disabled, matrix
   `max-parallel: 1`, `fail-fast: false`, job timeout 60 minutes and bounded per-phase
   deadlines. Preserve cleanup/evidence collection on failure; timeout or missing
   completion must never become PASS. Reassess the time bound from actual builds.
4. Capture native host/process architecture and versions, display availability,
   namespace/sandbox prerequisites, CPU/RAM/disk and runner image version. Reject
   emulation and insufficient resources. On Linux use the already installed Xvfb
   with the sandbox enabled. No privileged security reconfiguration.
5. Run baseline and refactored code under equivalent locked Node 24.22.0/dependencies
   and verified Electron versions. Compare source/archive hashes and command results.
   Do not use a successful compile as an installation/launch acceptance assertion.
6. Use only explicitly owned disposable roots, launcher destinations and profiles.
   Exercise fresh/repeat install, automatic startup, actual launcher invocation,
   stable/RC isolation, observed userData, old metadata, update, rollback, uninstall,
   unrelated-data sentinels, failures and retained-manager compatibility. Any needed
   profile/root redirection belongs in reviewed test harness code, not production.
7. Emit per-scenario PASS/FAIL/BLOCKED/NOT RUN. Record requested and **observed** paths,
   exact commits/versions/commands, native process ownership and cleanup. Missing
   profile observation or skipped scenarios do not inherit a suite-level PASS.
8. Record live child processes separately from defunct processes and their parents.
   Reap owned children; never terminate unrelated processes or PID 1. Persist PID,
   parent, process-group and exit-state evidence. Unexplained zombies or incomplete
   temporary-directory removal block full cleanup acceptance.
9. Collect diagnostics even on failure, cap the artifact to 10 MiB per target and
   retain for 3 days. Include scenario JSON, bounded stdout/stderr and cleanup records;
   exclude profiles, credential-bearing environment dumps, binaries and caches.
   Reference actual run/job/artifact URLs only after a run exists. Retention and
   artifact quotas must be compatible with the repository's confirmed policy.

## Results actually obtained and next authorization boundary

This follow-up executed only read-only Git/GitHub/catalog audits and documentation/
JSON/link/diff validation. It executed **zero application, native GUI or Actions
acceptance tests**, and made **zero dispatch attempts**. No run ID, job result or
Actions artifact link exists to report. No paid runner was created.

All six Actions targets are **NOT RUN**. The previous Codex Linux x64 sandbox/display
failures remain environment blockers, not new application regressions. Its three
PID-1-adopted zombies are historical cleanup evidence; this audit launched no
Electron process and makes no claim that the old zombies were subsequently reaped.

Before advancing, obtain read-only confirmation of Actions enablement, permitted
actions/runners and usage policy; arrange a separately authorized reviewed route
for the dispatch-only definition to exist on main without bypassing protections;
complete the pinned native test wiring; then obtain explicit dispatch authorization
for the concrete revision/targets. If settings changes are required, they are
outside this task. No owner confirmation has been inferred from elapsed time or
from the instruction to continue the audit.

**PR #25 remains Draft; native acceptance readiness remains BLOCKED.** PR #20/#21/
#23/#24, application/installer code, release workflows, tags, protections and the
standalone CLI remain untouched.

[runner-table]: https://github.com/github/docs/blob/404a5f4de6cd5311e3ce2d5c076571291e0107d6/data/reusables/actions/supported-github-runners.md
[manual]: https://github.com/github/docs/blob/404a5f4de6cd5311e3ce2d5c076571291e0107d6/content/actions/how-tos/manage-workflow-runs/manually-run-a-workflow.md
[dispatch]: https://github.com/github/docs/blob/404a5f4de6cd5311e3ce2d5c076571291e0107d6/data/reusables/actions/workflow-dispatch.md
[images]: https://github.com/actions/runner-images/blob/741e4eb8ef5f51698d730ac16ede65cadb067522/README.md
[ubuntu-x64]: https://github.com/actions/runner-images/blob/741e4eb8ef5f51698d730ac16ede65cadb067522/images/ubuntu/Ubuntu2404-Readme.md
[ubuntu-arm64]: https://github.com/actions/runner-images/blob/741e4eb8ef5f51698d730ac16ede65cadb067522/images/ubuntu/Ubuntu2404-Arm64-Readme.md
