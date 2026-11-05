@echo off
setlocal DisableDelayedExpansion
title SimpleVTT
rem Use this file as the target of a desktop shortcut. No special "Start in" is needed.
pushd "%~dp0"
if errorlevel 1 goto failed

where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer with npm, then reopen this launcher.
  goto failed
)
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)"
if errorlevel 1 (
  echo SimpleVTT requires Node.js 22.13 or newer.
  goto failed
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm included.
  goto failed
)

if not exist node_modules\ (
  echo Installing dependencies for the first launch. Internet is required...
  call npm.cmd ci
  if errorlevel 1 goto failed
)
if not exist dist\server\index.js goto build
if not exist dist\client\index.html goto build
goto launch

:build
echo Building SimpleVTT...
call npm.cmd run build
if errorlevel 1 goto failed

:launch
node scripts\start-windows.mjs
if errorlevel 1 goto failed
popd
exit /b 0

:failed
echo.
echo SimpleVTT could not start. See the messages above and README.md.
pause
popd
exit /b 1
