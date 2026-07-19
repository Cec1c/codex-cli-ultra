[CmdletBinding()]
param(
    [string]$InstallRoot = $(
        if ($env:CODEX_ULTRA_HOME) { $env:CODEX_ULTRA_HOME }
        else { Join-Path $env:LOCALAPPDATA 'codex-cli-ultra' }
    )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$manager = Join-Path $installRoot 'bin\codex-ultra.mjs'
Write-Host ''
Write-Host 'Codex CLI Ultra 一键卸载' -ForegroundColor Yellow
Write-Host '不会结束当前 Codex；新命令会立即回退到官方英文版。' -ForegroundColor DarkGray

if (-not (Test-Path -LiteralPath $manager -PathType Leaf)) {
    Write-Host "未找到已安装的 CCU 管理器：$manager" -ForegroundColor Yellow
    Write-Host '如果目录仍存在，可在关闭占用它的终端后手动删除。'
    exit 0
}

$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$env:CODEX_ULTRA_HOME = $installRoot
& $node.Source $manager uninstall
if ($LASTEXITCODE -ne 0) {
    throw "codex-ultra uninstall failed with exit code $LASTEXITCODE"
}

Write-Host '卸载指令已完成。请打开新终端运行 codex --version 验证英文原版。' -ForegroundColor Green
