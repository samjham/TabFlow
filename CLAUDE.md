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
    ├── browser-extension/          ← @tabflow/browser-extension — cross-browser MV3 extension (Chrome + Firefox)
    │   ├── public/
    │   │   ├── manifest.chrome.json   ← Chrome manifest template (copied in as manifest.json during build)
    │   │   ├── manifest.firefox.json  ← Firefox manifest template (gecko id, sidebar_action, etc.)
    │   │   └── icons/              ← copied into each dist at build time
    │   ├── vite.config.ts          ← TARGET env var picks the manifest and emits to dist/<target>/
    │   └── src/
    │       ├── background/         ← service worker, MessageHandler, TabManager
    │       ├── newtab/             ← main UI (NewTab.tsx + useWorkspaces hook)
    │       ├── popup/              ← toolbar popup
    │       ├── sidebar/            ← sidePanel (Chrome) / sidebarAction (Firefox) entry
    │       ├── storage/            ← IndexedDBAdapter (Dexie.js) — source of truth
    │       ├── sync/               ← SupabaseSyncClient
    │       ├── auth/               ← AuthManager + SetupWizard
    │       ├── components/         ← shared React components
    │       ├── content/            ← content scripts (youtube-time-tracker)
    │       ├── entries/            ← HTML entry points
    │       ├── browser-compat.ts   ← runtime/build-time browser detection + sidebar API wrapper
    │       └── config.ts           ← Supabase config loader (async from chrome.storage.local)
    ├── native-host/                ← optional native-messaging companion (install.bat for Chrome, install-firefox.bat for Firefox)
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

Sam has explicitly asked: don't assume the user knows where things are. When instructing Sam to make a change or open something, give the **full path**. Example: say `C:\Users\shamilton\OneDrive - vortexgov\Documents\Claude\Browser Tab Manager Project` or `packages/browser-extension/src/newtab/NewTab.tsx`, not "the newtab file."

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
| Build | Vite (for extension), tsc (for core); `TARGET=chrome\|firefox` env var selects manifest and emits to `dist/<target>/` | Single source, two browsers |
| Entry point | The new tab page IS the app | `chrome_url_overrides.newtab` → newtab.html (works on both Chrome and Firefox) |
| New tab activation | User action only | Background never opens new tabs unprompted |
| Cross-browser | Single codebase targets Chrome + Firefox (MV3) | See §5.7 browser-compat shim |

---

## 5. Critical Subsystems

### 5.1. Message layer (background ↔ UI)

All UI → background communication goes through `chrome.runtime.sendMessage` with a typed `MessageType` enum in `packages/browser-extension/src/background/MessageHandler.ts`. When adding a feature:

1. Add a new `MessageType` enum value
2. Add a case in `handleMessage`'s switch
3. Implement a private `handle*` method
4. Add a method on `useWorkspaces` hook for the UI side
5. Wire the call site in React

### 5.2. Storage schema versions (Dexie)

`packages/browser-extension/src/storage/IndexedDBAdapter.ts`:

- **v1:** `workspaces`, `tabs`, `sessions`
- **v2:** Added `workspaceHistory` (per-workspace tab snapshots, 30-day retention)
- **v3:** Added `thumbnails` (cached page screenshots, LRU-evicted, max 500)
- **v4:** Added `deletedWorkspaces` (recycle bin, 90-day retention)

When adding a new table or index, **always add a new `this.version(N).stores({...})` block** — never mutate an existing version, or existing users' DBs will break.

### 5.3. Multi-device sync (Resume Working Here)

Table: `active_devices` on Supabase (migration 004). One row per user. Columns: `user_id` (PK), `device_id`, `device_name`, `claimed_at`, `last_heartbeat`.

Mental model: **the cloud is always the source of truth.** The active browser pushes constantly (every snapshot, every explicit action). When you open a different browser, it shows a blocking "Resume Working Here" modal — click it, it pulls from the cloud, nukes whatever was in that browser, recreates the workspaces and tabs to match, then claims as active and starts pushing.

Flow:
- On startup, `SupabaseSyncClient.initDeviceSession(deviceId)` subscribes to realtime changes and checks current status.
- `checkActiveDevice()` auto-claims **only** if no device row exists or if this device's own row is stale. It will NOT auto-claim over another device — that requires the user to click "Resume Working Here."
- `startHeartbeat()` updates `last_heartbeat` every 30s.
- `pushToSync()` and the snapshot-push in `snapshotActiveWorkspace` are both double-gated: `syncClient.isActiveDevice` AND `safeToPush` must both be true. `safeToPush` is set only after a successful claim or for migrated existing installs.
- When an inactive device wants to take over, the UI shows a blocking modal. Clicking it sends `CLAIM_ACTIVE_DEVICE`, which calls `claimActiveDeviceWithMaterialization()`: pull all from Supabase → close all browser tabs → open the active workspace's tabs → re-snapshot → claim on Supabase → enable push.
- UI broadcasts status via `chrome.storage.session` so the newtab page can show/hide the modal.

### 5.4. Onboarding (SetupWizard)

`packages/browser-extension/src/auth/SetupWizard.tsx`. Three paths:

1. **Skip (local-only):** Sets `tabflow_local_only: true` in chrome.storage.local. No Supabase at all.
2. **Already have Supabase account:** Jump to credential entry form → test connection → success.
3. **New Supabase user:** Numbered steps to create a project → SQL copy button (embedded `SETUP_SQL` constant) → credential entry → success.

`config.ts` has `isSupabaseConfigured()` which checks BOTH stored credentials AND existing `sb-*-auth-token` sessions — this prevents existing users from seeing the wizard on upgrade.

### 5.5. Workspace archive (recycle bin)

When a workspace is deleted (`handleDeleteWorkspace`), it first archives to the `deletedWorkspaces` IndexedDB table with the full workspace data + tab snapshot, THEN deletes from active tables. UI: the "Archive" section in the sidebar of `NewTab.tsx` expands to show a checkbox list with Restore and Delete buttons. Auto-pruned after 90 days.

