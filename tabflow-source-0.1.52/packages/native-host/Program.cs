/**
 * TabFlow Native Messaging Host
 *
 * A persistent native messaging host that hides/shows browser windows
 * from the Windows taskbar using the WS_EX_TOOLWINDOW extended style,
 * and reports system/browser memory stats back to the extension.
 *
 * Protocol: Native messaging (length-prefixed JSON over stdin/stdout).
 *
 * Supported messages:
 *   { "action": "hide", "windowTitle": "..." }          — Hide a window from taskbar
 *   { "action": "show", "windowTitle": "..." }          — Restore a window to taskbar
 *   { "action": "hideMinimized", "processName": "chrome" | "firefox" }
 *                                                      — Hide all minimized windows belonging
 *                                                        to processes with that name from the
 *                                                        Windows taskbar. processName is
 *                                                        optional (defaults to "chrome") for
 *                                                        backward compat with installs from
 *                                                        before this parameter existed.
 *   { "action": "hideByPid", "excludeTitle": "..." }    — Hide all Chrome windows except one
 *   { "action": "ping" }                                — Health check
 *   { "action": "get_system_memory" }                   — Total + available system RAM
 *   { "action": "get_browser_memory", "processName": "chrome" | "firefox" }
 *                                                      — Sum working-set bytes across
 *                                                        all processes with that name
 *
 * Responses:
 *   { "success": true, "action": "...", "hwnd": "..." }
 *   { "success": true, "totalBytes": 17179869184, "availableBytes": 8589934592 }
 *   { "success": true, "processName": "firefox", "memoryBytes": 1234567890, "processCount": 7 }
 *   { "success": false, "error": "..." }
 */

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace TabFlowHost;

class Program
{
    // ─── Windows API imports ─────────────────────────────────────────

    [DllImport("user32.dll", SetLastError = true)]
    static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool IsIconic(IntPtr hWnd);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const int WS_EX_APPWINDOW = 0x00040000;
    const int SW_HIDE = 0;
    const int SW_SHOW = 5;
    const int SW_MINIMIZE = 6;

    // ─── Native Messaging I/O ────────────────────────────────────────

    static void Main(string[] args)
    {
        // Native messaging uses stdin/stdout with length-prefixed JSON.
        // Read messages in a loop until stdin closes (extension disconnects).
        using var stdin = Console.OpenStandardInput();
        using var stdout = Console.OpenStandardOutput();

        while (true)
        {
            try
            {
                var message = ReadMessage(stdin);
                if (message == null) break; // stdin closed

                var response = HandleMessage(message);
                WriteMessage(stdout, response);
            }
            catch (Exception ex)
            {
                try
                {
                    var errorResponse = JsonSerializer.Serialize(new
                    {
                        success = false,
                        error = ex.Message
                    });
                    WriteMessage(stdout, errorResponse);
                }
                catch
                {
                    // If we can't even write an error, bail out
                    break;
                }
            }
        }
    }

    /// <summary>
    /// Reads a length-prefixed JSON message from stdin.
    /// Returns null if stdin is closed.
    /// </summary>
    static string? ReadMessage(Stream stdin)
    {
        // First 4 bytes are the message length (little-endian uint32)
        var lengthBytes = new byte[4];
        int bytesRead = 0;
        while (bytesRead < 4)
        {
            int read = stdin.Read(lengthBytes, bytesRead, 4 - bytesRead);
            if (read == 0) return null; // EOF
            bytesRead += read;
        }

        int length = BitConverter.ToInt32(lengthBytes, 0);
        if (length <= 0 || length > 1024 * 1024) return null; // Sanity check: max 1MB

        var messageBytes = new byte[length];
        bytesRead = 0;
        while (bytesRead < length)
        {
            int read = stdin.Read(messageBytes, bytesRead, length - bytesRead);
            if (read == 0) return null; // EOF
            bytesRead += read;
        }

        return Encoding.UTF8.GetString(messageBytes);
    }

    /// <summary>
    /// Writes a length-prefixed JSON message to stdout.
    /// </summary>
    static void WriteMessage(Stream stdout, string message)
    {
        var messageBytes = Encoding.UTF8.GetBytes(message);
        var lengthBytes = BitConverter.GetBytes(messageBytes.Length);
        stdout.Write(lengthBytes, 0, 4);
        stdout.Write(messageBytes, 0, messageBytes.Length);
        stdout.Flush();
    }

    // ─── Message Handling ────────────────────────────────────────────

