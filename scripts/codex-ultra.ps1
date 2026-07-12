[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("Extract", "Compile", "Apply", "Doctor", "Revert", "Launch")]
    [string]$Action,

    [string]$CodexSource,

    [string]$Catalog = "build/languages/zh-CN/compiled-messages.json",

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

function Invoke-NodeCli {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $node = Get-Command node -CommandType Application -ErrorAction Stop
    & $node.Source $CliPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

switch ($Action) {
    "Extract" {
        Require-Value -Name "CodexSource" -Value $CodexSource
        $source = Resolve-ProjectPath -Path $CodexSource
        Invoke-NodeCli -Arguments @("catalog", "extract", "--source", $source)
    }
    "Compile" {
        $sourceCatalogPath = Resolve-ProjectPath -Path $SourceCatalog
        $packPath = Resolve-ProjectPath -Path $Pack
        $outputPath = Resolve-ProjectPath -Path $Catalog -AllowMissing
        Invoke-NodeCli -Arguments @(
            "pack",
            "compile",
            "--catalog",
            $sourceCatalogPath,
            "--pack",
            $packPath,
            "--output",
            $outputPath
        )
    }
    "Apply" {
        Require-Value -Name "CodexSource" -Value $CodexSource
        $source = Resolve-ProjectPath -Path $CodexSource
        Invoke-NodeCli -Arguments @("adapter", "apply", "--source", $source)
    }
    "Doctor" {
        Require-Value -Name "CodexSource" -Value $CodexSource
        $source = Resolve-ProjectPath -Path $CodexSource
        $catalogPath = Resolve-ProjectPath -Path $Catalog
        Invoke-NodeCli -Arguments @(
            "doctor",
            "--source",
            $source,
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
        $catalogPath = Resolve-ProjectPath -Path $Catalog

        $binaryPath = if (
            [System.IO.Path]::IsPathRooted($CodexBinary) -or
            $CodexBinary.Contains([System.IO.Path]::DirectorySeparatorChar) -or
            $CodexBinary.Contains([System.IO.Path]::AltDirectorySeparatorChar)
        ) {
            Resolve-ProjectPath -Path $CodexBinary
        }
        else {
            (Get-Command $CodexBinary -CommandType Application -ErrorAction Stop).Source
        }

        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $binaryPath
        $startInfo.UseShellExecute = $false
        $startInfo.WorkingDirectory = (Get-Location).ProviderPath
        $startInfo.Environment["CODEX_ULTRA_CATALOG"] = $catalogPath
        foreach ($argument in $CodexArguments) {
            $startInfo.ArgumentList.Add($argument)
        }

        $process = [System.Diagnostics.Process]::Start($startInfo)
        $process.WaitForExit()
        exit $process.ExitCode
    }
}
