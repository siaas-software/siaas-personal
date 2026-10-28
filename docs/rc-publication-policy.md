# Permanent Release Candidate publication policy

Authorized by the user on 2026-10-28. Applies to RC2 and all subsequent SIAAS
Personal Release Candidates until explicitly changed or revoked by the user.

After all mandatory executable gates pass, proceed without additional confirmation:
review, protected GitFlow integration, release preparation/version/tag, source
assets/installers, checksum verification, GitHub **prerelease** publication and
anonymous published-asset verification. Never mark an RC stable or Latest. Do not
modify stable main or deploy the public website as part of this authorization.

## Mandatory gates

- All available mandatory automated tests, TypeScript checks and desktop builds pass.
- Applicable packaging and distribution tests pass.
- Installer, manifest, archive and checksum integrity checks pass.
- Simulated Ollama, Knowledge, Chat, Actions and structured-analysis regressions pass.
- No confirmed unresolved critical application defect; no invalid artifact.
- Existing GitFlow protections and mandatory GitHub checks are satisfied without bypass.
- Release version references and all distribution assets are internally consistent.

Actual test failures, critical defects, corrupt artifacts or unsatisfied protection
remain blockers. Inspect and fix them; do not relabel them as environmental limitations.

## Excluded environmental gates while these limitations persist

| Test | Recorded limitation | RC disposition |
| --- | --- | --- |
| Real Ollama inference | localhost:11434 connection refused | BLOCKED; post-publication manual acceptance |
| Chromium visual tests | Browser download unavailable/invalid | BLOCKED; post-publication manual acceptance |
| Linux Electron runtime | Sandbox socket restrictions | BLOCKED; post-publication manual acceptance |
| Native Windows EXE/icon/installation | Windows host unavailable | BLOCKED; post-publication manual acceptance |
| Native macOS | Compatible host unavailable | NOT RUN; post-publication manual acceptance |

Never report these as PASS. Do not retry them without a material infrastructure
change. Do not introduce unavailable platform-specific tests as new mandatory RC
gates without explicit user authorization. Stable promotion remains a separate
process and may require additional real-world validation.

## GitFlow and evidence

Feature PRs target develop. Keep versioned candidates on release branches derived
from reviewed develop; do not merge a candidate into stable main merely to publish.
Preserve immutable tags/releases. Record commit, executable tests, simulated-vs-real
scope, blockers, manifest/checksum evidence and manual checklist in the release notes.
Verify that published assets download anonymously and the installer resolves the
exact RC version, with separate stable and RC installation/data roots.

## Italiano

Questa autorizzazione permanente vale da RC2 fino a modifica o revoca esplicita.
Test obbligatori eseguibili PASS → integrazione protetta → preparazione → prerelease
automatica → verifica pubblica degli asset. Nessuna ulteriore conferma richiesta.
Ollama reale, Chromium, runtime Electron Linux e host Windows/macOS indisponibili
restano BLOCKED/NOT RUN e diventano verifiche manuali successive alla pubblicazione.
Non ripeterli senza cambiamenti dell'ambiente. Errori reali nei test obbligatori,
difetti critici confermati, asset corrotti e protezioni non soddisfatte continuano
a bloccare la release. Release stabile, Latest e sito pubblico restano separati.
