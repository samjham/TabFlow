# TabFlow — Project Handoff for Claude

> **Note to Claude:** This document is the source of truth for continuing TabFlow development. Read this file first before touching anything. It describes what TabFlow is, how it's built, what's been done, and the rules you must follow. The human developer is **Sam** (shamilton@vortexgov.com). Update this document at the end of any meaningful work session.

---

## 1. What TabFlow Is

TabFlow is a Chrome MV3 browser extension that organizes tabs into **workspaces** (sometimes called "spaces"). Each workspace is a named container for a set of tabs, with its own color, icon, and metadata. The user's use case is separating different contexts (work, research, personal, projects) without drowning in one giant tab bar.

**Key product features:**

- Workspaces with custom names, colors, and optional short-name labels
- The new tab page (`chrome_url_overrides.newtab`) IS the app — it shows a sidebar of workspaces and a grid of tab tiles for the active workspace
- Drag-and-drop tab reordering and workspace reordering
- Per-tab memory stats and audible indicators
- Optional end-to-end encrypted cloud sync via the user's own self-hosted Supabase project
- Multi-device "Resume Working Here" model — only one device is actively pushing syncs at a time
- Workspace archive (recycle bin) — deleted workspaces can be restored with all their tabs
- Per-workspace tab history (snapshots) with restore
- Tab thumbnails, search across all workspaces, native-messaging companion host

**Published as:** Unlisted extension on Chrome Web Store. Item ID: `gkcamehohljdpenmjmoaciigppdbjcgl`.

---

## 2. Repository Layout

This is an npm workspaces monorepo.

```
Browser Tab Manager Project/
├── CLAUDE.md                       ← this file
├── BEHAVIOR_SPEC.md                ← short behavioral spec (older)
├── ICON_GENERATION.md              ← how icons are built
├── architecture.html               ← older architecture notes
├── supabase-setup.sql              ← combined idempotent SQL for new users
├── package.json                    ← root workspace config
├── store-assets/                   ← Chrome Web Store assets + privacy policy
│   ├── icon-source.svg
│   ├── icon-{16,48,128}.png
│   ├── screenshot-{1,2,3}-*.png    (1280x800)
│   ├── store-listing.md
│   └── privacy-policy.html         ← hosted at https://samjham.github.io/TabFlow/store-assets/privacy-policy.html
└── packages/
    ├── core/                       ← @tabflow/core — platform-agnostic types, engine, crypto
    │   └── src/
    │       ├── models/types.ts     ← Workspace, Tab, Session, DeletedWorkspace, etc.
    │       ├── storage/StorageAdapter.ts
    │       ├── workspace/WorkspaceEngine.ts
    │       ├── sync/SyncClient.ts
    │       └── crypto/encryption.ts
    ├── chrome-extension/           ← @tabflow/chrome-extension — the MV3 extension itself
    │   ├── public/manifest.json    ← permissions, icons, entry points
    │   └── src/
    │       ├── background/         ← service worker, MessageHandler, TabManager
    │       ├── newtab/             ← main UI (NewTab.tsx + useWorkspaces hook)
    │       ├── popup/              ← toolbar popup
    │       ├── sidebar/            ← side-panel entry
    │       ├── storage/            ← IndexedDBAdapter (Dexie.js) — source of truth
    │       ├── sync/               ← SupabaseSyncClient
    │       ├── auth/               ← AuthManager + SetupWizard
    │       ├── components/         ← shared React components
    │       ├── content/            ← content scripts (youtube-time-tracker)
    │       ├── entries/            ← HTML entry points
    │       └── config.ts           ← Supabase config loader (async from chrome.storage.local)
    ├── native-host/                ← optional native-messaging companion
    └── supabase/                   ← SQL migrations + setup script
        ├── migrations/
        │   ├── 001_init.sql
        │   ├── 002_...
        │   ├── 003_...
        │   └── 004_active_devices.sql
        └── tabflow-setup.sql       ← combined idempotent script for onboarding
```

---

## 3. Absolute Rules (non-negotiable)

These are principles Sam has explicitly set. **Violating them causes real problems.**

### 3.1. The database is LOCKED DOWN

> *"The only time that 'database' changes is when I manually make a change."*

