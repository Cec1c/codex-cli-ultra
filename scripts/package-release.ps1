[CmdletBinding()]
param(
    [string]$Version = '0.1.0',
    [string]$OutputDirectory = $(Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts')
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
        throw "$Label must stay inside the output directory: $resolvedCandidate"
    }
    return $resolvedCandidate
}

$root = Split-Path -Parent $PSScriptRoot
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$name = "codex-cli-ultra-v$Version-windows-x64"
$stage = Assert-ChildPath -Root $output -Candidate (Join-Path $output $name) -Label 'Release staging directory'
$zip = Assert-ChildPath -Root $output -Candidate (Join-Path $output "$name.zip") -Label 'Release ZIP'

Push-Location $root
try {
    npm run build
    Push-Location (Join-Path $root 'tui')
    try { cargo build --release }
    finally { Pop-Location }
}
finally { Pop-Location }

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'bin') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'content\languages') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'content\themes') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'content\catalog') -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'dist\codex-ultra.mjs') -Destination (Join-Path $stage 'bin')
Copy-Item -LiteralPath (Join-Path $root 'dist\launcher.mjs') -Destination (Join-Path $stage 'bin')
Copy-Item -LiteralPath (Join-Path $root 'tui\target\release\ccu-manager.exe') -Destination (Join-Path $stage 'bin')
Copy-Item -LiteralPath (Join-Path $root 'packages\languages\zh-CN') -Destination (Join-Path $stage 'content\languages\zh-CN') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'packages\themes\ccu-deepseek') -Destination (Join-Path $stage 'content\themes\ccu-deepseek') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'research\codex-0.144.4\tui-messages.jsonl') -Destination (Join-Path $stage 'content\catalog\tui-messages.jsonl')
Copy-Item -LiteralPath (Join-Path $root 'packages\quota.example.json') -Destination (Join-Path $stage 'content\quota.example.json')
Copy-Item -LiteralPath (Join-Path $root 'install.ps1') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination $stage

Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([System.IO.Path]::GetFileName($zip))" | Set-Content -LiteralPath "$zip.sha256" -Encoding ascii
[pscustomobject]@{
    version = $Version
    package = $stage
    zip = $zip
    sha256 = $hash
} | ConvertTo-Json
