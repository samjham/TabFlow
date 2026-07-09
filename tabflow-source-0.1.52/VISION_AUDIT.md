# VISION AUDIT: TabFlow Cross-Device Sync

**Generated:** 2026-06-22

## Executive Summary

The system is 75% aligned with the vision. The core architecture is sound:
- Cloud is the source of truth ✓
- Local IndexedDB is the cache ✓
- Resume Working Here materializes full state ✓
- Only active device pushes ✓
- Self-correcting via reconciliation ✓

But four features violate the "EXACTLY what I was last doing" promise because they were never wired to the cloud. Everything else passed the audit — no leaks, no architectural flaws, no hidden bugs.

## The Four Gaps

### Gap 1: Workspace History — NOT synced (CRITICAL)

Per-workspace tab snapshots used by the History panel. Local IndexedDB only.

**User impact:** Open browser on work PC → history only goes back to last time work PC was active (2 days ago). Last night's home PC activity is invisible.

**Fix:**
- New Supabase `workspace_history` table with encrypted tab_snapshots JSONB
- `pushHistoryEntry()` after each snapshot
- `pullHistory()` on claim
- 30-day retention via server-side cron

**Estimated effort:** ~7 hours

### Gap 2: Deleted Workspaces (recycle bin) — NOT synced (HIGH)

`deletedWorkspaces` IndexedDB table, never reaches cloud.

**User impact:** Delete on Device A, switch to Device B, the workspace still exists on B. Delete it again on B → two orphaned archive entries, one per device.

**Fix:**
- New Supabase `deleted_workspaces` table with encrypted workspace_snapshot JSONB
- `pushDeletedWorkspace()` on delete, `pushRestoredWorkspace()` on restore
- Pull on claim
- 90-day retention

**Estimated effort:** ~7 hours

### Gap 3: Workspace `shortName` — NOT synced (MEDIUM)

The 1-3 char label on pinned tab favicon. Local IndexedDB only. Currently preserved across pulls via a local-only hack (`shortNameMap` in SupabaseSyncClient pullAll), but never actually crosses devices.

**User impact:** Set "YT" label on home PC, switch to work PC → label is gone.

**Fix:**
- Add `short_name TEXT` column to `workspaces` Supabase table
- Include in pushWorkspace upsert
- Remove the shortNameMap preservation hack (no longer needed)

**Estimated effort:** ~2 hours

### Gap 4: Sidebar Width — PARTIAL sync (LOW)

Sync infrastructure exists (`user_settings.preferences.sidebarWidth` JSONB), pushes on drag, pulls on startup. BUT: `claimActiveDeviceWithMaterialization` doesn't pull preferences after the workspace/tab pull.

**User impact:** Resize sidebar on Device A, click Resume on Device B → Device B uses its own old width, not Device A's.

**Fix:**
- Add `getPreferences()` call to `claimActiveDeviceWithMaterialization` after `pullAll`
- Mirror returned `sidebarWidth` to chrome.storage.local

**Estimated effort:** ~1.5 hours

## State Inventory (Abridged)

What's currently synced and matches the vision:
- Workspaces (name, color, icon, sort_order, isActive)
- Tabs (URL, title, favicon, sort_order, pinned, scroll_x, scroll_y)
- Active device claim
- Sidebar width (partial — see Gap 4)

What's local-only and SHOULD be synced (the four gaps above):
- workspaceHistory
- deletedWorkspaces
- workspace.shortName
- sidebar width on claim

What's local-only and correctly so (per-device infrastructure):
- thumbnails (can regenerate)
- tabFlowTabId (per-device tab reference)
- encryption passphrase/salt (device secret)
- hiddenWindows map (per-device window IDs)
- gates (isStartingUp, isSwitchingWorkspaces, etc.)

## No Other Bugs Found

The audit looked for:
- Race conditions → only the device-status one, which is documented and acceptable
- Error swallowing → none found
- Dead code → minor, not user-facing
- Inconsistent push/pull paths → none beyond the four gaps
- Inappropriate sync (state pushed that shouldn't be) → none

## Recommended Priority

1. Workspace History — user just complained, biggest user impact
2. Deleted Workspaces — data consistency concern
3. shortName — quick win
4. Sidebar width — finishing touch

Total estimated effort: ~17.5 hours if done sequentially.
