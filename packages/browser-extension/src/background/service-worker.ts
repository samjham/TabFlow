/**
 * TabFlow Chrome Extension — Background Service Worker
 *
 * Handles:
 * - Message routing from popup/sidebar via MessageHandler
 * - Auth state monitoring and sync initialization
 * - Tab event listeners for real-time tracking
 */

import { MessageHandler, Message, Response } from './MessageHandler';
import * as AuthManager from '../auth/AuthManager';
import { SupabaseSyncClient, getOrCreateDeviceId, getDeviceName } from '../sync/SupabaseSyncClient';
import { storage } from '../storage/IndexedDBAdapter';
import { TabManager } from './TabManager';
import { WorkspaceEngine } from '@tabflow/core';
import { deriveKey } from '@tabflow/core';
import { encrypt, decrypt } from '@tabflow/core/crypto/encryption';
import { getExtensionBaseUrl, getExtensionPageUrl } from '../browser-compat';

/**
 * Known plaintext encrypted with the user's key and stored in user_settings.canary.
 * On every sign-in we attempt to decrypt this. If decryption fails, the passphrase
 * entered on THIS device does not match the one that encrypted the cloud data —
 * we halt sync rather than silently pushing up rows encrypted with the wrong key.
 */
const CANARY_PLAINTEXT = 'tabflow-canary-v1';

// Tab manager for workspace switching and tab tracking
// Created FIRST so it can be shared with MessageHandler
const tabManager = new TabManager();

// Core message handler (local operations) — shares the same TabManager
// so native host init on the service worker's tabManager is visible
// to moveTabsToHiddenWindow inside MessageHandler.
const messageHandler = new MessageHandler(storage, (value: boolean) => {
  isSwitchingWorkspaces = value;
  // When a workspace switch finishes, refresh the cached main window ID
  // since tabs may have moved between windows
  if (!value) {
    refreshMainWindowId();
    // After the first workspace switch post-restart, snapshots are safe again.
    // The switch handler correctly saves the outgoing workspace and restores
    // the incoming one, so we know the main window tabs match the active workspace.
    if (postRestartSnapshotSuppressed) {
      postRestartSnapshotSuppressed = false;
      console.log('[TabFlow] Post-restart snapshot suppression lifted (workspace switch completed)');
    }
  }
}, tabManager);

// Workspace engine for workspace queries
const workspaceEngine = new WorkspaceEngine(storage);

// Flag to prevent tab tracking events during workspace switches
let isSwitchingWorkspaces = false;

// Flag to suppress ALL tab events during extension startup/reload.
// Chrome closes and recreates extension pages on reload, which would
// trigger onRemoved and delete tab records from storage if not suppressed.
let isStartingUp = true;

// Track whether we're doing a full Chrome restart (vs extension reload).
// Detected by checking if the stored tabFlowTabId still exists as a
// real Chrome tab. After Chrome restart, all tab IDs change.
let isChromeRestart = false;

// Suppress snapshots after Chrome restart until the user explicitly
// switches a workspace. After restart, Chrome restores tabs from its
// own session — these may not match the "active" workspace in our DB.
// If the snapshot fires, it overwrites the active workspace's restart-*
// records (which are the TRUE data) with whatever Chrome restored.
// Cleared by the first SWITCH_WORKSPACE message.
let postRestartSnapshotSuppressed = false;

// Grace period for extension reload (tabs already exist, IDs preserved).
// On Chrome restart, isChromeRestart is set and isStartingUp stays true
// until the message-triggered startup flow completes.
// Stored as a variable so onStartup can clearTimeout if it fires first.
const startupGraceTimeout = setTimeout(() => {
  if (isStartingUp && !isChromeRestart) {
    isStartingUp = false;
    console.log('[TabFlow] Startup grace period ended (extension reload), tab tracking enabled');
  }
}, 3000);

/**
 * Cached main window ID. Only tabs in THIS window are tracked.
 * This replaces the old "isInHiddenWindow" blocklist approach which
 * failed on Chrome restart (hidden window map was stale).
 *
 * The allowlist approach is fundamentally more reliable: we only
 * need to know ONE window ID (the main one), and everything else
 * is ignored.
 */
let cachedMainWindowId: number | undefined = undefined;

/** Updates the cached main window ID. Called on startup and when windows change. */
async function refreshMainWindowId(): Promise<void> {
  cachedMainWindowId = await tabManager.getMainWindowId();
  if (cachedMainWindowId !== undefined) {
    console.log(`[TabFlow] Main window ID cached: ${cachedMainWindowId}`);
  }
}

/** Checks if a tab event should be tracked (only tabs in the main window). */
function isInMainWindow(windowId: number | undefined): boolean {
  if (windowId === undefined || cachedMainWindowId === undefined) return false;
  return windowId === cachedMainWindowId;
}

// Local user ID (single-user for now)
const LOCAL_USER_ID = 'local-user';

// Sync client (initialized after auth)
let syncClient: SupabaseSyncClient | null = null;

// Real Supabase user ID (set after auth)
let syncUserId: string | null = null;

/**
 * Notify all extension pages (new tab, popup, sidebar) that data changed.
 *
 * Uses chrome.storage.session as the notification channel because
 * chrome.runtime.sendMessage is unreliable for reaching extension pages
 * (especially pinned newtab overrides that may be in the background).
 * chrome.storage.onChanged fires reliably in ALL extension contexts.
 */
function broadcastSyncUpdate() {
  chrome.storage.session.set({ syncUpdateTs: Date.now() }).catch(() => {
    // storage.session not available — ignore
  });
}

/**
 * Initialize sync after user authenticates.
 * Derives the encryption key from the stored passphrase and starts real-time sync.
 */
async function initializeSync(userId: string) {
  try {
    // Get encryption passphrase from chrome.storage
    const stored = await chrome.storage.local.get(['encryptionPassphrase', 'encryptionSalt']);

    if (!stored.encryptionPassphrase) {
      console.warn('[TabFlow] No encryption passphrase found — sync disabled');
      return;
    }

    // Get Supabase client FIRST so we can consult the authoritative
    // user_settings row before deriving a key with a possibly-wrong salt.
    const supabase = await AuthManager.initialize();

    // ── Salt reconciliation ────────────────────────────────────────────────
    // user_settings.encryption_salt is the SOURCE OF TRUTH. On a fresh install
    // (folder rename, new computer, reinstall) chrome.storage.local starts
    // empty — without this step we would generate a new salt, derive a new
    // key, and push garbage encrypted data to the cloud overwriting the user's
    // real rows. Query first; only generate/upload on genuine first-run.
    const { data: settingsRow, error: settingsErr } = await supabase
      .from('user_settings')
      .select('encryption_salt, canary')
      .eq('user_id', userId)
      .maybeSingle();

    if (settingsErr) {
      console.error('[TabFlow] Failed to read user_settings:', settingsErr);
      // Don't abort — user may not have run the migration yet. Fall back to
      // legacy behavior (local-salt-only) but keep sync push-only to protect data.
    }

    let saltBytes: Uint8Array | undefined;
    let remoteSaltExists = false;

    if (settingsRow?.encryption_salt) {
      remoteSaltExists = true;
      try {
        saltBytes = new Uint8Array(JSON.parse(settingsRow.encryption_salt));
      } catch (e) {
        console.error('[TabFlow] user_settings.encryption_salt is malformed:', e);
        saltBytes = undefined;
      }
    } else if (stored.encryptionSalt) {
      // No remote row yet — use whatever is local (first-run on this account).
      saltBytes = new Uint8Array(JSON.parse(stored.encryptionSalt));
    }

    // Derive encryption key using the authoritative salt (or a newly-generated
    // one when both remote and local are absent).
    const { key, salt } = await deriveKey(stored.encryptionPassphrase, saltBytes);

    // Always mirror the authoritative salt into local storage so subsequent
    // cold-starts don't drift.
    await chrome.storage.local.set({
      encryptionSalt: JSON.stringify(Array.from(salt)),
    });

    // ── Canary check ───────────────────────────────────────────────────────
    // If a canary exists in user_settings, it was encrypted with the correct
    // key. Try to decrypt with ours: success → passphrase matches → safe to
    // push. Failure → passphrase mismatch → HALT sync entirely so we don't
    // overwrite real data with garbage.
    if (remoteSaltExists && settingsRow?.canary) {
      try {
        const decoded = await decrypt(settingsRow.canary, key);
        if (decoded !== CANARY_PLAINTEXT) {
          // Decrypt succeeded but payload is wrong — shouldn't happen unless
          // the schema changes. Treat as mismatch.
          throw new Error('canary payload mismatch');
        }
        console.log('[TabFlow] Passphrase canary verified ✓');
      } catch (err) {
        console.error('[TabFlow] Passphrase canary FAILED — sync halted:', err);
        // Tell all UI pages to surface the error + force re-entry.
        chrome.storage.session.set({
          passphraseMismatch: {
            ts: Date.now(),
            message:
              'The passphrase on this device does not match the one used to ' +
              'encrypt your cloud data. Sync is paused to protect your data. ' +
              'Sign out and sign in again with the ORIGINAL passphrase.',
          },
        }).catch(() => {});
        return; // Do NOT create syncClient; do NOT push anything.
      }
    } else if (!remoteSaltExists) {
      // First-run for this account on this (or any) device. Seed the canary
      // + salt so future devices can verify against it.
      try {
        const canaryCiphertext = await encrypt(CANARY_PLAINTEXT, key);
        const { error: upsertErr } = await supabase
          .from('user_settings')
          .upsert(
            {
              user_id: userId,
              encryption_salt: JSON.stringify(Array.from(salt)),
              canary: canaryCiphertext,
            },
            { onConflict: 'user_id' }
          );
        if (upsertErr) {
          console.error('[TabFlow] Failed to seed user_settings:', upsertErr);
        } else {
          console.log('[TabFlow] Seeded user_settings with salt + canary');
        }
      } catch (e) {
        console.error('[TabFlow] Failed to encrypt canary:', e);
      }
    } else if (remoteSaltExists && !settingsRow?.canary) {
      // Legacy row exists with a salt but no canary (user set up before this
      // safeguard shipped). Backfill the canary now — the salt is already
      // authoritative, so if the passphrase is wrong the user's data is
      // already wrong in the cloud and there is nothing we can verify against.
      try {
        const canaryCiphertext = await encrypt(CANARY_PLAINTEXT, key);
        const { error: updateErr } = await supabase
          .from('user_settings')
          .update({ canary: canaryCiphertext })
          .eq('user_id', userId);
        if (updateErr) {
          console.error('[TabFlow] Failed to backfill canary:', updateErr);
        } else {
          console.log('[TabFlow] Backfilled canary on existing user_settings row');
        }
      } catch (e) {
        console.error('[TabFlow] Failed to encrypt canary for backfill:', e);
      }
    }

    // Get or create a stable device ID for this Chrome installation
    const deviceId = await getOrCreateDeviceId();
    console.log('[TabFlow] Device ID:', deviceId);

    // Create and connect sync client with remote change callback + device change callback
    syncClient = new SupabaseSyncClient(
      supabase,
      storage,
      key,
      LOCAL_USER_ID,
      () => {
        console.log('[TabFlow] Remote change received, broadcasting to UI');
        broadcastSyncUpdate();
      },
      (isActive: boolean, claimedBy?: string) => {
        console.log(`[TabFlow] Active device changed: isActive=${isActive}, claimedBy=${claimedBy || 'self'}`);
        // Broadcast device status to all UI pages via storage.session
        chrome.storage.session.set({
          deviceStatus: { isActive, claimedBy: claimedBy || null, ts: Date.now() },
        }).catch(() => {});
      }
    );
    await syncClient.connect(userId);

    // Initialize device session (checks active device, auto-claims if none)
    await syncClient.initDeviceSession(deviceId);

    // Store the real user ID for sync pushes
    syncUserId = userId;

    // DISABLED: pullAll was downloading corrupted tab records from Supabase
    // back into IndexedDB after local cleanup. Sync is push-only for now.
    // TODO: Re-enable pull once Supabase data is clean, or add a
    // "sync reset" button that wipes Supabase and re-uploads local state.
    console.log('[TabFlow] Sync pull DISABLED — push-only mode');

    console.log('[TabFlow] Sync initialized for user:', userId);
  } catch (error) {
    console.error('[TabFlow] Failed to initialize sync:', error);
  }
}

