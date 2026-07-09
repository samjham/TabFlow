@echo off
REM ─────────────────────────────────────────────────────────────
REM  TabFlow Native Host Installer (Firefox) — standalone bundle.
REM
REM  Run this on a Windows computer that has TabFlow installed in
REM  Firefox but doesn't have the native host yet. Installs the
REM  pre-built TabFlowHost.exe sitting next to this script and
REM  registers it with Firefox.
REM
REM  Verifies each step at the end and prints a PASS/FAIL summary
REM  so you know exactly what worked and what didn't, all without
REM  needing to open another program.
REM
REM  No .NET SDK or Node.js required — TabFlowHost.exe is bundled
REM  with the .NET runtime so it just runs.
REM ─────────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

set INSTALL_DIR=C:\TabFlow
set HOST_NAME=com.tabflow.host
set MANIFEST=%INSTALL_DIR%\%HOST_NAME%.firefox.json
set REG_KEY=HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%
set DEFAULT_EXT_ID=tabflow@samhamilton.dev

echo.
echo  TabFlow Native Host Installer (Firefox, standalone)
echo  ───────────────────────────────────────────────────
echo.
echo  This will install TabFlowHost.exe to %INSTALL_DIR% and
echo  register it with Firefox so the TabFlow extension can
echo  show memory stats and hide workspace windows from the taskbar.
echo.
echo  Just press Enter at the prompt below to use the default
echo  gecko ID (which is what the published TabFlow uses).
echo.
set /p EXT_ID="  Enter your TabFlow gecko ID [default: %DEFAULT_EXT_ID%]: "

if "%EXT_ID%"=="" set EXT_ID=%DEFAULT_EXT_ID%

REM ── Pre-flight: kill any leftover host process so the copy can succeed ──
taskkill /f /im TabFlowHost.exe >nul 2>&1

REM ── Make the install directory ──
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo  Created %INSTALL_DIR%
)

REM ── Copy the binary ──
copy /Y "%~dp0TabFlowHost.exe" "%INSTALL_DIR%\TabFlowHost.exe" >nul
set COPY_OK=0
if exist "%INSTALL_DIR%\TabFlowHost.exe" set COPY_OK=1

REM ── Write the Firefox native messaging manifest ──
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
set MANIFEST_OK=0
if exist "%MANIFEST%" set MANIFEST_OK=1

REM ── Register with Firefox via Windows Registry ──
reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul 2>&1
set REG_OK=0
if not errorlevel 1 set REG_OK=1

REM ── Verification + summary ─────────────────────────────────
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
    echo         Most common cause: Firefox or TabFlowHost.exe was running
    echo         and Windows blocked the copy. Fully close Firefox, then
    echo         run this .bat again.
    set ALL_OK=0
)

if %MANIFEST_OK%==1 (
    echo  [PASS] Manifest written to %MANIFEST%
) else (
    echo  [FAIL] Manifest NOT at %MANIFEST%
    echo         The script could not write to %INSTALL_DIR%.
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

REM ── Sanity-check the binary actually runs (simple ping ──────
REM    via stdin would need protocol code, so we just check the
REM    file is launchable by querying its metadata). If the file
REM    is corrupted or 0 bytes, this catches it.
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
    echo    1. Fully close Firefox. Open Task Manager Ctrl+Shift+Esc,
    echo       click the Details tab, end any leftover firefox.exe
    echo       and TabFlowHost.exe processes.
    echo    2. Reopen Firefox.
    echo    3. Open a TabFlow new tab. The top-right header should
    echo       show System and Firefox memory lines, plus v0.1.7
    echo       at the bottom.
    echo    4. Switch workspaces a couple times. Hover over the
    echo       Firefox icon in the taskbar — there should be only
    echo       one window visible there, not multiple.
    echo.
    echo  If after restarting Firefox you still don't see the memory
    echo  stats or the taskbar still shows multiple windows, run
    echo  diagnose-firefox.bat in this same folder and follow the
    echo  instructions it prints.
) else (
    echo                       INSTALL FAILED
    echo ════════════════════════════════════════════════════════════
    echo.
    echo  See the [FAIL] lines above for what went wrong and how to
    echo  fix it. The most common fixes:
    echo.
    echo    - Close Firefox fully ^(Task Manager → Details tab →
    echo      end firefox.exe and TabFlowHost.exe processes^), then
    echo      run this .bat again.
    echo    - Right-click this .bat → Run as administrator.
    echo.
    echo  If neither of those helps, run diagnose-firefox.bat in this
    echo  same folder. It will write a tabflow-diagnostics.txt file
    echo  with everything I'd ask you to check, which you can email
    echo  to yourself or share for help.
)

echo.
pause