    static string HandleMessage(string messageJson)
    {
        using var doc = JsonDocument.Parse(messageJson);
        var root = doc.RootElement;

        var action = root.GetProperty("action").GetString() ?? "";

        switch (action)
        {
            case "ping":
                return JsonSerializer.Serialize(new { success = true, action = "pong" });

            case "hide":
            {
                var title = root.GetProperty("windowTitle").GetString() ?? "";
                var hwnd = FindChromeWindowByTitle(title);
                if (hwnd == IntPtr.Zero)
                    return JsonSerializer.Serialize(new { success = false, error = $"Window not found: {title}" });

                HideFromTaskbar(hwnd);
                return JsonSerializer.Serialize(new { success = true, action = "hide", hwnd = hwnd.ToString() });
            }

            case "show":
            {
                var title = root.GetProperty("windowTitle").GetString() ?? "";
                var hwnd = FindChromeWindowByTitle(title);
                if (hwnd == IntPtr.Zero)
                    return JsonSerializer.Serialize(new { success = false, error = $"Window not found: {title}" });

                ShowInTaskbar(hwnd);
                return JsonSerializer.Serialize(new { success = true, action = "show", hwnd = hwnd.ToString() });
            }

            case "hideByPid":
            {
                // Hide all Chrome windows except the one containing a specific tab title
                var excludeTitle = root.GetProperty("excludeTitle").GetString() ?? "";
                var count = HideChromeWindowsExcept(excludeTitle);
                return JsonSerializer.Serialize(new { success = true, action = "hideByPid", hiddenCount = count });
            }

            case "hideMinimized":
            {
                // Hide only minimized browser windows from the taskbar.
                // This is the safest approach — TabFlow's hidden workspace
                // windows are always minimized, while the main window is not.
                //
                // processName lets us target Chrome or Firefox specifically;
                // it defaults to "chrome" for backward compatibility (early
                // versions of the host took no parameter and hardcoded chrome).
                var processName = "chrome";
                if (root.TryGetProperty("processName", out var pnProp))
                {
                    var pn = pnProp.GetString();
                    if (!string.IsNullOrWhiteSpace(pn)) processName = pn!;
                }
                var count = HideMinimizedBrowserWindows(processName);
                return JsonSerializer.Serialize(new
                {
                    success = true,
                    action = "hideMinimized",
                    processName,
                    hiddenCount = count
                });
            }

            case "get_system_memory":
            {
                // Physical RAM total + available, via Win32 GlobalMemoryStatusEx.
                // This is the Firefox path (Firefox has no browser.system.memory API).
                // Chrome usually gets these from chrome.system.memory directly, but
                // this action lets Chrome fall back to the host too if the permission
                // was dropped from the manifest.
                var mem = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX)) };
                if (!GlobalMemoryStatusEx(ref mem))
                {
                    int errCode = Marshal.GetLastWin32Error();
                    return JsonSerializer.Serialize(new { success = false, error = $"GlobalMemoryStatusEx failed ({errCode})" });
                }
                return JsonSerializer.Serialize(new
                {
                    success = true,
                    action = "get_system_memory",
                    totalBytes = mem.ullTotalPhys,
                    availableBytes = mem.ullAvailPhys
                });
            }

            case "get_browser_memory":
            {
                // Sum working-set bytes across all processes whose name matches.
                // processName is "chrome" on Chrome and "firefox" on Firefox
                // (Process.GetProcessesByName matches without the .exe suffix).
                // Both browsers run multiple processes (main + content + GPU + utility
                // + extension), so we sum them all to show total real-memory footprint.
                if (!root.TryGetProperty("processName", out var nameProp))
                {
                    return JsonSerializer.Serialize(new { success = false, error = "Missing processName" });
                }
                var processName = nameProp.GetString() ?? "";
                if (string.IsNullOrWhiteSpace(processName))
                {
                    return JsonSerializer.Serialize(new { success = false, error = "processName cannot be empty" });
                }

                long total = 0;
                int procCount = 0;
                try
                {
                    var procs = Process.GetProcessesByName(processName);
                    foreach (var proc in procs)
                    {
                        try
                        {
                            // WorkingSet64 = physical RAM the process is currently using.
                            // Task Manager's "Memory" column for a process roughly matches
                            // this (minus some shared-page accounting).
                            total += proc.WorkingSet64;
                            procCount++;
                        }
                        catch
                        {
                            // Process may have exited between enumeration and read.
                        }
                        finally
                        {
                            proc.Dispose();
                        }
                    }
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new { success = false, error = $"GetProcessesByName failed: {ex.Message}" });
                }

                return JsonSerializer.Serialize(new
                {
                    success = true,
                    action = "get_browser_memory",
                    processName,
                    memoryBytes = total,
                    processCount = procCount
                });
            }

            default:
                return JsonSerializer.Serialize(new { success = false, error = $"Unknown action: {action}" });
        }
    }

    // ─── Window Management ───────────────────────────────────────────

    /// <summary>
    /// Finds a Chrome window whose title contains the given substring.
    /// Only matches windows belonging to Chrome processes.
    /// </summary>
    static IntPtr FindChromeWindowByTitle(string titleSubstring)
    {
        IntPtr found = IntPtr.Zero;
        var chromeProcessIds = GetChromeProcessIds();

        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd)) return true; // skip invisible

            GetWindowThreadProcessId(hWnd, out uint pid);
            if (!chromeProcessIds.Contains(pid)) return true; // skip non-Chrome

            int len = GetWindowTextLength(hWnd);
            if (len == 0) return true;

            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            var title = sb.ToString();

            if (title.Contains(titleSubstring, StringComparison.OrdinalIgnoreCase))
            {
                found = hWnd;
                return false; // stop enumeration
            }

            return true;
        }, IntPtr.Zero);

        return found;
    }

    /// <summary>
    /// Gets all process IDs for processes whose executable name matches
    /// (e.g. "chrome" or "firefox" — without the .exe suffix).
    /// </summary>
    static HashSet<uint> GetBrowserProcessIds(string processName)
    {
        var ids = new HashSet<uint>();
        foreach (var proc in Process.GetProcessesByName(processName))
        {
            ids.Add((uint)proc.Id);
        }
        return ids;
    }

    /// <summary>
    /// Backward-compat shim — older callers expect "chrome".
    /// </summary>
    static HashSet<uint> GetChromeProcessIds() => GetBrowserProcessIds("chrome");

    /// <summary>
    /// Hides a window from the taskbar by adding WS_EX_TOOLWINDOW
    /// and removing WS_EX_APPWINDOW.
    /// </summary>
    static void HideFromTaskbar(IntPtr hwnd)
    {
        // Must hide window before changing style, then show again
        ShowWindow(hwnd, SW_HIDE);

        int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
        exStyle |= WS_EX_TOOLWINDOW;    // Add tool window (hidden from taskbar)
        exStyle &= ~WS_EX_APPWINDOW;    // Remove app window (shown in taskbar)
        SetWindowLong(hwnd, GWL_EXSTYLE, exStyle);

        // Re-show as minimized
        ShowWindow(hwnd, SW_MINIMIZE);
    }

    /// <summary>
    /// Restores a window to the taskbar by removing WS_EX_TOOLWINDOW
    /// and adding WS_EX_APPWINDOW.
    /// </summary>
    static void ShowInTaskbar(IntPtr hwnd)
    {
        int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
        exStyle &= ~WS_EX_TOOLWINDOW;   // Remove tool window
        exStyle |= WS_EX_APPWINDOW;     // Add app window
        SetWindowLong(hwnd, GWL_EXSTYLE, exStyle);

        ShowWindow(hwnd, SW_SHOW);
    }

    /// <summary>
    /// Hides all MINIMIZED windows belonging to a given browser process from
    /// the taskbar. This is the safe approach: TabFlow's hidden workspace
    /// windows are always minimized, so only they get hidden. The user's
    /// main browser window (which is normal/maximized) is never touched.
    ///
    /// processName is the executable name without ".exe" — e.g. "chrome" or
    /// "firefox". Process.GetProcessesByName matches case-insensitively.
    /// </summary>
    static int HideMinimizedBrowserWindows(string processName)
    {
        int count = 0;
        var browserProcessIds = GetBrowserProcessIds(processName);

        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd)) return true; // already hidden

            GetWindowThreadProcessId(hWnd, out uint pid);
            if (!browserProcessIds.Contains(pid)) return true; // not this browser

            // Only hide windows that are minimized (IsIconic = true)
            if (!IsIconic(hWnd)) return true; // skip non-minimized

            int len = GetWindowTextLength(hWnd);
            if (len == 0) return true; // skip untitled

            HideFromTaskbar(hWnd);
            count++;
            return true;
        }, IntPtr.Zero);

        return count;
    }

    /// <summary>
    /// Backward-compat shim — older code paths expect a Chrome-specific name.
    /// </summary>
    static int HideMinimizedChromeWindows() => HideMinimizedBrowserWindows("chrome");

    /// <summary>
    /// Hides all Chrome windows from the taskbar EXCEPT the one whose
    /// title contains the given substring. Returns the number hidden.
    /// </summary>
    static int HideChromeWindowsExcept(string excludeTitleSubstring)
    {
        int count = 0;
        var chromeProcessIds = GetChromeProcessIds();

        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd)) return true;

            GetWindowThreadProcessId(hWnd, out uint pid);
            if (!chromeProcessIds.Contains(pid)) return true;

            int len = GetWindowTextLength(hWnd);
            if (len == 0) return true;

            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            var title = sb.ToString();

            // Skip the window we want to keep visible
            if (!string.IsNullOrEmpty(excludeTitleSubstring) &&
                title.Contains(excludeTitleSubstring, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            // Hide this Chrome window from taskbar
            HideFromTaskbar(hWnd);
            count++;
            return true;
        }, IntPtr.Zero);

        return count;
    }
}
