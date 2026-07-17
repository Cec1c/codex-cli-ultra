[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$SourceWorktree
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PinnedCommit = "8c68d4c87dc54d38861f5114e920c3de2efa5876"
$RequiredCargoVersion = "1.95.0"
$CatalogPath = Join-Path $ProjectRoot "research/codex-0.144.4/tui-messages.jsonl"
$PackRoot = Join-Path $ProjectRoot "packages/languages/zh-CN"
$FtlPath = Join-Path $PackRoot "messages.ftl"
$CliPath = Join-Path $ProjectRoot "src/cli.mjs"

function Resolve-SingleApplication {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $sources = @(
        Get-Command $Name -CommandType Application -All -ErrorAction Stop |
            ForEach-Object { $_.Source } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Select-Object -Unique
    )
    if ($sources.Count -ne 1) {
        throw "Expected exactly one application for '$Name'; found $($sources.Count): $($sources -join ', ')"
    }
    return $sources[0]
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)]
        [string]$Label,

        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [Parameter(Mandatory)]
        [string]$WorkingDirectory
    )

    Write-Host "==> $Label"
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Label failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-CapturedCommand {
    param(
        [Parameter(Mandatory)]
        [string]$Label,

        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [Parameter(Mandatory)]
        [string]$WorkingDirectory
    )

    Write-Host "==> $Label"
    Push-Location -LiteralPath $WorkingDirectory
    try {
        $output = @(& $FilePath @Arguments)
        if ($LASTEXITCODE -ne 0) {
            throw "$Label failed with exit code $LASTEXITCODE."
        }
        return ($output -join "`n").Trim()
    }
    finally {
        Pop-Location
    }
}

function Invoke-CargoTest {
    param(
        [Parameter(Mandatory)]
        [string]$Label,

        [Parameter(Mandatory)]
        [string]$Filter,

        [Parameter(Mandatory)]
        [int]$ExpectedPassed,

        [Parameter(Mandatory)]
        [string]$CargoPath,

        [Parameter(Mandatory)]
        [string]$RustRoot
    )

    $output = Invoke-CapturedCommand `
        -Label $Label `
        -FilePath $CargoPath `
        -Arguments @("test", "--locked", "-p", "codex-tui", $Filter) `
        -WorkingDirectory $RustRoot
    Write-Host $output
    $expectedResult = "test result: ok. $ExpectedPassed passed; 0 failed;"
    if (-not $output.Contains($expectedResult, [System.StringComparison]::Ordinal)) {
        throw "$Label did not run the expected $ExpectedPassed test(s)."
    }
}

function Assert-SelfCheck {
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Probe,

        [Parameter(Mandatory)]
        [bool]$ExpectedActive,

        [AllowNull()]
        [object]$ExpectedLocale,

        [Parameter(Mandatory)]
        [System.Collections.IDictionary]$ExpectedMessages
    )

    if ($Probe.schemaVersion -ne 1) {
        throw "Unexpected self-check schema version: $($Probe.schemaVersion)"
    }
    if ([bool]$Probe.active -ne $ExpectedActive) {
        throw "Unexpected self-check active state: $($Probe.active)"
    }
    if ($Probe.locale -ne $ExpectedLocale) {
        throw "Unexpected self-check locale: $($Probe.locale)"
    }
    foreach ($entry in $ExpectedMessages.GetEnumerator()) {
        $actual = $Probe.messages.($entry.Key)
        if ($actual -ne $entry.Value) {
            throw "Self-check message '$($entry.Key)' was '$actual'; expected '$($entry.Value)'."
        }
    }
    if ($Probe.messages.'ultra.i18n.missing-key' -ne "English fallback") {
        throw "The self-check missing-key probe did not use its English fallback."
    }
}

