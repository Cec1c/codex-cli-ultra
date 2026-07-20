[CmdletBinding()]
param(
    [string]$InstallRoot = $(
        if ($env:CODEX_ULTRA_HOME) { $env:CODEX_ULTRA_HOME }
        else { Join-Path $env:LOCALAPPDATA 'codex-cli-ultra' }
    ),
    [string]$ForkReleaseDir,
    [switch]$SkipBuild,
    [switch]$EnableStatusLine,
    [switch]$DisableStatusLine,
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($EnableStatusLine -and $DisableStatusLine) {
    throw 'EnableStatusLine and DisableStatusLine cannot be used together.'
}

function Write-InstallStep {
    param(
        [Parameter(Mandatory)] [int]$Number,
        [Parameter(Mandatory)] [int]$Total,
        [Parameter(Mandatory)] [string]$Message
    )
    Write-Host ("[{0}/{1}] {2}" -f $Number, $Total, $Message) -ForegroundColor Cyan
}

function Resolve-ApplicationPath {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$InstallHint
    )

    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $command) {
        throw "Cannot find $Name. $InstallHint"
    }
    return $command.Source
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(Mandatory)] [string[]]$ArgumentList,
        [Parameter(Mandatory)] [string]$FailureMessage
    )

    & $FilePath @ArgumentList
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "$FailureMessage (exit code $exitCode)."
    }
}

function Test-NetworkFailureText {
    param([Parameter(Mandatory)] [string]$Text)

    return $Text -match '(?i)(fetch failed|network|socket|timed?\s*out|timeout|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|TLS|GitHub latest release request failed with HTTP (403|408|429|5\d\d)|HTTP (403|408|429|5\d\d) while fetching)'
}

