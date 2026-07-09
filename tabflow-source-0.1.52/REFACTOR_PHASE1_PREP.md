# TabFlow Phase 1 Refactor Prep: System Operations Inventory

**Date:** 2026-06-08  
**Scope:** Comprehensive audit of every site that sets `isSwitchingWorkspaces`, calls system operations, and triggers gate-protected flows.

---

## 1. Every site that sets `isSwitchingWorkspaces` (direct or via callback)

### 1.1 MessageHandler initialization callback
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:78, 88, 92`
- **What:** Constructor accepts optional `onSwitchingWorkspacesChange` callback; stored as instance property.
- **When:** Dependency injection at MessageHandler creation in service-worker.ts.
- **Currently gated?:** No gate at definition; callback IS used (see 1.5-1.8).

### 1.2 Service Worker gate setter
- **File:** `packages/browser-extension/src/background/service-worker.ts:39-59`
- **What:** Global function `setSwitchingWorkspaces(value: boolean)` that sets module-level `isSwitchingWorkspaces` variable. Also referenced in guards at lines 2428, 2481, 2616, 2624, 2639, 2654, 2662, 2698 to gate snapshots and tab event handlers.
- **When:** Called via MessageHandler's `onSwitchingWorkspacesChange` callback.
- **Currently gated?:** No gate; just a boolean flag state machine.

### 1.3 handleSwitchWorkspace — set gate (true)
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:602`
- **What:** `this.onSwitchingWorkspacesChange?.(true)` at start of workspace switch flow.
- **When:** User clicks workspace tile → newtab.tsx calls `SWITCH_WORKSPACE` message → MessageHandler.handleSwitchWorkspace.
- **Currently gated?:** Gate is set; stays up through multiple async operations (lines 604-767), cleared in finally block (line 769).
- **Gate release:** try/finally at 604-770. No timeout. Gate released when SWITCH_WORKSPACE completes or errors.

### 1.4 handleSwitchWorkspace — clear gate (false)
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:769, 773`
- **What:** `this.onSwitchingWorkspacesChange?.(false)` in finally block; also on error path (line 773).
- **When:** After workspace switch completes (successfully or with error).
- **Currently gated?:** Yes; gate stays up during the entire flow and clears via try/finally.

### 1.5 handleRestoreHistoryEntry — set gate (true)
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:847`
- **What:** `this.onSwitchingWorkspacesChange?.(true)` before tab deletion/restoration.
- **When:** User clicks "Restore" on a history tile → HistoryPanel calls `RESTORE_HISTORY_ENTRY` message.
- **Currently gated?:** Gate set with try/finally block (847-907).
- **Gate release:** finally block at 907 clears gate. No timeout.

### 1.6 claimActiveDeviceWithMaterialization — set gate (true)
- **File:** `packages/browser-extension/src/background/service-worker.ts:2021`
- **What:** `isSwitchingWorkspaces = true` after pull completes, before tab materialization.
- **When:** Device claim operation (user signs in, sees "Claim device" button).
- **Currently gated?:** Gate set at line 2021; released in finally block (line 2070). No timeout.
- **Gate release:** finally block at 2070 clears gate and calls `refreshMainWindowId()`.

### 1.7 handleMoveTabsInServiceWorker — set gate (true)
- **File:** `packages/browser-extension/src/background/service-worker.ts:1365`
- **What:** `isSwitchingWorkspaces = true` inside setTimeout callback at +50ms (fire-and-forget tab close).
- **When:** User moves tabs between workspaces via "Move Tabs To..." popup menu.
- **Currently gated?:** Gate set at 1365 INSIDE a setTimeout (line 1364).
- **Gate release:** setTimeout at +500ms (line 1373) clears gate. **GATE LEAK:** setTimeout-based release; if SW crashes between set/clear, gate remains stuck.

