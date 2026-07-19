@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo [CCU] Cannot find pwsh.exe. Please install PowerShell 7 and retry.
  pause
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "code=%ERRORLEVEL%"
echo.
if not "%code%"=="0" echo [CCU] Installation failed with exit code %code%.
pause
exit /b %code%
