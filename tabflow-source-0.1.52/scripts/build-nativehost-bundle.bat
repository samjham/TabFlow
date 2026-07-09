@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  TabFlow native-host bundle builder.
REM
REM  Run this on a Windows computer that has the .NET 8 SDK installed
REM  (which is true on the work computer where dotnet has been used
REM  before). Produces a tabflow-nativehost-windows.zip in the project
REM  root that you can email/transfer to a different computer to install
REM  the native host without needing any developer tools on that side.
REM
REM  What it does:
REM    1. Rebuilds TabFlowHost.exe via `dotnet publish -c Release`.
REM       The .csproj is configured for SelfContained=true so the
REM       resulting binary is ~70 MB and includes the .NET runtime.
REM    2. Copies the rebuilt binary into scripts\native-host-bundle\
REM    3. Zips that folder via PowerShell's Compress-Archive into
REM       tabflow-nativehost-windows.zip at the repo root.
REM
REM  No npm, no Node.js needed — just .NET and PowerShell (which is
REM  built into Windows).
REM ─────────────────────────────────────────────────────────────────────

setlocal

REM Move to repo root (we live in scripts\)
pushd "%~dp0\.."

echo.
echo  TabFlow Native Host Bundle Builder
echo  ──────────────────────────────────
echo.

REM ── Sanity: dotnet must be available ────────────────────────────────
where dotnet >nul 2>&1
if errorlevel 1 (
    echo  ERROR: dotnet is not on PATH.
    echo  This script needs the .NET 8 SDK to rebuild the native host.
    echo  Install from https://dotnet.microsoft.com/download
    pause
    popd
    exit /b 1
)

REM ── 1. Rebuild ──────────────────────────────────────────────────────
echo  [1/3] Rebuilding native host...
pushd packages\native-host
dotnet publish -c Release
if errorlevel 1 (
    echo.
    echo  ERROR: dotnet publish failed. See output above.
    popd
    popd
    pause
    exit /b 1
)
popd

REM ── 2. Copy the binary into the bundle staging folder ───────────────
echo.
echo  [2/3] Copying binary into bundle folder...
set SRC=packages\native-host\bin\Release\net8.0\win-x64\publish\TabFlowHost.exe
set DST=scripts\native-host-bundle\TabFlowHost.exe
if not exist "%SRC%" (
    echo  ERROR: published binary not found at %SRC%
    popd
    pause
    exit /b 1
)
copy /Y "%SRC%" "%DST%" >nul
if errorlevel 1 (
    echo  ERROR: could not copy %SRC% to %DST%
    popd
    pause
    exit /b 1
)
for %%I in ("%DST%") do echo         %DST% (%%~zI bytes^)

REM ── 3. Zip the bundle ───────────────────────────────────────────────
echo.
echo  [3/3] Zipping bundle...
set OUT=tabflow-nativehost-windows.zip
if exist "%OUT%" del /q "%OUT%"
powershell -NoProfile -Command "Compress-Archive -Path 'scripts\native-host-bundle\*' -DestinationPath '%OUT%' -Force"
if errorlevel 1 (
    echo  ERROR: zip step failed.
    popd
    pause
    exit /b 1
)

for %%I in ("%OUT%") do set ZIP_SIZE=%%~zI
echo         %OUT% (%ZIP_SIZE% bytes^)

echo.
echo  ────────────────────────────────────────────────────────────
echo   Done. The bundle is at:
echo     %CD%\%OUT%
echo  ────────────────────────────────────────────────────────────
echo.
echo  Email it to yourself or copy it to a USB drive, then on the
echo  target computer extract the zip and run install-firefox.bat.
echo.

popd
endlocal
pause