$sourceRoot = (Resolve-Path -LiteralPath $SourceWorktree).Path
$rustRoot = Join-Path $sourceRoot "codex-rs"
if (-not (Test-Path -LiteralPath (Join-Path $rustRoot "Cargo.toml") -PathType Leaf)) {
    throw "SourceWorktree is not a Codex source worktree: $sourceRoot"
}
$adapterTargets = @(
    (Join-Path $rustRoot "tui/src/i18n.rs"),
    (Join-Path $rustRoot "tui/src/i18n_tests.rs"),
    (Join-Path $rustRoot "tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_narrow.snap"),
    (Join-Path $rustRoot "tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_medium.snap"),
    (Join-Path $rustRoot "tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_wide.snap")
)
foreach ($adapterTarget in $adapterTargets) {
    if (-not (Test-Path -LiteralPath $adapterTarget -PathType Leaf)) {
        throw "The Codex i18n adapter is not fully applied; missing: $adapterTarget"
    }
}
$cliMainPath = Join-Path $rustRoot "cli/src/main.rs"
if (-not (Select-String -LiteralPath $cliMainPath -SimpleMatch "--ultra-i18n-self-check" -Quiet)) {
    throw "The Codex i18n adapter is not fully applied; the binary self-check entry is missing."
}
foreach ($requiredPath in @($CatalogPath, $PackRoot, $FtlPath, $CliPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required project path does not exist: $requiredPath"
    }
}

$git = Resolve-SingleApplication -Name "git"
$node = Resolve-SingleApplication -Name "node"
$cargo = Resolve-SingleApplication -Name "cargo"

$head = Invoke-CapturedCommand `
    -Label "Verify pinned Codex commit" `
    -FilePath $git `
    -Arguments @("rev-parse", "HEAD") `
    -WorkingDirectory $sourceRoot
if ($head -ne $PinnedCommit) {
    throw "SourceWorktree must be pinned to $PinnedCommit; found $head."
}

$cargoVersionOutput = Invoke-CapturedCommand `
    -Label "Verify Cargo $RequiredCargoVersion" `
    -FilePath $cargo `
    -Arguments @("--version") `
    -WorkingDirectory $rustRoot
if ($cargoVersionOutput -notmatch "^cargo $([regex]::Escape($RequiredCargoVersion))(?:\s|$)") {
    throw "Cargo $RequiredCargoVersion is required; found '$cargoVersionOutput'."
}

Invoke-CheckedCommand `
    -Label "Validate zh-CN language pack" `
    -FilePath $node `
    -Arguments @(
        $CliPath,
        "language",
        "validate",
        "--pack",
        $PackRoot,
        "--catalog",
        $CatalogPath
    ) `
    -WorkingDirectory $ProjectRoot

$doctorJson = Invoke-CapturedCommand `
    -Label "Verify applied adapter state" `
    -FilePath $node `
    -Arguments @(
        $CliPath,
        "doctor",
        "--source",
        $sourceRoot,
        "--pack",
        $PackRoot,
        "--catalog",
        $CatalogPath
    ) `
    -WorkingDirectory $ProjectRoot
Write-Host $doctorJson
try {
    $doctor = $doctorJson | ConvertFrom-Json -ErrorAction Stop
}
catch {
    throw "Adapter doctor did not return valid JSON: $doctorJson"
}
if (-not [bool]$doctor.supported -or -not [bool]$doctor.applied) {
    throw "Adapter doctor did not report a supported, fully applied source worktree."
}
if ($doctor.PSObject.Properties.Name -contains "recoveryState") {
    $recoveryState = [string]$doctor.recoveryState
    if ($recoveryState -notin @("", "clean", "none")) {
        throw "Adapter doctor reported a non-clean recovery state: $recoveryState"
    }
}

Invoke-CargoTest `
    -Label "Run Rust i18n unit tests" `
    -Filter "i18n::tests" `
    -ExpectedPassed 10 `
    -CargoPath $cargo `
    -RustRoot $rustRoot
Invoke-CargoTest `
    -Label "Verify narrow, medium, and wide zh-CN snapshots" `
    -Filter "setup_view_snapshot_uses_zh_cn_localizer" `
    -ExpectedPassed 1 `
    -CargoPath $cargo `
    -RustRoot $rustRoot
