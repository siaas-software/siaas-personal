# Installation, managed runtime and updates

SIAAS Personal runs locally with Electron and Ollama. No account, paid AI API, global Node.js, npm, Git or NVM changes are required by the distributed source installer. Developers can still use their own Node.js with `npm ci` and `npm run desktop:dev`.

## Requirements and availability

Use a 64-bit Windows, macOS or Linux desktop (x64 or arm64), an Internet connection for installation/model downloads, and adequate disk and memory. Allow at least 10 GB of free space as a starting point. Linux needs the system libraries required by Electron and a graphical session; native dependency builds may require the OS compiler toolchain. macOS security restrictions remain active. The scripts do not bypass TLS verification, Gatekeeper or PowerShell execution policy.

The bootstrap requires no existing Node.js. Windows uses PowerShell 5.1+ and Windows archive tools. macOS/Linux require Bash, curl, tar, unzip, and sha256sum or shasum. Normal usage requires no Docker. Advanced Reasoning (Beta) and Advanced Web Research (Beta) are optional, independent features, both off by default; enabling either requires Docker Engine 20.10+ (Linux containers, x64/arm64), Compose v2 and explicit opt-in in Settings → Experimental Features. Advanced Web Research also requires the assistant-level toggle; documents and configured websites share a standard workflow without Docker. See the research guide.

**Prelaunch:** installation cannot complete until the application repository and stable release assets are public. A private repository or missing release produces a clear availability error, not a request for GitHub credentials. These changes do not publish a release or launch the product.

## Existing installations

For the previous v1.2.0 release, follow the [migration procedure](migration-en.md). The new v1.0.0 release uses a separate installation root and preserves the existing desktop data profile.

## Windows

Review [install.ps1](https://siaas.vercel.app/install.ps1), then run in a normal PowerShell terminal:

```powershell
irm https://siaas.vercel.app/install.ps1 | iex
```

The script retrieves `/api/downloads?platform=win32&arch=x64` (or `arm64`), validates its schema and trusted asset URLs, downloads the release source ZIP and official Node.js runtime, checks SHA-256 and archive size, and builds the application. Runtime checksums are also compared with Node.js `SHASUMS256.txt`. The Start menu launcher uses an explicit managed runtime path.

## macOS and Linux

Review [install.sh](https://siaas.vercel.app/install.sh), then:

```bash
curl -fsSL https://siaas.vercel.app/install.sh -o install-siaas.sh
bash install-siaas.sh
```

The installer detects the OS/architecture, verifies artifacts, builds locally and creates a launcher in `~/Applications` on macOS or `~/.local/share/applications` on Linux. Use the architecture matching your operating system; do not force execution of an incompatible binary.

## Application-managed Node.js

The distribution pins **Node.js 24.22.0 LTS**. The application's desktop packager requires Node 24's Zstandard support; the version is recorded in `runtime.json` and the per-release installation specification. Official runtime archives cover Windows/macOS/Linux x64 and arm64. The Linux x64 runtime and application build have been exercised here; Windows, macOS and arm64 still require native acceptance testing.

Default application installation roots:

- Windows: `%LOCALAPPDATA%/SIAAS Personal Source`
- macOS/Linux: `~/.local/share/siaas-personal-source`
- Optional override: absolute `SIAAS_INSTALL_DIR`

Runtime archives are unpacked under `runtimes/node-v<VERSION>-<PLATFORM>-<ARCH>`. Each application version records its runtime in `current.json`; startup verifies the runtime binary hash and version. The packaged server also uses a private Node executable. Build subprocesses receive a temporary PATH beginning with the managed runtime and explicit npm CLI paths. The installer does not change the user's PATH, global Node installation, NVM configuration or models.

## Updates, rollback and repair

Use **Settings → Application updates**. The application confirms before closing; detached update output is retained in `update.log` in the installation root. An update stages and validates the new application before activation. Current and previous application/runtime versions are kept; obsolete known version directories are pruned after successful activation. Unknown files are preserved. Each installed release retains its source manager.

The release's `scripts/update.ps1` or `scripts/update.sh` uses the managed runtime; `scripts/rollback.ps1` or `scripts/rollback.sh` switches to the previous application/runtime. `scripts/uninstall.*` unregisters the launcher while preserving installed versions and user data. Rollback does not reverse database migrations. Back up important data before upgrading.

Older source installations without a managed runtime record cannot be verified by the new manager. Rerun the new installer to install a managed version; do not delete your workspace. A previous legacy installation without runtime metadata cannot be safely activated by managed rollback. A missing, corrupted or incompatible runtime stops startup with repair instructions. Close the application, rename the affected runtime directory and rerun the official installer; never change global Node.js or NVM to repair SIAAS.

## Distribution contract and troubleshooting

The public manifest resolves the latest stable public GitHub Release without authentication. It requires two assets from the application repository:

- `SIAAS-Personal-<VERSION>-source.zip` (repository contents at the archive root)
- `SIAAS-Personal-<VERSION>-install.json` (`schemaVersion: 1`, `version`, `nodeVersion`)

Both require valid GitHub SHA-256 asset digests. Maintainers create these locally with `npm run release:source` from a committed release checkout; the command does not publish anything. The installer checks agreement between the manifest, package version and runtime specification. Publishing a release remains a separately authorized action.

- **No public stable release:** check release visibility and the two required assets. GitHub's automatically generated source archives are not a substitute for these assets and their integrity metadata.
- **Installer service not configured:** the old site proxied `SIAAS_SERVICE_URL`. That dependency has been removed from the source; an authorized site redeploy is needed before the public endpoint uses the fix. No replacement token or private service is required.
- **Network/HTTP error:** check connectivity to GitHub, release-assets.githubusercontent.com, nodejs.org and the package registry. Retry; the prior installation remains available if staging/building fails.
- **Checksum/schema mismatch:** stop and retry from the official endpoint. Do not disable integrity verification.
- **Build error:** inspect the terminal or `update.log`, disk space and OS build dependencies. Keep the working installation and data.

The website keeps `SITE_LAUNCH_STATUS=prelaunch`, no indexing and an empty prelaunch sitemap. After the approved repository reconnection, Vercel deploys commits from the new `main` branch. Deployment does not change the prelaunch indexing policy.
