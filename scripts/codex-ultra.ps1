[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("Extract", "Validate", "Plan", "Apply", "Doctor", "Revert", "Launch")]
    [string]$Action,

    [string]$CodexSource,

    [string]$SourceCatalog = "research/codex-0.144.1/tui-messages.jsonl",

    [string]$Pack = "packages/languages/zh-CN",

    [string]$CodexBinary,

    [Parameter(ValueFromRemainingArguments)]
    [string[]]$CodexArguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CliPath = Join-Path $ProjectRoot "src/cli.mjs"

function Resolve-ProjectPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [switch]$AllowMissing
    )

    $candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
        [System.IO.Path]::GetFullPath($Path)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $Path))
    }

    if (-not $AllowMissing -and -not (Test-Path -LiteralPath $candidate)) {
        throw "Path does not exist: $candidate"
    }

    return $candidate
}

function Require-Value {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [AllowNull()]
        [AllowEmptyString()]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "-$Name is required for -Action $Action"
    }
}

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

function Invoke-NodeCli {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $node = Resolve-SingleApplication -Name "node"
    & $node $CliPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

function Invoke-NodeCliCaptured {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $node = Resolve-SingleApplication -Name "node"
    $output = @(& $node $CliPath @Arguments)
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    return ($output -join "`n").Trim()
}

switch ($Action) {
    "Extract" {
        Require-Value -Name "CodexSource" -Value $CodexSource
        $source = Resolve-ProjectPath -Path $CodexSource
        Invoke-NodeCli -Arguments @("catalog", "extract", "--source", $source)
    }
    "Validate" {
        $catalogPath = Resolve-ProjectPath -Path $SourceCatalog
        $packPath = Resolve-ProjectPath -Path $Pack
        Invoke-NodeCli -Arguments @(
            "language",
            "validate",
            "--catalog",
            $catalogPath,
            "--pack",
            $packPath
        )
    }
    "Plan" {
        Require-Value -Name "CodexSource" -Value $CodexSource
        $source = Resolve-ProjectPath -Path $CodexSource
        Invoke-NodeCli -Arguments @("adapter", "plan", "--source", $source)
    }
    "Apply" {
        Require-Value -Name "CodexSource" -Value $CodexSource
        $source = Resolve-ProjectPath -Path $CodexSource
        Invoke-NodeCli -Arguments @("adapter", "apply", "--source", $source)
    }
    "Doctor" {
        Require-Value -Name "CodexSource" -Value $CodexSource
        $source = Resolve-ProjectPath -Path $CodexSource
        $catalogPath = Resolve-ProjectPath -Path $SourceCatalog
        $packPath = Resolve-ProjectPath -Path $Pack
        Invoke-NodeCli -Arguments @(
            "doctor",
            "--source",
            $source,
            "--pack",
            $packPath,
            "--catalog",
            $catalogPath
        )
    }
    "Revert" {
        Require-Value -Name "CodexSource" -Value $CodexSource
        $source = Resolve-ProjectPath -Path $CodexSource
        Invoke-NodeCli -Arguments @("adapter", "revert", "--source", $source)
    }
    "Launch" {
        Require-Value -Name "CodexBinary" -Value $CodexBinary
        $packPath = Resolve-ProjectPath -Path $Pack
        $catalogPath = Resolve-ProjectPath -Path $SourceCatalog
        $languagePath = Resolve-ProjectPath -Path (Join-Path $packPath "messages.ftl")

        $validationJson = Invoke-NodeCliCaptured -Arguments @(
            "language",
            "validate",
            "--catalog",
            $catalogPath,
            "--pack",
            $packPath
        )
        try {
            $validation = $validationJson | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw "Language validation did not return valid JSON: $validationJson"
        }
        $packLocale = [string]$validation.locale
        if ([string]::IsNullOrWhiteSpace($packLocale)) {
            throw "Validated language pack has no locale: $packPath"
        }

        if (
            -not [System.IO.Path]::IsPathRooted($CodexBinary) -and
            -not $CodexBinary.Contains([System.IO.Path]::DirectorySeparatorChar) -and
            -not $CodexBinary.Contains([System.IO.Path]::AltDirectorySeparatorChar)
        ) {
            throw "-CodexBinary must be an explicit executable file path for -Action Launch."
        }
        $binaryPath = Resolve-ProjectPath -Path $CodexBinary
        if ([System.IO.Path]::GetExtension($binaryPath) -ine ".exe") {
            throw "-CodexBinary must point to a Windows .exe file: $binaryPath"
        }

        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $binaryPath
        $startInfo.UseShellExecute = $false
        $startInfo.WorkingDirectory = (Get-Location).ProviderPath
        $startInfo.Environment["CODEX_ULTRA_LOCALE"] = $packLocale
        $startInfo.Environment["CODEX_ULTRA_FTL_PATH"] = $languagePath
        foreach ($argument in $CodexArguments) {
            $startInfo.ArgumentList.Add($argument)
        }

        $process = [System.Diagnostics.Process]::Start($startInfo)
        $process.WaitForExit()
        exit $process.ExitCode
    }
}
