[CmdletBinding()]
param([switch]$Build)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$exe = Join-Path $repoRoot 'tui\target\release\ccu-manager.exe'
if ($Build -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    & (Join-Path $repoRoot 'scripts\install-tui.ps1') -Build:$Build
}
& $exe --manager (Join-Path $repoRoot 'dist\codex-ultra.mjs') --content-root $repoRoot
exit $LASTEXITCODE
