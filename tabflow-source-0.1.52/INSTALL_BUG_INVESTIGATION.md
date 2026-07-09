# Install-Restart Bug Investigation

## Executive Summary

The "install-restart causes workspace tabs to end up in wrong place" bug has persisted through 5+ fixes because the root cause is a **race condition in `ensureTabFlowTab` combined with a gap in window detection logic after Firefox extension auto-update**. The bug manifests as:

1. A new Firefox window created with only an unpinned TabFlow tab
2. The original main window hidden or minimized with the workspace tabs intact
3. User sees no tabs at the top until they find/click the other window

The fix requires ensuring `ensureTabFlowTab` runs in the correct window context and that `getMainWindowId` can reliably identify the main window after session state is partially corrupted.

---

## Section 1: Startup Detection Logic

### IIFE Flow (lines 1149–1268)

The IIFE runs on every SW start: extension reload, SW wake, and browser restart. It has two branches:

**Branch A: Extension reload (lines 1209–1218)**
- Condition: `skipRestartDetection` is true (set by either session marker OR version change)
- Sets: Nothing destructive
- Calls: `ensureTabFlowTab()` at 1.5s, `refreshMainWindowId()`
- Purpose: Re-pin TabFlow tab if extension reloaded in-session

**Branch B: Browser restart detection (lines 1220–1267)**
- Condition: `skipRestartDetection` is false (fresh restart or detected restart)
- Markers checked:
  - `iifeRanThisSession` (chrome.storage.session, line 1183) — persists across SW reload/extension update; cleared on browser restart
  - `lastSeenVersion` vs current manifest version (lines 1194–1202) — detects extension updates because Firefox clears session storage on auto-update
- Logic:
  - If `pendingChromeRestart` flag exists (line 1220): explicitly set by onStartup/message handler
    - Sets: `isChromeRestart=true`, `postRestartSnapshotSuppressed=true`, schedules alarm
  - Else if stored `tabFlowTabId` doesn't exist as a real tab (lines 1227–1257):
    - Detects stale ID (Firefox/Chrome restart)
    - Sets: `isChromeRestart=true`, `pendingChromeRestart=true`, schedules alarm
  - Else: extension reload, calls `ensureTabFlowTab()` at 1.5s

**Critical Problem:** If `chrome.storage.session` is cleared by Firefox auto-update (happens on 0.1.29→0.1.30), but `lastSeenVersion` update fails or hasn't yet written, the IIFE can incorrectly branch into destructive Chrome restart path even though it's just an extension update. This path sets `pendingChromeRestart=true` and awakens `runChromeRestartFlow`.

---

## Section 2: What Triggers runChromeRestartFlow

`runChromeRestartFlow` (lines 763–1000) runs inside `runSystemOperation` gate. Triggered by:

1. **onStartup** (line 1128): Sets `pendingChromeRestart=true`, calls `runChromeRestartFlow` immediately
2. **IIFE browser restart branch** (line 1247): Sets flag, schedules alarm
3. **Message-triggered startup** (line 1536): Called from `ensureStartupComplete` if stale tab ID detected
4. **chrome.windows.onCreated** (line 1012): Fires on window creation during Chrome startup; re-triggers if flag still set

### runChromeRestartFlow Steps

| Step | Code | What Happens | Bug Risk |
|------|------|--------------|----------|
| 1 | Lines 775–797 | Call `ensureTabFlowTab()`, verify pinned, get `tabFlowWindowId` | ✗ If no tabs exist yet (Chrome still restoring), returns false, entire flow aborts |
| 1.5 | Lines 813–824 | Un-minimize TabFlow window (critical for Firefox) | |
| 2 | Line 830 | Clear hidden window map | |
| 3 | Lines 840–852 | **Close ALL windows except TabFlow window** | ⚠ If `tabFlowWindowId` is wrong, closes the user's main window |
| 4 | Lines 858–871 | Close non-TabFlow tabs in the main window | |
| 5 | Line 876 | Rename stale `chrome-*` IDs to `restart-*` | |
| 6 | Lines 881–893 | Restore active workspace's tabs via `restoreWorkspaceTabs` | |
| 7+ | Lines 943–984 | Dedupe watchdog for 30s | |

