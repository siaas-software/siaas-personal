# Contributing to SIAAS Personal

SIAAS Personal uses GitFlow. All changes to `main` and `develop`, including documentation and maintenance changes, go through pull requests.

## Branches and pull request targets

| Branch | Purpose | Start from | Pull request target |
| --- | --- | --- | --- |
| `main` | Stable, releasable history; default branch | Existing stable branch | Receives `release/*` and `hotfix/*` |
| `develop` | Integration for the next release | Existing integration branch | Receives `feature/*` and completed release/hotfix changes |
| `feature/*` | A focused feature, fix, or documentation change | Latest `develop` | `develop` |
| `release/*` | Stabilization and release preparation | Latest `develop` | `main`, then back to `develop` |
| `hotfix/*` | An urgent correction to the stable version | Latest `main` | `main` and `develop` |

Keep `main` as the default branch. Do not recreate, reset, or force-push either long-lived branch. GitHub may default a new pull request to `main`; explicitly select `develop` for feature pull requests.

## Feature workflow

Start from an up-to-date integration branch:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c feature/short-description
# Edit and validate the intended changes.
git add <changed-paths>
git commit -m "Describe the change"
git push -u origin feature/short-description
```

Open a pull request from `feature/short-description` into `develop`. Describe the resulting behavior, relevant validation, and any limitations. Inspect the diff and resolve every review conversation before merging.

Delete the feature branch after it has been merged when it is no longer needed. Never delete `main` or `develop`.

## Release workflow

1. Create `release/<version>` from the latest `develop`.
2. Limit changes to stabilization, release documentation, versioning, and necessary fixes. Validate the exact candidate using the existing project and distribution checks.
3. Open a pull request from that release branch into `main` and merge with **Create a merge commit**.
4. Bring the completed release back into `develop` through another pull request from the release branch. If the stable merge introduced conflict-resolution changes, include those changes through a `main` → `develop` pull request too.
5. Keep the release branch until both destinations contain its changes, then delete it.
6. Only when a release is explicitly authorized, tag the validated stable commit on `main` and publish the prepared release using the existing manual release process.

A documentation-only integration may follow the same release-branch pull request path without creating a version tag or publishing a release. A merge, branch creation, or documentation change does not itself authorize publication.

## Hotfix workflow

1. Create `hotfix/<description>` from the latest `main`.
2. Implement and validate the smallest appropriate stable correction.
3. Open and merge a pull request into `main` with **Create a merge commit**.
4. Open and merge a second pull request from the hotfix branch into `develop`. Include any stable merge conflict resolutions through a `main` → `develop` pull request if needed.
5. If a release branch is already active, bring the correction into that branch through a pull request as well.
6. Delete the hotfix branch only after the required integrations. Publish a new patch release only with explicit release authorization.

Do not cherry-pick between long-lived branches as the normal integration strategy; preserve shared ancestry with merge commits.

## Merge settings

Use **Create a merge commit** for release, hotfix, and long-lived branch synchronization pull requests. It preserves the ancestry needed for the subsequent integration.

The repository permits merge commits, squash merges, and rebase merges. Squash or rebase may be used for a short-lived feature branch that will be discarded after merging. Do not use them for release/hotfix promotion or synchronization between `main` and `develop`.

Linear history is not required because it would prevent these GitFlow merge commits. Automatic branch deletion is disabled; clean up short-lived branches manually after all required merges.

## Repository protection policy

Repository-level rulesets must be **Active**, with these targets and rules:

| Ruleset target | Required rules | Bypass |
| --- | --- | --- |
| Branches `main` and `develop` | Pull request before merging; all review conversations resolved; block force pushes; restrict deletions | Empty bypass list, including no administrator, team, or app exemption |
| Tags `v*` | Restrict updates; restrict deletions; block force pushes | Empty bypass list |

While there is one maintainer, a pull request requires **zero approving reviews**. The maintainer may inspect and merge their own pull request, but may not bypass the pull request requirement or unresolved conversations.

Do not require status checks that do not exist. GitHub Actions remains disabled; this policy does not enable workflows, require Actions checks, or add a merge queue. Run relevant checks locally and record their results in the pull request.

Branch updates are permitted through compliant pull request merges. Do not enable the separate branch **Restrict updates** rule with an empty bypass list: it would also block the intended merge workflow.

The `v*` tag pattern deliberately protects all version-prefixed tags, including `v1.0.0` and any future prerelease tags. Tag creation remains permitted for authorized releases, but an existing matching tag must never be moved, overwritten, or deleted. Publish a new version to correct a released version.

Rulesets enforce pull requests and ref integrity. They do not enforce the branch-name routing table above; the maintainer must check the source and target branches before merging.

## Release immutability

GitHub's repository-level **Enable release immutability** setting protects the tags and assets of future published releases. Prepare and verify every asset on a draft release before publication; after publication its assets cannot be added, replaced, or deleted.

Enable immutability before publishing the first stable release. Verify the actual setting and release state; branch/tag rules alone do not lock release assets. Previously published releases in other repositories remain untouched.

See GitHub's [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) and [enabling release immutability](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes) documentation.

## Validation and enforcement checks

For application changes, follow the commands in [Development](README.md#development), plus the relevant targeted checks. For documentation-only changes, verify links, commands, language, and consistency; application builds are unnecessary when application files have not changed.

After changing administrative controls:

- Read back the saved rulesets and confirm Active enforcement, exact ref targets, empty bypass lists, and the rules above.
- Confirm the default branch remains `main`, merge commits remain enabled, and Actions remains disabled.
- Use a real, non-no-op fast-forward ref-update attempt to verify that a direct update to each protected branch is rejected for requiring a pull request. Use a commit with no eligible pull request targeting that branch: GitHub can recognize a manual fast-forward merge of an existing compliant pull request and mark that pull request as merged. A dry run or an up-to-date push does not establish enforcement. Use only an already-reviewed documentation commit as the probe so an unexpected success cannot introduce application changes; stop and investigate if it succeeds.
- Confirm compliant pull requests remain mergeable by the sole maintainer without another approving reviewer or nonexistent checks.
- Inspect the saved tag rules without attempting destructive updates or deletion of published version tags.
- Compare the published release identity and asset IDs, names, sizes, digests, and modification timestamps before and after administrative changes.

Keep SIAAS Personal under its existing MIT [LICENSE](LICENSE). This workflow does not change application behavior, installers, release assets, or third-party licensing.
