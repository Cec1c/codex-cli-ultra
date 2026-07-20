[CmdletBinding()]
param(
    [switch]$Build,
    [string]$ReleaseDir
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$exe = Join-Path $repoRoot 'tui\target\release\ccu-manager.exe'
if ($Build -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    & (Join-Path $repoRoot 'scripts\install-tui.ps1') -Build:$Build
}
$arguments = @(
    '--manager', (Join-Path $repoRoot 'dist\codex-ultra.mjs'),
    '--content-root', $repoRoot
)
if ($ReleaseDir) {
    $arguments += @('--release-dir', [System.IO.Path]::GetFullPath($ReleaseDir))
}
& $exe @arguments
exit $LASTEXITCODE
