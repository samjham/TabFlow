TabFlow Native Host — Standalone Installer Bundle
===================================================

This bundle installs the TabFlow native messaging host on a Windows
computer that doesn't have any developer tools (no .NET SDK, no Node.js).
TabFlowHost.exe in this bundle is self-contained — it includes the .NET
runtime, so it just runs on any Windows 10+ x64 machine with no
prerequisites.

The native host is what enables two TabFlow features:
  - Memory usage stats in the new-tab page header
  - Hiding inactive workspace windows from the Windows taskbar
    (so they don't show up when you hover over Firefox/Chrome)

Without the host installed, TabFlow still works fine — those two
features just turn off.


Files in this bundle
--------------------
  TabFlowHost.exe          - Native host binary (self-contained, ~70 MB)
  install.bat              - Register the host with Chrome
  install-firefox.bat      - Register the host with Firefox
  diagnose-firefox.bat     - Inspect what's installed if Firefox isn't
                             picking up the host (read-only, doesn't
                             change anything)
  README.txt               - This file


Installing
----------
1. Extract this bundle to any folder on your computer (your Desktop
   is a fine place).

2. Fully close Firefox and/or Chrome. Open Task Manager
   (Ctrl + Shift + Esc), click the "Details" tab, and end any
   leftover firefox.exe, chrome.exe, or TabFlowHost.exe processes
   you see.

3. Double-click install-firefox.bat (for Firefox) or install.bat
   (for Chrome). A black command prompt window opens.

4. When prompted for the extension/gecko ID, just press Enter to
   use the default (the published TabFlow ID).

5. The script copies TabFlowHost.exe to C:\TabFlow\, registers it
   with the browser, and then runs verification at the end. You'll
   see a "VERIFICATION" section showing PASS/FAIL for each step
   and a clear "INSTALL SUCCEEDED" or "INSTALL FAILED" summary.

6. Read the summary. If it says SUCCEEDED, follow the "Next steps"
   it prints (close Firefox, reopen, check the new tab page).

7. If it says FAILED, the script tells you specifically what's wrong
   and how to fix it. The most common issues are: a browser process
   was still running during the install (close it, rerun), or the
   script needs to run as Administrator (right-click the .bat → Run
   as administrator).


If you run install but TabFlow STILL doesn't show memory stats
---------------------------------------------------------------
Run diagnose-firefox.bat in this same folder. It checks every piece
of the install (binary present, manifest present, registry entry
present, host actually launches, Firefox running or not, Windows
version) and prints PASS/FAIL with explanations. It also writes
everything to a text file called tabflow-diagnostics.txt next to
the .bat, which you can email to yourself or share for help.

Common reasons the host appears installed but isn't being used:
  - Firefox wasn't fully restarted after install. Close ALL Firefox
    windows, end any leftover firefox.exe processes in Task Manager,
    then reopen.
  - Your Firefox extension's gecko ID isn't tabflow@samhamilton.dev.
    This is rare — it'd only happen if you installed a temporary
    add-on with a custom ID. Check at about:support, search for
    TabFlow, look at the ID column.


Uninstalling
------------
The host runs only when the TabFlow extension talks to it, so leaving
it installed costs nothing. To remove it anyway:
  1. Delete C:\TabFlow\
  2. Open regedit and delete:
     HKEY_CURRENT_USER\Software\Mozilla\NativeMessagingHosts\com.tabflow.host
     HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.tabflow.host
