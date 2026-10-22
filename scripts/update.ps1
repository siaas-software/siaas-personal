param([ValidateSet('update','rollback','uninstall','check','status')][string]$Action = 'update')
$ErrorActionPreference = 'Stop'
$root = if ($env:SIAAS_INSTALL_DIR) { $env:SIAAS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'SIAAS Personal Source' }
$record = Get-Content -LiteralPath (Join-Path $root 'current.json') -Raw | ConvertFrom-Json
$node = $record.runtime.node
if (-not $node -or -not [IO.Path]::IsPathRooted($node) -or -not (Test-Path -LiteralPath $node)) { throw 'Managed runtime unavailable. Rerun the official installer.' }
$oldOptions=$env:NODE_OPTIONS; $oldNodePath=$env:NODE_PATH
try {
 $env:NODE_OPTIONS=$null; $env:NODE_PATH=$null
 & $node (Join-Path $root 'source-manager.mjs') $Action
 if ($LASTEXITCODE -ne 0) { throw 'SIAAS Personal operation failed. Review the message above.' }
} finally { $env:NODE_OPTIONS=$oldOptions; $env:NODE_PATH=$oldNodePath }