### 1.8 runChromeRestartFlow — implicit gate suppression
- **File:** `packages/browser-extension/src/background/service-worker.ts:753+`
- **What:** Does NOT explicitly set `isSwitchingWorkspaces`; instead suppresses snapshots via `isStartingUp` and `postRestartSnapshotSuppressed` flags (see lines 912-913).
- **When:** Called on Chrome restart (native onStartup, ensureStartupComplete, or alarm).
- **Currently gated?:** Uses different flags; no `isSwitchingWorkspaces` gate. **LEAK:** No explicit gate during tab restoration.

---

## 2. Every call to `restoreWorkspaceTabs()`

### 2.1 In runChromeRestartFlow (Step 6)
- **File:** `packages/browser-extension/src/background/service-worker.ts:877`
- **What:** Restores active workspace's tabs after restart (from database, using restart-* or other records).
- **When:** During Chrome restart recovery flow.
- **Gated?:** Implicit gate via `isStartingUp=true` and `postRestartSnapshotSuppressed=true` flags (set at 912-913).

### 2.2 In handleSwitchWorkspace (Step 5 — primary restore)
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:697`
- **What:** Restores suspended tabs for target workspace after moveTabsToHiddenWindow fails or no hidden window exists.
- **When:** Workspace switch, as fallback after hidden-window restore attempt.
- **Gated?:** YES; explicit `isSwitchingWorkspaces=true` set at line 602.

### 2.3 In handleSwitchWorkspace (Step 5 — pending tabs)
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:707`
- **What:** Restores pending (moved-* and dup-*) tabs not in hidden window.
- **When:** After hidden-window restore; clears orphaned pending records.
- **Gated?:** YES; same `isSwitchingWorkspaces=true` gate as 2.2.

### 2.4 In claimActiveDeviceWithMaterialization (Step 3)
- **File:** `packages/browser-extension/src/background/service-worker.ts:2040`
- **What:** Restores active workspace tabs after destructive pull.
- **When:** Device claim flow; materializes workspace after pull from cloud.
- **Gated?:** YES; `isSwitchingWorkspaces=true` set at line 2021.

### 2.5 In handleRestoreHistoryEntry (if active workspace)
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:886`
- **What:** Restores history entry's tabs to actual Chrome window if workspace is active.
- **When:** History restore on active workspace only.
- **Gated?:** YES; `isSwitchingWorkspaces=true` set at line 847.

---

## 3. Every call to `saveCurrentTabsToWorkspace()`

### 3.1 In handleSwitchWorkspace (Step 2 — outgoing save)
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:644`
- **What:** Saves current active workspace's tabs before switching away (scan-and-reconcile).
- **When:** Start of workspace switch (if not post-restart switch).
- **Gated?:** YES; `isSwitchingWorkspaces=true` set at line 602 covers this.

### 3.2 In handleSwitchWorkspace (Step 7 — incoming save)
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:759`
- **What:** Saves target workspace's tabs after restore (fresh snapshot of actual window).
- **When:** End of workspace switch, after tabs are restored.
- **Gated?:** YES; same gate as 3.1.

### 3.3 In claimActiveDeviceWithMaterialization (Step 3)
- **File:** `packages/browser-extension/src/background/service-worker.ts:2046`
- **What:** Re-snapshots after restoring workspace tabs (ensures DB reflects actual window).
- **When:** During device claim, after restore settles.
- **Gated?:** YES; `isSwitchingWorkspaces=true` set at line 2021.

### 3.4 In snapshotActiveWorkspace (post-restart grace period)
- **File:** `packages/browser-extension/src/background/service-worker.ts:2492`
- **What:** Saves active workspace after late-tab dedupe watchdog expires.
- **When:** ~30s after Chrome restart (grace period expires; see runChromeRestartFlow line 947).
- **Gated?:** Implicit; called AFTER `postRestartSnapshotSuppressed=false` (line 957).

---

## 4. Every call to `moveTabsToHiddenWindow()` and `restoreTabsFromHiddenWindow()`

### 4.1 moveTabsToHiddenWindow in handleSwitchWorkspace
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:671`
- **What:** Moves current workspace's tabs to minimized window, preserving full state.
- **When:** Workspace switch (Step 4), unless post-restart skip.
- **Gated?:** YES; `isSwitchingWorkspaces=true` set at line 602.

