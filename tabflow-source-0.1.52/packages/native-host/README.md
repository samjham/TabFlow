# TabFlow Native Messaging Host

A small Windows companion app that hides TabFlow's background workspace windows from the Windows taskbar.

## Prerequisites

- Windows 10 or 11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (for building)
- .NET 8 Runtime (for running — usually included with the SDK)

## Build

Open a terminal in this directory and run:

```
dotnet publish -c Release
```

The compiled executable will be at:
```
bin\Release\net8.0\win-x64\publish\TabFlowHost.exe
```

## Install

1. Build the project (see above)
2. Run `install.bat` **as Administrator**
3. When prompted, enter your TabFlow extension ID (find it at `chrome://extensions` with Developer Mode enabled)
4. Restart Chrome

## How It Works

The native host communicates with the TabFlow Chrome extension via Chrome's Native Messaging protocol (stdin/stdout JSON). When TabFlow creates a minimized window to preserve workspace tabs, it tells the native host to apply the `WS_EX_TOOLWINDOW` Windows API style to that window, which removes it from the taskbar.

The host runs as a persistent background process while Chrome is open. It uses minimal resources (~5MB RAM) and exits automatically when Chrome disconnects.

## Uninstall

1. Delete the registry key:
   ```
   reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.tabflow.host" /f
   ```
2. Delete the install directory: `C:\TabFlow\`
3. Restart Chrome
