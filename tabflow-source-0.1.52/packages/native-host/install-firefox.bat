@echo off
REM ─────────────────────────────────────────────────────────────
REM  TabFlow Native Host Installer (Firefox)
REM
REM  Run this as Administrator after building TabFlowHost.exe.
REM  It copies the host to C:\TabFlow\ and registers it with Firefox.
REM
REM  Firefox differs from Chrome in two ways:
REM   1. Manifest uses "allowed_extensions" with the gecko ID
REM      (from browser_specific_settings.gecko.id in manifest.firefox.json)
REM      instead of Chrome's "allowed_origins" with the chrome-extension:// URL.
REM   2. Manifest is registered under HKCU\Software\Mozilla\NativeMessagingHosts
REM      instead of HKCU\Software\Google\Chrome\NativeMessagingHosts.
REM ─────────────────────────────────────────────────────────────

setlocal

REM ── Configuration ──
set INSTALL_DIR=C:\TabFlow
set HOST_NAME=com.tabflow.host
set MANIFEST=%INSTALL_DIR%\%HOST_NAME%.firefox.json
set DEFAULT_EXT_ID=tabflow@samhamilton.dev

REM ── Step 1: Get the gecko extension ID from the user ──
echo.
echo  TabFlow Native Host Installer (Firefox)
echo  ───────────────────────────────────────
echo.
echo  The gecko ID comes from browser_specific_settings.gecko.id in
echo  packages\browser-extension\public\manifest.firefox.json.
echo  Default: %DEFAULT_EXT_ID%
echo.
set /p EXT_ID="  Enter your TabFlow gecko ID [default: %DEFAULT_EXT_ID%]: "

if "%EXT_ID%"=="" set EXT_ID=%DEFAULT_EXT_ID%

REM ── Step 2: Create install directory ──
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo  Created %INSTALL_DIR%
)

REM ── Step 3: Copy the executable ──
copy /Y "%~dp0bin\Release\net8.0\win-x64\publish\TabFlowHost.exe" "%INSTALL_DIR%\TabFlowHost.exe"
if errorlevel 1 (
    echo  Error: Could not copy TabFlowHost.exe.
    echo  Make sure you've built the project first:
    echo    dotnet publish -c Release
    pause
    exit /b 1
)
echo  Copied TabFlowHost.exe to %INSTALL_DIR%

REM ── Step 4: Write the Firefox native messaging manifest ──
(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "TabFlow Native Messaging Host",
echo   "path": "%INSTALL_DIR:\=\\%\\TabFlowHost.exe",
echo   "type": "stdio",
echo   "allowed_extensions": [
echo     "%EXT_ID%"
echo   ]
echo }
) > "%MANIFEST%"
echo  Wrote manifest to %MANIFEST%

REM ── Step 5: Register with Firefox via Windows Registry ──
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f
if errorlevel 1 (
    echo  Error: Could not write registry key.
    pause
    exit /b 1
)
echo  Registered native messaging host under HKCU\Software\Mozilla\NativeMessagingHosts

echo.
echo  ✓ Firefox installation complete!
echo    Host: %INSTALL_DIR%\TabFlowHost.exe
echo    Manifest: %MANIFEST%
echo    Gecko ID: %EXT_ID%
echo.
echo  Restart Firefox for the changes to take effect.
echo.
pause