### 4.2 restoreTabsFromHiddenWindow in handleSwitchWorkspace
- **File:** `packages/browser-extension/src/background/MessageHandler.ts:689`
- **What:** Restores tabs from hidden window back to main window (full state preservation).
- **When:** Workspace switch (Step 5), primary path before fallback to suspended-tab restore.
- **Gated?:** YES; `isSwitchingWorkspaces=true` set at line 602.

---

## 5. `runChromeRestartFlow` — browser-state mutations

**File:** `packages/browser-extension/src/background/service-worker.ts:753-951`

### Step 1: Ensure TabFlow tab (lines 765-786)
- `ensureTabFlowTab()` — creates/finds TabFlow newtab.
- `refreshMainWindowId()` — query and store main window ID.
- **Mutations:** chrome.tabs.create (via ensureTabFlowTab), chrome.storage.local set.

### Step 1.5: Restore TabFlow window visibility (lines 802-813)
- `chrome.windows.get(tabFlowWindowId)` — check state.
- `chrome.windows.update(tabFlowWindowId, { state: 'normal', focused: true })` — unmask/focus.
- **Mutations:** window state and focus.

### Step 2: Clear hidden window map (lines 819)
- `chrome.storage.local.set({ hiddenWindows: {} })` — wipe stale hidden-window tracking.
- **Mutations:** chrome.storage.local.

### Step 3: Close extra windows (lines 830-841)
- `chrome.windows.getAll()` — list all windows.
- `chrome.windows.remove(win.id)` for each non-TabFlow window.
- **Mutations:** chrome.windows (removal).

### Step 4: Close orphan tabs (lines 848-860)
- `chrome.tabs.query({ windowId: tabFlowWindowId })` — get tabs in main window.
- `chrome.tabs.remove(orphanTabIds)` — close non-TabFlow tabs.
- **Mutations:** chrome.tabs (removal).

### Step 5: Rename stale tab IDs (line 865)
- `renameStaleTabIds()` — batch-rename chrome-*/restart-* records (IndexedDB only).
- **Mutations:** IndexedDB (tab table).

### Step 6: Restore active workspace (lines 871-882)
- Calls `restoreWorkspaceTabs()` (see inventory item 2.1).
- **Mutations:** chrome.tabs (creation of suspended.html wrappers).

### Step 7: Late-tab dedupe watchdog (lines 884-951)
- `chrome.tabs.onCreated.addListener(onLateTabCreated)` — listen for late-arriving tabs.
- Deferred: `tabManager.dedupeTabsInWindow(dedupeWindowId)` at +1500ms and +30s.
- `chrome.tabs.onCreated.removeListener(onLateTabCreated)` at +30s.
- Final snapshot (post-watchdog; see line 957 onwards).
- **Mutations:** chrome.tabs (removal of duplicates via dedupe).

---

## 6. `claimActiveDeviceWithMaterialization` — browser-state mutations

**File:** `packages/browser-extension/src/background/service-worker.ts:1990-2073`

### Step 1: Destructive pull from cloud (lines 1998-2018)
- `syncClient.setPushing(true)` — lock out incoming Realtime.
- `syncClient.pullAll(syncUserId, true /* destructive */)` — wipe local data, fetch cloud.
- `syncClient.setPushing(false)` — unlock Realtime.
- **Mutations:** IndexedDB (workspaces, tabs tables; completely wiped and refilled).

### Step 2: Find active workspace (lines 2030-2034)
- `workspaceEngine.getWorkspaces()` — read active workspace from (now-clean) DB.
- **Mutations:** None.

