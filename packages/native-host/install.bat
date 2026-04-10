@echo off
REM ─────────────────────────────────────────────────────────────
REM  TabFlow Native Host Installer
REM
REM  Run this as Administrator after building TabFlowHost.exe.
REM  It copies the host to C:\TabFlow\ and registers it with Chrome.
REM ─────────────────────────────────────────────────────────────

setlocal

REM ── Configuration ──
set INSTALL_DIR=C:\TabFlow
set HOST_NAME=com.tabflow.host
set MANIFEST=%INSTALL_DIR%\%HOST_NAME%.json

REM ── Step 1: Get the extension ID from the user ──
echo.
echo  TabFlow Native Host Installer
echo  ─────────────────────────────
echo.
echo  To find your extension ID:
echo    1. Open chrome://extensions
echo    2. Enable Developer Mode (top right)
echo    3. Find TabFlow and copy its ID
echo.
set /p EXT_ID="  Enter your TabFlow extension ID: "

if "%EXT_ID%"=="" (
    echo  Error: Extension ID is required.
    pause
    exit /b 1
)

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

REM ── Step 4: Write the native messaging manifest ──
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
echo  Wrote manifest to %MANIFEST%

REM ── Step 5: Register with Chrome via Windows Registry ──
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f
if errorlevel 1 (
    echo  Error: Could not write registry key.
    pause
    exit /b 1
)
echo  Registered native messaging host in registry

echo.
echo  ✓ Installation complete!
echo    Host: %INSTALL_DIR%\TabFlowHost.exe
echo    Manifest: %MANIFEST%
echo    Extension: %EXT_ID%
echo.
echo  Restart Chrome for the changes to take effect.
echo.
pause