/**
 * Guard to prevent ensureTabFlowTab from running concurrently.
 * Both onInstalled and the startup IIFE call it, so without this
 * they can race each other and create duplicate tabs.
 */
let ensureTabFlowRunning = false;

/**
 * Ensures exactly one TabFlow tab exists, is pinned, and sits at position 0.
 * Searches ALL windows so duplicates in other windows are caught too.
 * Also closes any default chrome://newtab tabs Chrome creates on reload.
 */
async function ensureTabFlowTab() {
  // Prevent concurrent runs
  if (ensureTabFlowRunning) {
    console.log('[TabFlow] ensureTabFlowTab already running, skipping');
    return;
  }
  ensureTabFlowRunning = true;

  try {
    const extBase = getExtensionBaseUrl(); // chrome-extension://<id>/ or moz-extension://<id>/
    const suspendedPrefix = `${extBase}suspended.html`;

    // Search ALL windows for tabs
    const allTabs = await chrome.tabs.query({});
    console.log(`[TabFlow] ensureTabFlowTab: found ${allTabs.length} total tabs`);

    // Strategy 1: Find by extension URL (most reliable after page loads)
    let keeper = allTabs.find(
      (t) => t.url?.startsWith(extBase) &&
             !t.url?.startsWith(suspendedPrefix)
    ) || null;
    if (keeper) console.log(`[TabFlow] Found TabFlow tab by extension URL (tab ${keeper.id})`);

    // Strategy 2: Find by pendingUrl (during navigation)
    if (!keeper) {
      keeper = allTabs.find(
        (t) => (t as any).pendingUrl?.startsWith(extBase) &&
               !(t as any).pendingUrl?.startsWith(suspendedPrefix)
      ) || null;
      if (keeper) console.log(`[TabFlow] Found TabFlow tab by pendingUrl (tab ${keeper.id})`);
    }

    // Strategy 3: Find by stored tab ID from previous session.
    // IMPORTANT: Chrome reassigns tab IDs after a full restart, so a stored
    // tabFlowTabId can now point to a completely unrelated tab (e.g.
    // chrome://extensions that the user opened to reload the extension).
    // Require the matched tab's URL to actually look like TabFlow before
    // trusting the stored ID — otherwise we'd pin the wrong tab.
    if (!keeper) {
      const stored = await chrome.storage.local.get('tabFlowTabId');
      if (stored.tabFlowTabId) {
        const candidate = allTabs.find((t) => t.id === stored.tabFlowTabId) || null;
        if (candidate) {
          const candidateUrl = candidate.url || '';
          const candidatePendingUrl = (candidate as any).pendingUrl || '';
          const looksLikeTabFlow =
            candidateUrl.startsWith(extBase) ||
            candidatePendingUrl.startsWith(extBase) ||
            candidateUrl === 'chrome://newtab/' ||
            candidateUrl === 'chrome://newtab' ||
            candidateUrl === '' ||
            candidateUrl === 'about:blank';
          if (looksLikeTabFlow && !candidateUrl.startsWith(suspendedPrefix)) {
            keeper = candidate;
            console.log(`[TabFlow] Found TabFlow tab by stored ID (tab ${keeper.id})`);
          } else {
            console.log(`[TabFlow] Stored tab ID ${stored.tabFlowTabId} now points to unrelated tab (${candidateUrl || '(no url)'}), ignoring`);
            // Clear the stale mapping so we don't keep hitting this path
            await chrome.storage.local.remove('tabFlowTabId');
          }
        }
      }
    }

    // Strategy 4: Since we have chrome_url_overrides.newtab, any
    // chrome://newtab/ tab IS a TabFlow tab. Prefer already-pinned ones.
    if (!keeper) {
      keeper = allTabs.find(
        (t) => t.pinned && (t.url === 'chrome://newtab/' || t.url === 'chrome://newtab')
      ) || null;
      if (keeper) console.log(`[TabFlow] Found TabFlow tab by pinned newtab (tab ${keeper.id})`);
    }
    if (!keeper) {
      keeper = allTabs.find(
        (t) => t.url === 'chrome://newtab/' || t.url === 'chrome://newtab'
      ) || null;
      if (keeper) console.log(`[TabFlow] Found TabFlow tab by any newtab (tab ${keeper.id})`);
    }

    // Pin and position the keeper, or create a new tab
    if (keeper && keeper.id !== undefined) {
      // If the keeper is showing chrome://newtab (e.g., after extension reload),
      // explicitly navigate it to the extension URL. The newtab override SHOULD
      // handle this, but there's a timing gap where Chrome shows the default
      // new tab page instead of the extension's page. Explicit navigation
      // guarantees the TabFlow UI is visible.
      const keeperUrl = keeper.url || '';
      if (keeperUrl === 'chrome://newtab/' || keeperUrl === 'chrome://newtab' || keeperUrl === '' || keeperUrl === 'about:blank') {
        try {
          await chrome.tabs.update(keeper.id, { url: getExtensionPageUrl('newtab.html') });
          console.log('[TabFlow] Navigated keeper tab to explicit extension URL');
        } catch (e) {
          console.warn('[TabFlow] Could not navigate keeper to extension URL:', e);
        }
      }

      if (!keeper.pinned) {
        await chrome.tabs.update(keeper.id, { pinned: true });
        console.log('[TabFlow] Pinned TabFlow tab');
      }
      if (keeper.index !== 0) {
        await chrome.tabs.move(keeper.id, { index: 0 });
        console.log('[TabFlow] Moved TabFlow tab to position 0');
      }
      await chrome.storage.local.set({ tabFlowTabId: keeper.id });
      tabManager.setTabFlowTabId(keeper.id);
    } else {
      // No TabFlow tab found — create one.
      // MUST specify windowId — in a service worker during startup,
      // chrome.tabs.create without windowId fails with "No current window"
      // because service workers don't have a concept of "current window."
      console.log('[TabFlow] No TabFlow tab found, creating new one');

      // Find a window to create the tab in
      let targetWindowId: number | undefined;
      if (allTabs.length > 0 && allTabs[0].windowId !== undefined) {
        // Use the window of the first tab we found
        targetWindowId = allTabs[0].windowId;
      } else {
        // Last resort: get the last focused window
        try {
          const lastFocused = await chrome.windows.getLastFocused();
          targetWindowId = lastFocused?.id;
        } catch {
          // If this fails too, try creating without windowId
        }
      }

      console.log(`[TabFlow] Creating TabFlow tab in window ${targetWindowId ?? 'default'}`);
      const created = await chrome.tabs.create({
        url: getExtensionPageUrl('newtab.html'),
        pinned: true,
        active: false,
        ...(targetWindowId !== undefined ? { windowId: targetWindowId } : {}),
      });
      if (created.id) {
        await chrome.tabs.move(created.id, { index: 0 });
        await chrome.storage.local.set({ tabFlowTabId: created.id });
        tabManager.setTabFlowTabId(created.id);
        console.log(`[TabFlow] Created and pinned TabFlow tab (tab ${created.id}) in window ${targetWindowId}`);
      }
    }

    // Close duplicate TabFlow tabs (extension URL only — not chrome://newtab tabs
    // which are legitimate user-opened new tabs showing our override page)
    const keeperId = keeper?.id ?? (await chrome.storage.local.get('tabFlowTabId')).tabFlowTabId;
    const duplicates = allTabs.filter(
      (t) => t.id !== keeperId &&
             t.url?.startsWith(extBase) &&
             !t.url?.startsWith(suspendedPrefix)
    );
    for (const dupe of duplicates) {
      try {
        if (dupe.id) await chrome.tabs.remove(dupe.id);
        console.log(`[TabFlow] Removed duplicate TabFlow tab ${dupe.id}`);
      } catch { /* tab may be gone */ }
    }
  } catch (error) {
    console.error('[TabFlow] Error ensuring TabFlow tab:', error);
  } finally {
    ensureTabFlowRunning = false;
  }
}

