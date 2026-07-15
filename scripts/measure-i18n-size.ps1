#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$UpstreamSource,

    [string]$OutputPath,

    [string]$TemporaryRoot,

    [switch]$KeepWorktrees
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PinnedCommit = "44918ea10c0f99151c6710411b4322c2f5c96bea"
$RequiredCargoVersion = "1.95.0"
$ExpectedWorkspacePackageCount = 132
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CliPath = Join-Path $ProjectRoot "src/cli.mjs"
$temporaryRootCreated = $false
$GitPath = $null
$repositoryRoot = $null
$ownershipToken = $null
$baselineWorktree = $null
$patchedWorktree = $null

function Resolve-FullPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string]$BasePath
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Resolve-SingleApplication {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $paths = @(
        Get-Command $Name -All -CommandType Application -ErrorAction Stop |
            ForEach-Object { [System.IO.Path]::GetFullPath($_.Source) } |
            Sort-Object -Unique
    )
    if ($paths.Count -ne 1) {
        throw "Expected exactly one application for '$Name'; found $($paths.Count)."
    }
    return $paths[0]
}

function Assert-ReproducibleBuildEnvironment {
    $exactNames = @(
        "CARGO_BUILD_RUSTC",
        "CARGO_BUILD_RUSTDOC",
        "CARGO_BUILD_RUSTFLAGS",
        "CARGO_BUILD_TARGET",
        "CARGO_ENCODED_RUSTFLAGS",
        "CARGO_INCREMENTAL",
        "CARGO_TARGET_DIR",
        "RUSTC",
        "RUSTC_WRAPPER",
        "RUSTC_WORKSPACE_WRAPPER",
        "RUSTDOC",
        "RUSTFLAGS"
    )
    $blocked = @(
        Get-ChildItem Env: | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_.Value) -and
            (
                $_.Name -in $exactNames -or
                $_.Name -match "^CARGO_PROFILE_RELEASE_" -or
                $_.Name -match "^CARGO_TARGET_.+_(LINKER|RUSTFLAGS)$"
            )
        } | Select-Object -ExpandProperty Name | Sort-Object -Unique
    )
    if ($blocked.Count -gt 0) {
        throw "Build-affecting environment variables must be unset: $($blocked -join ', ')"
    }
}

function Invoke-Process {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$ArgumentList,

        [Parameter(Mandatory)]
        [string]$WorkingDirectory,

        [hashtable]$Environment = @{},

        [switch]$CaptureOutput
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $CaptureOutput
    $startInfo.RedirectStandardError = $CaptureOutput
    foreach ($argument in $ArgumentList) {
        $startInfo.ArgumentList.Add($argument)
    }
    foreach ($entry in $Environment.GetEnumerator()) {
        $startInfo.Environment[$entry.Key] = [string]$entry.Value
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Failed to start process: $FilePath"
    }

    $stdoutTask = $null
    $stderrTask = $null
    if ($CaptureOutput) {
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
    }

    $process.WaitForExit()
    $stdout = if ($CaptureOutput) {
        $stdoutTask.GetAwaiter().GetResult()
    }
    else {
        ""
    }
    $stderr = if ($CaptureOutput) {
        $stderrTask.GetAwaiter().GetResult()
    }
    else {
        ""
    }

    if ($process.ExitCode -ne 0) {
        $details = @(
            @($stdout.Trim(), $stderr.Trim()) |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
        $suffix = if ($details.Count -gt 0) {
            [Environment]::NewLine + ($details -join [Environment]::NewLine)
        }
        else {
            ""
        }
        throw "Command failed with exit code $($process.ExitCode): $FilePath $($ArgumentList -join ' ')$suffix"
    }

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        StdOut = $stdout
        StdErr = $stderr
    }
}

function Invoke-Git {
    param(
        [Parameter(Mandatory)]
        [string[]]$ArgumentList,

        [Parameter(Mandatory)]
        [string]$WorkingDirectory,

        [switch]$CaptureOutput
    )

    if ([string]::IsNullOrWhiteSpace($GitPath)) {
        throw "Git application path has not been resolved."
    }
    return Invoke-Process `
        -FilePath $GitPath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -Environment @{ GIT_OPTIONAL_LOCKS = "0" } `
        -CaptureOutput:$CaptureOutput
}