### Step 3: Materialize browser state (lines 2037-2046)
- `tabManager.closeAllTabs()` — close all non-pinned tabs in main window.
- `storage.getTabs(activeWorkspace.id)` — read tabs for active workspace.
- `tabManager.restoreWorkspaceTabs(workspaceTabs, ...)` — create suspended.html tabs.
- `setTimeout(500ms)` — settle.
- `tabManager.saveCurrentTabsToWorkspace(activeWorkspace.id, ...)` — re-snapshot to DB.
- **Mutations:** chrome.tabs (close all, recreate from DB); IndexedDB (re-snapshot).

### Step 4: Claim on Supabase (lines 2054-2055)
- `syncClient.claimActiveDevice()` — mark this device as active in Supabase.
- `markSafeToPush('claim completed')` — allow future pushes.
- **Mutations:** Supabase devices table; IndexedDB (safeToPush flag).

### Step 5: Full sync push (lines 2062)
- `syncClient.fullSyncPush(syncUserId)` — clean up stale cloud rows.
- **Mutations:** Supabase (workspaces, tabs tables).

---

## 7. `handleSwitchWorkspace` — browser-state mutations

**File:** `packages/browser-extension/src/background/MessageHandler.ts:594-779`

### Step 1: Get workspaces (lines 606-623)
- Read from IndexedDB.
- **Mutations:** None.

### Step 2: Conditionally save outgoing workspace (lines 640-646)
- If not post-restart and currentActiveWorkspace exists: `saveCurrentTabsToWorkspace()`.
- **Mutations:** IndexedDB (tab records update).

### Step 3: Update workspace active flags (lines 649-660)
- Set `currentActiveWorkspace.isActive = false`, `targetWorkspace.isActive = true`.
- Call `storage.saveWorkspace()` twice.
- **Mutations:** IndexedDB (workspace records).

### Step 4: Move/close current tabs (lines 666-686)
- If post-restart: `closeAllTabs()` (closes all non-pinned).
- Else: `moveTabsToHiddenWindow(currentActiveWorkspace.id)` (moves to hidden window).
- **Mutations:** chrome.windows (creation of hidden window); chrome.tabs (move).

### Step 5: Restore target workspace (lines 688-709)
- Try `restoreTabsFromHiddenWindow(workspaceId)` (primary).
- If no hidden window: `restoreWorkspaceTabs(tabsToRestore, ...)` (fallback to suspended.html).
- Also restore pending moved-*/dup-* tabs.
- **Mutations:** chrome.windows (close hidden); chrome.tabs (move from hidden or create suspended).

### Step 6: Verify TabFlow tab pinning (lines 715-732)
- `chrome.tabs.get(tabFlowTabId)` — check if still pinned.
- `chrome.tabs.update(tabFlowTabId, { pinned: true })` if not.
- `chrome.tabs.move(tabFlowTabId, { index: 0 })` if not at index 0.
- **Mutations:** chrome.tabs (pin/move).

### Step 7: Settle and restore main window visibility (lines 735-753)
- `setTimeout(300ms)` — let tab events settle.
- `chrome.windows.get(mainWindowId)` — check if minimized.
- `chrome.windows.update(mainWindowId, { state: 'normal', focused: true })` if minimized.
- **Mutations:** chrome.windows (state/focus).

### Step 8: Re-snapshot target workspace (line 759)
- `saveCurrentTabsToWorkspace(workspaceId, ...)` — final snapshot of new state.
- **Mutations:** IndexedDB (tab records).

---

## 8. `handleRestoreHistoryEntry` — browser-state mutations

**File:** `packages/browser-extension/src/background/MessageHandler.ts:824-908`

### Step 1: Fetch history entry (lines 830-832)
- Read from IndexedDB.
- **Mutations:** None.

### Step 2: Delete existing tabs (lines 851-854)
- For each tab in workspace: `storage.deleteTab(tab.id)`.
- **Mutations:** IndexedDB (tab records deleted).