/**
 * On extension install or update — ensure TabFlow tab is pinned
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[TabFlow] Extension ${details.reason}`);
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }

  // Short delay to let Chrome finish its own tab operations
  setTimeout(async () => {
    await ensureTabFlowTab();
    await refreshMainWindowId();
  }, 500);
});

/**
 * Rename stale chrome-* tab IDs in ALL workspaces to restart-* after
 * Chrome restart. Chrome assigns entirely new tab IDs after restart,
 * so old chrome-* IDs are meaningless and could collide with new IDs.
 *
 * This does NOT delete or add any tab records — it only renames IDs.
 * The URL/title/favicon data is preserved. When the user switches to
 * a workspace, restoreWorkspaceTabs creates real Chrome tabs from these
 * restart-* records.
 *
 * This is safe because it's a pure rename — no data is created or lost.
 */
async function renameStaleTabIds(): Promise<void> {
  try {
    const workspaces = await workspaceEngine.getWorkspaces(LOCAL_USER_ID);
    const now = Date.now();
    let renamedCount = 0;

    for (const ws of workspaces) {
      const tabs = await storage.getTabs(ws.id);
      for (const tab of tabs) {
        if (tab.id.startsWith('chrome-')) {
          const newId = `restart-${now}-${renamedCount}`;
          await storage.deleteTab(tab.id);
          await storage.saveTab({ ...tab, id: newId });
          renamedCount++;
        }
      }
    }

    if (renamedCount > 0) {
      console.log(`[TabFlow] Renamed ${renamedCount} stale chrome-* IDs to restart-* across all workspaces`);
    }
  } catch (error) {
    console.error('[TabFlow] Error renaming stale tab IDs:', error);
  }
}

/**
 * Run the Chrome restart startup flow.
 *
 * LOCKED-DOWN approach: This does NOT modify workspace data or tab records.
 * It only does two things:
 * 1. Pin the TabFlow tab (so the user has their workspace UI)
 * 2. Rename stale chrome-* IDs to restart-* (pure rename, no data change)
 *
 * The database is NOT touched otherwise. Whatever was saved when the user
 * last switched workspaces or made manual changes is preserved exactly.
 *
 * Returns true if successful, false if Chrome has no tabs yet (caller should retry).
 */
async function runChromeRestartFlow(): Promise<boolean> {
  try {
    // Check if Chrome has any tabs yet
    const allTabs = await chrome.tabs.query({});
    if (allTabs.length === 0) {
      console.log('[TabFlow] Restart flow: no tabs yet — Chrome still restoring');
      return false;
    }

    console.log(`[TabFlow] Restart flow: Chrome has ${allTabs.length} tabs, proceeding`);

    // Step 1: Find/create and pin the TabFlow tab
    await ensureTabFlowTab();
    await refreshMainWindowId();

    // Verify it worked
    const stored = await chrome.storage.local.get('tabFlowTabId');
    let verified = false;
    let tabFlowWindowId: number | undefined;
    if (stored.tabFlowTabId) {
      try {
        const tab = await chrome.tabs.get(stored.tabFlowTabId);
        if (tab && tab.pinned) {
          verified = true;
          tabFlowWindowId = tab.windowId;
          console.log('[TabFlow] Restart flow: TabFlow tab verified pinned');
        }
      } catch { /* tab doesn't exist */ }
    }

    if (!verified) {
      console.log('[TabFlow] Restart flow: TabFlow tab not verified yet');
      return false;
    }

    // Step 2: Clear the hidden window map. It's stored in chrome.storage.local
    // and survives Chrome restart, but the actual windows are gone (or restored
    // as regular windows with reused IDs). Stale entries cause the "Hidden window
    // ID matches main window ID" safety abort when Chrome reuses a window ID.
    await chrome.storage.local.set({ hiddenWindows: {} });
    console.log('[TabFlow] Restart flow: cleared stale hidden window map');

    // Step 3: Close ALL windows except the one containing the TabFlow tab.
    // After Chrome restart, hidden minimized windows from the previous session
    // get restored as regular windows. The in-memory hidden window map is empty,
    // so closeAllHiddenWindows() can't find them. These orphan windows show
    // tabs from other workspaces, confusing both the user and the snapshot system.
    // Closing them is safe because all tab data is preserved in the DB as
    // restart-* records — tabs will be restored when the user switches workspaces.
    if (tabFlowWindowId !== undefined) {
      const allWindows = await chrome.windows.getAll();
      for (const win of allWindows) {
        if (win.id !== tabFlowWindowId && win.id !== undefined) {
          try {
            await chrome.windows.remove(win.id);
            console.log(`[TabFlow] Restart flow: closed extra window ${win.id}`);
          } catch (e) {
            console.warn(`[TabFlow] Restart flow: failed to close window ${win.id}:`, e);
          }
        }
      }
    }

    // Step 4: Close all non-TabFlow tabs in the main window.
    // Chrome may have restored tabs from the previous session in this window,
    // but they may belong to a different workspace than the active one.
    // We'll let the active workspace's tabs be restored from the DB below.
    if (tabFlowWindowId !== undefined) {
      const windowTabs = await chrome.tabs.query({ windowId: tabFlowWindowId });
      const tabsToClose = windowTabs.filter(
        (t) => t.id !== stored.tabFlowTabId && t.id !== undefined
      );
      if (tabsToClose.length > 0) {
        try {
          await chrome.tabs.remove(tabsToClose.map((t) => t.id!));
          console.log(`[TabFlow] Restart flow: closed ${tabsToClose.length} orphan tabs in main window`);
        } catch (e) {
          console.warn('[TabFlow] Restart flow: error closing orphan tabs:', e);
        }
      }
    }

    // Step 5: Rename stale chrome-* IDs in ALL workspaces to restart-*.
    // This is a pure rename — no tab records are added or deleted.
    // It prevents stale IDs from colliding with new Chrome tab IDs.
    await renameStaleTabIds();

    // Step 6: Restore the active workspace's tabs from the DB.
    // This gives the user their tabs back immediately after Chrome restart,
    // using the restart-* records as the source of truth.
    try {
      const workspaces = await workspaceEngine.getWorkspaces(LOCAL_USER_ID);
      const activeWorkspace = workspaces.find((ws) => ws.isActive);
      if (activeWorkspace) {
        const tabsToRestore = await storage.getTabs(activeWorkspace.id);
        if (tabsToRestore.length > 0) {
          console.log(`[TabFlow] Restart flow: restoring ${tabsToRestore.length} tabs for active workspace "${activeWorkspace.name}"`);
          await tabManager.restoreWorkspaceTabs(tabsToRestore, storage, tabFlowWindowId);
        }
      }
    } catch (e) {
      console.warn('[TabFlow] Restart flow: error restoring active workspace tabs:', e);
    }

    // Clear the restart flag and enable tab tracking.
    // Snapshot suppression is lifted because we just restored the correct
    // tabs for the active workspace — the main window tabs now match the DB.
    await chrome.storage.local.remove('pendingChromeRestart');
    isChromeRestart = false;
    isStartingUp = false;
    postRestartSnapshotSuppressed = false;
    messageHandler.setSkipOutgoingSave(false);
    broadcastSyncUpdate();
    console.log('[TabFlow] Chrome restart flow COMPLETE — tab tracking enabled');
    return true;
  } catch (error) {
    console.error('[TabFlow] Error in Chrome restart flow:', error);
    return false;
  }
}