function Invoke-CcuInstall {
    param(
        [Parameter(Mandatory)] [string]$NodePath,
        [Parameter(Mandatory)] [string[]]$ArgumentList,
        [Parameter(Mandatory)] [bool]$UsesOnlineForkRelease
    )

    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        & $NodePath @ArgumentList 2> $stderrPath
        $exitCode = $LASTEXITCODE
        $stderrText = if (Test-Path -LiteralPath $stderrPath) {
            Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
        }
        else {
            ''
        }
        if ($exitCode -eq 0) {
            return
        }
        if ($UsesOnlineForkRelease -and (Test-NetworkFailureText -Text $stderrText)) {
            Write-Host ''
            Write-Host '你的网络跳起来没够到墙，你应该前往 https://github.com/Cec1c/codex-cli-ultra/releases 直接下载压缩包安装' -ForegroundColor Red
            Write-Host '安装程序提桶跑路。' -ForegroundColor Red
            exit $exitCode
        }
        if (-not [string]::IsNullOrWhiteSpace($stderrText)) {
            Write-Host $stderrText.Trim() -ForegroundColor Red
        }
        throw "codex-ultra install failed (exit code $exitCode)."
    }
    finally {
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Test-NodeDependencies {
    param([Parameter(Mandatory)] [string]$ProjectRoot)

    $manifestPath = Join-Path $ProjectRoot 'package.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
    $requirements = @(
        $manifest.dependencies.PSObject.Properties
        $manifest.devDependencies.PSObject.Properties
    )
    foreach ($requirement in $requirements) {
        $installedManifestPath = Join-Path $ProjectRoot (
            'node_modules\{0}\package.json' -f ([string]$requirement.Name).Replace('/', '\')
        )
        if (-not (Test-Path -LiteralPath $installedManifestPath -PathType Leaf)) {
            return $false
        }
        $installedManifest = Get-Content -LiteralPath $installedManifestPath -Raw |
            ConvertFrom-Json -ErrorAction Stop
        $expectedVersion = [string]$requirement.Value
        if (
            $expectedVersion -match '^\d+\.\d+\.\d+(?:[-+].+)?$' -and
            [string]$installedManifest.version -ne $expectedVersion
        ) {
            return $false
        }
    }
    return $true
}

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
$nodePath = Resolve-ApplicationPath -Name 'node' -InstallHint 'Install Node.js 24 or newer and retry.'
$nodeVersionText = (& $nodePath --version).Trim().TrimStart('v')
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the Node.js version (exit code $LASTEXITCODE)."
}
$nodeVersion = $null
if (-not [version]::TryParse($nodeVersionText, [ref]$nodeVersion) -or $nodeVersion.Major -lt 24) {
    throw "Node.js 24 or newer is required; found $nodeVersionText."
}
Write-Host ''
Write-Host 'Codex CLI Ultra 中文版安装程序' -ForegroundColor Green
Write-Host '不会结束当前 Codex；官方 npm Codex 会保留为英文回退版本。' -ForegroundColor DarkGray
Write-InstallStep -Number 1 -Total 5 -Message '检查安装包与本机环境'
if (-not $packaged -and -not $SkipBuild) {
    $npmPath = Resolve-ApplicationPath -Name 'npm' -InstallHint 'Reinstall Node.js with npm and retry.'
    $cargoPath = Resolve-ApplicationPath -Name 'cargo' -InstallHint 'Install the Rust toolchain and retry.'
    Write-Host '检测到源码目录，正在构建 CCU 管理器。' -ForegroundColor DarkGray
    Push-Location $sourceRoot
    try {
        if (-not (Test-NodeDependencies -ProjectRoot $sourceRoot)) {
            Write-Host 'Node 依赖缺失或与 package.json 不一致，正在执行 npm ci。' -ForegroundColor DarkGray
            Invoke-CheckedCommand `
                -FilePath $npmPath `
                -ArgumentList @('ci') `
                -FailureMessage 'CCU Node dependency installation failed'
        }
        Invoke-CheckedCommand `
            -FilePath $npmPath `
            -ArgumentList @('run', 'build') `
            -FailureMessage 'CCU Node manager build failed'
        Push-Location (Join-Path $sourceRoot 'tui')
        try {
            Invoke-CheckedCommand `
                -FilePath $cargoPath `
                -ArgumentList @('build', '--release', '--locked') `
                -FailureMessage 'CCU Rust manager build failed'
        }
        finally { Pop-Location }
    }
    finally { Pop-Location }

    foreach ($requiredBuildOutput in @(
        (Join-Path $sourceRoot 'dist\codex-ultra.mjs'),
        (Join-Path $sourceRoot 'dist\launcher.mjs'),
        (Join-Path $sourceRoot 'tui\target\release\ccu-manager.exe')
    )) {
        if (-not (Test-Path -LiteralPath $requiredBuildOutput -PathType Leaf)) {
            throw "Required build output was not created: $requiredBuildOutput"
        }
    }
}

if (-not $ForkReleaseDir) {
    $bundledForkRelease = Join-Path $sourceRoot 'fork-release'
    if (Test-Path -LiteralPath (Join-Path $bundledForkRelease 'ccu-fork-manifest.json') -PathType Leaf) {
        $ForkReleaseDir = $bundledForkRelease
    }
}

$statusLineEnabled = if ($EnableStatusLine) {
    $true
}
elseif ($DisableStatusLine) {
    $false
}
elseif (-not $NonInteractive -and [Environment]::UserInteractive) {
    Write-Host ''
    Write-Host '可选 Hermes 状态栏：🦊 gpt-5.6-sol[xhigh] │ 42.7K/353K │ [█░░░░░░░░░] 9% │ ⏱ 1s ⚡0s │'
    $answer = Read-Host '是否启用 CCU Hermes 四段式状态栏？[y/N]'
    $answer -match '^(?i:y|yes|是)$'
}
else {
    $false
}
$statusLineMessage = if ($statusLineEnabled) {
    '状态栏预设：启用'
}
else {
    '状态栏预设：不启用（可稍后重新安装时启用）'
}
Write-Host $statusLineMessage -ForegroundColor DarkGray

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
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'packages\themes\ccu-hermes') -Destination (Join-Path $temporaryContent 'themes\ccu-hermes') -Recurse
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'research\codex-0.144.5\tui-messages.jsonl') -Destination (Join-Path $temporaryContent 'catalog\tui-messages.jsonl')
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'templates\languages\messages.en-US.ftl') -Destination (Join-Path $temporaryContent 'catalog\messages.en-US.ftl')
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'packages\quota.example.json') -Destination (Join-Path $temporaryContent 'quota.example.json')
    $contentSource = $temporaryContent
}

$env:CODEX_ULTRA_HOME = $installRoot
$env:CODEX_CCU_CONTENT_ROOT = $contentSource
$arguments = @($managerEntrypoint, 'install')
if ($ForkReleaseDir) {
    $arguments += @('--release-dir', [System.IO.Path]::GetFullPath($ForkReleaseDir))
}
if ($statusLineEnabled) {
    $arguments += '--enable-statusline'
}
else {
    $arguments += '--disable-statusline'
}
try {
    Write-InstallStep -Number 2 -Total 5 -Message '校验并安装翻译版 Codex'
    Invoke-CcuInstall `
        -NodePath $nodePath `
        -ArgumentList $arguments `
        -UsesOnlineForkRelease (-not [bool]$ForkReleaseDir)

    Write-InstallStep -Number 3 -Total 5 -Message '安装 CCU 管理命令与中文内容'
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

Write-InstallStep -Number 4 -Total 5 -Message '更新当前终端命令优先级'
$env:Path = "$bin;$env:Path"
Write-InstallStep -Number 5 -Total 5 -Message '安装完成'
Write-Host "CCU 命令目录：$bin" -ForegroundColor Green
Write-Host '新终端中的 codex 会启动中文版本；官方英文版仍保留用于一键回退。' -ForegroundColor Green
Write-Host '验证命令：codex --version；codex --i18n-self-check；codex --yolo' -ForegroundColor Cyan
Write-Host '卸载回退：运行安装包中的 uninstall.cmd，或执行 codex-ultra uninstall。' -ForegroundColor Cyan