### Step 3: Create new tab records (lines 857-869)
- Build new Tab[] from history entry's tabs.
- Call `storage.saveTabs(newTabs)`.
- **Mutations:** IndexedDB (new tab records with fresh UUIDs).

### Step 4: If active workspace, restore in browser (lines 874-895)
- Get main window ID.
- `chrome.tabs.query({ windowId: mainWindowId })` — list current tabs.
- `chrome.tabs.remove(tabsToClose)` — close non-pinned, non-chrome://newtab.
- `restoreWorkspaceTabs(newTabs, ...)` — open new tabs from history.
- `setTimeout(500ms)` — settle.
- **Mutations:** chrome.tabs (removal, creation).

---

## 9. `handleMoveTabsInServiceWorker` — browser-state mutations

**File:** `packages/browser-extension/src/background/service-worker.ts:1297-1382`

### Step 1: Snapshot and index (lines 1316-1345)
- `tabManager.buildMainWindowUrlIndex()` — build URL→ChromeTabId[] map.
- For each selected tab: create new record in target workspace with moved-* ID.
- Call `storage.saveTab()` for each new record.
- **Mutations:** IndexedDB (new moved-* records).

### Step 2: Delete original records (lines 1352-1355)
- For each original tab ID: `storage.deleteTab(tabId)`.
- **Mutations:** IndexedDB (original records deleted).

### Step 3: Broadcast update (line 1358)
- `broadcastSyncUpdate()` — notify UI of new state.
- **Mutations:** None (notification only).

### Step 4: Close Chrome tabs (async, setTimeout +50ms) (lines 1362-1379)
- Set `isSwitchingWorkspaces = true` at +50ms.
- `chrome.tabs.remove(chromeIdsToClose)` — close Chrome tabs corresponding to moved records.
- Set `isSwitchingWorkspaces = false` at +500ms.
- **Mutations:** chrome.tabs (removal).
- **CRITICAL LEAK:** Gate set/cleared inside setTimeout chain; if SW terminates between set/clear, gate persists.

---

## 10. Tab event listeners that fire `snapshotActiveWorkspace()`

**File:** `packages/browser-extension/src/background/service-worker.ts:2615-2713`

### Listener: chrome.tabs.onCreated
- **Line:** 2615
- **Guard:** `if (isStartingUp || isSwitchingWorkspaces) return;` (line 2616)
- **Trigger condition:** Always calls `snapshotActiveWorkspace()` if not gated.
- **What:** Snapshot when user opens a new tab.

### Listener: chrome.tabs.onRemoved
- **Line:** 2623
- **Guard:** `if (isStartingUp || isSwitchingWorkspaces) return;` (line 2624)
- **Trigger condition:** Always calls `snapshotActiveWorkspace()` if not gated.
- **What:** Snapshot when user closes a tab.

### Listener: chrome.tabs.onUpdated
- **Line:** 2638
- **Guard:** `if (isStartingUp || isSwitchingWorkspaces) return;` (line 2639)
- **Trigger condition:** Calls `snapshotActiveWorkspace()` only if `status === 'complete'` (line 2644).
- **What:** Snapshot when tab finishes loading.

### Listener: chrome.tabs.onMoved
- **Line:** 2653
- **Guard:** `if (isStartingUp || isSwitchingWorkspaces) return;` (line 2654)
- **Trigger condition:** Always calls `snapshotActiveWorkspace()` if not gated.
- **What:** Snapshot when user reorders tabs.

### Listener: chrome.tabs.onAttached
- **Line:** 2661
- **Guard:** `if (isStartingUp || isSwitchingWorkspaces) return;` (line 2662)
- **Trigger condition:** Always calls `snapshotActiveWorkspace()` if not gated.
- **What:** Snapshot when tab is moved from another window.