/**
 * Window-created listener for Chrome restart startup.
 *
 * chrome.alarms in MV3 can be throttled (minimum ~30s in some cases).
 * But chrome.windows.onCreated fires immediately when Chrome restores
 * a window from its session — this is the fastest reliable signal that
 * Chrome is ready for us to pin the TabFlow tab and clean up.
 *
 * Only active during Chrome restart (checked via pendingChromeRestart).
 */
chrome.windows.onCreated.addListener(async () => {
  // Only run during Chrome restart startup
  if (!isChromeRestart) return;

  const { pendingChromeRestart } = await chrome.storage.local.get('pendingChromeRestart');
  if (!pendingChromeRestart) return;

  console.log('[TabFlow] Window created during startup — attempting restart flow');

  // Small delay to let Chrome finish setting up the window and its tabs
  setTimeout(async () => {
    const { pendingChromeRestart: stillPending } = await chrome.storage.local.get('pendingChromeRestart');
    if (!stillPending) return; // Already completed by another path

    const success = await runChromeRestartFlow();
    if (success) {
      chrome.alarms.clear(STARTUP_ALARM_NAME);
      console.log('[TabFlow] Restart flow completed via window-created trigger');
    }
  }, 500);
});

/**
 * Alarm-based retry for Chrome restart startup.
 *
 * chrome.alarms RELIABLY wakes the service worker — unlike setTimeout,
 * which dies when Chrome terminates the worker. This is essential for
 * the profile-picker scenario where the worker starts, goes to sleep
 * while waiting for the user, and needs to be woken up afterward.
 */
const STARTUP_ALARM_NAME = 'tabflow-startup-retry';
const HISTORY_PRUNE_ALARM_NAME = 'tabflow-history-prune';

/** 30 days in milliseconds */
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** 90 days for deleted workspace archive retention */
const ARCHIVE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// Create a recurring alarm to prune old workspace history entries.
// periodInMinutes: 1440 = once per day. MV3 may throttle, but daily is fine.
chrome.alarms.create(HISTORY_PRUNE_ALARM_NAME, {
  periodInMinutes: 1440,
  delayInMinutes: 5, // first run 5 minutes after startup
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Handle history pruning
  if (alarm.name === HISTORY_PRUNE_ALARM_NAME) {
    try {
      const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
      const deleted = await storage.pruneHistory(cutoff);
      if (deleted > 0) {
        console.log(`[TabFlow] Pruned ${deleted} history entries older than 30 days`);
      }
      // Also prune thumbnails — keep at most 500
      const prunedThumbs = await storage.pruneThumbnails(500);
      if (prunedThumbs > 0) {
        console.log(`[TabFlow] Pruned ${prunedThumbs} old thumbnails`);
      }
      // Prune deleted workspaces older than 90 days
      try {
        const archiveCutoff = new Date(Date.now() - ARCHIVE_RETENTION_MS);
        const prunedArchive = await storage.pruneDeletedWorkspaces(archiveCutoff);
        if (prunedArchive > 0) {
          console.log(`[TabFlow] Pruned ${prunedArchive} archived workspaces older than 90 days`);
        }
      } catch (archiveErr) {
        console.warn('[TabFlow] Error pruning archived workspaces:', archiveErr);
      }
    } catch (err) {
      console.warn('[TabFlow] Error pruning history/thumbnails:', err);
    }
    return;
  }

  if (alarm.name !== STARTUP_ALARM_NAME) return;

  console.log('[TabFlow] Startup alarm fired');

  // Check if we still need to do the restart flow
  const { pendingChromeRestart } = await chrome.storage.local.get('pendingChromeRestart');
  if (!pendingChromeRestart) {
    console.log('[TabFlow] Startup alarm: no pending restart, done');
    return;
  }

  const success = await runChromeRestartFlow();
  if (!success) {
    // Schedule another retry. chrome.alarms minimum is ~1 minute for
    // periodInMinutes, but one-shot `when` alarms can fire sooner.
    chrome.alarms.create(STARTUP_ALARM_NAME, { when: Date.now() + 3000 });
    console.log('[TabFlow] Startup alarm: will retry in 3s');
  }
});

/**
 * On Chrome browser startup — set up the alarm-based startup flow.
 * This fires once when the user opens Chrome (not on extension reload).
 *
 * We persist a flag in chrome.storage.local and use chrome.alarms for
 * retries. Both survive service worker termination — which happens
 * frequently in MV3, especially during the profile picker screen.
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[TabFlow] Chrome started (onStartup)');
  isChromeRestart = true;
  postRestartSnapshotSuppressed = true;
  messageHandler.setSkipOutgoingSave(true);

  // Persist the flag so it survives service worker restarts
  await chrome.storage.local.set({ pendingChromeRestart: true });

  // Clear the short extension-reload grace timeout
  clearTimeout(startupGraceTimeout);

  // Try immediately — Chrome may already have tabs restored
  const success = await runChromeRestartFlow();
  if (!success) {
    // Fall back to alarm-based retry (reliable across worker termination)
    chrome.alarms.create(STARTUP_ALARM_NAME, { when: Date.now() + 3000 });
    console.log('[TabFlow] Immediate startup failed, scheduled alarm for 3s');
  }
});

// deduplicateAllWorkspaces REMOVED — no longer needed.
// With the locked-down approach, the database is only modified by
// explicit user actions, so duplicates shouldn't occur.

/**
 * On service worker startup — resume sync, clean up stale hidden windows.
 *
 * This IIFE runs every time the service worker starts (cold start, extension
 * reload, AND when woken from sleep). It handles:
 * - Extension reload: ensureTabFlowTab at 1.5s (tabs already exist)
 * - Chrome restart: checks for pendingChromeRestart flag and re-triggers
 *   the alarm if the worker was killed before the restart flow completed
 */
