[CmdletBinding()]
param(
    [string]$InstallRoot = $(
        if ($env:CODEX_ULTRA_HOME) { $env:CODEX_ULTRA_HOME }
        else { Join-Path $env:LOCALAPPDATA 'codex-cli-ultra' }
    ),
    [switch]$Build
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot 'tui\target\release\ccu-manager.exe'
if ($Build -or -not (Test-Path -LiteralPath $target -PathType Leaf)) {
    Push-Location (Join-Path $repoRoot 'tui')
    try { cargo build --release }
    finally { Pop-Location }
}

$bin = Join-Path ([System.IO.Path]::GetFullPath($InstallRoot)) 'bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $bin 'ccu-manager.exe') -Force
Write-Host "CCU Rust TUI 已安装：$(Join-Path $bin 'ccu-manager.exe')" -ForegroundColor Green
