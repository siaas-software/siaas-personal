---
name: siaas-deploy
description: Safe deployment procedure for the SIAAS Personal repository. Use before every website, app, CI, or release change.
---

# SIAAS Personal deploy procedure

## Goal
Deploy changes without unnecessary GitHub Actions runs, broken previews, or repeated failure emails.

## Mandatory workflow
1. Read the current target files from `main` in the relevant repository: `siaas-personal` for the desktop app, `siaas-public-site` for the website, or private `siaas-documentation` for maintainer guides. Never edit from remembered/stale snippets.
2. Batch related changes into one commit whenever possible.
3. Before committing, inspect the final source for stale copy, invalid references, imports, and JSX/TypeScript errors.
4. Website preview changes are deployed by Vercel. Do not run Desktop installers for normal website commits.
5. `Verify` is manual while GitHub-hosted jobs are failing before runner steps. Run it intentionally when CI infrastructure is healthy or before a merge/release.
6. Desktop installers run only:
   - manually with `workflow_dispatch`, or
   - for version tags matching `v*.*.*`.
7. Never trigger desktop packaging just to validate a website copy/style change.
8. After pushing a website change, query Vercel for the exact commit SHA. Do not report success until that deployment is `READY`.
9. If Vercel is `ERROR`, inspect the deployment/build logs before another commit.
10. Before reporting completion, re-read the changed source and confirm the requested text/UI is actually present.

## Release rule
For a real desktop release, validate the app first, then create the version tag. The tag is what starts the cross-platform installer workflow.

## Failure discipline
Do not make trial commits to diagnose CI. Inspect workflow state/logs first. If GitHub Actions fails before any step starts, treat it as runner/account/workflow infrastructure and do not repeatedly rerun or push speculative fixes.
