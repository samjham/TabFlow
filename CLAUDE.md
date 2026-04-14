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

Flow:
- On startup, `SupabaseSyncClient.initDeviceSession(deviceId)` subscribes to realtime changes and checks current status.
- `checkActiveDevice()` auto-claims if no device is active OR the claimant is stale (no heartbeat for 2+ min).
- `startHeartbeat()` updates `last_heartbeat` every 30s.
- `pushToSync()` in the service worker is gated: `if (!syncClient.isActiveDevice) return;`.
- When an inactive device wants to take over, the UI calls `CLAIM_ACTIVE_DEVICE`, which `upsert`s a new row and restarts the heartbeat.
- UI broadcasts status via `chrome.storage.session` so the newtab page can show/hide the "Resume Working Here" banner.

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

## 6. Build & Run

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