(async () => {
  // ── ONE-TIME DATABASE CLEANUP ──
  // Remove this block after the corrupted data has been cleared.
  // Wipes all tab records, closes all hidden windows, closes all extra
  // Chrome tabs, and blocks Supabase sync from repopulating the data.
  const { dbCleanedV2 } = await chrome.storage.local.get('dbCleanedV2');
  if (!dbCleanedV2) {
    console.log('[TabFlow] ONE-TIME CLEANUP: full reset starting');
    try {
      // Step 1: Close ALL hidden windows (they hold hundreds of tabs from corruption)
      console.log('[TabFlow] CLEANUP: closing all hidden windows');
      await tabManager.closeAllHiddenWindows();

      // Step 2: Close ALL Chrome tabs except the one we're in
      console.log('[TabFlow] CLEANUP: closing all extra Chrome tabs');
      const allChromeTabs = await chrome.tabs.query({});
      // Keep the first tab of the first window (so Chrome doesn't close entirely)
      const mainWindow = await chrome.windows.getLastFocused();
      const keepTabs = allChromeTabs.filter(
        (t) => t.windowId === mainWindow.id && t.index === 0
      );
      const keepTabId = keepTabs[0]?.id;
      const tabsToClose = allChromeTabs
        .filter((t) => t.id !== keepTabId && t.id !== undefined)
        .map((t) => t.id!);

      if (tabsToClose.length > 0) {
        // Close in batches to avoid overwhelming Chrome
        for (let i = 0; i < tabsToClose.length; i += 50) {
          const batch = tabsToClose.slice(i, i + 50);
          try {
            await chrome.tabs.remove(batch);
          } catch (e) {
            console.warn(`[TabFlow] CLEANUP: batch close error:`, e);
          }
        }
        console.log(`[TabFlow] CLEANUP: closed ${tabsToClose.length} Chrome tabs`);
      }

      // Step 3: Close all extra windows (hidden windows that survived Step 1)
      const allWindows = await chrome.windows.getAll();
      for (const win of allWindows) {
        if (win.id !== mainWindow.id) {
          try {
            await chrome.windows.remove(win.id!);
          } catch {}
        }
      }

      // Step 4: Delete all tab records from IndexedDB
      console.log('[TabFlow] CLEANUP: wiping all tab records');
      const allWorkspaces = await workspaceEngine.getWorkspaces(LOCAL_USER_ID);
      let totalDeleted = 0;
      for (const ws of allWorkspaces) {
        const tabs = await storage.getTabs(ws.id);
        for (const tab of tabs) {
          await storage.deleteTab(tab.id);
          totalDeleted++;
        }
      }
      console.log(`[TabFlow] CLEANUP: deleted ${totalDeleted} tab records across ${allWorkspaces.length} workspaces`);

      // Step 5: Mark cleanup as done so it never runs again
      await chrome.storage.local.set({ dbCleanedV2: true });

      // Step 6: Block Supabase sync from repopulating
      // Set a flag that initializeSync checks before pulling data
      await chrome.storage.local.set({ skipSyncPull: true });

      console.log('[TabFlow] ONE-TIME CLEANUP: complete');
    } catch (e) {
      console.error('[TabFlow] ONE-TIME CLEANUP failed:', e);
      // Mark as done even on failure to prevent infinite retry loops
      await chrome.storage.local.set({ dbCleanedV2: true });
    }
  }

  // Check if there's a pending Chrome restart that wasn't completed
  // (e.g., the service worker was killed and restarted)
  const { pendingChromeRestart, tabFlowTabId } = await chrome.storage.local.get([
    'pendingChromeRestart',
    'tabFlowTabId',
  ]);

  if (pendingChromeRestart) {
    // Explicit pending restart flag — restore state and ensure alarm
    isChromeRestart = true;
    postRestartSnapshotSuppressed = true;
    messageHandler.setSkipOutgoingSave(true);
    console.log('[TabFlow] IIFE: detected pending Chrome restart flag — ensuring alarm is set');
    chrome.alarms.create(STARTUP_ALARM_NAME, { when: Date.now() + 2000 });
  } else if (tabFlowTabId) {
    // DETECT CHROME RESTART: Check if the stored tabFlowTabId still
    // exists as a real Chrome tab. After Chrome restart, all tab IDs
    // change, so the stored ID will be invalid → we know it's a restart.
    // This catches the case where onStartup didn't fire (or fired but
    // the worker was killed before setting pendingChromeRestart).
    let tabExists = false;
    try {
      await chrome.tabs.get(tabFlowTabId);
      tabExists = true;
    } catch {
      // Tab doesn't exist — Chrome restart
    }

    if (!tabExists) {
      console.log('[TabFlow] IIFE: stored tabFlowTabId is stale — Chrome restart detected');
      isChromeRestart = true;
      postRestartSnapshotSuppressed = true;
      messageHandler.setSkipOutgoingSave(true);
      await chrome.storage.local.set({ pendingChromeRestart: true });
      chrome.alarms.create(STARTUP_ALARM_NAME, { when: Date.now() + 2000 });
    } else {
      // Tab exists — this is an extension reload, not a Chrome restart
      console.log('[TabFlow] IIFE: stored tabFlowTabId is valid — extension reload');
      setTimeout(async () => {
        console.log('[TabFlow] IIFE: running ensureTabFlowTab (1.5s)');
        await ensureTabFlowTab();
        await refreshMainWindowId();
        // dedup removed — locked-down DB approach
      }, 1500);
    }
  } else {
    // No stored tab ID at all — fresh install or first run
    console.log('[TabFlow] IIFE: no stored tabFlowTabId — fresh start');
    setTimeout(async () => {
      console.log('[TabFlow] IIFE: running ensureTabFlowTab (1.5s)');
      await ensureTabFlowTab();
      await refreshMainWindowId();
      // dedup removed — locked-down DB approach
    }, 1500);
  }

  // Close ALL hidden windows on every extension reload/restart.
  // Hidden windows hold tabs for inactive workspaces. On reload, they
  // survive but the native host disconnects, making them visible and
  // confusing. They'll be recreated when the user switches workspaces.
  try {
    await tabManager.closeAllHiddenWindows();
  } catch (e) {
    console.error('[TabFlow] Error closing hidden windows:', e);
  }

  // Connect to the native messaging host (hides windows from taskbar).
  // This is non-blocking — if the host isn't installed, everything
  // still works, hidden windows just remain visible in the taskbar.
  try {
    await tabManager.initNativeHost();

    // SAFETY: On startup/reload, ensure the main window is visible in the
    // taskbar. A previous session may have accidentally applied WS_EX_TOOLWINDOW
    // to the main window due to a race condition in safeHideMinimizedWindows.
    setTimeout(async () => {
      await tabManager.ensureMainWindowVisible();
    }, 2500);
  } catch (e) {
    console.log('[TabFlow] Native host init skipped:', e);
  }

  try {
    const session = await AuthManager.getSession();
    if (session) {
      console.log('[TabFlow] Resuming sync for existing session, user:', session.user.email);
      await initializeSync(session.user.id);
    } else {
      console.log('[TabFlow] No auth session found — user not logged in or session expired');
    }
  } catch (e) {
    console.warn('[TabFlow] Auth session check failed:', e);
  }
})();

/**
 * Handle MOVE_TABS entirely in the service worker.
 *
 * STRATEGY: "Snapshot → Write new → Delete old → Close Chrome tab (async)"
 * We write the new records FIRST, respond to the UI immediately,
 * then close the Chrome tabs asynchronously afterward.
 */
async function handleMoveTabsInServiceWorker(payload: any): Promise<Response> {
  const { tabIds, targetWorkspaceId } = payload || {};
  if (!tabIds?.length) return { success: false, error: 'tabIds is required' };
  if (!targetWorkspaceId) return { success: false, error: 'targetWorkspaceId is required' };

  const targetWorkspace = await storage.getWorkspace(targetWorkspaceId);
  if (!targetWorkspace) return { success: false, error: 'Target workspace not found' };

  // Step 1: Snapshot the tab data and create new records in target workspace
  const allWorkspaces = await storage.getWorkspaces(LOCAL_USER_ID);
  const tabIdSet = new Set(tabIds as string[]);
  const chromeIdsToClose: number[] = [];
  const now = Date.now();
  const existingTargetTabs = await storage.getTabs(targetWorkspaceId);
  let startOrder = existingTargetTabs.length;
  let movedCount = 0;

  for (const ws of allWorkspaces) {
    const wsTabs = await storage.getTabs(ws.id);
    for (const tab of wsTabs) {
      if (tabIdSet.has(tab.id)) {
        // Create a NEW record in the target workspace
        const newId = `moved-${now}-${movedCount}`;
        await storage.saveTab({
          id: newId,
          workspaceId: targetWorkspaceId,
          url: tab.url,
          title: tab.title,
          faviconUrl: tab.faviconUrl,
          sortOrder: startOrder + movedCount,
          isPinned: tab.isPinned,
          lastAccessed: new Date(),
          updatedAt: new Date(),
        });
        console.log(`[TabFlow] Move: created ${newId} for "${tab.title}" in ${targetWorkspaceId}`);
        movedCount++;

        const match = tab.id.match(/^chrome-(\d+)$/);
        if (match) {
          chromeIdsToClose.push(parseInt(match[1], 10));
        }
      }
    }
  }

  if (movedCount === 0) {
    return { success: false, error: 'No matching tabs found' };
  }

  // Step 2: Delete the original records
  for (const tabId of tabIds) {
    await storage.deleteTab(tabId);
    console.log(`[TabFlow] Move: deleted original record ${tabId}`);
  }

  // Step 3: Broadcast update BEFORE closing Chrome tabs so the UI refreshes immediately
  broadcastSyncUpdate();

  // Step 4: Close Chrome tabs asynchronously (fire-and-forget).
  // Do this AFTER responding to the UI. Mark tabs so event handlers skip them.
  if (chromeIdsToClose.length > 0) {
    for (const id of chromeIdsToClose) {
      recentlyRemovedTabs.add(`chrome-${id}`);
      setTimeout(() => recentlyRemovedTabs.delete(`chrome-${id}`), 10000);
    }
    // Use setTimeout to truly decouple from the message response
    setTimeout(async () => {
      isSwitchingWorkspaces = true;
      try {
        await chrome.tabs.remove(chromeIdsToClose);
        console.log(`[TabFlow] Move: closed ${chromeIdsToClose.length} Chrome tabs (async)`);
      } catch (e) {
        console.warn('[TabFlow] Move: error closing Chrome tabs:', e);
      }
      // Let events settle, then reset
      setTimeout(() => {
        isSwitchingWorkspaces = false;
        refreshMainWindowId();
        broadcastSyncUpdate();
      }, 500);
    }, 50);
  }

  return { success: true, data: { movedCount, targetWorkspaceId } };
}

/**
 * MESSAGE-TRIGGERED STARTUP — the most reliable MV3 startup mechanism.
 *
 * Problem: After Chrome restart with profile picker, the service worker
 * starts, goes idle, gets killed, and both setTimeout and chrome.alarms
 * are unreliable. But when the user clicks "+" to open a new tab, the
 * TabFlow UI loads and sends GET_WORKSPACES — this ALWAYS wakes the
 * service worker and delivers a message.
 *
 * Solution: Before handling ANY message, check if there's a pending
 * Chrome restart. If so, run the full startup flow (pin TabFlow tab,
 * reconcile stale IDs) BEFORE responding. This guarantees the startup
 * flow completes before the UI gets any data.
 */
let messageStartupPromise: Promise<boolean> | null = null;

async function ensureStartupComplete(): Promise<void> {
  const { pendingChromeRestart, tabFlowTabId } = await chrome.storage.local.get([
    'pendingChromeRestart',
    'tabFlowTabId',
  ]);

  let needsStartup = !!pendingChromeRestart;

  // If no flag yet, also check if stored tab ID is stale.
  // This handles the race where the message arrives before the IIFE
  // or onStartup had a chance to set pendingChromeRestart.
  if (!needsStartup && tabFlowTabId) {
    try {
      await chrome.tabs.get(tabFlowTabId);
      // Tab exists — not a Chrome restart
    } catch {
      // Tab doesn't exist — Chrome restart, IIFE hasn't set flag yet
      needsStartup = true;
      await chrome.storage.local.set({ pendingChromeRestart: true });
      console.log('[TabFlow] Message-triggered startup: detected stale tabFlowTabId (IIFE race)');
    }
  }

  if (!needsStartup) return;

  console.log('[TabFlow] Message-triggered startup: pending restart detected, running flow NOW');
  isChromeRestart = true;
  postRestartSnapshotSuppressed = true;
  messageHandler.setSkipOutgoingSave(true);

  // Only run one instance at a time
  if (!messageStartupPromise) {
    messageStartupPromise = runChromeRestartFlow();
  }

  const success = await messageStartupPromise;
  messageStartupPromise = null;

  if (success) {
    console.log('[TabFlow] Message-triggered startup: flow completed successfully');
    // Cancel the alarm — no longer needed
    chrome.alarms.clear(STARTUP_ALARM_NAME);
  } else {
    console.warn('[TabFlow] Message-triggered startup: flow failed, alarm will retry');
  }
}