function Test-GitWorktreeRegistered {
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot,

        [Parameter(Mandatory)]
        [string]$Worktree
    )

    $result = Invoke-Git `
        -ArgumentList @("-C", $RepositoryRoot, "worktree", "list", "--porcelain") `
        -WorkingDirectory $RepositoryRoot `
        -CaptureOutput
    $expected = [System.IO.Path]::GetFullPath($Worktree)
    foreach ($line in ($result.StdOut -split "`r?`n")) {
        if ($line.StartsWith("worktree ", [System.StringComparison]::Ordinal)) {
            $actual = [System.IO.Path]::GetFullPath($line.Substring(9))
            if ($actual.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        }
    }
    return $false
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory)]
        [string]$Parent,

        [Parameter(Mandatory)]
        [string]$Child
    )

    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
    $childFull = [System.IO.Path]::GetFullPath($Child)
    return $childFull.StartsWith(
        $parentFull,
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Remove-MeasurementRoot {
    param(
        [Parameter(Mandatory)]
        [string]$Root,

        [Parameter(Mandatory)]
        [string]$OwnershipToken
    )

    $markerPath = Join-Path $Root ".codex-ultra-i18n-size-owner"
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw "Refusing to remove temporary root without ownership marker: $Root"
    }
    if ((Get-Content -LiteralPath $markerPath -Raw).Trim() -ne $OwnershipToken) {
        throw "Refusing to remove temporary root with an unexpected ownership marker: $Root"
    }
    if ([System.IO.Path]::GetPathRoot($Root) -eq [System.IO.Path]::GetFullPath($Root)) {
        throw "Refusing to remove a filesystem root: $Root"
    }
    Remove-Item -LiteralPath $Root -Recurse -Force
}

function Write-TextAtomically {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string]$Content
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $temporaryPath = Join-Path $directory (
        "." + [System.IO.Path]::GetFileName($Path) + "." +
        [guid]::NewGuid().ToString("N") + ".tmp"
    )
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            $Content,
            [System.Text.UTF8Encoding]::new($false)
        )
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            [System.IO.File]::Replace($temporaryPath, $Path, $null, $true)
        }
        else {
            [System.IO.File]::Move($temporaryPath, $Path)
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Build-CodexCli {
    param(
        [Parameter(Mandatory)]
        [string]$CargoPath,

        [Parameter(Mandatory)]
        [string]$Worktree,

        [Parameter(Mandatory)]
        [string]$TargetDirectory,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $cargoRoot = Join-Path $Worktree "codex-rs"
    Write-Host "Building $Label in $Worktree"
    Write-Host "Using isolated target directory $TargetDirectory"
    Invoke-Process `
        -FilePath $CargoPath `
        -ArgumentList @("build", "-p", "codex-cli", "--release", "--locked") `
        -WorkingDirectory $cargoRoot `
        -Environment @{ CARGO_TARGET_DIR = $TargetDirectory } | Out-Null

    $binaryPath = Join-Path $TargetDirectory "release/codex.exe"
    if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
        throw "Expected codex.exe was not produced: $binaryPath"
    }
    return (Get-Item -LiteralPath $binaryPath).Length
}

function Get-FileSha256 {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Normalize-ReleaseLock {
    param(
        [Parameter(Mandatory)]
        [string]$CargoPath,

        [Parameter(Mandatory)]
        [string]$Worktree,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $cargoRoot = Join-Path $Worktree "codex-rs"
    $lockPath = Join-Path $cargoRoot "Cargo.lock"
    $beforeHash = Get-FileSha256 -Path $lockPath
    Write-Host "Normalizing the $Label release lock with the shared non-i18n step"
    Invoke-Process `
        -FilePath $CargoPath `
        -ArgumentList @("update", "--workspace", "--offline") `
        -WorkingDirectory $cargoRoot `
        -CaptureOutput | Out-Null
    $afterHash = Get-FileSha256 -Path $lockPath

    return [pscustomobject]@{
        BeforeHash = $beforeHash
        AfterHash = $afterHash
    }
}

try {
    Assert-ReproducibleBuildEnvironment
    $GitPath = Resolve-SingleApplication -Name "git"
    $cargo = Resolve-SingleApplication -Name "cargo"
    $node = Resolve-SingleApplication -Name "node"
    $inheritedProxyVariables = @(
        Get-ChildItem Env: | Where-Object {
            $_.Name -in @("ALL_PROXY", "HTTP_PROXY", "HTTPS_PROXY") -and
            -not [string]::IsNullOrWhiteSpace($_.Value)
        } | Select-Object -ExpandProperty Name | Sort-Object -Unique
    )

    $sourceInput = Resolve-FullPath -Path $UpstreamSource -BasePath (Get-Location).ProviderPath
    if (-not (Test-Path -LiteralPath $sourceInput -PathType Container)) {
        throw "Upstream source repository does not exist: $sourceInput"
    }

    $repositoryResult = Invoke-Git `
        -ArgumentList @("-C", $sourceInput, "rev-parse", "--show-toplevel") `
        -WorkingDirectory $sourceInput `
        -CaptureOutput
    $repositoryRoot = [System.IO.Path]::GetFullPath($repositoryResult.StdOut.Trim())

    $commitResult = Invoke-Git `
        -ArgumentList @("-C", $repositoryRoot, "rev-parse", "$PinnedCommit^{commit}") `
        -WorkingDirectory $repositoryRoot `
        -CaptureOutput
    if ($commitResult.StdOut.Trim() -ne $PinnedCommit) {
        throw "Pinned upstream commit is unavailable: $PinnedCommit"
    }

    $cargoVersionResult = Invoke-Process `
        -FilePath $cargo `
        -ArgumentList @("--version") `
        -WorkingDirectory (Join-Path $repositoryRoot "codex-rs") `
        -CaptureOutput
    $cargoVersion = $cargoVersionResult.StdOut.Trim()
    if ($cargoVersion -notmatch "^cargo $([regex]::Escape($RequiredCargoVersion))(?:\s|$)") {
        throw "Cargo $RequiredCargoVersion is required; found: $cargoVersion"
    }

    if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) {
        throw "Project CLI does not exist: $CliPath"
    }

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $OutputPath = "research/codex-0.144.1/i18n-size.json"
    }
    $resolvedOutputPath = Resolve-FullPath -Path $OutputPath -BasePath $ProjectRoot

    $ownershipToken = [guid]::NewGuid().ToString("N")
    if ([string]::IsNullOrWhiteSpace($TemporaryRoot)) {
        $volumeRoot = [System.IO.Path]::GetPathRoot($repositoryRoot)
        $TemporaryRoot = Join-Path $volumeRoot "codex-ultra-i18n-size-$ownershipToken"
    }
    else {
        $TemporaryRoot = Resolve-FullPath `
            -Path $TemporaryRoot `
            -BasePath (Get-Location).ProviderPath
    }
    if (
        $resolvedOutputPath.Equals(
            [System.IO.Path]::GetFullPath($TemporaryRoot),
            [System.StringComparison]::OrdinalIgnoreCase
        ) -or
        (Test-PathWithin -Parent $TemporaryRoot -Child $resolvedOutputPath)
    ) {
        throw "Output path must not be inside the temporary root: $resolvedOutputPath"
    }
    if (Test-Path -LiteralPath $TemporaryRoot) {
        throw "Temporary root already exists; refusing to reuse it: $TemporaryRoot"
    }

    $baselineWorktree = Join-Path $TemporaryRoot "baseline"
    $patchedWorktree = Join-Path $TemporaryRoot "patchedx"
    $baselineTarget = Join-Path $TemporaryRoot "target-baseline"
    $patchedTarget = Join-Path $TemporaryRoot "target-patchedx"
    New-Item -ItemType Directory -Path $TemporaryRoot | Out-Null
    $temporaryRootCreated = $true
    [System.IO.File]::WriteAllText(
        (Join-Path $TemporaryRoot ".codex-ultra-i18n-size-owner"),
        $ownershipToken + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )

    foreach ($childPath in @(
        $baselineWorktree,
        $patchedWorktree,
        $baselineTarget,
        $patchedTarget
    )) {
        if (-not (Test-PathWithin -Parent $TemporaryRoot -Child $childPath)) {
            throw "Temporary child path escaped its root: $childPath"
        }
    }
    if ($baselineWorktree.Length -ne $patchedWorktree.Length) {
        throw "Baseline and patched worktree paths must have equal lengths."
    }
    if ($baselineTarget.Length -ne $patchedTarget.Length) {
        throw "Baseline and patched target paths must have equal lengths."
    }

    Write-Host "Pinned commit: $PinnedCommit"
    Write-Host "Cargo: $cargoVersion"
    Write-Host "Temporary root: $TemporaryRoot"
    Write-Host "Disk strategy: separate baseline and patched target directories"

    Invoke-Git `
        -ArgumentList @(
            "-C",
            $repositoryRoot,
            "worktree",
            "add",
            "--detach",
            $baselineWorktree,
            $PinnedCommit
        ) `
        -WorkingDirectory $repositoryRoot | Out-Null

    Invoke-Git `
        -ArgumentList @(
            "-C",
            $repositoryRoot,
            "worktree",
            "add",
            "--detach",
            $patchedWorktree,
            $PinnedCommit
        ) `
        -WorkingDirectory $repositoryRoot | Out-Null

    foreach ($worktree in @($baselineWorktree, $patchedWorktree)) {
        $headResult = Invoke-Git `
            -ArgumentList @("-C", $worktree, "rev-parse", "HEAD") `
            -WorkingDirectory $worktree `
            -CaptureOutput
        if ($headResult.StdOut.Trim() -ne $PinnedCommit) {
            throw "Detached worktree is not at the pinned commit: $worktree"
        }
        $statusResult = Invoke-Git `
            -ArgumentList @("-C", $worktree, "status", "--porcelain") `
            -WorkingDirectory $worktree `
            -CaptureOutput
        if (-not [string]::IsNullOrWhiteSpace($statusResult.StdOut)) {
            throw "Fresh detached worktree is unexpectedly dirty: $worktree"
        }
    }

    Write-Host "Applying the Codex Ultra adapter only to the patched worktree"
    Invoke-Process `
        -FilePath $node `
        -ArgumentList @($CliPath, "adapter", "apply", "--source", $patchedWorktree) `
        -WorkingDirectory $ProjectRoot | Out-Null

    # The release tag has workspace.package.version = 0.144.1 while its
    # checked-in Cargo.lock still labels workspace packages as 0.0.0. Apply
    # the same non-i18n release-lock normalization to both worktrees before
    # the required --locked builds so that this release metadata drift is not
    # counted as part of the i18n binary delta.
    $baselineLock = Normalize-ReleaseLock `
        -CargoPath $cargo `
        -Worktree $baselineWorktree `
        -Label "baseline"
    $baselineLockDiffResult = Invoke-Git `
        -ArgumentList @(
            "-C",
            $baselineWorktree,
            "diff",
            "--unified=0",
            "--",
            "codex-rs/Cargo.lock"
        ) `
        -WorkingDirectory $baselineWorktree `
        -CaptureOutput
    $baselineChangeLines = @(
        $baselineLockDiffResult.StdOut -split "`r?`n" |
            Where-Object {
                ($_ -match "^[+-]") -and
                ($_ -notmatch "^(---|\+\+\+)")
            }
    )
    $unexpectedBaselineChanges = @(
        $baselineChangeLines | Where-Object {
            $_ -notin @(
                '-version = "0.0.0"',
                '+version = "0.144.1"'
            )
        }
    )
    $normalizedWorkspacePackages = @(
        $baselineChangeLines | Where-Object { $_ -eq '-version = "0.0.0"' }
    ).Count
    $normalizedVersionLines = @(
        $baselineChangeLines | Where-Object { $_ -eq '+version = "0.144.1"' }
    ).Count
    if (
        $unexpectedBaselineChanges.Count -gt 0 -or
        $normalizedWorkspacePackages -ne $ExpectedWorkspacePackageCount -or
        $normalizedWorkspacePackages -ne $normalizedVersionLines
    ) {
        throw "Baseline lock normalization changed more than workspace package versions."
    }

    $patchedLock = Normalize-ReleaseLock `
        -CargoPath $cargo `
        -Worktree $patchedWorktree `
        -Label "patched"
    if ($patchedLock.BeforeHash -ne $patchedLock.AfterHash) {
        throw "Shared lock normalization unexpectedly changed the adapter-produced Cargo.lock."
    }

    $baselineBytes = Build-CodexCli `
        -CargoPath $cargo `
        -Worktree $baselineWorktree `
        -TargetDirectory $baselineTarget `
        -Label "baseline"

    $patchedBytes = Build-CodexCli `
        -CargoPath $cargo `
        -Worktree $patchedWorktree `
        -TargetDirectory $patchedTarget `
        -Label "patched"

    $deltaBytes = $patchedBytes - $baselineBytes
    $deltaPercent = [math]::Round(
        ($deltaBytes / [double]$baselineBytes) * 100,
        6
    )
    $evidence = [ordered]@{
        schemaVersion = 1
        commit = $PinnedCommit
        profile = "release"
        cargoVersion = $cargoVersion
        buildEnvironment = [ordered]@{
            compilationOverrides = "rejected-nonempty"
            inheritedProxyVariables = $inheritedProxyVariables
        }
        lockNormalization = [ordered]@{
            command = "cargo update --workspace --offline"
            reason = "Pinned release metadata labels workspace packages as 0.144.1 while Cargo.lock labels them as 0.0.0."
            changedWorkspacePackages = $normalizedWorkspacePackages
            patchedLockAlreadyNormalized = $true
        }
        baselineBytes = $baselineBytes
        patchedBytes = $patchedBytes
        deltaBytes = $deltaBytes
        deltaPercent = $deltaPercent
    }

    $json = $evidence | ConvertTo-Json -Depth 4
    Write-TextAtomically `
        -Path $resolvedOutputPath `
        -Content ($json + [Environment]::NewLine)

    Write-Host "Baseline codex.exe: $baselineBytes bytes"
    Write-Host "Patched codex.exe:  $patchedBytes bytes"
    Write-Host "Delta:              $deltaBytes bytes ($deltaPercent%)"
    Write-Host "Evidence:           $resolvedOutputPath"
}
finally {
    if ($temporaryRootCreated -and -not $KeepWorktrees) {
        $cleanupFailed = $false
        $patchedRegistered = $false
        try {
            $patchedRegistered = Test-GitWorktreeRegistered `
                -RepositoryRoot $repositoryRoot `
                -Worktree $patchedWorktree
        }
        catch {
            $cleanupFailed = $true
            Write-Warning "Could not inspect patched worktree registration: $($_.Exception.Message)"
        }
        if ($patchedRegistered) {
            try {
                Invoke-Git `
                    -ArgumentList @(
                        "-C",
                        $repositoryRoot,
                        "worktree",
                        "remove",
                        "--force",
                        $patchedWorktree
                    ) `
                    -WorkingDirectory $repositoryRoot | Out-Null
            }
            catch {
                $cleanupFailed = $true
                Write-Warning "Could not remove patched worktree: $($_.Exception.Message)"
            }
        }

        $baselineRegistered = $false
        try {
            $baselineRegistered = Test-GitWorktreeRegistered `
                -RepositoryRoot $repositoryRoot `
                -Worktree $baselineWorktree
        }
        catch {
            $cleanupFailed = $true
            Write-Warning "Could not inspect baseline worktree registration: $($_.Exception.Message)"
        }
        if ($baselineRegistered) {
            try {
                Invoke-Git `
                    -ArgumentList @(
                        "-C",
                        $repositoryRoot,
                        "worktree",
                        "remove",
                        "--force",
                        $baselineWorktree
                    ) `
                    -WorkingDirectory $repositoryRoot | Out-Null
            }
            catch {
                $cleanupFailed = $true
                Write-Warning "Could not remove baseline worktree: $($_.Exception.Message)"
            }
        }

        if (-not $cleanupFailed) {
            Remove-MeasurementRoot `
                -Root $TemporaryRoot `
                -OwnershipToken $ownershipToken
        }
        else {
            Write-Warning "Temporary files were kept for manual cleanup: $TemporaryRoot"
        }
    }
    elseif ($temporaryRootCreated) {
        Write-Host "Kept measurement worktrees and targets: $TemporaryRoot"
    }
}
