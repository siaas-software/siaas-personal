# Windows x64 Personal installer — isolated preview validation

This proposed CI workflow builds **one unsigned SIAAS Personal RC4 installer .exe**
from exactly the immutable public RC4 source commit
`d8bf6e61a4d47920a00cc4e069a90cf26ac2d80f` (version `1.1.0-rc.4`).
It does **not** package SIAAS CLI or any CLI release assets.

## Scope and isolation

- CI is strictly `pull_request` to `develop` or explicit `workflow_dispatch`;
  no release publishing, main/develop merge, or changes to immutable RC4.
- Uses Electron Builder's existing NSIS `oneClick:false`, per-user setup
  configuration with desktop/Start shortcuts and `deleteAppDataOnUninstall:false`.
- Windows x64 only in this preview gate. Cross-platform Windows ARM64, macOS and
  Linux installers require separate native packaging/review before availability.
- Build artifacts are uploaded as **temporary GitHub Actions artifacts** for
  signed-in test users, **not** GitHub Releases. The website must not display a
  permanent download button for these temporary artifacts.
- The file is **unsigned**. Windows security controls may reject it. Do not
  disable antivirus, SmartScreen or organizational execution policy.
- Must not silently overwrite Stable installations; during manual acceptance,
  choose a dedicated RC4 test directory and verify profiles/backups and unrelated
  Stable/Ollama sentinels before and after setup.

## Reviewer verification

1. Verify Windows runner's exact source SHA, Node 24.22.0, `npm ci`,
   `npm run typecheck`, `npm run desktop:package -- --x64` and checksum
   from the Actions run. Confirm one `SIAAS-Personal-1.1.0-rc.4-*.exe`.
2. Download test artifact from GitHub Actions, extract only the executable.
   Compare file SHA-256 to the log. Do not trust an arbitrary similarly named file.
3. On a disposable Windows 11 user account/profile, verify GUI installer, target
   directory, shortcuts, first launch, app version, repeat install and uninstall.
4. Confirm Personal user data, other channel installation, CLI installation,
   existing Ollama models, system PATH and unrelated files are unchanged.
5. Record outcome with commands/screenshot/output on the PR; only after a
   separate publisher security decision should a signed public setup release
   be planned.

No promise of public installer availability or of completed desktop GUI acceptance
is made by merely building the artifact.
