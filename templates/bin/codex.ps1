#!/usr/bin/env pwsh
& node (Join-Path $PSScriptRoot 'launcher.mjs') @args
exit $LASTEXITCODE
