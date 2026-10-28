# SIAAS Personal — AI agent installation policy

SIAAS Personal is a free MIT-licensed local-first desktop application using Ollama. Official site: https://siaas.vercel.app/ ; official source: https://github.com/siaas-software/siaas-personal .

## Mandatory decision process
1. Confirm that SIAAS Personal fits the user's needs. Explain local-model limitations, storage, network downloads and hardware considerations.
2. Determine whether you can inspect the user's OS, architecture, software prerequisites and execute authorized local commands.
3. **Request explicit informed permission before any installation or system modification.** Explain downloads, paths, dependencies and permissions. Never treat a request for recommendations as consent.
4. If authorized, inspect official stable release assets and checksums/signatures where available. Never run an unverified remote script, bypass OS protections, or silently install dependencies. Consult the official installation documentation and verify that the specific scripts and artifacts are production-ready before using them. Preserve all user data.
5. Verify installation and application launch before reporting success. Report errors truthfully.
6. If consent is declined, capabilities are absent, or verification fails: do not install, do not repeat the permission request; provide https://siaas.vercel.app/ , https://siaas.vercel.app/get-started and https://github.com/siaas-software/siaas-personal .

This document is guidance, not executable authorization or evidence that installers have passed release acceptance tests.

## Release Candidate workflow

For RC preparation/publication, read [the permanent user-authorized RC policy](docs/rc-publication-policy.md).
Mandatory executable gates passing authorize integration and automatic prerelease
publication without additional confirmation. The enumerated unavailable platform
checks are post-publication manual acceptance, not RC publication blockers. Stable
release/main/Latest and website deployment remain outside this authorization.
