@echo off
REM ─────────────────────────────────────────────────────────────
REM  TabFlow Native Host Installer (Chrome) — standalone bundle.
REM
REM  Same script as install-firefox.bat but registers with Chrome
REM  instead of Firefox. See install-firefox.bat / README.txt for
REM  full details.
REM ─────────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

set INSTALL_DIR=C:\TabFlow
set HOST_NAME=com.tabflow.host
set MANIFEST=%INSTALL_DIR%\%HOST_NAME%.json
set REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%
set DEFAULT_EXT_ID=gkcamehohljdpenmjmoaciigppdbjcgl

echo.
echo  TabFlow Native Host Installer (Chrome, standalone)
echo  ──────────────────────────────────────────────────
echo.
echo  This will install TabFlowHost.exe to %INSTALL_DIR% and
echo  register it with Chrome so the TabFlow extension can show
echo  memory stats and hide workspace windows from the taskbar.
echo.
echo  Just press Enter at the prompt below to use the default
echo  extension ID (the published Chrome Web Store ID).
echo.
set /p EXT_ID="  Enter your TabFlow extension ID [default: %DEFAULT_EXT_ID%]: "

if "%EXT_ID%"=="" set EXT_ID=%DEFAULT_EXT_ID%

taskkill /f /im TabFlowHost.exe >nul 2>&1

if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo  Created %INSTALL_DIR%
)

copy /Y "%~dp0TabFlowHost.exe" "%INSTALL_DIR%\TabFlowHost.exe" >nul
set COPY_OK=0
if exist "%INSTALL_DIR%\TabFlowHost.exe" set COPY_OK=1

(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "TabFlow Native Messaging Host",
echo   "path": "%INSTALL_DIR:\=\\%\\TabFlowHost.exe",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST%"
set MANIFEST_OK=0
if exist "%MANIFEST%" set MANIFEST_OK=1

reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul 2>&1
set REG_OK=0
if not errorlevel 1 set REG_OK=1

echo.
echo ════════════════════════════════════════════════════════════
echo                      VERIFICATION
echo ════════════════════════════════════════════════════════════
echo.

set ALL_OK=1

if %COPY_OK%==1 (
    echo  [PASS] Binary copied to %INSTALL_DIR%\TabFlowHost.exe
) else (
    echo  [FAIL] Binary NOT at %INSTALL_DIR%\TabFlowHost.exe
    echo         Most common cause: Chrome or TabFlowHost.exe was running
    echo         and Windows blocked the copy. Fully close Chrome, then
    echo         run this .bat again.
    set ALL_OK=0
)

if %MANIFEST_OK%==1 (
    echo  [PASS] Manifest written to %MANIFEST%
) else (
    echo  [FAIL] Manifest NOT at %MANIFEST%
    echo         Try running this .bat as Administrator (right-click,
    echo         Run as administrator).
    set ALL_OK=0
)

if %REG_OK%==1 (
    echo  [PASS] Registry entry set:
    echo         %REG_KEY%
) else (
    echo  [FAIL] Registry entry NOT set
    echo         Try running this .bat as Administrator (right-click,
    echo         Run as administrator).
    set ALL_OK=0
)

if %COPY_OK%==1 (
    for %%I in ("%INSTALL_DIR%\TabFlowHost.exe") do set BIN_SIZE=%%~zI
    if !BIN_SIZE! GTR 100000 (
        echo  [PASS] Binary size looks healthy (!BIN_SIZE! bytes^)
    ) else (
        echo  [FAIL] Binary size is suspiciously small (!BIN_SIZE! bytes^)
        echo         The file may not have copied completely. Re-extract
        echo         the bundle zip and run this .bat again.
        set ALL_OK=0
    )
)

echo.
echo ════════════════════════════════════════════════════════════

if %ALL_OK%==1 (
    echo                       INSTALL SUCCEEDED
    echo ════════════════════════════════════════════════════════════
    echo.
    echo  Next steps:
    echo    1. Fully close Chrome. Open Task Manager Ctrl+Shift+Esc,
    echo       Details tab, end any leftover chrome.exe and
    echo       TabFlowHost.exe processes.
    echo    2. Reopen Chrome.
    echo    3. Open a TabFlow new tab. Top-right header should show
    echo       System and Chrome memory lines, plus v0.1.7.
    echo    4. Switch workspaces a couple times. Hover over Chrome
    echo       in the taskbar — only one window visible.
) else (
    echo                       INSTALL FAILED
    echo ════════════════════════════════════════════════════════════
    echo.
    echo  See [FAIL] lines above. Most common fixes:
    echo    - Close Chrome ^(Task Manager → Details tab → end
    echo      chrome.exe and TabFlowHost.exe^), then run this .bat again.
    echo    - Right-click this .bat → Run as administrator.
)

echo.
pause