### 5.6. Tab history (per-workspace snapshots)

Separate from the archive. On every meaningful tab change, the service worker takes a snapshot of the workspace's tabs (URL list dedup'd). Stored in `workspaceHistory`. UI: `showHistoryPanel` slider on NewTab lets the user scrub through history and restore. 30-day retention.

### 5.7. Cross-browser support (Chrome + Firefox)

The extension is built from a single source tree in `packages/browser-extension/` and targets both Chrome and Firefox via a build flag:

- `TARGET=chrome vite build` → `dist/chrome/` with `manifest.chrome.json` copied in as `manifest.json`
- `TARGET=firefox vite build` → `dist/firefox/` with `manifest.firefox.json` copied in as `manifest.json`

Picked in `packages/browser-extension/vite.config.ts` via the `postBuild` plugin. `publicDir` is left enabled (so `icons/` and `suspended.*` get copied) and the stray `manifest.<target>.json` templates are stripped out of the final dist by the same plugin.

Firefox manifest differences (`public/manifest.firefox.json`):
- Adds `browser_specific_settings.gecko.id` + `strict_min_version: 128.0` (FF 128 is when MV3 service_worker support landed)
- Removes Chrome-only permissions `sidePanel` and `system.memory`
- Replaces `side_panel` key with `sidebar_action`
- Everything else identical (including `chrome_url_overrides.newtab` — Firefox supports this, with a one-time user permission prompt)

Runtime compatibility is handled by `packages/browser-extension/src/browser-compat.ts`:
- Firefox exposes `chrome` as an alias for `browser`, so existing `chrome.*` calls mostly just work
- The few Chrome-only APIs (`chrome.sidePanel`, `chrome.system?.memory`) are already guarded with feature checks in `service-worker.ts`, so they no-op on Firefox
- `browserCompat.openSidebar(tabId?)` wraps `chrome.sidePanel.open()` / `browser.sidebarAction.open()` so UI code doesn't have to branch
- Vite's `define` injects `import.meta.env.TARGET_BROWSER` (`'chrome'` or `'firefox'`) so source code can check the build target

Native messaging (`packages/native-host/`) has separate installers because the registration differs:
- Chrome: `install.bat` → writes to `HKCU\Software\Google\Chrome\NativeMessagingHosts`, uses `allowed_origins: ["chrome-extension://<ID>/"]`
- Firefox: `install-firefox.bat` → writes to `HKCU\Software\Mozilla\NativeMessagingHosts`, uses `allowed_extensions: ["<gecko-id>"]`

---

## 6. New Machine Setup

Follow these steps when setting up the project on a fresh computer (e.g. home PC).

**Prerequisites — install these first if you don't have them:**

1. **Git:** Download from https://git-scm.com/downloads — use default options during install. After install, open a terminal and run `git --version` to confirm.
2. **Node.js (LTS):** Download from https://nodejs.org — pick the LTS version. After install, confirm with `node --version` and `npm --version`.
3. **Configure your Git identity** (one-time, so commits have your name):
   ```
   git config --global user.name "Sam Hamilton"
   git config --global user.email "shamilton@vortexgov.com"
   ```

**Clone and build:**

1. Open a terminal and `cd` to wherever you want the project folder to live (e.g. `cd C:\Users\YourUser\Documents`).
2. Clone the repo:
   ```
   git clone https://github.com/samjham/tabflow.git
   ```
3. Enter the folder and install dependencies:
   ```
   cd tabflow
   npm install
   ```
4. Build the Chrome extension:
   ```
   npm run build:chrome
   ```

**Load the extension in Chrome:**

1. Go to `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select the `packages/browser-extension/dist/chrome` folder inside the cloned repo

**Set up native host (optional — needed for taskbar-hiding and memory stats):**

1. Open a terminal in the project folder
2. Run:
   ```
   cd packages/native-host
   install-host.bat
   ```
3. Restart Chrome

**Day-to-day workflow — pulling changes from your other machine:**

Before starting work, pull the latest:
```
git pull origin main
```

After making changes, push them:
```
git add -A
```
```
git commit -m "describe what you changed"
```
```
git push origin main
```

Then on the other machine, `git pull origin main` to get those changes.

---

## 7. Build & Run

```bash
# Install
npm install

# Build both browsers (produces dist/chrome and dist/firefox)
npm run build

# Build one target
npm run build:chrome
npm run build:firefox

# Dev mode (defaults to chrome target; for Firefox use build:firefox + `web-ext run`)
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
4. Select `packages/browser-extension/dist/chrome`

To load temporarily in Firefox (does not persist across restarts):

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `packages/browser-extension/dist/firefox/manifest.json`

To build zips for store upload:

```bash
# Chrome Web Store
cd packages/browser-extension/dist/chrome && zip -r ../../../../tabflow-chrome.zip .
# Firefox (addons.mozilla.org)
cd packages/browser-extension/dist/firefox && zip -r ../../../../tabflow-firefox.zip .
```

---

## 8. Publishing state

- **Chrome Web Store** submission: UNLISTED. First submission was rejected for requesting `tabGroups` permission without using it. Version 0.1.1 removed it.
- **GitHub:** https://github.com/samjham/TabFlow (public, used for hosting the privacy policy via GitHub Pages)
- **Privacy policy URL:** https://samjham.github.io/TabFlow/store-assets/privacy-policy.html
- **Extension ID:** `gkcamehohljdpenmjmoaciigppdbjcgl`

When bumping the extension version in `manifest.json`, also bump in `package.json` if you care (not strictly required — Chrome Web Store only reads manifest.json).

---

## 9. Known issues / deferred items

- **Broad host permissions warning** from Chrome Web Store review: TabFlow uses `<all_urls>` because it genuinely needs to read every tab's URL to organize them. Listed as a warning, not a blocker, but reviews take longer.
- **Cross-browser sync needs testing.** Push-on-snapshot is re-enabled with `safeToPush` gate. The claim flow (pull → nuke → recreate → claim) is simplified. Needs a clean cross-browser test: reload Chrome, confirm it auto-claims and pushes; load Firefox, confirm it shows the blocking modal, confirm clicking Resume Working Here pulls and recreates tabs correctly.

