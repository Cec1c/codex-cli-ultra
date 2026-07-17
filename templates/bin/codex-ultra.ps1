#!/usr/bin/env pwsh
$env:NODE_USE_ENV_PROXY = '1'
& node (Join-Path $PSScriptRoot 'codex-ultra.mjs') @args
exit $LASTEXITCODE
