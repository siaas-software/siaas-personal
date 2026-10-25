# Windows release candidate testing

Engineering acceptance procedure for v1.1.0-rc.1. This is a prerelease, not a
production-readiness claim. Use a separate installation and disposable sample data.
Real analytical Ollama acceptance, graphical Windows/macOS behavior and the full
native update/rollback lifecycle remain to be verified. Historical failed and
blocked attempts are retained in the technical report and release notes.

## Inspect and back up

Close SIAAS before copying its profile. Settings → Application updates → Open data
directory identifies the actual profile; use that path if yours is customized.
The established default is `%APPDATA%\SIAAS`. Do not delete a legacy installation.

```powershell
$SiaasStableRoot = Join-Path $env:LOCALAPPDATA 'SIAAS Personal Source'
$SiaasStableData = Join-Path $env:APPDATA 'SIAAS'
Get-Process -ErrorAction SilentlyContinue | Where-Object ProcessName -Like '*SIAAS*'
if (Test-Path (Join-Path $SiaasStableRoot 'current.json')) {
    Get-Content (Join-Path $SiaasStableRoot 'current.json')
}
$SiaasBackup = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('SIAAS-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $SiaasBackup -ErrorAction Stop | Out-Null
if (Test-Path $SiaasStableData) {
    Copy-Item -LiteralPath $SiaasStableData -Destination (Join-Path $SiaasBackup 'profile') -Recurse -ErrorAction Stop
}
if (Test-Path (Join-Path $SiaasStableRoot 'current.json')) {
    Copy-Item (Join-Path $SiaasStableRoot 'current.json') $SiaasBackup -ErrorAction Stop
}
```

The backup covers the app profile, including SQLite/WAL and managed documents.
Back up linked originals separately; a linked folder is not copied into the profile.
Verify the backup files before proceeding. Leave the original stable profile intact.

## Install the explicit candidate

This uses GitHub directly; it does not require a website deployment or global Node.
The installer verifies source/runtime hashes, provisions Node 24.22.0, runs npm ci,
builds Electron locally, and activates only after successful preparation. Network,
several GB of disk space and time are required. No Docker/Python is required.

```powershell
$ErrorActionPreference = 'Stop'
$SiaasTag = 'v1.1.0-rc.1'
$SiaasRelease = Invoke-RestMethod "https://api.github.com/repos/siaas-software/siaas-personal/releases/tags/$SiaasTag"
if ($SiaasRelease.draft -or -not $SiaasRelease.prerelease -or $SiaasRelease.tag_name -cne $SiaasTag) { throw 'Unexpected release state' }
$SiaasAsset = @($SiaasRelease.assets | Where-Object name -CEQ 'install-rc.ps1')
if ($SiaasAsset.Count -ne 1 -or $SiaasAsset[0].digest -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Missing verified installer' }
$SiaasScript = Join-Path $env:TEMP ('siaas-rc-' + [guid]::NewGuid().ToString('N') + '.ps1')
Invoke-WebRequest -UseBasicParsing $SiaasAsset[0].browser_download_url -OutFile $SiaasScript
if ((Get-FileHash $SiaasScript -Algorithm SHA256).Hash.ToLowerInvariant() -cne $SiaasAsset[0].digest.Substring(7)) { throw 'Installer checksum mismatch' }
$SiaasRcRoot = Join-Path $env:LOCALAPPDATA 'SIAAS Personal RC Source'
if (Test-Path (Join-Path $SiaasRcRoot 'current.json')) { throw 'RC already installed: inspect it before updating' }
$env:SIAAS_RELEASE_TAG = $SiaasTag
$env:SIAAS_INSTALL_DIR = $SiaasRcRoot
& $SiaasScript
if ($LASTEXITCODE -ne 0) { throw 'RC installation failed; inspect the preceding error' }
```

Respect PowerShell execution policy and antivirus controls. Do not use bypass flags
or disable protection. For file locks, close the relevant app/process and retry.
If organizational policy blocks scripts, ask the administrator for the approved path.

The RC uses `$SiaasRcRoot\profile`, not the stable data profile, and creates
`$SiaasRcRoot\launch-rc.cmd`, not a replacement Start Menu launcher.

