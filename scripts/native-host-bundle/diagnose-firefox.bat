@echo off
REM ─────────────────────────────────────────────────────────────
REM  TabFlow Firefox Diagnostics.
REM
REM  Run this if you've already run install-firefox.bat but the
REM  TabFlow extension still doesn't show memory stats or hide
REM  workspace windows from the taskbar.
REM
REM  This script does NOT change anything on your computer. It
REM  only inspects what's already there and prints the result
REM  to the screen AND to a file called tabflow-diagnostics.txt
REM  in this same folder, which you can email or share for help.
REM ─────────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

set INSTALL_DIR=C:\TabFlow
set HOST_NAME=com.tabflow.host
set MANIFEST=%INSTALL_DIR%\%HOST_NAME%.firefox.json
set REG_KEY=HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%
set OUT="%~dp0tabflow-diagnostics.txt"

REM Fresh diagnostic file
echo TabFlow Firefox Diagnostics > %OUT%
echo Generated: %DATE% %TIME% >> %OUT%
echo. >> %OUT%

call :both ─────────────────────────────────────────────
call :both  TabFlow Firefox Diagnostics
call :both ─────────────────────────────────────────────
call :both ""

REM ── Check 1: Binary exists ─────────────────────────────
call :both "[Check 1] TabFlowHost.exe at %INSTALL_DIR%\TabFlowHost.exe"
if exist "%INSTALL_DIR%\TabFlowHost.exe" (
    for %%I in ("%INSTALL_DIR%\TabFlowHost.exe") do set BIN_SIZE=%%~zI
    call :both "  PASS — file exists, !BIN_SIZE! bytes"
) else (
    call :both "  FAIL — file does not exist"
    call :both "  FIX:  Run install-firefox.bat in this folder."
)
call :both ""

REM ── Check 2: Manifest exists ───────────────────────────
call :both "[Check 2] Manifest at %MANIFEST%"
if exist "%MANIFEST%" (
    call :both "  PASS — manifest file exists"
    call :both "  Contents:"
    for /f "usebackq delims=" %%L in ("%MANIFEST%") do (
        call :both "    %%L"
    )
) else (
    call :both "  FAIL — manifest file does not exist"
    call :both "  FIX:  Run install-firefox.bat in this folder."
)
call :both ""

REM ── Check 3: Registry entry ────────────────────────────
call :both "[Check 3] Registry entry at %REG_KEY%"
reg query "%REG_KEY%" >nul 2>&1
if errorlevel 1 (
    call :both "  FAIL — registry key not set"
    call :both "  FIX:  Run install-firefox.bat as Administrator"
    call :both "        right-click → Run as administrator."
) else (
    call :both "  PASS — registry key exists. Value:"
    for /f "tokens=2*" %%A in ('reg query "%REG_KEY%" /ve 2^>nul ^| findstr REG_SZ') do (
        call :both "    %%B"
    )
)
call :both ""

REM ── Check 4: Try running the host briefly ──────────────
call :both "[Check 4] Can TabFlowHost.exe actually run?"
if exist "%INSTALL_DIR%\TabFlowHost.exe" (
    REM The host expects native-messaging input on stdin. Without input it
    REM exits cleanly after reading 0 bytes from stdin (EOF). If it crashes
    REM with a runtime error, the exit code is nonzero and we'd see that.
    REM We pipe `echo.` so stdin is closed immediately.
    echo. | "%INSTALL_DIR%\TabFlowHost.exe" >nul 2>nul
    if errorlevel 1 (
        call :both "  FAIL — host exited with error code %ERRORLEVEL%"
        call :both "  FIX:  Likely .NET runtime issue. The bundled binary"
        call :both "        SHOULD be self-contained (no .NET install needed)"
        call :both "        but if you're seeing this, try downloading the"
        call :both "        latest TabFlow native host bundle, which uses"
        call :both "        the self-contained build."
    ) else (
        call :both "  PASS — host launches cleanly"
    )
) else (
    call :both "  SKIPPED — binary not present"
)
call :both ""

REM ── Check 5: Is Firefox running? ───────────────────────
call :both "[Check 5] Is Firefox currently running?"
tasklist /fi "imagename eq firefox.exe" 2>nul | find /i "firefox.exe" >nul
if errorlevel 1 (
    call :both "  Firefox is NOT running. That's fine for installing"
    call :both "  but you'll need to reopen Firefox to test."
) else (
    call :both "  Firefox IS running. Note: changes to native-host"
    call :both "  registration only take effect after Firefox is fully"
    call :both "  closed and reopened (close all windows AND end any"
    call :both "  firefox.exe processes in Task Manager)."
)
call :both ""

REM ── Check 6: Windows version ───────────────────────────
call :both "[Check 6] Windows version"
for /f "tokens=4-7 delims=[.] " %%A in ('ver') do (
    call :both "  %%A.%%B.%%C.%%D"
)
call :both ""

call :both ─────────────────────────────────────────────
call :both " Diagnostics also saved to:"
call :both "   %~dp0tabflow-diagnostics.txt"
call :both ""
call :both " You can email that file to yourself or share it for help."
call :both ─────────────────────────────────────────────

echo.
pause
goto :eof

REM Helper: print a line to the screen AND append it to the diagnostics file.
:both
echo  %~1
echo  %~1>>%OUT%
goto :eof