### Listener: chrome.tabs.onActivated
- **Line:** 2673
- **Guard:** None at listener entry; guards apply only inside callback.
- **Trigger condition:** Calls `snapshotActiveWorkspace()` inside a nested `if (!isStartingUp && !isSwitchingWorkspaces)` check (line 2698).
- **What:** Snapshot when user activates a tab (optional; also triggers active-tab self-heal).

---

## Synthesis

### System operations that need to be wrapped in `runSystemOperation()`

The following are the CORE system operations that mutate significant browser state and currently rely on the `isSwitchingWorkspaces` gate:

1. **`handleSwitchWorkspace`** (CRITICAL)
   - Largest state mutation (save old workspace, switch active flags, move/close tabs, restore new workspace, verify pinning, re-snapshot)
   - All sub-calls depend on `isSwitchingWorkspaces=true`.
   - Currently: try/finally gate.

2. **`handleRestoreHistoryEntry`** (CRITICAL)
   - Deletes and recreates tab records; conditionally opens/closes Chrome tabs.
   - Gate set at start, released in finally.

3. **`claimActiveDeviceWithMaterialization`** (CRITICAL)
   - Destructive pull from cloud; entire workspace materialization.
   - Gate set at start, released in finally.

4. **`handleMoveTabsInServiceWorker`** (HIGH RISK)
   - Creates new records, deletes originals, closes Chrome tabs.
   - **BUG:** Gate set/cleared inside nested setTimeout; can leak if SW crashes.

5. **`runChromeRestartFlow`** (SPECIAL CASE)
   - Does NOT use explicit `isSwitchingWorkspaces` gate.
   - Uses `isStartingUp` and `postRestartSnapshotSuppressed` flags instead.
   - Needs different wrapping strategy; see "Gate leak inventory" below.

### Dependencies (secondary operations called within primary ones)
- `restoreWorkspaceTabs()` — called by all primary ops; safe if gate is set by caller.
- `saveCurrentTabsToWorkspace()` — called by all primary ops; safe if gate is set by caller.
- `moveTabsToHiddenWindow()` and `restoreTabsFromHiddenWindow()` — called only within handleSwitchWorkspace; safe.

**Recommendation:** All 5 primary operations should be wrapped in a new `runSystemOperation(operationName, asyncFn)` wrapper that:
- Sets the gate before calling the function.
- Runs the function with robust error handling.
- Clears the gate in a finally block **guaranteed to run** (no setTimeout delays).
- Persists gate state to storage so it survives SW restarts.

### Gate leak inventory

#### 1. **handleMoveTabsInServiceWorker** (CRITICAL LEAK)
- **Location:** service-worker.ts:1365-1379
- **Leak type:** setTimeout-based gate set/clear.
- **Symptom:** If SW crashes between `setTimeout(..., 50)` (gate set) and `setTimeout(..., 500)` (gate clear), gate persists across restart and blocks all future snapshots.
- **Fix:** Move the gate set/clear into the synchronous message handler; use a per-operation ID for tracking.

#### 2. **runChromeRestartFlow** (MODERATE LEAK)
- **Location:** service-worker.ts:753-951
- **Leak type:** Uses `isStartingUp` and `postRestartSnapshotSuppressed` instead of explicit `isSwitchingWorkspaces` gate.
- **Symptom:** If SW crashes during the watchdog period (30s post-restart), these flags stay `true` and snapshots never resume.
- **Evidence:** Lines 900-905 comment explicitly warns that `isStartingUp` and `postRestartSnapshotSuppressed` must stay true for the full 30s.
- **Fix:** Persist these flags to storage; check them on startup.

#### 3. **MessageHandler callbacks** (SOFT LEAK)
- **Location:** MessageHandler.ts:602, 769, 773, 847, 906
- **Leak type:** Gate set/clear via callback; callback may not fire if MessageHandler is destroyed or message channel closes.
- **Symptom:** Less likely in practice (callbacks are synchronous), but theoretically possible if exception occurs between lines 602 and 769.
- **Evidence:** Both 602 and 769 are in try/finally, so this is already mitigated. Line 773 (error path) has a direct call.
- **Status:** LOW RISK due to try/finally wrapping.

