@echo off
REM ─────────────────────────────────────────────────────────
REM  TabFlow Native Messaging Host — Windows Installer
REM
REM  Usage:  install-host.bat <chrome-extension-id>
REM
REM  Example:
REM    install-host.bat abcdefghijklmnopqrstuvwxyz123456
REM
REM  To find your extension ID:
REM    1. Go to chrome://extensions/
REM    2. Enable "Developer mode" (top right)
REM    3. Copy the ID shown under "TabFlow"
REM ─────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

if "%~1"=="" (
    echo.
    echo ERROR: Please provide your TabFlow Chrome extension ID.
    echo.
    echo Usage:  install-host.bat ^<extension-id^>
    echo.
    echo To find your extension ID, go to chrome://extensions/
    echo and copy the ID shown under TabFlow.
    echo.
    pause
    exit /b 1
)

set EXT_ID=%~1
set HOST_NAME=com.tabflow.memory
set SCRIPT_DIR=%~dp0
set HOST_SCRIPT=%SCRIPT_DIR%tabflow-memory-host.ps1
set MANIFEST_FILE=%SCRIPT_DIR%%HOST_NAME%.json

REM Create a wrapper batch file that Chrome will execute.
REM Chrome launches .bat files directly; this calls PowerShell with the real script.
set WRAPPER=%SCRIPT_DIR%tabflow-memory-host.bat
echo @echo off > "%WRAPPER%"
echo powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HOST_SCRIPT%" >> "%WRAPPER%"

REM Generate the native messaging host manifest
echo { > "%MANIFEST_FILE%"
echo   "name": "%HOST_NAME%", >> "%MANIFEST_FILE%"
echo   "description": "TabFlow memory monitor", >> "%MANIFEST_FILE%"
echo   "path": "%WRAPPER:\=\\%", >> "%MANIFEST_FILE%"
echo   "type": "stdio", >> "%MANIFEST_FILE%"
echo   "allowed_origins": [ >> "%MANIFEST_FILE%"
echo     "chrome-extension://%EXT_ID%/" >> "%MANIFEST_FILE%"
echo   ] >> "%MANIFEST_FILE%"
echo } >> "%MANIFEST_FILE%"

REM Register in Windows registry (current user)
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul 2>nul

if %ERRORLEVEL% equ 0 (
    echo.
    echo  SUCCESS! TabFlow native messaging host installed.
    echo.
    echo  Host name:    %HOST_NAME%
    echo  Manifest:     %MANIFEST_FILE%
    echo  Extension ID: %EXT_ID%
    echo.
    echo  Restart Chrome for this to take effect.
    echo.
) else (
    echo.
    echo  ERROR: Failed to write registry key.
    echo  Try running this script as Administrator.
    echo.
)

pause
