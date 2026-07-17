@echo off
set "NODE_USE_ENV_PROXY=1"
node "%~dp0codex-ultra.mjs" %*
exit /b %ERRORLEVEL%