```powershell
& (Join-Path $SiaasRcRoot 'launch-rc.cmd')
$SiaasInstalled = Get-Content (Join-Path $SiaasRcRoot 'current.json') -Raw | ConvertFrom-Json
$SiaasInstalled | Select-Object version, profile, folder
Invoke-RestMethod 'http://127.0.0.1:11434/api/version'
Invoke-RestMethod 'http://127.0.0.1:11434/api/tags'
```

If Ollama is not running, start the installed Ollama application/service. In SIAAS
Models select/download Qwen3 8B, then select it for the assistant. If Ollama CLI is
available, `ollama pull qwen3:8b` is the equivalent explicit model download. The
model is several GB; CPU-only inference may be slow. Agent eligibility requires
verified >=8B parameters and tool support. Never substitute a smaller model and
claim equivalent agent validation.

## Reproducible functional checks

Sample files are in `examples/structured-analysis` inside the installed version's
source directory: `$SiaasRcRoot\versions\<folder>\examples\structured-analysis`.

1. Create a project from Production Planning. Import orders.csv and operations.xlsx
   into its assistant Knowledge. Expect four datasets: orders, Inventory, BOM,
   Materials. Inspect previews/types and explicitly confirm each mapping.
2. Join Product between orders and Inventory (many-to-one). Ask for the total
   Quantity: **15**. Orders A=10, B=5; inventory A=8, B=9. Shortage A=**2**; B has
   **4** spare. Inspect the executed plan, filename, sheet and source ranges.
3. Configure Product between orders and BOM, then Material to Materials. Required
   M1=10×2+5×1=**25**; available=20; shortage=**5**. Confirm unit/recipe assumptions.
4. Create Personal Finance. Import transactions.csv and budgets.csv. Confirm ISO
   dates, number types, amount signs and Currency partitions. EUR income=**100**,
   EUR expenses=**30**, EUR balance=**70**; USD expenses=**4**, kept separate.
   Food EUR budget=35 versus actual=30: **5 remaining**. October EUR expense total=30.
5. Import duplicates.csv separately. Both T1 rows are duplicate candidates; do not
   combine this separate check with the transaction totals or delete records.
6. Compare results from the model-free query editor with Chat. A planning failure
   must report a limitation, never substitute invented totals. Save the complete
   error/result and elapsed time if real Ollama fails. Download evidence reports.
7. Add a small TXT/PDF Knowledge document and a configured public website. Ask a
   descriptive question, inspect citations, then combine instructions with the
   structured result. Confirm one assistant cannot access another's datasets.
8. Check Actions (report, mindmap, flashcards, quiz), Data Cell, loading/error states,
   light/dark themes and window resizing. Restart the RC and verify projects,
   files, mappings, chat and reports remain present. Export a project template:
   model must be null and private files/data/absolute paths must be absent.

## Update, rollback and preservation

Settings checks the stable channel, which excludes this prerelease. An older stable
version must not silently replace the RC. To install a later explicitly selected RC,
close the app, back up its profile, repeat the checksum-verified installer block with
the new tag and the same RC root, omitting only the first-install existence guard.
Never edit a manifest/version manually to simulate a real published update.

With two successfully installed RC versions, close the app before rollback:

```powershell
$env:SIAAS_INSTALL_DIR = $SiaasRcRoot
$SiaasNode = (Get-Content (Join-Path $SiaasRcRoot 'runtime-path') -Raw).Trim()
& $SiaasNode (Join-Path $SiaasRcRoot 'source-manager.mjs') status
& $SiaasNode (Join-Path $SiaasRcRoot 'source-manager.mjs') rollback
& (Join-Path $SiaasRcRoot 'launch-rc.cmd')
```

On a first installation, “No previous version” is expected: record rollback as
NOT TESTED until a second candidate exists. Rollback changes code/runtime, not
database migrations. Compare sample projects, conversations and file hashes before
and after. Never restore an older binary against important new-format data without
a verified backup. The untouched stable installation remains your separate fallback.

Optional uninstall of the test installation unregisters only its RC launcher and
active record; retained versions/profile remain. Do not delete them during validation.
Report OS/architecture, release tag, Ollama/model version, reproduction steps,
expected/actual result and sanitized logs. Do not attach financial files, recipes,
credentials or complete personal profiles to public GitHub issues.