- IndexedDB (the local database) must **never** be mutated except in direct response to an explicit user action (clicking delete, dragging a tab, renaming a workspace, etc.) or a Chrome tab event that the app is explicitly tracking.
- Reads must be pure reads. `handleGetTabs` returns storage records AS-IS — it never deletes during a read, even if a tab looks stale.
- Sync is **push-only** from this device; pull from Supabase is currently disabled. Don't re-enable pull without explicit approval.
- Sync push is gated behind the active-device check (see §5.3). An inactive device must not push.

### 3.2. Be specific about file paths

Sam has explicitly asked: don't assume the user knows where things are. When instructing Sam to make a change or open something, give the **full path**. Example: say `C:\Users\shamilton\OneDrive - vortexgov\Documents\Claude\Browser Tab Manager Project` or `packages/chrome-extension/src/newtab/NewTab.tsx`, not "the newtab file."

### 3.3. Storage is the source of truth, not Chrome

The model is: **IndexedDB is truth.** Tab event listeners update IndexedDB. The UI reads from IndexedDB. Chrome's own tab state is not trusted for persistence — it can be lost on restart. Do not design features that assume Chrome's in-memory tab state persists.

---

## 4. Key Technical Decisions

| Concern | Choice | Why |
|---|---|---|
| Storage (local) | IndexedDB via **Dexie.js** | Large capacity, async, indexes, schema versioning |
| Sync (cloud) | **Supabase**, self-hosted by each user | Avoids any vendor lock-in on Sam's side; users own their data |
| Encryption | AES-GCM via WebCrypto, derived from passphrase | Data at rest in Supabase is opaque to the Supabase host |
| Multi-device model | **"Resume Working Here"** — one active device at a time | Avoids merge conflicts; heartbeat-based claim with 2-min stale detection |
| UI framework | React 18 with inline `style={}` objects (no CSS framework) | Kept bundle small; each screen manages its own styles |
| Build | Vite (for extension), tsc (for core) | Fast dev, clean output |
| Entry point | The new tab page IS the app | `chrome_url_overrides.newtab` → newtab.html |
| New tab activation | User action only | Background never opens new tabs unprompted |

---

## 5. Critical Subsystems

### 5.1. Message layer (background ↔ UI)

All UI → background communication goes through `chrome.runtime.sendMessage` with a typed `MessageType` enum in `packages/chrome-extension/src/background/MessageHandler.ts`. When adding a feature:

1. Add a new `MessageType` enum value
2. Add a case in `handleMessage`'s switch
3. Implement a private `handle*` method
4. Add a method on `useWorkspaces` hook for the UI side
5. Wire the call site in React

### 5.2. Storage schema versions (Dexie)

`packages/chrome-extension/src/storage/IndexedDBAdapter.ts`:

- **v1:** `workspaces`, `tabs`, `sessions`
- **v2:** Added `workspaceHistory` (per-workspace tab snapshots, 30-day retention)
- **v3:** Added `thumbnails` (cached page screenshots, LRU-evicted, max 500)
- **v4:** Added `deletedWorkspaces` (recycle bin, 90-day retention)

When adding a new table or index, **always add a new `this.version(N).stores({...})` block** — never mutate an existing version, or existing users' DBs will break.

### 5.3. Multi-device sync (Resume Working Here)

Table: `active_devices` on Supabase (migration 004). One row per user. Columns: `user_id` (PK), `device_id`, `device_name`, `claimed_at`, `last_heartbeat`.

Flow:
- On startup, `SupabaseSyncClient.initDeviceSession(deviceId)` subscribes to realtime changes and checks current status.
- `checkActiveDevice()` auto-claims if no device is active OR the claimant is stale (no heartbeat for 2+ min).
- `startHeartbeat()` updates `last_heartbeat` every 30s.
- `pushToSync()` in the service worker is gated: `if (!syncClient.isActiveDevice) return;`.
- When an inactive device wants to take over, the UI calls `CLAIM_ACTIVE_DEVICE`, which `upsert`s a new row and restarts the heartbeat.
- UI broadcasts status via `chrome.storage.session` so the newtab page can show/hide the "Resume Working Here" banner.

### 5.4. Onboarding (SetupWizard)

`packages/chrome-extension/src/auth/SetupWizard.tsx`. Three paths:

1. **Skip (local-only):** Sets `tabflow_local_only: true` in chrome.storage.local. No Supabase at all.
2. **Already have Supabase account:** Jump to credential entry form → test connection → success.
3. **New Supabase user:** Numbered steps to create a project → SQL copy button (embedded `SETUP_SQL` constant) → credential entry → success.

`config.ts` has `isSupabaseConfigured()` which checks BOTH stored credentials AND existing `sb-*-auth-token` sessions — this prevents existing users from seeing the wizard on upgrade.

### 5.5. Workspace archive (recycle bin)

When a workspace is deleted (`handleDeleteWorkspace`), it first archives to the `deletedWorkspaces` IndexedDB table with the full workspace data + tab snapshot, THEN deletes from active tables. UI: the "Archive" section in the sidebar of `NewTab.tsx` expands to show a checkbox list with Restore and Delete buttons. Auto-pruned after 90 days.

### 5.6. Tab history (per-workspace snapshots)

Separate from the archive. On every meaningful tab change, the service worker takes a snapshot of the workspace's tabs (URL list dedup'd). Stored in `workspaceHistory`. UI: `showHistoryPanel` slider on NewTab lets the user scrub through history and restore. 30-day retention.

---

## 6. Build & Run

```bash
# Install
npm install

# Build everything
npm run build

# Dev mode (Chrome extension only)
npm run dev:chrome

# Typecheck
npm run typecheck

# Tests
npm run test
npm run test:smoke  # puppeteer-based end-to-end
```

To load unpacked in Chrome:

1. `chrome://extensions`
2. Toggle Developer mode on (top right)
3. Click **Load unpacked**
4. Select `packages/chrome-extension/dist`

To build a zip for Chrome Web Store upload:

```bash
cd packages/chrome-extension/dist && zip -r ../../../tabflow-extension.zip .
```

---

## 7. Publishing state

- **Chrome Web Store** submission: UNLISTED. First submission was rejected for requesting `tabGroups` permission without using it. Version 0.1.1 removed it.
- **GitHub:** https://github.com/samjham/TabFlow (public, used for hosting the privacy policy via GitHub Pages)
- **Privacy policy URL:** https://samjham.github.io/TabFlow/store-assets/privacy-policy.html
- **Extension ID:** `gkcamehohljdpenmjmoaciigppdbjcgl`

When bumping the extension version in `manifest.json`, also bump in `package.json` if you care (not strictly required — Chrome Web Store only reads manifest.json).

---

## 8. Known issues / deferred items

- **Backlit glow on tab tiles** has a hard edge that Sam flagged. Deferred ("let's come back to that").
- **Supabase pull** is disabled — push-only. Re-enabling requires design work to handle conflict resolution cleanly.
- **Broad host permissions warning** from Chrome Web Store review: TabFlow uses `<all_urls>` because it genuinely needs to read every tab's URL to organize them. Listed as a warning, not a blocker, but reviews take longer.

---

## 9. How to update this document

At the end of any meaningful work session (new feature, bug fix, publishing event), update:

- **§ 5.** if you added a new subsystem
- **§ 5.2** if you added a Dexie schema version
- **§ 7.** if publishing state changed
- **§ 8.** if you discovered a new known issue OR resolved a listed one
- **§ 10.** changelog below — add a dated entry summarizing what changed

Keep this document tight. It's for quickly onboarding a new Claude — not a full history. The **git log** is the full history. This file is the cliff notes.

---

## 10. Changelog (most recent first)

- **2026-04-13** — Workspace archive (recycle bin) added. Deleted workspaces now restore-able. v4 Dexie schema. Version bumped to 0.1.1. `tabGroups` permission removed per Chrome Web Store rejection feedback. Initial Chrome Web Store submission rejected (tabGroups); resubmission pending.
- **2026-04-12** — Multi-device "Resume Working Here" sync model implemented (migration 004, heartbeat, active-device gate). SetupWizard rewritten with skip/existing/new paths. Extension first submitted to Chrome Web Store (unlisted) with icon, screenshots, and listing copy.
- **2026-04-11** — Initial feature set: workspaces, tabs, drag-drop, thumbnails, history (per-workspace snapshots), encrypted Supabase sync, native-host companion. Extension loaded unpacked for dev.