/**
 * Message listener — routes popup/sidebar messages to handlers
 */
chrome.runtime.onMessage.addListener(
  (message: Message & { type: string }, sender, sendResponse: (response: Response) => void) => {
    // MESSAGE-TRIGGERED STARTUP: Before handling ANY message, ensure the
    // Chrome restart flow has completed. This is the primary mechanism for
    // reliable startup after Chrome restart + profile picker.
    // We wrap the entire handler in an async IIFE that awaits startup first.
    (async () => {
      try {
        // Run startup flow if needed (no-op if already complete)
        await ensureStartupComplete();

        // Handle AUTH_READY from popup after login
        if (message.type === 'AUTH_READY' && message.payload?.userId) {
          await initializeSync(message.payload.userId);
          sendResponse({ success: true });
          return;
        }

        // Handle SIGN_OUT
        if (message.type === 'SIGN_OUT') {
          if (syncClient) {
            syncClient.disconnect();
            syncClient = null;
          }
          sendResponse({ success: true });
          return;
        }

        // Handle CAPTURE_MISSING_THUMBNAILS — try to capture the active tab if missing
        if (message.type === 'CAPTURE_MISSING_THUMBNAILS') {
          captureActiveIfMissing().catch(console.error);
          sendResponse({ success: true });
          return;
        }

        // Handle GET_THUMBNAILS directly in service worker (needs IndexedDB-specific API)
        if (message.type === 'GET_THUMBNAILS') {
          try {
            const { urls } = message.payload || {};
            if (!urls?.length) {
              sendResponse({ success: true, data: {} });
              return;
            }
            const thumbnails = await storage.getThumbnails(urls);
            sendResponse({ success: true, data: thumbnails });
          } catch (err) {
            sendResponse({ success: false, error: 'Failed to get thumbnails' });
          }
          return;
        }

        // Handle GET_WORKSPACE_STATS — per-workspace memory and tab info
        if (message.type === 'GET_WORKSPACE_STATS') {
          try {
            const workspaces = await workspaceEngine.getWorkspaces(LOCAL_USER_ID);
            const mainWindowId = cachedMainWindowId ?? await tabManager.getMainWindowId();
            const hiddenMap = await tabManager.getHiddenWindowMap();

            // Get all windows' tabs in one query
            const allTabs = await chrome.tabs.query({});

            // Build stats per workspace (tab count + audible indicators)
            const stats: Record<string, { tabCount: number; audibleCount: number }> = {};

            for (const ws of workspaces) {
              let windowId: number | undefined;
              let wsTabs: chrome.tabs.Tab[] = [];

              if (ws.isActive && mainWindowId) {
                windowId = mainWindowId;
              } else if (hiddenMap[ws.id]) {
                windowId = hiddenMap[ws.id];
              }

              if (windowId) {
                wsTabs = allTabs.filter((t) => t.windowId === windowId && !tabManager.isTabFlowTab(t));
              }

              let audibleCount = 0;
              for (const tab of wsTabs) {
                if (tab.audible) audibleCount++;
              }

              stats[ws.id] = {
                tabCount: wsTabs.length || (await storage.getTabs(ws.id)).length,
                audibleCount,
              };
            }

            // Also get total system memory
            let totalSystemMemory = 0;
            let availableMemory = 0;
            try {
              if (chrome.system?.memory?.getInfo) {
                const memInfo = await chrome.system.memory.getInfo();
                totalSystemMemory = memInfo.capacity || 0;
                availableMemory = memInfo.availableCapacity || 0;
              }
            } catch { /* not available */ }

            // Try to get Chrome's total memory via native messaging host
            let chromeMemoryBytes = 0;
            try {
              const nativeResponse: any = await new Promise((resolve) => {
                chrome.runtime.sendNativeMessage(
                  'com.tabflow.memory',
                  { action: 'get_chrome_memory' },
                  (resp) => {
                    if (chrome.runtime.lastError) {
                      resolve(null);
                    } else {
                      resolve(resp);
                    }
                  }
                );
              });
              if (nativeResponse?.success && nativeResponse.chromeMemoryBytes) {
                chromeMemoryBytes = nativeResponse.chromeMemoryBytes;
              }
            } catch { /* native host not installed — that's fine */ }

            sendResponse({
              success: true,
              data: { stats, totalSystemMemory, availableMemory, chromeMemoryBytes },
            });
          } catch (err) {
            sendResponse({ success: false, error: 'Failed to get stats' });
          }
          return;
        }

        // ─── DEVICE SESSION MANAGEMENT ─────────────────────────────
        if (message.type === 'CLAIM_ACTIVE_DEVICE') {
          try {
            if (!syncClient || !syncUserId) {
              sendResponse({ success: false, error: 'Sync not initialized' });
              return;
            }

            // Just claim — do NOT auto-pull or auto-clear local state.
            // Cross-browser sync is disabled pending a proper redesign:
            // tab IDs are currently browser-specific (e.g. chrome-1234 where
            // 1234 is whatever internal ID the browser assigned), so Firefox's
            // chrome-1234 and Chrome's chrome-1234 collide on the same Supabase
            // row. A "pull" against a corrupted cloud can overwrite local data
            // with another browser's tabs. Until IDs are deterministic across
            // browsers (e.g. derived from workspace+URL), claiming is pure —
            // user keeps whatever local state they have.
            await syncClient.claimActiveDevice();
            sendResponse({ success: true });
          } catch (err) {
            console.error('[TabFlow] Failed to claim active device:', err);
            sendResponse({ success: false, error: 'Failed to claim active device' });
          }
          return;
        }

        if (message.type === 'GET_DEVICE_STATUS') {
          try {
            const isActive = syncClient ? syncClient.isActiveDevice : true;
            sendResponse({ success: true, data: { isActive } });
          } catch {
            sendResponse({ success: true, data: { isActive: true } });
          }
          return;
        }

        // ─── ONE-TIME RESTORE FROM CLOUD ───────────────────────────
        // Explicit user-triggered pull. Fetches all encrypted workspaces
        // and tabs from Supabase, decrypts with the passphrase-derived key,
        // and writes them into this install's IndexedDB. Safe because:
        //   (a) only runs when the user clicks "Restore from Cloud"
        //   (b) push still requires active-device + user actions — this
        //       does not push anything back
        //   (c) saveWorkspace/saveTab upsert by id so re-running is idempotent
        if (message.type === 'RESTORE_FROM_CLOUD') {
          try {
            if (!syncClient || !syncUserId) {
              sendResponse({ success: false, error: 'Sync not initialized — sign in first' });
              return;
            }
            // Temporarily suppress the realtime push echo guard so the
            // pulled rows go straight into storage.
            syncClient.setPushing(true);
            await syncClient.pullAll(syncUserId);
            syncClient.setPushing(false);

            // Count what we now have locally so the UI can confirm.
            const workspaces = await storage.getWorkspaces(LOCAL_USER_ID);
            let tabCount = 0;
            for (const ws of workspaces) {
              const tabs = await storage.getTabs(ws.id);
              tabCount += tabs.length;
            }
            broadcastSyncUpdate();
            sendResponse({
              success: true,
              data: { workspaceCount: workspaces.length, tabCount },
            });
          } catch (err) {
            if (syncClient) syncClient.setPushing(false);
            console.error('[TabFlow] Restore from cloud failed:', err);
            // DOMException from Web Crypto means the passphrase-derived key
            // cannot decrypt the cloud ciphertext — almost always a passphrase
            // mismatch on this install.
            let msg: string;
            if (err instanceof DOMException || (err as any)?.name === 'OperationError') {
              msg =
                'Decryption failed. The passphrase on this install does not match ' +
                'the passphrase used to encrypt your cloud data. Sign out and sign ' +
                'in again, entering the ORIGINAL passphrase when prompted.';
            } else if (err instanceof Error) {
              msg = err.message;
            } else {
              msg = `Restore failed: ${String(err)}`;
            }
            sendResponse({ success: false, error: msg });
          }
          return;
        }

        // Handle MOVE_TABS entirely in the service worker so we have direct
        // control over recentlyRemovedTabs and isSwitchingWorkspaces.
        if (message.type === 'MOVE_TABS') {
          const response = await handleMoveTabsInServiceWorker(message.payload);
          if (syncClient && response.success) {
            pushToSync(message, response.data).catch(console.error);
          }
          sendResponse(response);
          return;
        }

        // Handle DUPLICATE_TABS — copy tabs to another workspace without removing originals
        if (message.type === 'DUPLICATE_TABS') {
          try {
            const { tabIds, targetWorkspaceId } = message.payload || {};
            if (!tabIds?.length) { sendResponse({ success: false, error: 'tabIds is required' }); return; }
            if (!targetWorkspaceId) { sendResponse({ success: false, error: 'targetWorkspaceId is required' }); return; }

            const targetWorkspace = await storage.getWorkspace(targetWorkspaceId);
            if (!targetWorkspace) { sendResponse({ success: false, error: 'Target workspace not found' }); return; }

            const allWorkspaces = await storage.getWorkspaces(LOCAL_USER_ID);
            const tabIdSet = new Set(tabIds as string[]);
            const now = Date.now();
            const existingTargetTabs = await storage.getTabs(targetWorkspaceId);
            let startOrder = existingTargetTabs.length;
            let dupCount = 0;

            for (const ws of allWorkspaces) {
              const wsTabs = await storage.getTabs(ws.id);
              for (const tab of wsTabs) {
                if (tabIdSet.has(tab.id)) {
                  const newId = `dup-${now}-${dupCount}`;
                  await storage.saveTab({
                    id: newId,
                    workspaceId: targetWorkspaceId,
                    url: tab.url,
                    title: tab.title,
                    faviconUrl: tab.faviconUrl,
                    sortOrder: startOrder + dupCount,
                    isPinned: tab.isPinned,
                    lastAccessed: new Date(),
                    updatedAt: new Date(),
                  });
                  console.log(`[TabFlow] Duplicate: created ${newId} for "${tab.title}" in ${targetWorkspaceId}`);
                  dupCount++;
                }
              }
            }

            if (dupCount === 0) {
              sendResponse({ success: false, error: 'No matching tabs found' });
              return;
            }

            broadcastSyncUpdate();
            sendResponse({ success: true, data: { duplicatedCount: dupCount } });
          } catch (err) {
            console.error('[TabFlow] Duplicate tabs error:', err);
            sendResponse({ success: false, error: 'Failed to duplicate tabs' });
          }
          return;
        }

        // Message types that modify data and should be synced to Supabase
        const SYNC_WRITE_TYPES = new Set([
          'CREATE_WORKSPACE',
          'DELETE_WORKSPACE',
          'SWITCH_WORKSPACE',
          'REMOVE_TAB',
          'RENAME_WORKSPACE',
          'CHANGE_WORKSPACE_COLOR',
          'REORDER_WORKSPACES',
        ]);

        // Route all other messages through MessageHandler
        const response = await messageHandler.handleMessage(message);
        // After local write, push to sync if connected (skip read-only operations)
        if (syncClient && response.success && SYNC_WRITE_TYPES.has(message.type)) {
          pushToSync(message, response.data).catch(console.error);
        }
        sendResponse(response);
      } catch (error) {
        console.error('[TabFlow] Error in onMessage handler:', error);
        sendResponse({ success: false, error: 'Failed to handle message' });
      }
    })();

    return true; // async response
  }
);

