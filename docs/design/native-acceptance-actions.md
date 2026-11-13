# Manual native acceptance infrastructure — preparation only

**Review status: PARTIAL. Execution is disabled; no native result is claimed.**
This feature PR prepares a manual workflow and a limited real Electron smoke
orchestrator. It does not activate Actions, merge code, modify production behavior,
implement Installer Adapter v1, or authorize a future run.

## Repository audit and GitFlow

Base develop: `17202c5964d9282efd4a1991c548612287c65dbb`.
Default main: `04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e`.
Branch: `feature/native-acceptance-actions`; PR target: **develop**.
The working tree was clean before branch creation. The branch follows
[CONTRIBUTING.md](../../CONTRIBUTING.md) and [AGENTS.md](../../AGENTS.md).

Read-only checks found active main/develop and version-tag rulesets, required PRs,
resolved conversations and no bypass actors. Actions policy reads returned HTTP
403: the settings are **UNKNOWN**, not proven disabled. The workflow listing
returned zero registered workflows. The four pre-existing `.yml.disabled` files
are unchanged. Default branch, protections and PR #20/#21/#23/#24/#25 are untouched.

Current policy says Actions remains disabled. The user's narrow authorization
permits preparing this unexecuted feature-branch definition; it does not change
the standing policy. Neither policy file is edited. Proposed amendments below
must be reviewed and adopted separately before any activation.

## Workflow and fail-closed preparation gate

