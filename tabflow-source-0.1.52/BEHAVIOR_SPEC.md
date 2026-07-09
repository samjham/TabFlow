# TabFlow Behavior Specification

## Core Principle
**IndexedDB is the source of truth.** It only changes when the user takes an explicit action. Background processes NEVER delete or modify stored tab records.

## Data Model
- **Workspace**: has id, name, color, isActive, sortOrder
- **Tab record**: has id, workspaceId, url, title, faviconUrl, sortOrder, isPinned
  - `chrome-{N}` IDs: tabs currently open as real Chrome tabs
  - `moved-{N}` IDs: tabs moved from another workspace, not yet materialized

## User Actions That Change Storage

| Action | What Changes |
|--------|-------------|
| Create workspace | New workspace record added |
| Delete workspace | Workspace + its tab records deleted |
| Rename workspace | Workspace name updated |
| Change workspace color | Workspace color updated |
| Reorder workspaces | Workspace sortOrder updated |
| Switch workspace | Both workspaces' isActive toggled; current workspace's tabs snapshot saved |
| Open new tab (in browser) | New tab record added to active workspace |
| Close tab (in browser) | Tab record removed from active workspace (ONLY if user closed it, NOT if window is closing) |
| Navigate tab to new URL | Tab record URL/title updated |
| Move tab between workspaces | Record deleted from source, created in target with moved-* ID |
| Reorder tabs (drag in browser) | Tab sortOrder updated |

## Background Processes That Are ALLOWED

| Process | What It Does | Why It's OK |
|---------|-------------|-------------|
| ensureTabFlowTab | Pins/creates TabFlow tab on startup | Only touches Chrome tabs, not storage |
| Tab event tracking (onCreate, onUpdate, onRemove) | Keeps storage in sync with Chrome | Mirrors user actions in real-time |
| saveCurrentTabsToWorkspace (during switch) | Snapshots active workspace tabs | Captures current state before hiding |
| Hidden window move/restore | Moves Chrome tabs between windows | Only touches Chrome tabs, not storage |
| ID remapping (restoreWorkspaceTabs) | Updates chrome-* IDs after creating suspended tabs | Necessary: old IDs are invalid |

## Background Processes That Are HARMFUL (must be removed/fixed)

| Process | Problem |
|---------|---------|
| handleGetWorkspaces dedup (line 175) | Deletes "duplicate" records during a READ operation — reads should NEVER write |
| handleGetTabs reconciliation (line 290) | Deletes "stale" records during a READ operation — reads should NEVER write |
| reconcileActiveWorkspaceTabs on startup | Deletes records that don't match Chrome tabs — but after restart ALL IDs are stale, so it deletes everything |
| saveCurrentTabsToWorkspace deleting chrome-* records | Deletes existing records before saving — can race with other operations |
| onRemoved without isWindowClosing | Deletes records when Chrome shuts down (all windows closing) |

## Workspace Switch Flow (correct behavior)

1. Save current Chrome tabs to current workspace storage (ADDITIVE - update/add records, don't delete)
2. Toggle isActive on both workspaces
3. Move current Chrome tabs to hidden window (Chrome state only, no storage changes)
4. Restore target workspace: move from hidden window OR create suspended tabs
5. Remap IDs in storage for newly created suspended tabs
6. Verify TabFlow tab is still pinned at index 0

## Chrome Restart Flow (correct behavior)

1. Chrome opens with session restore (or fresh start)
2. ensureTabFlowTab finds/creates/pins the TabFlow tab
3. Hidden windows are gone — clean up the mapping
4. Active workspace tab records still exist in storage (old chrome-* IDs)
5. DO NOT reconcile — old IDs are fine; they'll be remapped when user switches away and back
6. When user views active workspace, show stored records (they reflect the correct tabs)
7. Tab event listeners will naturally update records as Chrome tabs load

## TabFlow Tab Detection (for isTabFlowTab)

Priority order:
1. Cached tab ID (stored in chrome.storage.local + TabManager.cachedTabFlowTabId)
2. Extension URL check (chrome-extension://{id}/)
3. Pinned tab at index 0 (always assumed to be TabFlow)
