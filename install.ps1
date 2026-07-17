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
$temporaryContent = $null

if ($packaged) {
    $managerEntrypoint = Join-Path $sourceRoot 'bin\codex-ultra.mjs'
    $managerExecutable = Join-Path $sourceRoot 'bin\ccu-manager.exe'
    $contentSource = Join-Path $sourceRoot 'content'
}
else {
    $managerEntrypoint = Join-Path $sourceRoot 'dist\codex-ultra.mjs'
    $managerExecutable = Join-Path $sourceRoot 'tui\target\release\ccu-manager.exe'
    $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $temporaryContent = Assert-ChildPath `
        -Root $temporaryRoot `
        -Candidate (Join-Path $temporaryRoot ("codex-cli-ultra-content-{0}" -f [guid]::NewGuid().ToString('N'))) `
        -Label 'Temporary content directory'
    New-Item -ItemType Directory -Path (Join-Path $temporaryContent 'languages') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $temporaryContent 'themes') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $temporaryContent 'catalog') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'packages\languages\zh-CN') -Destination (Join-Path $temporaryContent 'languages\zh-CN') -Recurse
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'packages\themes\ccu-deepseek') -Destination (Join-Path $temporaryContent 'themes\ccu-deepseek') -Recurse
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'research\codex-0.144.4\tui-messages.jsonl') -Destination (Join-Path $temporaryContent 'catalog\tui-messages.jsonl')
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'packages\quota.example.json') -Destination (Join-Path $temporaryContent 'quota.example.json')
    $contentSource = $temporaryContent
}

$env:CODEX_ULTRA_HOME = $installRoot
$env:CODEX_CCU_CONTENT_ROOT = $contentSource
$arguments = @($managerEntrypoint, 'install')
if ($ForkReleaseDir) {
    $arguments += @('--release-dir', [System.IO.Path]::GetFullPath($ForkReleaseDir))
}
try {
    & node @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "codex-ultra install failed with exit code $LASTEXITCODE"
    }

    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    Copy-Item -LiteralPath $managerExecutable -Destination (Join-Path $bin 'ccu-manager.exe') -Force
    if (Test-Path -LiteralPath $content) { Remove-Item -LiteralPath $content -Recurse -Force }
    Copy-Item -LiteralPath $contentSource -Destination $content -Recurse
}
finally {
    if ($temporaryContent -and (Test-Path -LiteralPath $temporaryContent)) {
        Remove-Item -LiteralPath $temporaryContent -Recurse -Force
    }
}

$env:Path = "$bin;$env:Path"
Write-Host "安装完成。当前终端已优先使用：$(Join-Path $bin 'codex.ps1')" -ForegroundColor Green
Write-Host '验证命令：codex --version；codex --yolo' -ForegroundColor Cyan