Invoke-CargoTest `
    -Label "Verify unchanged English status-line snapshot" `
    -Filter "setup_view_snapshot_uses_runtime_preview_values" `
    -ExpectedPassed 1 `
    -CargoPath $cargo `
    -RustRoot $rustRoot
Invoke-CargoTest `
    -Label "Verify localized Worked for rendering" `
    -Filter "worked_for_uses_zh_cn_localizer" `
    -ExpectedPassed 1 `
    -CargoPath $cargo `
    -RustRoot $rustRoot
Invoke-CheckedCommand `
    -Label "Check the patched Rust workspace with the locked dependency graph" `
    -FilePath $cargo `
    -Arguments @("check", "--locked") `
    -WorkingDirectory $rustRoot

$previousLocale = [Environment]::GetEnvironmentVariable("CODEX_ULTRA_LOCALE", "Process")
$previousFtlPath = [Environment]::GetEnvironmentVariable("CODEX_ULTRA_FTL_PATH", "Process")
try {
    $env:CODEX_ULTRA_LOCALE = "zh-CN"
    $env:CODEX_ULTRA_FTL_PATH = $FtlPath
    $zhJson = Invoke-CapturedCommand `
        -Label "Run valid-FTL Chinese binary self-check" `
        -FilePath $cargo `
        -Arguments @("run", "--locked", "-p", "codex-cli", "--", "--ultra-i18n-self-check") `
        -WorkingDirectory $rustRoot
    try {
        $zhProbe = $zhJson | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Chinese self-check did not return valid JSON: $zhJson"
    }
    Assert-SelfCheck `
        -Probe $zhProbe `
        -ExpectedActive $true `
        -ExpectedLocale "zh-CN" `
        -ExpectedMessages ([ordered]@{
            "tui.status-line.setup.use-theme-colors" = "使用主题颜色"
            "tui.status-line.setup.apply-theme-colors" = "应用当前 /theme 的颜色"
            "tui.status-line.setup.configure-title" = "配置状态栏"
            "tui.status-line.setup.select-items-description" = "选择要显示在状态栏中的项目。"
            "tui.history.worked-for" = "工作了 7m 57s"
            "tui.slash-command.description.model" = "选择模型和推理强度"
            "tui.slash-command.description.status" = "显示当前会话配置和令牌用量"
        })

    $env:CODEX_ULTRA_FTL_PATH = Join-Path $env:TEMP ("codex-ultra-missing-{0}.ftl" -f [guid]::NewGuid().ToString("N"))
    $enJson = Invoke-CapturedCommand `
        -Label "Run missing-FTL English binary self-check" `
        -FilePath $cargo `
        -Arguments @("run", "--locked", "-p", "codex-cli", "--", "--ultra-i18n-self-check") `
        -WorkingDirectory $rustRoot
    try {
        $enProbe = $enJson | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "English fallback self-check did not return valid JSON: $enJson"
    }
    Assert-SelfCheck `
        -Probe $enProbe `
        -ExpectedActive $false `
        -ExpectedLocale $null `
        -ExpectedMessages ([ordered]@{
            "tui.status-line.setup.use-theme-colors" = "Use theme colors"
            "tui.status-line.setup.apply-theme-colors" = "Apply colors from the active /theme"
            "tui.status-line.setup.configure-title" = "Configure Status Line"
            "tui.status-line.setup.select-items-description" = "Select which items to display in the status line."
            "tui.history.worked-for" = "Worked for 7m 57s"
        })
}
finally {
    [Environment]::SetEnvironmentVariable("CODEX_ULTRA_LOCALE", $previousLocale, "Process")
    [Environment]::SetEnvironmentVariable("CODEX_ULTRA_FTL_PATH", $previousFtlPath, "Process")
}

Write-Host "Rust i18n runtime smoke test passed."
