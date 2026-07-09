@echo off
REM ─────────────────────────────────────────────────────────
REM  TabFlow Native Messaging Host — Firefox Windows Installer
REM
REM  Usage:  install-firefox.bat
REM
REM  No arguments needed — Firefox identifies extensions by
REM  their gecko ID (tabflow@samhamilton.dev), not a hash.
REM ─────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

set GECKO_ID=tabflow@samhamilton.dev
set HOST_NAME=com.tabflow.memory
set SCRIPT_DIR=%~dp0
set HOST_SCRIPT=%SCRIPT_DIR%tabflow-memory-host.ps1
set MANIFEST_FILE=%SCRIPT_DIR%%HOST_NAME%.firefox.json

REM Create a wrapper batch file that Firefox will execute.
set WRAPPER=%SCRIPT_DIR%tabflow-memory-host.bat
if not exist "%WRAPPER%" (
    echo @echo off > "%WRAPPER%"
    echo powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HOST_SCRIPT%" >> "%WRAPPER%"
)

REM Generate the Firefox native messaging host manifest.
REM Firefox uses "allowed_extensions" instead of "allowed_origins".
echo { > "%MANIFEST_FILE%"
echo   "name": "%HOST_NAME%", >> "%MANIFEST_FILE%"
echo   "description": "TabFlow memory monitor", >> "%MANIFEST_FILE%"
echo   "path": "%WRAPPER:\=\\%", >> "%MANIFEST_FILE%"
echo   "type": "stdio", >> "%MANIFEST_FILE%"
echo   "allowed_extensions": [ >> "%MANIFEST_FILE%"
echo     "%GECKO_ID%" >> "%MANIFEST_FILE%"
echo   ] >> "%MANIFEST_FILE%"
echo } >> "%MANIFEST_FILE%"

REM Register in Windows registry (current user) — Firefox looks here
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul 2>nul

if %ERRORLEVEL% equ 0 (
    echo.
    echo  SUCCESS! TabFlow native messaging host installed for Firefox.
    echo.
    echo  Host name:    %HOST_NAME%
    echo  Manifest:     %MANIFEST_FILE%
    echo  Gecko ID:     %GECKO_ID%
    echo.
    echo  Restart Firefox for this to take effect.
    echo.
) else (
    echo.
    echo  ERROR: Failed to write registry key.
    echo  Try running this script as Administrator.
    echo.
)

pause