---

## 10. How to update this document

At the end of any meaningful work session (new feature, bug fix, publishing event), update:

- **§ 5.** if you added a new subsystem
- **§ 5.2** if you added a Dexie schema version
- **§ 8.** if publishing state changed
- **§ 9.** if you discovered a new known issue OR resolved a listed one
- **§ 11.** changelog below — add a dated entry summarizing what changed

Keep this document tight. It's for quickly onboarding a new Claude — not a full history. The **git log** is the full history. This file is the cliff notes.

---

## 11. Changelog (most recent first)

- **2026-04-16** — Major sync fixes after cross-browser testing exposed three contamination vectors. (1) **Destructive pull on claim** — `pullAll(userId, destructive)` now takes a `destructive` flag. When true (used by `CLAIM_ACTIVE_DEVICE` and `RESTORE_FROM_CLOUD`), it calls `clearLocalData()` first, wiping all local workspaces and tabs so the result is an exact mirror of the cloud with no leftover junk. New `clearLocalData()` method on `SupabaseSyncClient`. (2) **Realtime handler gated behind isActiveDevice** — `handleWorkspaceChange` and `handleTabChange` now return early if `!this._isActiveDevice`. Previously, when Firefox pushed after claiming, Chrome's realtime subscription picked up the changes and wrote them into Chrome's IndexedDB, contaminating Chrome even though it was no longer the active device. (3) **Full sync push with orphan cleanup** — new `fullSyncPush(userId)` method on `SupabaseSyncClient` pushes ALL local workspaces and tabs, then deletes any cloud rows that don't exist locally. Called after a successful claim (step 5 of `claimActiveDeviceWithMaterialization`) and on startup if this device is active (`initializeSync`). This cleans up the hundreds of stale rows from earlier corruption incidents. (4) **Firefox sidebar_action removed** from `manifest.firefox.json` — the sidebar panel showed "Coming Soon" alongside the newtab page, creating a confusing double-sidebar. The newtab page IS the app; the sidebar was vestigial. (5) Previous commit's changes (push-on-snapshot re-enabled, modal stripped down, auto-claim prevention, one-time cleanup removal) remain.
- **2026-04-16** — Cross-browser sync simplified to match the intended mental model: the cloud is always truth, the active browser pushes constantly, any other browser must "Resume Working Here" to pull and recreate. Changes: (1) **Push-on-snapshot re-enabled** in `snapshotActiveWorkspace` — after saving to IndexedDB, the snapshot now pushes the active workspace + its tabs to Supabase, double-gated by `isActiveDevice` and `safeToPush`. This is safe because a second browser that hasn't claimed yet has `safeToPush = false`. (2) **Claim flow simplified** — `claimActiveDeviceWithMaterialization()` no longer takes a mode parameter or offers save-first/close options. It just pulls from cloud, closes all tabs, opens the workspace's tabs, re-snapshots, claims, enables push. Removed `saveMainWindowToRecoveredWorkspace` and `verifyWindowMatchesWorkspace` helpers (no more Option C, no more verification). (3) **Modal stripped down** — the Resume Working Here modal is now just a title, subtitle, body text, and a single button. No radio options, no tab count, no choices. Removed `claimTabCount`, `claimMode` state and `GET_MAIN_WINDOW_TABS_SUMMARY` message handler. Removed `resumeModalChoices/Choice/ChoiceLabel/ChoiceHint` styles. (4) **Second browser no longer auto-claims** — `checkActiveDevice()` in `SupabaseSyncClient.ts` will only auto-claim if no `active_devices` row exists or if this device's own row is found. It will NOT auto-claim over another device's stale heartbeat; the user must explicitly click Resume Working Here. This prevents Firefox from silently stealing the claim on load and locking Chrome out. (5) **One-time cleanup block removed** from service worker startup — the `dbCleanedV2`-gated emergency cleanup (which closes all windows + wipes all tabs) was left over from an earlier corruption fix and would fire on any fresh install (including Firefox), nuking the browser. It already ran on Chrome so removing it is safe. Both builds clean (background.js 45.34 → 44.16 kB gzipped, newtab.js 15.76 → 15.32 kB gzipped).
- **2026-04-15** — Cross-browser sync Phase 4 redesigned after the first-cut re-enable from earlier today corrupted Chrome. Root cause: `snapshotActiveWorkspace` assumes the browser window's open tabs faithfully represent the active workspace. That's true on a single browser the user has been actively using, but it's NOT true on a second browser that just pulled a workspace from the cloud — Firefox's window still held about:debugging, the newtab itself, random pages; the snapshot wrote those into the active workspace, pushed it up, and Chrome's realtime subscription mirrored the junk back down. Four changes in `packages/browser-extension/src/background/service-worker.ts`: (1) **Push-on-snapshot permanently disabled** in `snapshotActiveWorkspace`. Explicit user-intent actions (create / rename / delete / color / switch / move tabs) still push through `pushToSync`; snapshots never do. Comment at the old push site now explains why. (2) **`safeToPush` gate** added as a second condition (on top of `isActiveDevice`) for every push. Stored as `tabflow_safe_to_push` in `chrome.storage.local`, checked at the top of `pushToSync`. Set to `true` only after a successful claim-with-materialization or `RESTORE_FROM_CLOUD`, OR auto-migrated to `true` for existing installs that already have local workspaces (so current Chrome user doesn't get sync-silent after updating). Fresh installs start with the flag unset and can't push until they properly claim. Migration runs ~1.5s after service worker startup. (3) **`CLAIM_ACTIVE_DEVICE` rewritten** to take a `{ mode: 'close' | 'save-first' }` payload and route through a new `claimActiveDeviceWithMaterialization()` function. Flow: `setPushing(true)` → `pullAll` (additive upsert) → `isSwitchingWorkspaces = true` → optionally `saveMainWindowToRecoveredWorkspace` if mode is save-first → `closeAllTabs` → `restoreWorkspaceTabs` for the active workspace → 800ms settle → re-snapshot → `verifyWindowMatchesWorkspace` (canonicalized URL multiset comparison) → if diverged, Option C fallback auto-saves current window tabs to a Recovered workspace then aborts with a diagnostic error → otherwise `claimActiveDevice()` + `markSafeToPush`. `isSwitchingWorkspaces` stays true throughout so snapshots can't race the reshuffle. Crypto failures on pull abort with a passphrase-mismatch message; pull network errors also abort (we refuse to materialize against an incomplete cloud state). (4) **`GET_MAIN_WINDOW_TABS_SUMMARY` message** added, returns `{ count, urls }` of the current main-window non-TabFlow tabs so the pre-claim modal can show "this will close 14 tabs". Two helper functions added: `saveMainWindowToRecoveredWorkspace(mainWindowId, context)` creates an inactive "Recovered from {BROWSER} {YYYY-MM-DD HH:mm}" workspace and snapshots the window into it (used by both save-first mode and Option C); `verifyWindowMatchesWorkspace(mainWindowId, workspaceId)` compares canonicalized URL multisets, unwrapping `suspended.html?url=` wrappers. UI changes in `packages/browser-extension/src/newtab/NewTab.tsx`: the Resume Working Here **banner** across the top was replaced with a centered blocking **modal** (full-viewport `rgba(5,8,16,0.72)` backdrop with `backdrop-filter: blur(4px)`, dark centered card with a blue accent gradient at the top, z-index 9999) that the user cannot dismiss without claiming — this is because claim is destructive (replaces the browser's tabs) and needs to be an informed choice. Modal has two radio-button options: "Save current tabs to a new workspace first" (default, recommended) and "Close them (they're saved elsewhere)". Shows a live count from `GET_MAIN_WINDOW_TABS_SUMMARY`. On failure, surfaces the background's error message inline. New state in `NewTab.tsx`: `claimTabCount`, `claimMode`, `claimInProgress`, `claimError`. All modal styles added to `packages/browser-extension/src/newtab/styles.ts` under `resumeModal*` keys. Both Chrome and Firefox builds clean (background.js gzipped grew 44.29 → 45.34 kB for the materialization helpers; newtab.js grew 14.95 → 15.76 kB for the modal). Needs a fresh cross-browser test — this time Firefox's claim flow should pull Chrome's data, close Firefox's current tabs, open the workspace's tabs, verify, then claim. Sam's existing Chrome install is safe (migration sets `safeToPush = true` on startup since Chrome has workspaces).
- **2026-04-15** — Cross-browser sync Phase 4 re-enabled. Two call sites in `packages/browser-extension/src/background/service-worker.ts` changed: (1) `snapshotActiveWorkspace` now pushes to Supabase after every debounced snapshot, gated by `syncClient.isActiveDevice` and wrapped in `setPushing(true)/setPushing(false)` to suppress the realtime echo guard. Pushes the workspace row plus all its tabs, filtered through the existing `isSyncableTab` / `isSyncableFavicon` helpers so `chrome://`, `about:`, `moz-extension://`, and non-`data:` / non-`http(s):` favicon URLs never hit the cloud. (2) `CLAIM_ACTIVE_DEVICE` now calls `syncClient.pullAll(syncUserId)` before `claimActiveDevice()`, wrapped in the same `setPushing` guard. The pull is additive — `pullAll` → `saveWorkspace` / `saveTab` are upsert-by-id, so local rows not present in the cloud are preserved, and a mid-pull failure leaves the previous local state intact plus whatever rows came in cleanly. Crypto failures (`DOMException` / `OperationError`) abort the claim and surface a passphrase-mismatch error to the UI; non-crypto pull errors log a warning and the claim still proceeds so the user isn't blocked from taking over. The decision to go additive (not clear-then-pull) is because the April 15 incident showed that clear-then-pull has no safety net — if the pull is wrong or partial, local state is already gone. Also updated `initializeSync()` comment at line 299 from "DISABLED — push-only mode" to "pull on claim / restore only" to reflect the new model. This change is only safe because deterministic tab IDs (`tab-<16hex>` content hashes from the Phase 1–3 migration earlier today) make Chrome and Firefox produce the same ID for the same URL in the same workspace, so realtime echo and `pullAll` upserts can't corrupt the cloud the way they did on the morning of April 15. Both Chrome and Firefox builds clean at identical sizes (background.js gzipped: 44.29 kB for both). Pre-existing typecheck errors in the codebase (string-literal MessageType comparisons, SupabaseSyncClient payload casts, config.ts nullability) are unrelated and not touched.
- **2026-04-15** — HistoryPanel and ArchivePanel extracted from `NewTab.tsx`. New siblings `packages/browser-extension/src/newtab/HistoryPanel.tsx` (163 lines) and `ArchivePanel.tsx` (135 lines). NewTab.tsx dropped from 1,684 → 1,485 lines (-12%). Both components are pure presentational — fetching, mutation, and panel-open state all stay in NewTab. HistoryPanel takes 9 props: `loading`, `entries`, `index`, `setIndex`, `confirmRestore`, `setConfirmRestore`, `restoring`, `onRestore`, `onClose`. It's defined with `React.forwardRef` so the parent can still attach `historyPanelRef` to the root `<div>` (the ref is currently unused at the read end, but preserving the DOM wiring in case it's needed later). `formatTimeAgo` moved into `HistoryPanel.tsx` as a module-local helper — it was only used by the history UI. ArchivePanel takes 6 props: `loading`, `deletedWorkspaces`, `selectedIds`, `onToggleSelection`, `onRestore`, `onPermanentlyDelete`. While here, the `deletedWorkspaces` state in NewTab was retyped from `any[]` to `DeletedWorkspace[]` (the type already existed in `@tabflow/core`). Chrome and Firefox builds clean; newtab.js gzipped grew modestly (14.62 → 14.95 kB) from the extra module boilerplate — standard cost for a split.
- **2026-04-15** — Dragged tab tile halo switched to workspace accent color in `packages/browser-extension/src/newtab/NewTab.tsx`. The previous fix kept the halo amber (`rgba(255, 200, 120, ...)` etc.) — a leftover from the original zero-blur amber ring. Result: press-and-hold showed the workspace-color glow from TabCard, but the moment drag started the halo shifted to warm yellow, which read as a distracting color change rather than a continuation of the pressed state. Replaced the three amber layers with `${dragAccent}80 / 4d / 26` where `dragAccent = activeWorkspace?.color || '#6c8cff'` (same fallback TabCard uses). Cast shadow unchanged. Halo is now visually continuous from press → drag in the workspace's own color.
- **2026-04-15** — Hard-edge amber outline on dragged tab tiles fixed in `packages/browser-extension/src/newtab/NewTab.tsx`. After the TabCard inset-glow fix from earlier today, press-and-hold on a tile looked right — but the moment the cursor moved past the drag threshold and the floating drag tile appeared, a crisp cold edge reappeared around the tile. Root cause: the floating drag tile's wrapper `boxShadow` led with `0 0 0 2px rgba(255, 200, 120, 0.45)` — a zero-blur, 2px-spread amber ring. That's a literal sharp outline around the card. Replaced the ring with three blurred amber halo layers (15px @ 50% + 35px @ 30% + 70px @ 15%) stacked with the existing dark cast shadow (promoted from `0 6px 20px` to a unified `0 10px 30px` to match TabCard's pressed state). Same "this is being dragged" visual cue, no hard boundary. Both builds clean.
- **2026-04-15** — Hard-edge backlit glow on tab tiles fixed in `packages/browser-extension/src/newtab/TabCard.tsx`. Previously the exterior `box-shadow` halo emanated at `accentColor50` (~31% alpha) right at the card's rectangular boundary, while the card's interior stayed flat `#24272f` — that contrast step (bright halo just outside / dark flat inside) read as a visible hard edge wrapping the tile. Fix: layered matching `inset` box-shadows into both hover and pressed states so the card's interior edge brightens to meet the exterior halo continuously. Hover gets `inset 0 0 15px 0px ${accentColor}20` (one layer, paired with the existing 12/25px exterior blurs). Pressed gets two layers — `inset 0 0 25px 0px ${accentColor}35` + `inset 0 0 50px 0px ${accentColor}18` — stacked in front of the existing 5-layer exterior halo. No transform, color, or cast-shadow changes; the lift and brightness filter are untouched. Removed the "hard edge on backlit glow" item from §9 known issues. Both builds clean (newtab.js 14.59 kB → 14.62 kB gzipped — +30 bytes for the extra shadow layers).
- **2026-04-15** — `paddingX` / `paddingY` / `marginX` / `marginY` typos fixed in `packages/browser-extension/src/newtab/styles.ts`. These were pre-existing invalid CSSProperties fields that React silently dropped at runtime — `workspacesList` had `paddingX: '8px'` + `paddingY: 0` and `newWorkspaceForm` had `marginX: '8px'` + `marginY: '8px'`. Translated to valid CSS shorthand (`padding: '0 8px'` and `margin: '8px'` respectively) so the author's original intent now actually applies. This is a small visible layout change: the workspace list in the sidebar now has 8px of horizontal padding, and the new-workspace form has 8px of margin around it. Also dropped the file-header comment that flagged them as TODO and the `as React.CSSProperties` casts (no longer needed now that the fields are valid). Both builds clean (newtab.js gzipped: 14.61 kB → 14.59 kB).
- **2026-04-15** — Dead `recentlyRemovedTabs` code removed from `packages/browser-extension/src/background/service-worker.ts`. The Set was a write-only leftover from the pre-deterministic-ID era — three call sites added `chrome-<id>` keys with 5–10s self-expiring timers, but nothing ever read the Set. Removed the declaration, the two write sites (the `handleMoveTabsInServiceWorker` loop and the `chrome.tabs.onRemoved` handler entry), and updated the two stale comments that still referenced it (`service-worker.ts` near the MOVE_TABS dispatch, and `MessageHandler.ts` L497 on the move-tabs return). No behavior change — just removes a tiny amount of cruft and the attendant `setTimeout` timers. Both Chrome and Firefox builds clean at identical gzipped sizes.
- **2026-04-15** — `NewTab.tsx` split into smaller files. The new-tab page was a 3,278-line monster holding the orchestrator, two sub-components, and a 1,162-line styles blob in a single file. Extracted four siblings into `packages/browser-extension/src/newtab/`: `constants.ts` (SIDEBAR_WIDTH, COLOR_PALETTE, formatBytes), `styles.ts` (the full styles object, unchanged apart from being moved), `WorkspaceSidebarItem.tsx` (the sidebar row component with its rename/color/short-name context menu), and `TabCard.tsx` (the tile with the backlit-glow hover/press effect). `NewTab.tsx` is now 1,675 lines and imports from the new modules. Props, render output, and behavior are byte-for-byte identical — this was a pure move, not a rewrite. Pre-existing `paddingX`/`paddingY`/`marginX`/`marginY` typos in the styles object (which React silently drops) were preserved verbatim with a comment in `styles.ts` flagging them for a future pass. No schema changes, no new dependencies. Both Chrome and Firefox builds produce identical bundles (14.49 kB → 14.61 kB gzipped newtab.js — a few hundred bytes of extra module boilerplate). HistoryPanel and ArchivePanel stay inline because they're threaded deep into NewTab's state; extracting them would require props plumbing that's better saved for a follow-up pass.
- **2026-04-15** — `shortName` revert bug fixed in `packages/browser-extension/src/sync/SupabaseSyncClient.ts`. Manually-set workspace short-names (e.g. "GNS" on the Guns workspace, overriding the default "GU") were reverting to the auto-generated letters whenever any sync push fired. Root cause: `pushWorkspace` only uploads the columns the Supabase `workspaces` schema has (`id`, `name`, `color`, `icon`, `sort_order`, `is_active`, `version`, `updated_at`) — `shortName` is a local-only field the cloud schema doesn't track. When the realtime subscription echoed that push back, or when `pullAll()` ran, the incoming payload had no `shortName`, so `handleWorkspaceChange` / `pullAll` reconstructed the `Workspace` object with `shortName: undefined` and `saveWorkspace` clobbered the local row. Fix: both paths now read the existing local workspace first (`await this.storage.getWorkspace(id)`) and merge `shortName: existing?.shortName` into the object before saving, so remote echoes can't wipe the local-only field. No schema change required — solving it in the cloud would mean adding a column and encrypting shortName, which is overkill for a 3-character UI label.
- **2026-04-15** — Deterministic tab ID migration (Phases 1–3). Replaced the old `chrome-<numericId>` tab ID scheme — which embedded Chrome's runtime tab ID and caused the Chrome/Firefox collision documented in §9 — with content-derived IDs of the form `tab-<16hex>`, where the hex is the first 16 chars of `sha256(workspaceId | canonicalUrl | firstSeenAt)`. Canonical URLs strip the trailing slash and lowercase the host. New `packages/browser-extension/src/utils/tabId.ts` exports `computeTabId()` and `canonicalizeUrl()`. Since the storage ID no longer carries the Chrome tab ID, we can't do `chrome.tabs.update(storageId)` to activate a tile — instead, `TabManager.buildMainWindowUrlIndex()` returns a `Map<canonicalUrl, chromeTabId[]>` built by querying `chrome.tabs.query({ windowId })`, unwrapping the `suspended.html?url=` wrapper when needed, and excluding the TabFlow tab itself. Handlers that used to regex `storageId.match(/^chrome-(\d+)$/)` to recover the Chrome tab ID now look it up by canonical URL instead: `handleOpenTab` (UI-side, routes through `ACTIVATE_TAB_BY_URL`), `handleRemoveTab`, `handleCloseAllTabs`, `handleMoveTabs`, `handleReorderTabs` in `MessageHandler.ts`, and `handleMoveTabsInServiceWorker` in `service-worker.ts`. Duplicate URLs are handled with `urlIndex.get(canonical)?.shift()` so the same Chrome ID isn't consumed twice. Phase 4 (re-enable cross-browser sync push/pull now that IDs are deterministic) is deliberately deferred — infrastructure is in place, but we're leaving push-only / pull-disabled until we've stress-tested the new IDs locally. `recentlyRemovedTabs.add(\`chrome-${id}\`)` remains at three spots in `service-worker.ts` but is dead code (the Set is never read) — left untouched to minimize diff.
- **2026-04-15** — Cross-browser sync partially disabled after a full-day debugging session exposed a fundamental tab-ID collision bug between Chrome and Firefox. Timeline: (1) Added `chrome-extension://` → `getExtensionBaseUrl()` / `getExtensionPageUrl()` wrappers across `service-worker.ts`, `TabManager.ts`, `MessageHandler.ts` (new helpers in `browser-compat.ts`) so Firefox stops throwing "address wasn't understood" on `chrome-extension://tabflow@samhamilton.dev/newtab.html`. Also added `moz-extension://` to the `isCapturable` URL filter. Firefox manifest: changed `background.service_worker` → `background.scripts` since FF 149's MV3 rejects the service_worker key. These are all permanent and good. (2) Added aggressive sync behavior that turned out to be dangerous: `CLAIM_ACTIVE_DEVICE` was rewritten to clear all local tabs and then `pullAll()` from Supabase before claiming, and `snapshotActiveWorkspace` began pushing every tab change to Supabase. These were intended to make "Resume Working Here" pull-not-push and to make day-to-day edits sync across browsers. In practice both paths amplified a pre-existing ID collision: tab IDs are generated as `chrome-<numericId>` where `numericId` is the browser's internal `chrome.tabs` ID — Chrome and Firefox each start counting from 1, so unrelated tabs in each browser map to the same Supabase row. Upserts from Firefox overwrote `workspace_id` on rows Chrome had pushed, causing tabs to visibly teleport between workspaces. Compounding: `saveCurrentTabsToWorkspace` regenerates IDs on every snapshot, so the cloud accumulated hundreds of zombie rows (368 in Sam's case) that `pullAll` mass-imported as duplicates, and the realtime echo of all the churn caused UI thrash (multiple workspaces highlighted at once, state flicker). (3) Rollback (current state): `CLAIM_ACTIVE_DEVICE` is back to a pure `claimActiveDevice()` — no clear, no pull. `snapshotActiveWorkspace` no longer pushes to Supabase at all. Explicit actions (create/rename/delete workspace) still push as they always have. Kept as harmless defensive additions: URL / favicon filters in `SupabaseSyncClient.pullAll` and `handleTabChange` (drop `chrome://…`, `about:…`, `moz-extension://…` on inbound, drop non-`data:` / non-`http(s):` favicons like `chrome://global/skin/icons/info.svg`), and a `replaceWorkspaceTabs` method that's defined but currently unused (kept for the eventual redesign). Sam wiped Supabase `tabs` + `workspaces` tables and the local `TabFlowDB` IndexedDB, then rebuilt workspaces by hand. Firefox is not to be opened against this install until cross-browser sync is redesigned. See §9 for the real fix (deterministic IDs).
- **2026-04-13** — Stale `tabFlowTabId` collision fix in `packages/browser-extension/src/background/service-worker.ts` (`ensureTabFlowTab`, Strategy 3). After a full Chrome restart, Chrome reassigns every tab a fresh numeric ID, so the `tabFlowTabId` persisted in `chrome.storage.local` from the previous session can now coincidentally point to a completely unrelated tab — notably `chrome://extensions`, which is commonly open during unpacked-install development when the extension reloads. The old Strategy 3 matched purely on ID and handed the tab straight to the pin/move logic, which would then pin `chrome://extensions` at index 0 and never route to the real TabFlow newtab. Strategies 1/2/4/5 didn't save us because on a cold service-worker wake-up the TabFlow tab often hasn't been re-created yet. Fix: Strategy 3 now validates the candidate tab's URL before trusting the stored ID — accepts only `chrome-extension://<extensionId>/…` (URL or `pendingUrl`), `chrome://newtab/` / `chrome://newtab`, empty string, or `about:blank`, and explicitly rejects `suspendedPrefix`. If the candidate doesn't match, the stale ID is removed from `chrome.storage.local` so subsequent runs don't keep hitting the same collision, and the function falls through to Strategies 4/5 which correctly locate (or create) the real keeper. No schema changes, no behavior change on the happy path.
- **2026-04-13** — Data-loss safeguards added after the folder-rename incident permanently destroyed a user's local workspaces (new extension ID → empty IndexedDB; cloud rows present but undecryptable because the encryption salt was only ever stored in chrome.storage.local and had been GC'd by Chrome). Three defenses now ship together in version **0.1.2**:
  1. **Pinned extension ID.** `packages/browser-extension/public/manifest.chrome.json` now includes a `key` field (RSA 2048 public key, base64-encoded). The extension ID is now derived from this key, NOT the folder path, so future folder renames will reuse the same ID and the same IndexedDB. Private key was generated with `openssl genrsa 2048` and intentionally NOT committed — losing it only means a future keypair swap requires unpacked-install users to re-import, it doesn't affect cloud data.
  2. **Salt backup to Supabase.** The `user_settings` table gained a `canary text` column (migration applied in `packages/supabase/tabflow-setup.sql` and the embedded `SETUP_SQL` constant in `packages/browser-extension/src/auth/SetupWizard.tsx` — both use `ADD COLUMN IF NOT EXISTS` for idempotency). `initializeSync()` in `packages/browser-extension/src/background/service-worker.ts` now queries `user_settings` BEFORE deriving a key: if a row exists, its `encryption_salt` is treated as the source of truth and mirrored into local storage; if no row exists, the local salt (or a freshly generated one) is pushed up and becomes authoritative. This means any device signing in with the correct passphrase will derive the same key regardless of local storage state.
  3. **Canary verification.** On first-run, `initializeSync()` encrypts the fixed string `'tabflow-canary-v1'` with the derived key and stores it in `user_settings.canary`. On every subsequent sign-in, it attempts to decrypt the canary; on `DOMException` (wrong key) it aborts — `syncClient` is NOT created, nothing is pushed — and writes a `passphraseMismatch` record to `chrome.storage.session`. A new red error banner at the top of `NewTab.tsx` (styled via `mismatchBanner` / `mismatchBannerContent` / `mismatchBannerText`) surfaces the message and instructs the user to sign out and re-enter the original passphrase. Legacy rows without a canary are backfilled automatically on next sign-in. This closes the "quietly overwrite cloud data with garbage encrypted with the wrong key" failure mode that made the incident unrecoverable.
  New import in service-worker.ts: `import { encrypt, decrypt } from '@tabflow/core/crypto/encryption'`. New constant `CANARY_PLAINTEXT = 'tabflow-canary-v1'` (do not change — changing it invalidates every existing user's canary).
- **2026-04-13** — One-time "Restore from Cloud" button added to recover local state after the `packages/chrome-extension` → `packages/browser-extension` rename orphaned the old unpacked install (new folder path → new extension ID → fresh empty IndexedDB; data was safe on Supabase but locally invisible). Wiring: new `RESTORE_FROM_CLOUD` message type handled in `packages/browser-extension/src/background/service-worker.ts` — calls the existing (previously-dormant) `SupabaseSyncClient.pullAll(syncUserId)`, which fetches every `workspaces` / `tabs` row for the user, decrypts `name` / `url` / `title` with the passphrase-derived key, and upserts them into IndexedDB via `StorageAdapter.saveWorkspace` / `saveTab`. Sets `setPushing(true)` around the pull so the realtime echo guard doesn't bounce the rows back out. Returns `{ workspaceCount, tabCount }` for UI confirmation. Button lives at the bottom of the popup footer (`packages/browser-extension/src/popup/Popup.tsx`) — only visible when `user` is signed in. Click flow: `window.confirm` preamble explaining it's pull-only → spinner → success line (green) or error line (red) → 1.5s delay → `window.location.reload()` so `useTabFlow` re-fetches. No schema changes, no auto-pull, existing push-only model preserved. This handler is safe to leave in place as a general "disaster recovery" button for anyone whose local DB gets wiped. Followup: pin a static `key` in `manifest.chrome.json` so the unpacked extension ID stops depending on folder path — deliberately deferred so it doesn't orphan THIS install.
- **2026-04-13** — SetupWizard test-connection endpoint and instructions fixed after a healthy project was still returning 401. The test was hitting `/rest/v1/` with `Authorization: Bearer <publishable_key>`, which PostgREST rejects for the new non-JWT `sb_publishable_…` keys. Switched the probe to `GET /auth/v1/settings` with only the `apikey` header — a GoTrue public endpoint that validates URL + key together without needing schema or a user JWT, and works equivalently for legacy `eyJ…` anon keys and new publishable keys. Also rewrote the "enter-credentials" step instructions to match the actual Supabase dashboard: Project URL is copied directly from the top of the project dashboard (not from Project Settings → API), and API Keys is reached via the "Get connected" row. Removed the misleading step that said the URL lives on the API Keys page.
- **2026-04-13** — SetupWizard Supabase instructions rewritten in `packages/browser-extension/src/auth/SetupWizard.tsx` after a 401 failure with ambiguous guidance. `handleTestConnection` now branches on HTTP status (401 / 403 / 404 / 5xx / network) with actionable causes — e.g. 401 suggests a truncated key, the wrong key, or a paused project. The "enter-credentials" step was rebuilt with a numbered `<ol>` walkthrough (open supabase.com/dashboard → Project Settings → API → copy Project URL → copy publishable/anon key), explicit handling of BOTH key formats (legacy JWT `eyJ…` and the new `sb_publishable_…`), a red-text warning not to paste `service_role` / `sb_secret_…`, a direct link to the dashboard, and a placeholder string that shows both formats. Added matching styles (`steps`, `step`, `subSteps`, `code`, `link`) and bumped `errorBox` `lineHeight` to 1.55 for readability. Fixed a duplicate `link:` key in the styles object that was blocking the build. Chrome and Firefox dists rebuilt clean.
- **2026-04-13** — Firefox support (cross-browser build). Renamed `packages/chrome-extension` → `packages/browser-extension` and `@tabflow/chrome-extension` → `@tabflow/browser-extension`. Split the single `public/manifest.json` into `manifest.chrome.json` and `manifest.firefox.json` templates; the Firefox variant adds `browser_specific_settings.gecko` (placeholder id `tabflow@samhamilton.dev`, min FF 128), drops Chrome-only permissions (`sidePanel`, `system.memory`), and swaps `side_panel` for `sidebar_action`. `vite.config.ts` reworked to read `TARGET=chrome|firefox` and emit to `dist/<target>/`, copying the right manifest in and scrubbing the stray template from the output. Added `packages/browser-extension/src/browser-compat.ts` exposing `BROWSER` / `isChrome` / `isFirefox` (via Vite's `define` → `import.meta.env.TARGET_BROWSER`) plus a `browserCompat.openSidebar()` wrapper around `chrome.sidePanel.open` / `browser.sidebarAction.open`. Added `cross-env` dep so `TARGET=...` env works on Windows. Root `package.json` scripts: `build`, `build:chrome`, `build:firefox`, `dev:chrome`; inner scripts mirror them via `cross-env`. Native-host: added `packages/native-host/install-firefox.bat` that writes to `HKCU\Software\Mozilla\NativeMessagingHosts` and uses `allowed_extensions` with the gecko id. Both Chrome and Firefox builds verified producing clean `dist/chrome/` and `dist/firefox/` with the correct manifest in each.
- **2026-04-13** — Drop-indicator thinned in `packages/chrome-extension/src/newtab/NewTab.tsx`. Reduced the bar height from 3px to 1.5px, scaled the glow offsets down proportionally (3/8/16/32/56px instead of 4/10/20/40/70px), and adjusted the above/below anchor offsets from `-3px` to `-2px` to keep the bar visually centered in the gap between items.
- **2026-04-13** — Drop-indicator glow styling in `packages/chrome-extension/src/newtab/NewTab.tsx`. Replaced the flat blue bar (`#6c8cff` with a single soft boxShadow) with a multi-layer backlit glow that matches the tab-tile pressed `glowStyle` aesthetic (see TabTile component, ~line 1961). The bar now uses the dragged workspace's own color as `dragIndicatorColor` (threaded from the parent as a new `WorkspaceSidebarItem` prop, falls back to `#6c8cff` if no workspace is being dragged) with five layered box-shadows from a bright 4px core out to a 70px soft halo, and pill-shaped rounded ends (`borderRadius: 999px`). Feels like a lit LED in the workspace's accent color.
- **2026-04-13** — Drop-indicator flicker fix in `packages/chrome-extension/src/newtab/NewTab.tsx`. After the earlier drag-and-drop overhaul, the indicator bar was flickering between the hovered workspace and the bottom of the list as the cursor crossed the 4px flex gap between items. Cause: the container's `onDragOver` with `e.target !== e.currentTarget` guard still fired when the cursor was momentarily in a gap (there's no child element at that pixel, so `e.target === e.currentTarget`), setting the state to `'__bottom__'`. If the user released during that instant, the drop landed at the end. Fix: removed the container-level `onDragOver` / `onDrop` handlers and the `'__bottom__'` indicator div entirely. The per-item above/below logic already covers "drop at end" — hovering the bottom half of the last workspace correctly inserts below it. Also removed the now-stale `'__bottom__'` comment on the `dragOverPosition` state declaration.
- **2026-04-13** — Workspace reorder drag-and-drop UX overhaul in `packages/chrome-extension/src/newtab/NewTab.tsx`. Root-cause bug: the `styles.workspacesList` container's `onDragOver`/`onDrop` bubbled from child workspace events and overwrote the target to `'__bottom__'`, causing every drop to land at the end. Fixed with `e.stopPropagation()` in child handlers and an `e.target !== e.currentTarget` guard on the container handlers. Added cursor-Y-based above/below drop-position detection (new `dragOverPosition` state), replaced the old 2px top border with a prominent 3px glowing blue indicator bar that renders above OR below the target based on cursor position, added a matching bar for drop-at-end, dimmed the item being dragged to opacity 0.35, and fixed `handleDrop` to insert at the indicated position with proper index adjustment after the dragged item is removed from the order array. `WorkspaceSidebarItem` props extended with `dragOverPosition` and `isBeingDragged`; `onDrop` signature changed to accept the drag event so it can call `stopPropagation`.
- **2026-04-13** — Workspace archive (recycle bin) added. Deleted workspaces now restore-able. v4 Dexie schema. Version bumped to 0.1.1. `tabGroups` permission removed per Chrome Web Store rejection feedback. Initial Chrome Web Store submission rejected (tabGroups); resubmission pending.
- **2026-04-12** — Multi-device "Resume Working Here" sync model implemented (migration 004, heartbeat, active-device gate). SetupWizard rewritten with skip/existing/new paths. Extension first submitted to Chrome Web Store (unlisted) with icon, screenshots, and listing copy.
- **2026-04-11** — Initial feature set: workspaces, tabs, drag-drop, thumbnails, history (per-workspace snapshots), encrypted Supabase sync, native-host companion. Extension loaded unpacked for dev.
