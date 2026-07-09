@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  TabFlow project cleanup (Windows batch version).
REM
REM  Run by double-clicking this file in Explorer, or from cmd:
REM    scripts\clean.bat
REM
REM  Identical in spirit to `npm run clean` but doesn't require Node.
REM  Removes:
REM   - dist/ folders under packages/
REM   - All zi* sandbox temp files in the project root
REM   - .release-tmp-chrome-store/ staging dir
REM   - vite.config.ts.timestamp-*.mjs build temp files
REM   - manifest.json.tmp anywhere
REM   - tabflow-*.zip release zips that aren't the current version
REM   - Legacy unversioned zips: tabflow-firefox.zip, tabflow-source.zip,
REM     tabflow-chrome.zip
REM
REM  Always preserves the current version's release zips so you have the
REM  most recent release on disk.
REM ─────────────────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

REM Move to the repo root (the parent of scripts\).
pushd "%~dp0\.."

echo.
echo  TabFlow Cleanup
echo  ───────────────
echo.

REM ── Read the current version from the Chrome manifest ──────────────
set CURRENT_VERSION=
for /f "tokens=2 delims=:," %%V in ('findstr /c:"\"version\"" packages\browser-extension\public\manifest.chrome.json') do (
    set RAW=%%V
    set RAW=!RAW: =!
    set RAW=!RAW:"=!
    if not defined CURRENT_VERSION set CURRENT_VERSION=!RAW!
)

if defined CURRENT_VERSION (
    echo  Current version: %CURRENT_VERSION%
) else (
    echo  Could not detect current version — keeping nothing version-specific.
)
echo.

REM ── 1. dist/ folders ───────────────────────────────────────────────
echo  [1/5] Removing dist/ folders...
for /d %%D in (packages\*) do (
    if exist "%%D\dist" (
        echo    - %%D\dist
        rmdir /s /q "%%D\dist"
    )
)

REM ── 2. zi* sandbox temp files in project root ──────────────────────
echo  [2/5] Removing zi* sandbox temp files...
for %%F in (zi*) do (
    if exist "%%F" (
        echo    - %%F
        del /q "%%F"
    )
)

REM ── 3. .release-tmp-* staging dirs ─────────────────────────────────
echo  [3/5] Removing .release-tmp-* staging dirs...
for /d %%D in (.release-tmp-*) do (
    if exist "%%D" (
        echo    - %%D
        rmdir /s /q "%%D"
    )
)

REM ── 4. Vite timestamp temps + manifest.json.tmp ────────────────────
echo  [4/5] Removing Vite temp files and manifest.json.tmp...
for /r packages %%F in (vite.config.ts.timestamp-*.mjs) do (
    if exist "%%F" (
        echo    - %%F
        del /q "%%F"
    )
)
for /r packages %%F in (manifest.json.tmp) do (
    if exist "%%F" (
        echo    - %%F
        del /q "%%F"
    )
)

REM ── 5. Old release zips (anything not matching current version) ────
echo  [5/5] Removing old release zips...
REM Legacy unversioned filenames (always remove)
for %%F in (tabflow-chrome.zip tabflow-firefox.zip tabflow-source.zip) do (
    if exist "%%F" (
        echo    - %%F (legacy unversioned)
        del /q "%%F"
    )
)
REM Versioned zips that don't match the current version
for %%F in (tabflow-chrome-*.zip tabflow-firefox-*.zip tabflow-source-*.zip) do (
    set "FNAME=%%F"
    set KEEP=0
    if defined CURRENT_VERSION (
        echo !FNAME! | findstr /c:"-%CURRENT_VERSION%.zip" /c:"-%CURRENT_VERSION%-store.zip" >nul 2>&1
        if not errorlevel 1 set KEEP=1
    )
    if !KEEP! equ 0 (
        if exist "%%F" (
            echo    - %%F
            del /q "%%F"
        )
    )
)

echo.
echo  ───────────────────────────────────────────────────────────────────
echo  Done. Current version's release zips were preserved.
echo  ───────────────────────────────────────────────────────────────────
echo.

popd
endlocal
pause