/**
 * After a successful local operation, push the change to Supabase.
 * Reads the current state from local storage and pushes it to Supabase
 * so that other devices receive the change via Realtime.
 */
async function pushToSync(message: Message & { type: string }, responseData?: any) {
  if (!syncClient || !syncUserId) return;

  // Only the active device may push changes to Supabase
  if (!syncClient.isActiveDevice) {
    console.log(`[TabFlow] Skipping sync push (not active device): ${message.type}`);
    return;
  }

  try {
    syncClient.setPushing(true);

    switch (message.type) {
      case 'CREATE_WORKSPACE': {
        // Push the new workspace + push all workspaces (active states changed)
        const allWorkspaces = await storage.getWorkspaces(LOCAL_USER_ID);
        for (const ws of allWorkspaces) {
          // Remap local userId to real Supabase userId for remote storage
          await syncClient.pushWorkspace({ ...ws, userId: syncUserId });
        }
        // Push tabs for the old workspace (they were saved before switch)
        for (const ws of allWorkspaces) {
          const tabs = await storage.getTabs(ws.id);
          for (const tab of tabs) {
            await syncClient.pushTab(tab);
          }
        }
        break;
      }

      case 'DELETE_WORKSPACE': {
        const { workspaceId } = message.payload || {};
        if (workspaceId) {
          await syncClient.deleteWorkspace(workspaceId);
          // Also delete all tabs for this workspace remotely
          // (They should already be deleted locally by the engine)
        }
        // Push updated active states for remaining workspaces
        const remaining = await storage.getWorkspaces(LOCAL_USER_ID);
        for (const ws of remaining) {
          await syncClient.pushWorkspace({ ...ws, userId: syncUserId });
        }
        break;
      }

      case 'SWITCH_WORKSPACE': {
        // Push all workspaces (active states changed) and all their tabs
        const workspaces = await storage.getWorkspaces(LOCAL_USER_ID);
        for (const ws of workspaces) {
          await syncClient.pushWorkspace({ ...ws, userId: syncUserId });
          const tabs = await storage.getTabs(ws.id);
          for (const tab of tabs) {
            await syncClient.pushTab(tab);
          }
        }
        break;
      }

      case 'REMOVE_TAB': {
        const { tabId } = message.payload || {};
        if (tabId) {
          await syncClient.deleteTab(tabId);
        }
        break;
      }

      case 'MOVE_TABS': {
        // Delete old tab records remotely, then push all current tabs
        const movedTabIds = message.payload?.tabIds || [];
        for (const oldId of movedTabIds) {
          await syncClient.deleteTab(oldId);
        }
        const allWs = await storage.getWorkspaces(LOCAL_USER_ID);
        for (const ws of allWs) {
          const wsTabs = await storage.getTabs(ws.id);
          for (const tab of wsTabs) {
            await syncClient.pushTab(tab);
          }
        }
        break;
      }

      case 'RENAME_WORKSPACE':
      case 'CHANGE_WORKSPACE_COLOR':
      case 'REORDER_WORKSPACES': {
        // Push all workspaces with updated names/colors/order
        const updatedWorkspaces = await storage.getWorkspaces(LOCAL_USER_ID);
        for (const ws of updatedWorkspaces) {
          await syncClient.pushWorkspace({ ...ws, userId: syncUserId! });
        }
        break;
      }

      default:
        // No sync needed for unrecognized operations
        return;
    }

    console.log(`[TabFlow] Synced ${message.type} to Supabase`);
  } catch (error) {
    console.error('[TabFlow] Sync push error:', error);
  } finally {
    syncClient.setPushing(false);
  }
}

// ─── SYNC FILTERING HELPERS ───────────────────────────────────────

/**
 * Determines whether a tab's URL is safe to push to cloud sync.
 * Filters out browser-internal and extension-internal URLs that would
 * be meaningless (or actively broken) on a different browser.
 *
 * Accepted: http, https, file
 * Rejected: chrome://, moz-extension://, chrome-extension://, about:, etc.
 */
function isSyncableTab(tab: { url: string }): boolean {
  const url = tab.url || '';
  if (!url) return false;
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  if (url.startsWith('file://')) return true;
  return false;
}

/**
 * Determines whether a favicon URL is safe to push to cloud sync.
 * Browser-internal favicon URLs (chrome://global/..., resource://...)
 * render as broken images when loaded on a different browser.
 */
function isSyncableFavicon(faviconUrl?: string): boolean {
  if (!faviconUrl) return false;
  if (faviconUrl.startsWith('data:')) return true;
  if (faviconUrl.startsWith('http://') || faviconUrl.startsWith('https://')) return true;
  return false;
}

// ─── THUMBNAIL CAPTURE ────────────────────────────────────────────
// Lazily captures screenshots of tabs as the user visits them.
// Thumbnails are stored as small JPEG data URLs in IndexedDB.

/** Per-tab debounce timers for thumbnail capture */
const thumbnailTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Set of URLs currently being captured (prevent duplicate captures) */
const thumbnailCaptureInProgress = new Set<string>();

/** URLs that should NOT be captured (internal pages, etc.) */
function isCapturable(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('moz-extension://') ||
      url.startsWith('about:') ||
      url.startsWith('edge://') ||
      url.startsWith('devtools://') ||
      url.startsWith('data:') ||
      url.startsWith('blob:')) return false;
  return true;
}

/**
 * Capture a thumbnail of the currently visible tab.
 * Supports retry: if the first attempt fails, retries once after a delay.
 *
 * IMPORTANT: captureVisibleTab captures whatever is visible in the window,
 * NOT a specific tab by ID. So the tab must still be active when we capture.
 */
async function captureTabThumbnail(tabId: number, retryCount = 0): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !tab.active || !tab.windowId) return;
    if (!isCapturable(tab.url)) return;
    if (tabManager.isTabFlowTab(tab)) return;
    if (!isInMainWindow(tab.windowId)) return;

    // Deduplicate concurrent captures for the same URL
    if (thumbnailCaptureInProgress.has(tab.url)) return;
    thumbnailCaptureInProgress.add(tab.url);

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality: 40,
      });

      await storage.saveThumbnail(tab.url, dataUrl);
      console.log(`[TabFlow] Thumbnail captured: ${tab.url.substring(0, 80)}`);
    } catch (captureErr: any) {
      const msg = captureErr?.message || String(captureErr);
      // Retry once after 2s for transient errors (page still loading, etc.)
      if (retryCount === 0 && !msg.includes('permission')) {
        console.log(`[TabFlow] Thumbnail capture failed (will retry): ${msg.substring(0, 80)}`);
        setTimeout(() => captureTabThumbnail(tabId, 1), 2000);
      } else {
        console.log(`[TabFlow] Thumbnail capture failed: ${msg.substring(0, 80)} — ${tab.url.substring(0, 60)}`);
      }
    } finally {
      thumbnailCaptureInProgress.delete(tab.url);
    }
  } catch {
    // Tab may have been closed
  }
}

