#!/usr/bin/env pwsh
& node (Join-Path $PSScriptRoot 'codex-ultra.mjs') @args
exit $LASTEXITCODE