**The trap:** Step 3 closes all windows except the one we *think* is the main window. If `tabFlowWindowId` is wrong, we delete the user's entire workspace.

---

## Section 3: Source of the "Extra Window"

Two mechanisms can create a new TabFlow window:

### Mechanism A: ensureTabFlowTab Creates Tab in Default Window (lines 522–557)

When `ensureTabFlowTab` can't find an existing TabFlow tab, it creates one. Window selection logic:

```
if (allTabs.length > 0 && allTabs[0].windowId !== undefined) {
  // Use window of first tab found
  targetWindowId = allTabs[0].windowId;
} else {
  targetWindowId = (chrome.windows.getLastFocused()).id;
}
```

**Problem:** On Firefox after extension auto-update during startup:
- Firefox restores the user's previous session into one window (e.g., YouTube tabs in Window A)
- The extension reloads, service worker starts
- IIFE runs, checks session marker → cleared by Firefox auto-update
- `lastSeenVersion` check may not have run yet or may have failed
- IIFE enters restart-detection branch, detects stale `tabFlowTabId` (because Firefox's tab IDs changed)
- Sets `pendingChromeRestart=true`, schedules alarm
- `ensureTabFlowTab()` is called (from alarm or message trigger)
- `chrome.tabs.query({})` returns restored session tabs from Window A
- New TabFlow tab created in Window A
- But user had a DIFFERENT window open before (Window B) where TabFlow actually lives
- Result: **Two windows, TabFlow in the wrong one**

### Mechanism B: chrome.windows.onCreated During Startup (lines 1012–1022)

On browser startup, Firefox restores windows. Each restored window triggers `chrome.windows.onCreated`. If `isChromeRestart` is true and `pendingChromeRestart` is set, the handler re-triggers `runChromeRestartFlow`.

**Problem:** If the handler fires BEFORE the IIFE's `ensureTabFlowTab` call, and the user's main window hasn't been created yet, Firefox may create a new window for the TabFlow tab instead of using the existing one.

---

## Section 4: Why 0.1.25's Version-Comparison Check Isn't Reliable

**0.1.25 code (lines 1194–1202):**

```typescript
const currentVersion = chrome.runtime.getManifest().version;
const stored = await chrome.storage.local.get('lastSeenVersion');
if (stored?.lastSeenVersion && stored.lastSeenVersion !== currentVersion) {
  wasJustUpdated = true;
  console.log(`[TabFlow] IIFE: detected extension update from ${stored.lastSeenVersion} to ${currentVersion}`);
}
if (stored?.lastSeenVersion !== currentVersion) {
  await chrome.storage.local.set({ lastSeenVersion: currentVersion });
}
```

**Why it fails:**

1. **Timing race on first run:** On Firefox 0.1.29→0.1.30 update:
   - Firefox clears `chrome.storage.session`
   - IIFE runs immediately, reads `lastSeenVersion` from storage
   - On first IIFE run after update, if `chrome.storage.local` hasn't synced yet (or is empty on fresh profile), `stored.lastSeenVersion` is undefined
   - `wasJustUpdated` stays false ✗
   - Falls through to stale-tab-ID detection
   - **Incorrectly triggers restart flow**

2. **No error handling:** If `chrome.runtime.getManifest()` or storage read fails, the check is silently skipped

3. **Can't distinguish:** The check detects "updated" but not "which type of restart." On Firefox, session marker is wiped but the version write has a race window.

**Correct signal chain should be:**
- Session marker + version BOTH say "same session" → definitely not a restart
- Session marker missing BUT version unchanged → Firefox auto-update, not a restart
- Version changed → extension update, not a restart
- All three missing/contradictory → genuine restart

Current code treats "version unchanged" + "session marker gone" as "genuine restart" — but that's exactly the Firefox auto-update case.

---

## Section 5: Recommended Fix Approach

### Root Cause
The startup code doesn't reliably distinguish "Firefox extension auto-update" from "Firefox browser restart." Session storage gets cleared in both cases, and the version check has a write-race.

### Fix Strategy

**1. Fix the version check write order (service-worker.ts:1194–1202)**

Update BEFORE reading, not after:
```typescript
// WRITE first so we always have a baseline
const currentVersion = chrome.runtime.getManifest().version;
const stored = await chrome.storage.local.get('lastSeenVersion');
const previousVersion = stored?.lastSeenVersion || '';

// Only treat as "update" if we have a previous version AND it's different
let wasJustUpdated = previousVersion && previousVersion !== currentVersion;

// Always update for next time
if (previousVersion !== currentVersion) {
  await chrome.storage.local.set({ lastSeenVersion: currentVersion });
}
```

**2. Add a persistent "startup completed" flag (new)**

After startup flow completes, set a flag that survives the session marker wipe:
```typescript
await chrome.storage.local.set({ startupCompleted: true });
```

In ensureStartupComplete (line 1517), add:
```typescript
const { startupCompleted } = await chrome.storage.local.get('startupCompleted');
if (startupCompleted) {
  // Already ran startup once this install — don't re-trigger on ext update
  return;
}
```

**3. Fix ensureTabFlowTab window detection (service-worker.ts:522–557)**

When creating a new TabFlow tab, prefer the last-focused window over the first tab's window:
```typescript
let targetWindowId: number | undefined;
try {
  const lastFocused = await chrome.windows.getLastFocused();
  if (lastFocused?.id !== undefined) {
    targetWindowId = lastFocused.id; // Prefer last-focused
  }
} catch { /* fall through */ }
if (!targetWindowId && allTabs.length > 0) {
  targetWindowId = allTabs[0].windowId; // Fallback
}
```

This ensures the TabFlow tab lands in the user's active window, not a random restored session window.

**4. Add window state recovery (service-worker.ts:813–824)**

The code already does this for hidden windows. Ensure it's called even if Step 1 verification fails:
```typescript
// In runChromeRestartFlow, move un-minimize before verification
// So if verification fails, at least the window is visible
if (tabFlowWindowId !== undefined) {
  try {
    await chrome.windows.update(tabFlowWindowId, { state: 'normal', focused: true });
  } catch { /* ignore */ }
}
```

**5. Verify main window before closing others (service-worker.ts:840–852)**

Add a safety check:
```typescript
if (tabFlowWindowId === undefined) {
  console.error('[TabFlow] Cannot safely proceed: main window ID unknown');
  return false; // Abort, don't close anything
}

const allWindows = await chrome.windows.getAll();
const mainWindowExists = allWindows.some(w => w.id === tabFlowWindowId);
if (!mainWindowExists) {
  console.error('[TabFlow] Main window not in window list!');
  return false; // Abort
}

// Now safe to close others
for (const win of allWindows) {
  if (win.id !== tabFlowWindowId && win.id !== undefined) {
    try {
      await chrome.windows.remove(win.id);
    } catch { /* ignore */ }
  }
}
```

### Why This Works

- **Fix 1:** Guarantees version write completes before read, eliminating the race
- **Fix 2:** Prevents re-running startup on extension updates by checking persistent state
- **Fix 3:** Ensures new TabFlow tabs are created in the user's active window, not a random session-restored one
- **Fix 4:** Guarantees the main window is visible before we try to move tabs into it
- **Fix 5:** Prevents the catastrophic "closing the user's window by mistake" scenario

---

## Files to Modify

- `packages/browser-extension/src/background/service-worker.ts`
  - Lines 1194–1202: Fix version check write order
  - Lines 1220–1268: Add startup-completed flag check
  - Lines 522–557: Fix ensureTabFlowTab window selection
  - Lines 813–824: Move window un-minimize earlier
  - Lines 840–852: Add safety checks before closing windows

---

## Testing After Fix

1. **Test on Firefox extension auto-update:**
   - Build 0.1.30 from source
   - Load as temporary add-on on Firefox 128+
   - Close Firefox
   - "Update" by changing manifest version to 0.1.31 (don't rebuild, just copy the dist)
   - Reopen Firefox → observe that startup flow does NOT re-run

2. **Test genuine Firefox restart:**
   - Close all Firefox windows
   - Reopen Firefox → startup flow SHOULD run

3. **Test multi-window scenario:**
   - Open Firefox with multiple windows
   - Restart Firefox
   - Observe: TabFlow tab appears in the last-focused window, other windows are closed (as designed)
