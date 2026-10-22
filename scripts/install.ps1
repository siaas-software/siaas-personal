$ErrorActionPreference = 'Stop'
$stage = $null
$oldOptions = $env:NODE_OPTIONS
$oldNodePath = $env:NODE_PATH
$oldInstallDir = $env:SIAAS_INSTALL_DIR
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'SIAAS Personal requires 64-bit Windows.' }
    $machineArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $arch = if ($machineArch -eq 'ARM64') { 'arm64' } elseif ($machineArch -eq 'AMD64') { 'x64' } else { throw 'Unsupported Windows architecture.' }
    Write-Host 'Checking the public SIAAS Personal release...'
    try { $m = Invoke-RestMethod -Uri "https://siaas.vercel.app/api/downloads?platform=win32&arch=$arch" -TimeoutSec 30 }
    catch { throw 'No downloadable public release is available, or the network is unavailable. Retry after a stable release is published.' }
    $semver = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
    if ($m.schemaVersion -ne 1 -or $m.platform -ne 'win32' -or $m.arch -ne $arch -or $m.version -notmatch $semver -or $m.runtime.version -notmatch $semver -or [int]($m.runtime.version.Split('.')[0]) -lt 24) { throw 'Invalid or incompatible download manifest.' }
    $name = "SIAAS-Personal-$($m.version)-source.zip"
    $sourceUrl = "https://github.com/siaas-software/siaas-personal/releases/download/v$($m.version)/$name"
    $nodeName = "node-v$($m.runtime.version)-win-$arch.zip"
    $nodeUrl = "https://nodejs.org/dist/v$($m.runtime.version)/$nodeName"
    if ($m.name -cne $name -or $m.downloadUrl -cne $sourceUrl -or $m.runtime.name -cne $nodeName -or $m.runtime.url -cne $nodeUrl -or $m.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $m.runtime.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $m.size -lt 1 -or $m.size -gt 500000000 -or [math]::Floor($m.size) -ne $m.size) { throw 'Invalid asset URL or integrity metadata.' }
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('siaas-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $sourceZip = Join-Path $stage 'source.zip'
    $nodeZip = Join-Path $stage 'node.zip'
    Write-Host "Downloading and verifying application source and Node.js $($m.runtime.version)..."
    Invoke-WebRequest -UseBasicParsing -Uri $sourceUrl -OutFile $sourceZip -TimeoutSec 180
    if ((Get-FileHash $sourceZip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $m.sha256 -or (Get-Item $sourceZip).Length -ne $m.size) { throw 'Application archive integrity verification failed.' }
    Invoke-WebRequest -UseBasicParsing -Uri $nodeUrl -OutFile $nodeZip -TimeoutSec 180
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$($m.runtime.version)/SHASUMS256.txt" -TimeoutSec 30).Content
    $checksum = @($checksums -split "`n" | Where-Object { ($_ -split '\s+')[1] -ceq $nodeName })
    if ($checksum.Count -ne 1 -or ($checksum[0] -split '\s+')[0] -cne $m.runtime.sha256 -or (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $m.runtime.sha256) { throw 'Runtime integrity verification failed.' }
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $stage
    $extracted = Join-Path $stage ([IO.Path]::GetFileNameWithoutExtension($nodeName))
    $env:NODE_OPTIONS = $null; $env:NODE_PATH = $null
    if ((& (Join-Path $extracted 'node.exe') --version) -cne "v$($m.runtime.version)" -or $LASTEXITCODE -ne 0) { throw 'The runtime is incompatible with this computer.' }
    $root = if ($env:SIAAS_INSTALL_DIR) { $env:SIAAS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'SIAAS Personal Source' }
    if (-not [IO.Path]::IsPathRooted($root)) { throw 'SIAAS_INSTALL_DIR must be an absolute path.' }
    $runtime = Join-Path $root "runtimes/node-v$($m.runtime.version)-win32-$arch"
    New-Item -ItemType Directory -Force -Path (Split-Path $runtime) | Out-Null
    if (Test-Path $runtime) {
        $existing = Join-Path $runtime 'node.exe'
        if (-not (Test-Path $existing) -or (Get-FileHash $existing -Algorithm SHA256).Hash -ne (Get-FileHash (Join-Path $extracted 'node.exe') -Algorithm SHA256).Hash) { throw "Close SIAAS Personal, rename the damaged runtime at $runtime, and rerun the installer. Your data is preserved." }
    } else { Move-Item -LiteralPath $extracted -Destination $runtime }
    $node = Join-Path $runtime 'node.exe'
    $record = @{folder=$runtime;node=$node;npm=(Join-Path $runtime 'node_modules/npm/bin/npm-cli.js');version=$m.runtime.version;binarySha256=(Get-FileHash $node -Algorithm SHA256).Hash.ToLowerInvariant()}
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText((Join-Path $runtime 'runtime.json'), ($record | ConvertTo-Json), $utf8)
    [IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), ($m | ConvertTo-Json -Depth 10), $utf8)
    Expand-Archive -LiteralPath $sourceZip -DestinationPath (Join-Path $stage 'source')
    $env:SIAAS_INSTALL_DIR = $root
    & $node (Join-Path $stage 'source/scripts/source-manager.mjs') install --prepared $stage --manifest (Join-Path $stage 'manifest.json')
    if ($LASTEXITCODE -ne 0) { throw 'Installation did not complete. The previous version and user data are preserved. Review the error above and retry.' }
} catch {
    Write-Host ('SIAAS: ' + $_.Exception.Message) -ForegroundColor Red
    $global:LASTEXITCODE = 1
    throw
} finally {
    $env:NODE_OPTIONS = $oldOptions; $env:NODE_PATH = $oldNodePath; $env:SIAAS_INSTALL_DIR = $oldInstallDir
    if ($stage -and (Test-Path $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