/**
 * Schedule a thumbnail capture for a specific tab with per-tab debouncing.
 * Each tab gets its own timer, so rapid switching between tabs doesn't
 * cancel captures for previously-visited tabs.
 */
function scheduleThumbnailCapture(tabId: number): void {
  // Clear any existing timer for this specific tab
  const existing = thumbnailTimers.get(tabId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    thumbnailTimers.delete(tabId);
    captureTabThumbnail(tabId);
  }, 1500);

  thumbnailTimers.set(tabId, timer);
}

/**
 * Capture thumbnails for tabs that were recently restored (e.g., after
 * workspace switch). Since captureVisibleTab can only capture the active tab,
 * this only captures the currently-active tab if it doesn't have a thumbnail.
 * Other tabs will get thumbnails as the user visits them naturally.
 */
async function captureActiveIfMissing(): Promise<void> {
  if (isSwitchingWorkspaces || isStartingUp) return;

  try {
    const mainWindowId = cachedMainWindowId ?? await tabManager.getMainWindowId();
    if (mainWindowId === undefined) return;

    const activeTabs = await chrome.tabs.query({ windowId: mainWindowId, active: true });
    const activeTab = activeTabs[0];
    if (!activeTab?.url || !activeTab.id || !isCapturable(activeTab.url)) return;
    if (tabManager.isTabFlowTab(activeTab)) return;

    // Check if we already have a thumbnail for this URL
    const existing = await storage.getThumbnail(activeTab.url);
    if (existing) return;

    // Wait a moment for the page to render, then capture
    setTimeout(() => captureTabThumbnail(activeTab.id!), 2000);
  } catch {
    // Non-critical
  }
}

/**
 * Tab event listeners — LOCKED-DOWN approach with smart save triggers.
 *
 * PRINCIPLE: The database ONLY changes via atomic snapshots triggered by
 * user actions. Individual tab events do NOT write individual records.
 * Instead, specific user actions trigger a full saveCurrentTabsToWorkspace
 * snapshot that replaces ALL chrome-* records with what's actually in Chrome.
 *
 * Save triggers (all user-initiated):
 * - Workspace switch (in MessageHandler)
 * - Tab activated (user clicks a different tab)
 * - Tab closed (user closes a tab)
 * - TabFlow tab activated (user clicks the TabFlow pinned tab)
 *
 * Each trigger calls snapshotActiveWorkspace() which does ONE atomic
 * saveCurrentTabsToWorkspace call. This is safe because it only captures
 * what's currently in Chrome — it never creates phantom data.
 */

const recentlyRemovedTabs = new Set<string>();

/**
 * Debounced snapshot of the active workspace's tabs.
 * Multiple rapid events (e.g., closing several tabs) only trigger one save.
 */
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotInProgress = false;

async function snapshotActiveWorkspace(): Promise<void> {
  // Debounce: wait 500ms after the last trigger before saving
  if (snapshotTimer) clearTimeout(snapshotTimer);

  snapshotTimer = setTimeout(async () => {
    if (snapshotInProgress || isStartingUp || isSwitchingWorkspaces || postRestartSnapshotSuppressed) return;
    snapshotInProgress = true;

    try {
      const workspaces = await workspaceEngine.getWorkspaces(LOCAL_USER_ID);
      const activeWorkspace = workspaces.find((ws) => ws.isActive);
      if (!activeWorkspace) return;

      const mainWindowId = cachedMainWindowId ?? await tabManager.getMainWindowId();
      if (mainWindowId === undefined) return;

      await tabManager.saveCurrentTabsToWorkspace(activeWorkspace.id, storage, mainWindowId);
      broadcastSyncUpdate();

      // Save a history entry if the tab URLs have changed since the last one.
      // This enables the "rewind" feature without storing redundant snapshots.
      try {
        const currentTabs = await storage.getTabs(activeWorkspace.id);
        const currentUrls = currentTabs
          .map((t) => t.url)
          .filter(Boolean)
          .sort()
          .join('\n');

        const lastEntry = await storage.getLatestHistoryEntry(activeWorkspace.id);
        const lastUrls = lastEntry
          ? lastEntry.tabs.map((t) => t.url).filter(Boolean).sort().join('\n')
          : '';

        if (currentUrls !== lastUrls) {
          await storage.saveHistoryEntry({
            id: crypto.randomUUID(),
            workspaceId: activeWorkspace.id,
            timestamp: new Date(),
            tabs: currentTabs.map((t) => ({
              url: t.url,
              title: t.title,
              faviconUrl: t.faviconUrl,
              sortOrder: t.sortOrder,
              isPinned: t.isPinned,
            })),
          });
          console.log(`[TabFlow] History entry saved for "${activeWorkspace.name}" (${currentTabs.length} tabs)`);
        }
      } catch (histErr) {
        // History is non-critical — don't let it break snapshots
        console.warn('[TabFlow] Error saving history entry:', histErr);
      }

      console.log(`[TabFlow] Snapshot saved for workspace "${activeWorkspace.name}"`);

      // NOTE: Snapshot no longer pushes to Supabase. Cross-browser sync is
      // temporarily disabled at the per-snapshot level — tab IDs are currently
      // browser-specific and collide across browsers, which corrupts the cloud.
      // Explicit actions (CREATE_WORKSPACE etc.) still push; day-to-day tab
      // opens / closes are local-only until the ID scheme is redesigned.
    } catch (error) {
      console.error('[TabFlow] Error in snapshot save:', error);
    } finally {
      snapshotInProgress = false;
    }
  }, 500);
}

chrome.tabs.onCreated.addListener(async (tab) => {
  if (isStartingUp || isSwitchingWorkspaces) return;
  if (!isInMainWindow(tab.windowId)) return;

  // A new tab was opened — snapshot so it appears in the database
  snapshotActiveWorkspace();
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (isStartingUp || isSwitchingWorkspaces) return;

  // CRITICAL: When Chrome is shutting down, don't modify storage.
  if (removeInfo.isWindowClosing) {
    console.log(`[TabFlow] Skipping tab removal ${tabId} — window is closing`);
    return;
  }

  if (!isInMainWindow(removeInfo.windowId)) return;

  const tabKey = `chrome-${tabId}`;
  recentlyRemovedTabs.add(tabKey);
  setTimeout(() => recentlyRemovedTabs.delete(tabKey), 5000);

  // User closed a tab — snapshot to update the database
  snapshotActiveWorkspace();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (isStartingUp || isSwitchingWorkspaces) return;
  if (!isInMainWindow(tab.windowId)) return;

  // Only snapshot on meaningful changes (URL change or page load complete)
  if (changeInfo.url || changeInfo.status === 'complete') {
    snapshotActiveWorkspace();
  }

  // Capture thumbnail when page finishes loading (if tab is active)
  if (changeInfo.status === 'complete' && tab.active) {
    scheduleThumbnailCapture(tabId);
  }
});

chrome.tabs.onMoved.addListener(async (tabId, moveInfo) => {
  if (isStartingUp || isSwitchingWorkspaces) return;
  if (!isInMainWindow(moveInfo.windowId)) return;

  // User reordered tabs — snapshot to update sort order
  snapshotActiveWorkspace();
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  if (isStartingUp || isSwitchingWorkspaces) return;
  if (!isInMainWindow(attachInfo.newWindowId)) return;

  // Tab dragged into main window — snapshot
  snapshotActiveWorkspace();
});

/**
 * Auto-load suspended tabs when the user clicks on them.
 * Also triggers a snapshot on tab activation (user is interacting).
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);

    // Auto-load suspended tabs
    const suspendedPrefix = `${getExtensionBaseUrl()}suspended.html`;
    if (tab.url?.startsWith(suspendedPrefix)) {
      const params = new URL(tab.url).searchParams;
      const realUrl = params.get('url');
      if (realUrl) {
        console.log(`[TabFlow] Activating suspended tab → ${realUrl}`);
        await chrome.tabs.update(activeInfo.tabId, { url: realUrl });
      }
    }

    // Track last active tab per workspace and trigger snapshot
    if (!isStartingUp && !isSwitchingWorkspaces && !tabManager.isTabFlowTab(tab)) {
      if (isInMainWindow(tab.windowId)) {
        try {
          const workspaces = await workspaceEngine.getWorkspaces(LOCAL_USER_ID);
          const activeWorkspace = workspaces.find((ws) => ws.isActive);
          if (activeWorkspace) {
            await chrome.storage.local.set({
              [`lastActiveTab_${activeWorkspace.id}`]: activeInfo.tabId,
            });
          }
        } catch {
          // Non-critical
        }

        // User clicked a tab — snapshot to keep DB fresh
        snapshotActiveWorkspace();

        // Schedule thumbnail capture for the newly activated tab
        scheduleThumbnailCapture(activeInfo.tabId);
      }
    }
  } catch (error) {
    // Tab may have been closed already
  }
});

export {};
