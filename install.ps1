[CmdletBinding()]
param(
    [string]$InstallRoot = $(
        if ($env:CODEX_ULTRA_HOME) { $env:CODEX_ULTRA_HOME }
        else { Join-Path $env:LOCALAPPDATA 'codex-cli-ultra' }
    ),
    [string]$ForkReleaseDir,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)] [string]$Root,
        [Parameter(Mandatory)] [string]$Candidate,
        [Parameter(Mandatory)] [string]$Label
    )

    $resolvedRoot = [System.IO.Path]::GetFullPath($Root)
    $resolvedCandidate = [System.IO.Path]::GetFullPath($Candidate)
    $separator = [System.IO.Path]::DirectorySeparatorChar.ToString()
    $rootPrefix = if ($resolvedRoot.EndsWith($separator, [System.StringComparison]::Ordinal)) {
        $resolvedRoot
    }
    else {
        "$resolvedRoot$separator"
    }
    if (-not $resolvedCandidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside the install root: $resolvedCandidate"
    }
    return $resolvedCandidate
}

$sourceRoot = $PSScriptRoot
$packaged = Test-Path -LiteralPath (Join-Path $sourceRoot 'bin\codex-ultra.mjs') -PathType Leaf
if (-not $packaged -and -not $SkipBuild) {
    Push-Location $sourceRoot
    try {
        npm run build
        Push-Location (Join-Path $sourceRoot 'tui')
        try { cargo build --release }
        finally { Pop-Location }
    }
    finally { Pop-Location }
}

$installRoot = [System.IO.Path]::GetFullPath($InstallRoot)
if ($installRoot.Equals([System.IO.Path]::GetFullPath($sourceRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'InstallRoot must not be the installer source directory.'
}
$bin = Join-Path $installRoot 'bin'
$content = Assert-ChildPath -Root $installRoot -Candidate (Join-Path $installRoot 'content') -Label 'Content directory'
New-Item -ItemType Directory -Path $bin -Force | Out-Null

if ($packaged) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'bin\codex-ultra.mjs') -Destination $bin -Force
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'bin\launcher.mjs') -Destination $bin -Force
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'bin\ccu-manager.exe') -Destination $bin -Force
    if (Test-Path -LiteralPath $content) { Remove-Item -LiteralPath $content -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'content') -Destination $content -Recurse
}
else {
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'dist\codex-ultra.mjs') -Destination $bin -Force
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'dist\launcher.mjs') -Destination $bin -Force
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'tui\target\release\ccu-manager.exe') -Destination $bin -Force
    if (Test-Path -LiteralPath $content) { Remove-Item -LiteralPath $content -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $content 'languages') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $content 'themes') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $content 'catalog') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'packages\languages\zh-CN') -Destination (Join-Path $content 'languages\zh-CN') -Recurse
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'packages\themes\ccu-deepseek') -Destination (Join-Path $content 'themes\ccu-deepseek') -Recurse
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'research\codex-0.144.4\tui-messages.jsonl') -Destination (Join-Path $content 'catalog\tui-messages.jsonl')
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'packages\quota.example.json') -Destination (Join-Path $content 'quota.example.json')
}

$env:CODEX_ULTRA_HOME = $installRoot
$env:CODEX_CCU_CONTENT_ROOT = $content
$arguments = @((Join-Path $bin 'codex-ultra.mjs'), 'install')
if ($ForkReleaseDir) {
    $arguments += @('--release-dir', [System.IO.Path]::GetFullPath($ForkReleaseDir))
}
& node @arguments
if ($LASTEXITCODE -ne 0) {
    throw "codex-ultra install failed with exit code $LASTEXITCODE"
}

$env:Path = "$bin;$env:Path"
Write-Host "安装完成。当前终端已优先使用：$(Join-Path $bin 'codex.ps1')" -ForegroundColor Green
Write-Host '验证命令：codex --version；codex --yolo' -ForegroundColor Cyan
