# TabFlow Refactor Plan: Robust Gate + Final Reconcile

**Status:** Approved 2026-05-13. Phase 0 in progress.
**Estimated effort:** 1 week of focused work + per-phase testing.
**Risk:** Low–medium. The architecture stays — we're just making the existing gate reliable.

---

## What we're fixing

The DB-as-source-of-truth model is already what TabFlow is *trying* to do. The implementation breaks because the gate (`isSwitchingWorkspaces`) that suppresses snapshots during system operations is leaky:

1. The gate is lifted on a timeout (300ms / 500ms) instead of when the system operation's code actually finishes.
2. Some paths don't set the gate (history restore pre-0.1.19).
3. SW restart mid-operation loses the in-memory gate.
4. No final reconcile after the gate lifts — so user actions that happen DURING a system operation can be lost.

Each "fix" between 0.1.21 and 0.1.25 was patching a different symptom of the leaky gate. The right move is to fix the gate properly, not stack more workarounds.

---

## The model (Sam's words)

- **User actions** → snapshot scans the browser, makes the DB match. Adds AND deletes.
- **System operations** (workspace switch, restore, claim, restoreWorkspaceTabs) → DON'T touch the DB. The system manages its own browser changes; the DB is left alone.
- **End of every system operation** → ONE final scan-and-reconcile. Captures any user actions that happened during the operation. From here on, normal snapshot rules resume.
- **Resume Working Here** → reverse direction. Read DB, recreate browser.

Loading time is irrelevant. While the system is loading tabs, all those tab events are ignored by the snapshot. When the system's code finishes, gate lifts, final reconcile runs, normal operation resumes.

Special cases that bypass the snapshot:
- **Scroll position** — own fast path (SAVE_SCROLL_POSITION → direct Supabase push). Frequent updates would be expensive as full scans. Stays as is.
- **YouTube time tracker URL update** — fires `chrome.tabs.onUpdated` like any URL change. Snapshot handles it naturally.
- **Workspace operations** (rename, delete, create) — direct DB writes via dedicated message handlers. Don't depend on the snapshot.

---

## What's broken right now (concrete failure modes)

1. **Workspace switch leaves the gate ON for 300ms** then lifts. If chrome.tabs.create's onCreated events fire after 300ms (slow system, many tabs), they reach the snapshot as if they were user actions. Snapshot scans during transition → mid-state visible → wrong DB write.

2. **Restore from history sets the gate** (added in 0.1.19) but lifts after 500ms. Same race as #1, just larger window.

3. **Claim materialization** (Resume Working Here) doesn't have a unified gate. It sets `isSwitchingWorkspaces` for parts of its flow but not consistently.

4. **SW killed mid-operation.** Extension auto-update kills the SW. New SW starts. `isSwitchingWorkspaces` is a JS variable in memory — gone. New SW thinks no operation is in progress. Snapshot fires. Mid-state visible → wrong DB write.

5. **No final reconcile.** If during a workspace switch the user closes a Firefox tab via Firefox's UI (which we can't block), that close fires onRemoved, gate is ON so it's ignored. Gate lifts. No reconcile. The DB doesn't know about the closed tab. Eventually the next user action's snapshot catches it, but until then the DB is stale.

---

## What stays the same

- Storage schema (IndexedDB + Supabase). No changes.
- Deterministic storage IDs (`tab-<hash>`).
- Hidden-window workspace switching.
- End-to-end encryption.
- Sync layer (SupabaseSyncClient).
- Resume Working Here flow.
- All UI.
- Native host integration.
- `saveCurrentTabsToWorkspace` — the scan-and-reconcile function. Keeps its current behavior.
- Snapshot debouncing (500ms) for user actions.

---

## What changes

### Removed