[personal-engine-native-acceptance.yml](../../.github/workflows/personal-engine-native-acceptance.yml)
has **only `workflow_dispatch`**. It has no push/PR/scheduled/callable/deployment
trigger. Adding it on this feature branch does not authorize a run. GitHub requires
the definition on the default branch for manual dispatch; see the
[official rule](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

[reviewed.json](../../tests/native-acceptance/reviewed.json) contains a code-reviewed
`executionEnabled: false` gate. No workflow input or repository variable can turn
it on. An accidental future dispatch of this preparation revision fails the plan
job with `PREPARATION_ONLY_POLICY_GATE` before source checkout/build/native jobs.
It may allocate the bounded plan runner if someone dispatches after registration;
the gate is not a substitute for the policy prohibition on dispatch itself.

The native job depends on successful plan validation. Even after a separately
reviewed future gate change, the current harness always returns nonzero overall:
full installer scenarios and independent process-reaping verification are missing.
Successful smoke observations cannot turn the overall acceptance result green.

| Input | Accepted values / behavior |
| --- | --- |
| `platforms` | One of six target keys, `linux`, `windows`, `macos`, or `all`; at most six jobs |
| `baseline` | Only `17202c5964d9282efd4a1991c548612287c65dbb` |
| `candidate` | Only reviewed PR #25 SHA `e7f8feb5185d4d64c23ace6a904b637c726b97ff` |
| `authorization` | Only `PREPARATION_ONLY`; this is not permission to run |

SHA values must be exact lowercase 40-character hashes; branch names, alternate
hashes, whitespace and unexpected platform selections are rejected. Inputs reach
Node through environment variables, never interpolated shell code. The workflow
definition is checked out at `github.workflow_sha`, separately recorded from the
two application revisions. Changing a reviewed application SHA requires a code
review of the allowlist, not selecting a new branch HEAD in the UI.

After the closed gate, future preflight would check both exact commits through
anonymous bounded API calls to the fixed repository. Each native checkout's HEAD,
origin and absence of persisted HTTP authentication headers are verified before
builds. Baseline/candidate lockfile digests must match. API/rate-limit failures
fail closed. No unvalidated remote ref or downloaded script is executed.

## Runner feasibility and resource bounds

These are documented standard hosted **candidates**, not confirmed repository
availability or native PASS. All six targets are **NOT RUN** in this preparation.
The repository is public; GitHub documents standard public hosted compute as free.
No larger, paid, custom or self-hosted runner is selected or provisioned.

| Target | Standard label | Remaining native prerequisite |
| --- | --- | --- |
| Linux x64 | `ubuntu-24.04` | Preinstalled Xvfb, ordinary-user Chromium sandbox, native build dependencies |
| Linux arm64 | `ubuntu-24.04-arm` | Same, plus actual arm64 Node/Electron/dependencies |
| Windows x64 | `windows-2022` | Actual GUI session and native cleanup; image runs as administrator, so this does not establish ordinary-user acceptance |
| Windows arm64 | `windows-11-arm` | Same, plus no x64-emulation substitution |
| macOS x64 | `macos-15-intel` | Intel process, launcher/GUI permissions and dependencies |
| macOS arm64 | `macos-15` | Native arm64 process, no Rosetta, sufficient memory/disk |

Source: [GitHub's standard public runner table](https://github.com/github/docs/blob/404a5f4de6cd5311e3ce2d5c076571291e0107d6/data/reusables/actions/supported-github-runners.md).
Image versions and capacity roll forward; record actual OS, ImageOS/ImageVersion,
native machine, process architecture, Node and Electron versions in any future run.
Do not equate successful cross-builds with native execution.

One concurrency group has cancellation disabled; `max-parallel: 1` and
`fail-fast: false` bound execution while retaining other target diagnostics.
Plan timeout is 5 minutes; native job timeout is 60 minutes. Each revision's suite
has a 27-minute bound, with dependency/Electron/build/smoke command limits of
8/3/12/3 minutes. Cleanup itself has the reused helper's deadlines; hard host/job
termination can interrupt it and must not be reported as successful cleanup.
At least 10 GiB free disk and 4 GiB free RAM are required before work, with disk
rechecked before the second revision. No paid fallback or host disk cleanup is used.

Artifact retention is 3 days. Only bounded JSON summaries under `evidence/` are
uploaded; the native summary has a 1 MiB limit. No dependency cache action, profiles,
application binaries, installers, screenshots or traces are uploaded. Actual
repository/org quotas, storage costs and action allowlists remain to be verified.

## Test harness provenance and actual scope

[provenance.json](../../tests/native-acceptance/vendor/pr20/provenance.json) records
four byte-for-byte test files from PR #20 commit
`1496298a6619708e56bba1b1a2d08c0b542b2d80`, their original paths and SHA-256 digests.
They were fetched again at that immutable ref and compared before delivery. This
is scoped reuse of existing Playwright/Node helpers, not a PR merge or a new test
framework. Their original generic browser/real-model helper exports are not used
by this workflow; only the sandbox-preserving Electron smoke path is wired.

PR #20 is not otherwise present on develop. The copied helper files remain under
a test-only vendor directory. Before a future smoke run, they are hash-checked and
copied to an owned `.native-acceptance` directory in each disposable application
checkout, so they resolve that revision's locked dependencies. Production scripts
and application files are not rewritten. The test-only copy is removed afterward.

The orchestrator would run `npm ci`, the project's checksum-verifying Electron
installer and `npm run desktop:build`, then the real Electron smoke on each exact
revision under equivalent Node 24.22.0 and lockfile conditions. Linux uses an
already installed `xvfb-run -a`; it never installs privileged helpers. The smoke
sets `chromiumSandbox: true`, observes Electron's actual userData, checks a real
SQLite file/API boundary, closes and restarts the application in its temporary
profile. Ollama is a loopback fixture; this proves neither model inference nor
installation behavior. None of this was executed in this task.

| Scenario | Prepared implementation | Remaining gap |
| --- | --- | --- |
| Locked dependencies and desktop build | Orchestration for both exact revisions | Native execution unverified; build is not install acceptance |
| Direct Electron startup/restart/profile/SQLite/API boundary | Reused PR #20 native smoke | Native execution unverified; GUI failures may still be host blockers |
| Cleanup of tracked child processes/temp directories | Existing owned-process helper and explicit path-removal evidence | Independent live/defunct process accounting, PID 1 behavior, process escape/crash paths unverified |
| Legacy source install, automatic post-install launch and launcher execution | **NOT IMPLEMENTED** | Full native installer harness needed; never substitute direct smoke launch |
| Stable/RC roots, populated metadata and retained managers | **NOT IMPLEMENTED** | Native fixtures/observations needed |
| Repeat install/update/rollback/uninstall/data preservation/failure recovery | **NOT IMPLEMENTED** | Disposable native lifecycle scenarios needed |

Full native acceptance is deliberately reported **BLOCKED** after smoke success;
missing scenarios stay NOT RUN. A real command/cleanup error remains FAIL and is
not erased by a later prerequisite blocker. Smoke diagnostics classify known
sandbox/display messages without automatically calling them extraction regressions.
Reports keep requested/observed profile information distinct. There is no Installer
Adapter v1 advertisement, parser, receipt or installation-only engine here.

## Security review and residual limits

- Only `contents: read`; all unspecified GITHUB_TOKEN permissions are disabled.
  No OIDC, environments, deployment/package/release scopes or production secrets.
  All checkouts fix the repository, use reviewed revisions and set
  `persist-credentials: false`. No git push/tag/release command exists in the workflow.
- Only official checkout/setup-node/upload-artifact actions are used, pinned to
  full commit SHAs. Their manifests and relevant input/runtime declarations were
  inspected at those refs. No third-party service or remote shell installer is added.
- Child build/app environments use an explicit allowlist. They do not receive
  GitHub/Actions/cloud credentials, inherited application data paths, NODE_OPTIONS,
  NODE_PATH, Electron override variables or user npm configuration. Proxy/CA trust
  is preserved. An empty owned npmrc and owned npm/Electron caches are selected.
- Every new profile, XDG directory and Windows application-data override is under
  an owned temporary root. Existing user installs and launchers are not invoked.
  Whole checkouts/build output exist only on disposable hosted jobs. Cleanup never
  kills by image name, targets PID 1, or deletes unrelated directories.
- No sandbox-disable argument is introduced. TLS, OS security, signing/quarantine
  and production Electron settings remain unchanged. Missing sandbox support is
  a blocker, not permission to change SUID ownership, AppArmor, sysctls or UAC.
- Reviewed source and locked dependency lifecycle scripts still execute code if
  a future run is authorized. Environment filtering is not filesystem/network
  containment. This is not the Installer Adapter security backend from PR #23/#24.
- Existing helpers have bounded process cleanup but do not prove every descendant
  was reaped. `fullProcessReaping` always remains UNVERIFIED here. No absence of
  live processes, timeout result or VM disposal is converted into a zombie-cleanup
  PASS. Independent native process census/ownership evidence is a future blocker.
- Raw PR #20 traces can contain ephemeral desktop request keys and are excluded
  from artifacts. Artifacts contain selected structured observations/command exit
  records, not raw environments or browser traces. Local bounded helper logs stay
  in the disposable job workspace and are not uploaded by this definition.

## Proposed policy amendments — NOT effective

The following replacements/additions are **proposals only**. CONTRIBUTING.md and
AGENTS.md remain unchanged; these paragraphs confer no merge or execution authority.

1. Replace CONTRIBUTING.md's “GitHub Actions remains disabled” paragraph with a
   narrowly approved exception, retaining the unrelated status-check requirement:

   > Do not require status checks that do not exist. GitHub Actions remains disabled
   > except for the separately reviewed personal-engine-native-acceptance.yml manual,
   > non-publishing workflow, after explicit maintainer approval of its registration,
   > policy and execution gate. Each dispatch requires authorization for the exact
   > workflow revision, application SHAs and target subset. Release/deployment and
   > automatic workflows remain disabled. This exception adds no required status
   > check, merge queue, production secret or publishing authority.

2. Replace AGENTS.md's general “Keep GitHub Actions disabled” bullet consistently:

   > Preserve disabled release/deployment/automatic workflows. The approved manual
   > native-acceptance workflow may be prepared through feature branches; its
   > activation and each dispatch require separate explicit authorization under
   > CONTRIBUTING.md. Never infer run permission from successful static checks,
   > PR creation or default-branch registration. Paid/self-hosted runners and
   > repository security changes are outside this exception.

3. Extend CONTRIBUTING.md's documentation-only non-publishing integration clause:

   > An expressly reviewed, non-publishing test-infrastructure integration may also
   > use feature/* → develop → release/* → main, followed by synchronization back to
   > develop, without a release tag or published application artifact. Review the
   > entire release-to-main diff, including any pre-existing application changes.
   > The infrastructure exception neither authorizes those changes nor exempts
   > required PR reviews/protections. Release branch naming and promotion scope
   > must be approved explicitly; do not invent an application version to ship CI.

The existing routing supports feature → develop and release → main. However the
explicit no-publication exception currently mentions **documentation-only** work;
it does not unambiguously cover this workflow plus executable harness. This remains
a policy contradiction for eventual infrastructure-only promotion, not a reason
to bypass the authorized preparation branch.

## Future promotion, activation and removal

1. Review this Draft PR against develop. No merge is authorized by this task.
2. Separately approve/adopt the proposed policy text and native test coverage needed
   for the intended run. Confirm repository Actions/action allowlists, runner access,
   quotas and credentials without interpreting HTTP 403 as disabled Actions.
3. After authorized feature integration, use a reviewed release/* branch from
   develop and a protected PR into main, then synchronize back to develop. No tag,
   release, published application asset or existing release workflow is needed.
   **Current develop differs from main in 173 files, including production code.**
   Thus a release merge is not automatically infrastructure-only. Its complete
   scope requires separate approval; do not cherry-pick or change routing silently.
4. Default-branch registration alone does not authorize execution. A future reviewed
   change must address the preparation acknowledgement and code gate, coverage gaps,
   cleanup evidence and bounded result semantics. Do not simply flip the boolean
   to call an incomplete suite acceptance-ready. Verify the registered workflow
   and obtain explicit authorization for the concrete workflow/app SHAs/platforms.
5. Only then may an authorized actor dispatch. No dispatch command was run here.
   Record real run/job/artifact URLs, image versions and scenario outcomes afterward.

To withdraw preparation, close the unmerged Draft PR. If later integrated, remove
the workflow/test-only files through a reviewed feature/develop/release/main route
and revoke the documented exception. Restoring the code gate blocks future native
jobs but does not cancel a running job or erase artifacts; cancellation, retention
and any settings change require their own authorization. Never delete release
assets, tags or user data as workflow rollback.

## Static validation and delivery limits

Run from the repository root with locked development dependencies already present:

```sh
node tests/native-acceptance/validate-static.mjs
git diff --check
```

The validator only parses YAML/JSON, exercises the pure input validator, verifies
provenance hashes and invokes `node --check`/`bash -n`. It never imports execution
entry points, installs dependencies, builds, launches Electron or dispatches.
It checks ten valid platform choices, fifteen invalid input/context cases, all
six runner mappings, action pins, read-only permissions, shell-expression separation,
artifact bounds and the closed gate. Local Markdown links and the final diff were
also checked. See [static results](../evidence/native-acceptance-actions/static-validation.json).

All six platforms: **NOT RUN**. There are no Actions run IDs or native artifact
URLs. Prior Codex sandbox failures are host evidence, not regressions introduced
here. The separate PR is suitable for review of the preparation; overall delivery
is **PARTIAL** because full native lifecycle/cleanup wiring and activation policy
remain unresolved. Successful static validation is not native acceptance.