#### 4. **claimActiveDeviceWithMaterialization** (SOFT LEAK)
- **Location:** service-worker.ts:2021, 2070
- **Leak type:** Direct assignment within function; no setTimeout, but gate depends on function completion.
- **Symptom:** If `await syncClient.pullAll()` or `await tabManager.restoreWorkspaceTabs()` hangs indefinitely, gate stays true.
- **Evidence:** No timeout on the individual awaits.
- **Mitigation:** Recommend wrapping in `runSystemOperation()` which can add an operation-level timeout.

### Tab event handlers that need to respect the gate

All five tab event listeners in service-worker.ts:2615-2713 already guard on `isSwitchingWorkspaces`:
- `chrome.tabs.onCreated` (line 2616)
- `chrome.tabs.onRemoved` (line 2624)
- `chrome.tabs.onUpdated` (line 2639)
- `chrome.tabs.onMoved` (line 2654)
- `chrome.tabs.onAttached` (line 2662)
- `chrome.tabs.onActivated` (line 2698 — nested guard)

**Current state:** GOOD. All guards check `if (isStartingUp || isSwitchingWorkspaces) return;` before calling snapshot.

**Post-Phase-1:** If gate is persisted to storage, these listeners must query the persisted gate state (not just the in-memory flag) to respect gates across SW restarts.

### Open questions

1. **Timeout policy for Phase 1 gate:**
   - Should `runSystemOperation()` include an operation-level timeout (e.g., 60 seconds)?
   - Or should timeout be per-sub-operation (e.g., individual await statements)?
   - Recommendation: Add an operation timeout with clear logging if exceeded (do not auto-clear; let operator diagnose).

2. **Gate storage key design:**
   - Store gate state in chrome.storage.local with an `activeOperation: { name, startTime, context? }` object?
   - Or use separate keys per operation type (e.g., `gateSwitchingWorkspaces`, `gateDeviceClaim`)?
   - Recommendation: Single `activeSystemOperation` key to prevent multiple overlapping operations.

3. **Nested operation semantics:**
   - If `handleSwitchWorkspace` is wrapped in `runSystemOperation()`, but it internally calls functions that themselves might be wrapped, how do we prevent double-wrapping?
   - Recommendation: Only wrap the top-level entry points (handleSwitchWorkspace, handleRestoreHistoryEntry, claimActiveDeviceWithMaterialization, handleMoveTabsInServiceWorker). Do NOT wrap sub-operations like restoreWorkspaceTabs.

4. **runChromeRestartFlow special case:**
   - Should it be wrapped in `runSystemOperation()`, or should its gate flags (isStartingUp, postRestartSnapshotSuppressed) be handled separately?
   - It doesn't call `isSwitchingWorkspaces` at all; it uses different flags.
   - Recommendation: Persist `{ isStartingUp, postRestartSnapshotSuppressed, watchdogExpiryTime }` to storage separately. On startup, check if watchdog has expired; if so, clear flags.

5. **UI feedback during long operations:**
   - Phase 3 mentions a loading overlay. Should Phase 1 at least broadcast the gate state via `broadcastSyncUpdate()` so UI can show "operation in progress"?
   - Recommendation: Yes; `runSystemOperation()` should broadcast gate state transitions.

---

## File Structure Reference

```
packages/browser-extension/src/
├── background/
│   ├── service-worker.ts          (main startup, listeners, restart flow, claim flow, move-tabs handler)
│   ├── MessageHandler.ts          (switch workspace, restore history handlers)
│   └── TabManager.ts              (restore/save/move/hide operations)
└── newtab/
    └── NewTab.tsx                 (UI calls that trigger SWITCH_WORKSPACE, RESTORE_HISTORY_ENTRY)
```

---

**End of inventory. Ready for Phase 1 implementation.**