- The 0.1.24 verify-retry block in `restoreWorkspaceTabs` (it's the duplicate source). **Phase 0.**
- The timeout-based gate lifts (`setTimeout` then set isSwitchingWorkspaces=false). Replaced with explicit lifts in try/finally.
- The 5-second record preservation rule in saveCurrentTabsToWorkspace. Unnecessary once the gate is reliable. **Phase 2.**

### Added

- A persistent gate flag in `chrome.storage.session`. SW restart mid-operation reads this on startup and resumes "system operation in progress" state until explicit clear.
- A `runSystemOperation(name, fn)` wrapper that handles gate set/lift in try/finally, runs the operation, then runs the final reconcile. All system operations use this wrapper.
- A `finalReconcile(workspaceId, windowId)` function that's called at the end of every system operation. Does one scan-and-reconcile to capture any user actions during the operation.

### Modified

- `handleSwitchWorkspace`: wraps in `runSystemOperation`. Explicit gate management, final reconcile.
- `handleRestoreHistoryEntry`: same.
- `claimActiveDeviceWithMaterialization`: same.
- `runChromeRestartFlow`: same. The "Step 3 close non-TabFlow windows" stays only for the genuine Chrome-restart case (cleaned-up via the runtime.onStartup signal), not the false-positive cases that 0.1.23–0.1.25 tried to patch.
- The SW's tab event listeners (`onCreated`, `onUpdated`, `onRemoved`, etc.) check the persistent gate AND the in-memory flag. Either being set means "operation in progress, skip snapshot."

---

## Phased plan

### Phase 0: Stop the bleeding (this session)

- Revert 0.1.24's verify-retry from `restoreWorkspaceTabs`.
- Ship as 0.1.26.
- Sam tests: install. Restoration shouldn't create duplicates anymore. Other issues (data loss on install) remain — that's Phase 1.

### Phase 1: Robust gate (2-3 days)

- Implement `runSystemOperation(name, fn)` wrapper.
- Add persistent gate in `chrome.storage.session` + fallback to local storage for SW-restart-resilience.
- Convert `handleSwitchWorkspace`, `handleRestoreHistoryEntry`, `claimActiveDeviceWithMaterialization`, and any `restoreWorkspaceTabs` call site to use the wrapper.
- All tab event listeners check the gate.
- Ship as 0.1.27. Don't move forward until Sam confirms install-data-loss is fixed.

### Phase 2: Final reconcile (1-2 days)

- Add `finalReconcile()` function called at the end of `runSystemOperation`.
- It runs ONE saveCurrentTabsToWorkspace for the active workspace, after the operation completes.
- Remove the 5-second record preservation rule (no longer needed — the gate prevents the race, and the final reconcile is precise).
- Ship as 0.1.28.

### Phase 3: UI loading overlay (1 day, optional polish)

- React component that shows during long system operations.
- Renders when isSwitchingWorkspaces is true for more than 500ms.
- Dismisses when the gate clears.
- Does NOT block — just communicates state. Firefox-level user actions still go through (and get captured by the final reconcile).
- Ship as 0.1.29.

---

## Risks

### Gate gets stuck ON

If an operation throws but the finally doesn't fire (shouldn't happen with try/finally, but JS edge cases exist), the gate could stay ON indefinitely. Mitigations:
- Always use try/finally in `runSystemOperation`.
- Add a max-lifetime fallback: if the persistent gate has been set for >60 seconds, clear it automatically.
- Log every gate set/clear with operation name for debugging.

### SW restarts during an operation

The persistent gate (in chrome.storage.session) survives SW restart within the same browser session. On SW restart, we read the gate. If set, we assume an operation was in flight and just clear it (the operation's continuation logic, if any, will re-fire via onStartup or onInstalled flow).

### Tab events that arrive AFTER gate clears but BEFORE final reconcile

Race window between gate-clear and the final-reconcile call. Tab events here would trigger a normal snapshot, which competes with the final reconcile. Mitigation: the final reconcile runs SYNCHRONOUSLY at the end of `runSystemOperation`, before the gate is cleared. So events arriving after the gate clears do trigger normal snapshots (correct) but don't race with the final reconcile.

### Phase 1 ships without Phase 2

If Phase 1 ships without Phase 2, the gate works but user actions during system operations may not register until the next user action. Acceptable. Phase 2 follows quickly.

---

## Testing plan per phase

**Phase 0:** Install 0.1.26 on Firefox. Restore from history. Verify no duplicates.

**Phase 1:** Install 0.1.27 on Firefox. Auto-update from prior version. Verify:
- Inactive workspace tabs survive the update.
- Workspace switch doesn't lose tabs.
- History restore sticks on first try.

**Phase 2:** Install 0.1.28. Verify:
- Open a tab during a workspace switch — after the switch, the new tab is in the DB.
- Close a tab during a restore — after the restore, the closed tab is not in the DB.

**Phase 3:** Visual check. Loading overlay appears during slow operations.

---

## Honest expectations

- Phase 0 is 30 minutes of work. Confidence: high.
- Phase 1 is the real fix. ~2-3 days, mostly because converting every system operation to the wrapper requires touching multiple files and careful testing.
- Phase 2 is cleanup once Phase 1 is solid.
- Phase 3 is purely polish.

If after Phase 1 Sam still sees data loss on install, the next step is **getting actual SW console logs** rather than another speculative patch. The new code will log every gate set/clear with operation name; the logs will pinpoint where the race is happening.

I will not ship Phase 2 or 3 until Sam confirms Phase 1 fixed the install-data-loss issue.
