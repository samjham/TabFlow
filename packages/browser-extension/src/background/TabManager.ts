/**
 * Chrome Tabs API integration layer for TabFlow
 * Provides a wrapper around Chrome's tabs and tabGroups APIs
 *
 * Tracks ALL tabs in each workspace — http, https, chrome://, etc.
 * Only the TabFlow pinned tab itself and truly empty pages are excluded.
 *
 * WORKSPACE MODEL:
 * Active workspace tabs live in the main Chrome window.
 * Inactive workspace tabs are moved to minimized hidden windows.
 * This preserves full tab state (video playback, scroll, forms).
 */

import { Tab } from '@tabflow/core';
import { NativeHostClient } from './NativeHostClient';
import { getExtensionBaseUrl } from '../browser-compat';

/** URLs that should never be saved as workspace tabs */
const EXCLUDED_URL_PREFIXES = [
  'about:blank',
  'chrome://newtab',
];

/**
 * TabManager class handles all interactions with the Chrome tabs API
 * Converts between Chrome's native tab format and TabFlow's internal Tab model
 */
export class TabManager {
  private nativeHost: NativeHostClient;
  private nativeHostAvailable: boolean | null = null; // null = not yet checked

  /**
   * Cached TabFlow tab ID. This is the MOST RELIABLE way to identify
   * the TabFlow tab, because tab.url can be chrome://newtab/ instead
   * of the extension URL after restarts. Set by ensureTabFlowTab() in
   * the service worker and persisted in chrome.storage.local.
   */
  private cachedTabFlowTabId: number | undefined = undefined;

  constructor() {
    this.nativeHost = new NativeHostClient();
    // Load the cached tab ID from storage (async, but isTabFlowTab
    // has a fallback if the cache isn't ready yet)
    chrome.storage.local.get('tabFlowTabId').then((stored) => {
      if (stored.tabFlowTabId) {
        this.cachedTabFlowTabId = stored.tabFlowTabId;
        console.log(`[TabFlow] TabManager loaded cached TabFlow tab ID: ${this.cachedTabFlowTabId}`);
      }
    }).catch(() => {});
  }

  /**
   * Ensures the main Chrome window is visible in the Windows taskbar.
   * Calls showWindow on the native host with the active tab's title.
   * No-op if the native host isn't available or the window is already visible.
   * Call this on startup to undo any WS_EX_TOOLWINDOW that was accidentally
   * applied to the main window during a previous session.
   */
  async ensureMainWindowVisible(): Promise<void> {
    if (!this.nativeHostAvailable) return;
    try {
      const mainWindowId = await this.getMainWindowId();
      if (mainWindowId === undefined) return;

      const mainTabs = await chrome.tabs.query({ windowId: mainWindowId, active: true });
      if (mainTabs.length > 0 && mainTabs[0].title) {
        await this.nativeHost.showWindow(mainTabs[0].title);
        console.log('[TabFlow] Ensured main window is visible in taskbar');
      }
    } catch (e) {
      // Non-critical
    }
  }

  /** Called by ensureTabFlowTab to keep the cached ID in sync */
  setTabFlowTabId(tabId: number): void {
    this.cachedTabFlowTabId = tabId;
    console.log(`[TabFlow] TabManager cached TabFlow tab ID updated: ${tabId}`);
  }

  getTabFlowTabId(): number | undefined {
    return this.cachedTabFlowTabId;
  }

  /**
   * Close the hidden window for a given workspace and remove it from the map.
   */
  async closeHiddenWindow(workspaceId: string): Promise<void> {
    const map = await this.getHiddenWindowMap();
    const hiddenWindowId = map[workspaceId];
    if (!hiddenWindowId) return;

    try {
      await chrome.windows.remove(hiddenWindowId);
      console.log(`[TabFlow] Closed hidden window ${hiddenWindowId} for workspace ${workspaceId}`);
    } catch {
      // Window may already be gone
    }

    delete map[workspaceId];
    await this.setHiddenWindowMap(map);
  }

  /**
   * Close ALL hidden windows and clear the map entirely.
   * Used during emergency cleanup to eliminate all hidden tabs.
   */
  async closeAllHiddenWindows(): Promise<void> {
    const map = await this.getHiddenWindowMap();
    for (const [workspaceId, windowId] of Object.entries(map)) {
      try {
        await chrome.windows.remove(windowId);
        console.log(`[TabFlow] Closed hidden window ${windowId} for workspace ${workspaceId}`);
      } catch {
        // Window may already be gone
      }
    }
    await this.setHiddenWindowMap({});
    console.log('[TabFlow] All hidden windows closed and map cleared');
  }

  /**
   * Connects to the native host and checks availability.
   * Called once on startup. If the host isn't installed, all native
   * calls gracefully degrade (hidden windows still work, just visible in taskbar).
   */
  async initNativeHost(): Promise<boolean> {
    try {
      this.nativeHost.connect();
      this.nativeHostAvailable = await this.nativeHost.ping();
      if (this.nativeHostAvailable) {
        console.log('[TabFlow] Native host available — taskbar hiding enabled');
      } else {
        console.log('[TabFlow] Native host not available — taskbar hiding disabled');
      }
    } catch {
      this.nativeHostAvailable = false;
      console.log('[TabFlow] Native host not installed — taskbar hiding disabled');
    }
    return this.nativeHostAvailable;
  }

  /**
   * Checks if a URL should be tracked as a workspace tab.
   */
  isTrackableUrl(url: string): boolean {
    if (!url) return false;
    if (this.isSuspendedUrl(url)) return true;
    if (url.startsWith(getExtensionBaseUrl())) return false;
    for (const prefix of EXCLUDED_URL_PREFIXES) {
      if (url.startsWith(prefix)) return false;
    }
    return true;
  }

  /** Checks if a URL is a TabFlow suspended tab */
  isSuspendedUrl(url: string): boolean {
    return url.startsWith(`${getExtensionBaseUrl()}suspended.html`);
  }

  /** Extracts the real URL from a suspended tab URL */
  getRealUrl(url: string): string {
    if (!this.isSuspendedUrl(url)) return url;
    try {
      const params = new URL(url).searchParams;
      return params.get('url') || url;
    } catch {
      return url;
    }
  }

  /** Converts a Chrome tab to a TabFlow Tab model */
  private chromeTabToTab(chromeTab: chrome.tabs.Tab, workspaceId: string): Tab {
    const rawUrl = chromeTab.url || '';
    const isSuspended = this.isSuspendedUrl(rawUrl);
    let url = rawUrl;
    let title = chromeTab.title || 'Untitled Tab';
    let faviconUrl = chromeTab.favIconUrl;

    if (isSuspended) {
      try {
        const params = new URL(rawUrl).searchParams;
        url = params.get('url') || rawUrl;
        title = params.get('title') || title;
        faviconUrl = params.get('favicon') || faviconUrl;
      } catch {
        // Keep original values
      }
    }

    return {
      id: `chrome-${chromeTab.id}`,
      workspaceId,
      url,
      title,
      faviconUrl,
      sortOrder: chromeTab.index ?? 0,
      isPinned: chromeTab.pinned || false,
      lastAccessed: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Gets trackable tabs in a specific window or the current window.
   *
   * IMPORTANT: When called from a service worker during workspace switches,
   * always pass an explicit windowId. Using { currentWindow: true } in a
   * service worker means "last focused window" which can be WRONG during
   * the window shuffling of a workspace switch.
   *
   * @param windowId Explicit window ID to query. If omitted, uses currentWindow.
   */
  async getCurrentWindowTabs(windowId?: number): Promise<Tab[]> {
    try {
      const query = windowId !== undefined
        ? { windowId }
        : { currentWindow: true as const };
      const chromeTabs = await chrome.tabs.query(query);
      const trackableTabs = chromeTabs.filter(
        (tab) => this.isTrackableUrl(tab.url || '')
      );

      return trackableTabs.map((chromeTab, index) => {
        const tab = this.chromeTabToTab(chromeTab, '');
        tab.sortOrder = chromeTab.index ?? index;
        return tab;
      });
    } catch (error) {
      console.error('[TabFlow] Error getting current window tabs:', error);
      return [];
    }
  }

  /** Alias for getCurrentWindowTabs */
  async getCurrentTabs(): Promise<Tab[]> {
    return this.getCurrentWindowTabs();
  }

  /**
   * Saves all current browser tabs to a workspace in storage.
   *
   * REPLACE chrome-* records, PRESERVE moved-* records.
   * - Deletes old chrome-* records (stale IDs from previous switches)
   * - Saves fresh chrome-* records from current Chrome tabs
   * - Never touches moved-* records (tabs moved from other workspaces
   *   that haven't been materialized as Chrome tabs yet)
   *
   * This prevents duplication (old stale chrome-* records accumulating)
   * while preserving cross-workspace moves.
   */
  async saveCurrentTabsToWorkspace(workspaceId: string, storage: any, windowId?: number): Promise<void> {
    try {
      console.log(`[TabFlow] Saving current tabs to workspace ${workspaceId} (window: ${windowId ?? 'current'})`);

      const currentTabs = await this.getCurrentWindowTabs(windowId);

      if (currentTabs.length === 0) {
        console.log(`[TabFlow] No trackable tabs found — keeping existing records for workspace ${workspaceId}`);
        return;
      }

      // SAFETY: If Chrome reports an unreasonable number of tabs, something is wrong.
      // Only save up to MAX_RESTORE_TABS to prevent database corruption.
      if (currentTabs.length > TabManager.MAX_RESTORE_TABS) {
        console.warn(`[TabFlow] SAFETY CAP: ${currentTabs.length} tabs in window, only saving first ${TabManager.MAX_RESTORE_TABS}`);
        currentTabs.splice(TabManager.MAX_RESTORE_TABS);
      }

      // Step 1: Delete old chrome-* and restart-* records for this workspace.
      // When we have actual Chrome tabs open, they are the complete
      // source of truth for chrome-* prefixes. However, moved-* and dup-*
      // records represent tabs from other workspaces that may not have
      // been materialized as Chrome tabs yet — preserve those.
      const existingTabs = await storage.getTabs(workspaceId);
      let deleted = 0;
      for (const tab of existingTabs) {
        if (tab.id.startsWith('moved-') || tab.id.startsWith('dup-')) {
          // Preserve — they'll be materialized as Chrome tabs on the
          // next workspace switch or restore
          continue;
        }
        await storage.deleteTab(tab.id);
        deleted++;
      }

      // Step 2: Save fresh chrome-* records from current Chrome tabs
      let saved = 0;
      for (let i = 0; i < currentTabs.length; i++) {
        const tab = { ...currentTabs[i], workspaceId, sortOrder: i };
        await storage.saveTab(tab);
        saved++;
      }

      const preservedPending = existingTabs.filter((t) => t.id.startsWith('moved-') || t.id.startsWith('dup-')).length;
      console.log(`[TabFlow] Saved ${saved} tabs to workspace ${workspaceId} (replaced ${deleted} old records, preserved ${preservedPending} pending records)`);
    } catch (error) {
      console.error('[TabFlow] Error saving tabs to workspace:', error);
    }
  }

  /** Checks if a Chrome tab is the pinned TabFlow tab.
   *
   * Uses the cached tab ID as PRIMARY detection (most reliable).
   * Falls back to URL and position checks when the cache isn't ready.
   * Getting this wrong means moveTabsToHiddenWindow moves the TabFlow
   * tab to the hidden window, leaving the main window empty → Chrome closes.
   */
  isTabFlowTab(tab: chrome.tabs.Tab): boolean {
    // Strategy 1: Cached tab ID (most reliable — works regardless of URL)
    if (this.cachedTabFlowTabId !== undefined && tab.id === this.cachedTabFlowTabId) {
      return true;
    }

    const url = tab.url || '';

    // Strategy 2: Check by extension URL
    if (url && !this.isSuspendedUrl(url)) {
      if (url.startsWith(getExtensionBaseUrl())) return true;
    }

    // Strategy 3: Check by pendingUrl (during navigation)
    const pendingUrl = (tab as any).pendingUrl || '';
    if (pendingUrl && pendingUrl.startsWith(getExtensionBaseUrl())) {
      return true;
    }

    // Strategy 4: Pinned tab at index 0 — always assumed to be TabFlow
    if (tab.pinned && tab.index === 0) {
      return true;
    }

    return false;
  }

  /**
   * Closes all tabs in the current window EXCEPT the TabFlow pinned tab.
   * SAFETY: If closing all tabs would leave the window empty (and Chrome
   * would close the window), creates a blank tab first to keep it alive.
   */
  async closeAllTabs(): Promise<void> {
    try {
      const chromeTabs = await chrome.tabs.query({ currentWindow: true });

      const closeableTabs = chromeTabs.filter(
        (tab) => !this.isTabFlowTab(tab)
      );

      if (closeableTabs.length === 0) {
        console.log('[TabFlow] No tabs to close');
        return;
      }

      // CRITICAL SAFETY CHECK: If ALL tabs are closeable (i.e., the TabFlow
      // tab wasn't found — maybe it hasn't loaded yet), create a blank tab
      // first so Chrome doesn't close the entire window.
      if (closeableTabs.length === chromeTabs.length) {
        console.log('[TabFlow] Creating safety blank tab before closing all tabs to prevent window closure');
        // Use explicit windowId from any existing tab to avoid "No current window"
        const windowId = chromeTabs[0]?.windowId;
        await chrome.tabs.create({ url: 'about:blank', active: false, ...(windowId ? { windowId } : {}) });
      }

      const tabIdsToClose = closeableTabs.map((tab) => tab.id!).filter((id) => id !== undefined);
      if (tabIdsToClose.length > 0) {
        await chrome.tabs.remove(tabIdsToClose);
        console.log(`[TabFlow] Closed ${tabIdsToClose.length} tabs`);
      }
    } catch (error) {
      console.error('[TabFlow] Error closing all tabs:', error);
    }
  }

  /** Builds a suspended tab URL */
  private buildSuspendedUrl(tab: Tab): string {
    const params = new URLSearchParams();
    params.set('url', tab.url);
    params.set('title', tab.title || 'Untitled');
    if (tab.faviconUrl) {
      params.set('favicon', tab.faviconUrl);
    }
    return `${getExtensionBaseUrl()}suspended.html?${params.toString()}`;
  }

  /**
   * Opens tabs in SUSPENDED state and remaps IDs in storage.
   * Fallback for when no hidden window exists (e.g., after browser restart).
   *
   * @param tabs The tabs to restore
   * @param storageAdapter Optional storage adapter for remapping tab IDs
   * @param targetWindowId The window to create tabs in. MUST be provided by
   *   the caller (captured before any tab moves) to avoid "No current window" errors.
   */
  /**
   * Maximum number of tabs to restore at once. Prevents runaway tab creation
   * from corrupted database records. If a workspace has more than this many
   * stored tabs, only the first MAX are restored and the rest are skipped.
   */
  static readonly MAX_RESTORE_TABS = 30;

  async restoreWorkspaceTabs(tabs: Tab[], storageAdapter?: any, targetWindowId?: number): Promise<void> {
    try {
      if (tabs.length === 0) {
        console.log('[TabFlow] No tabs to restore, TabFlow tab will remain open');
        return;
      }

      // SAFETY CAP: Never restore more than MAX_RESTORE_TABS at once.
      if (tabs.length > TabManager.MAX_RESTORE_TABS) {
        console.warn(`[TabFlow] SAFETY CAP: workspace has ${tabs.length} tabs, only restoring first ${TabManager.MAX_RESTORE_TABS}`);
        tabs = tabs.slice(0, TabManager.MAX_RESTORE_TABS);
      }

      // Use the provided window ID, or try to find the main window as fallback
      let windowId = targetWindowId;
      if (windowId === undefined) {
        windowId = await this.getMainWindowId();
      }
      if (windowId === undefined) {
        console.error('[TabFlow] Cannot restore tabs — no window ID available');
        return;
      }

      console.log(`[TabFlow] Restoring ${tabs.length} tabs as suspended in window ${windowId}`);

      for (const tab of tabs) {
        try {
          const suspendedUrl = this.buildSuspendedUrl(tab);
          // NEVER restore workspace tabs as pinned. Only the TabFlow tab
          // should be pinned (at index 0). Restoring a pinned tab would
          // push the TabFlow tab out of position and corrupt pin state.
          const created = await chrome.tabs.create({
            url: suspendedUrl,
            active: false,
            pinned: false,
            windowId: windowId,
          });

          if (storageAdapter && created.id) {
            const newId = `chrome-${created.id}`;
            if (tab.id !== newId) {
              await storageAdapter.deleteTab(tab.id);
              await storageAdapter.saveTab({ ...tab, id: newId });
              console.log(`[TabFlow] Remapped tab ID: ${tab.id} → ${newId}`);
            }
          }
        } catch (error) {
          console.error(`[TabFlow] Error creating suspended tab for ${tab.url}:`, error);
        }
      }

      console.log(`[TabFlow] Successfully restored ${tabs.length} suspended tabs`);
    } catch (error) {
      console.error('[TabFlow] Error restoring workspace tabs:', error);
    }
  }

  /** Gets the currently active tab */
  async getActiveTab(): Promise<Tab | null> {
    try {
      const chromeTabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (chromeTabs.length === 0) return null;
      return this.chromeTabToTab(chromeTabs[0], '');
    } catch (error) {
      console.error('[TabFlow] Error getting active tab:', error);
      return null;
    }
  }

  // ─── Hidden Window Management ────────────────────────────────────
  // Instead of closing tabs and creating suspended ones, we move tabs
  // to minimized "hidden" windows. This preserves full tab state:
  // video playback position, scroll position, form data, etc.
  // The mapping is stored in chrome.storage.local so it survives both
  // service worker restarts AND extension reloads. On startup, stale
  // entries (windows that no longer exist) are cleaned up.

  /**
   * Gets the workspace → hidden windowId mapping
   */
  async getHiddenWindowMap(): Promise<Record<string, number>> {
    const result = await chrome.storage.local.get('hiddenWindows');
    return result.hiddenWindows || {};
  }

  /**
   * Stores the workspace → hidden windowId mapping
   */
  private async setHiddenWindowMap(map: Record<string, number>): Promise<void> {
    await chrome.storage.local.set({ hiddenWindows: map });
  }

  /**
   * Validates hidden window entries on startup.
   * Removes stale entries for windows that no longer exist (e.g. after
   * browser restart). This prevents the map from growing forever.
   */
  async cleanupStaleHiddenWindows(): Promise<void> {
    try {
      const map = await this.getHiddenWindowMap();
      const entries = Object.entries(map);
      if (entries.length === 0) return;

      // Get the main window ID so we can detect ID reuse after Chrome restart.
      // Chrome can reuse old window IDs — a hidden window ID from before restart
      // might now be the main window.
      const mainWindowId = await this.getMainWindowId();

      let changed = false;
      for (const [workspaceId, windowId] of entries) {
        // If the stored ID now matches the main window, it's stale (ID reuse)
        if (mainWindowId !== undefined && windowId === mainWindowId) {
          delete map[workspaceId];
          changed = true;
          console.log(`[TabFlow] Cleaned up stale hidden window entry for workspace ${workspaceId} (ID reused by main window)`);
          continue;
        }

        try {
          const tabs = await chrome.tabs.query({ windowId });
          // If the window has no tabs, it's dead — clean it up
          if (tabs.length === 0) {
            try { await chrome.windows.remove(windowId); } catch {}
            delete map[workspaceId];
            changed = true;
            console.log(`[TabFlow] Cleaned up empty hidden window for workspace ${workspaceId}`);
          }
        } catch {
          // Window doesn't exist anymore
          delete map[workspaceId];
          changed = true;
          console.log(`[TabFlow] Cleaned up stale hidden window entry for workspace ${workspaceId}`);
        }
      }

      if (changed) {
        await this.setHiddenWindowMap(map);
      }
      console.log(`[TabFlow] Hidden window cleanup done. Active hidden windows: ${Object.keys(map).length}`);
    } catch (error) {
      console.error('[TabFlow] Error cleaning up stale hidden windows:', error);
    }
  }

  /**
   * Gets the main window ID (the window containing the TabFlow pinned tab).
   *
   * Uses multiple strategies in case the TabFlow tab's URL isn't visible
   * yet (e.g., during startup or after tab moves):
   * 1. Search all tabs for the TabFlow extension URL
   * 2. Search for any pinned tab in position 0 (TabFlow is always pinned at index 0)
   * 3. Fall back to the last focused window
   */
  async getMainWindowId(): Promise<number | undefined> {
    try {
      const extBase = getExtensionBaseUrl();
      const suspendedPrefix = `${extBase}suspended.html`;
      const allTabs = await chrome.tabs.query({});

      // Strategy 1: Find by extension URL
      const tabFlowTab = allTabs.find(
        (t) =>
          t.url?.startsWith(extBase) &&
          !t.url?.startsWith(suspendedPrefix)
      );
      if (tabFlowTab?.windowId !== undefined) {
        return tabFlowTab.windowId;
      }

      // Strategy 2: Find a pinned tab at index 0 (TabFlow is always pinned first)
      const pinnedAtZero = allTabs.find(
        (t) => t.pinned && t.index === 0
      );
      if (pinnedAtZero?.windowId !== undefined) {
        console.log('[TabFlow] Found main window via pinned tab at index 0');
        return pinnedAtZero.windowId;
      }

      // Strategy 3: Fall back to the last focused window
      const lastFocused = await chrome.windows.getLastFocused();
      if (lastFocused?.id !== undefined) {
        console.log('[TabFlow] Found main window via last focused window');
        return lastFocused.id;
      }

      return undefined;
    } catch (error) {
      console.error('[TabFlow] Error finding main window:', error);
      return undefined;
    }
  }

  /**
   * Moves all non-TabFlow tabs from the main window to a hidden minimized window.
   * Stores the workspace→windowId mapping so we can bring them back later.
   * @returns true if tabs were moved (or no tabs to move)
   */
  async moveTabsToHiddenWindow(workspaceId: string): Promise<boolean> {
    try {
      const mainWindowId = await this.getMainWindowId();
      if (mainWindowId === undefined) {
        console.warn('[TabFlow] Could not find main window');
        return false;
      }

      const allTabs = await chrome.tabs.query({ windowId: mainWindowId });
      const movableTabs = allTabs.filter((t) => !this.isTabFlowTab(t));

      if (movableTabs.length === 0) {
        console.log('[TabFlow] No tabs to hide for workspace', workspaceId);
        return true;
      }

      // CRITICAL SAFETY: Never move ALL tabs out of the main window.
      // If isTabFlowTab failed to detect the TabFlow tab, moving everything
      // would leave the window empty and Chrome would close entirely.
      if (movableTabs.length === allTabs.length) {
        console.warn('[TabFlow] SAFETY: All tabs marked as movable — TabFlow tab not detected. Keeping pinned tab at index 0.');
        // Find the pinned tab at index 0 (should be TabFlow) and exclude it
        const pinnedAtZero = allTabs.find((t) => t.pinned && t.index === 0);
        if (pinnedAtZero) {
          const safeMovableTabs = movableTabs.filter((t) => t.id !== pinnedAtZero.id);
          if (safeMovableTabs.length === 0) {
            console.log('[TabFlow] No tabs to hide after safety filter');
            return true;
          }
          // Use the filtered list instead
          const tabIds = safeMovableTabs.map((t) => t.id!).filter((id) => id !== undefined);

          const hiddenWindow = await chrome.windows.create({
            state: 'minimized',
            url: 'about:blank',
          });
          if (!hiddenWindow?.id) {
            console.error('[TabFlow] Failed to create hidden window');
            return false;
          }

          await chrome.tabs.move(tabIds, { windowId: hiddenWindow.id, index: -1 });

          const hiddenTabs = await chrome.tabs.query({ windowId: hiddenWindow.id });
          const blankTab = hiddenTabs.find(
            (t) => t.url === 'about:blank' && !tabIds.includes(t.id!)
          );
          if (blankTab?.id) {
            await chrome.tabs.remove(blankTab.id);
          }

          const map = await this.getHiddenWindowMap();
          map[workspaceId] = hiddenWindow.id;
          await this.setHiddenWindowMap(map);

          console.log(
            `[TabFlow] SAFETY: Moved ${tabIds.length} tabs (kept pinned tab) to hidden window ${hiddenWindow.id}`
          );

          // Hide the hidden window from the taskbar via native host.
          // First ensure the main window is focused so hideMinimized
          // only catches the hidden workspace window, never the main one.
          await this.safeHideMinimizedWindows(mainWindowId);

          return true;
        }

        // No pinned tab found either — abort to prevent Chrome from closing
        console.error('[TabFlow] SAFETY: Cannot find any TabFlow tab — aborting move to prevent Chrome closure');
        return false;
      }

      // Create a minimized window (needs at least one URL)
      const hiddenWindow = await chrome.windows.create({
        state: 'minimized',
        url: 'about:blank',
      });

      if (!hiddenWindow?.id) {
        console.error('[TabFlow] Failed to create hidden window');
        return false;
      }

      // Move workspace tabs to the hidden window
      const tabIds = movableTabs.map((t) => t.id!).filter((id) => id !== undefined);
      await chrome.tabs.move(tabIds, { windowId: hiddenWindow.id, index: -1 });

      // Close the about:blank placeholder tab
      const hiddenTabs = await chrome.tabs.query({ windowId: hiddenWindow.id });
      const blankTab = hiddenTabs.find(
        (t) => t.url === 'about:blank' && !tabIds.includes(t.id!)
      );
      if (blankTab?.id) {
        await chrome.tabs.remove(blankTab.id);
      }

      // Store the mapping
      const map = await this.getHiddenWindowMap();
      map[workspaceId] = hiddenWindow.id;
      await this.setHiddenWindowMap(map);

      console.log(
        `[TabFlow] Moved ${tabIds.length} tabs to hidden window ${hiddenWindow.id} for workspace ${workspaceId}`
      );

      // Hide the hidden window from the taskbar via native host.
      // First ensure the main window is focused so hideMinimized
      // only catches the hidden workspace window, never the main one.
      await this.safeHideMinimizedWindows(mainWindowId);

      return true;
    } catch (error) {
      console.error('[TabFlow] Error moving tabs to hidden window:', error);
      return false;
    }
  }

  /**
   * Restores tabs from a hidden window back to the main window.
   * Preserves full tab state (video position, scroll, forms, etc.)
   * @returns true if tabs were restored from a hidden window
   */
  async restoreTabsFromHiddenWindow(workspaceId: string): Promise<boolean> {
    try {
      const map = await this.getHiddenWindowMap();
      const hiddenWindowId = map[workspaceId];

      if (!hiddenWindowId) return false;

      // Verify the hidden window still exists
      let hiddenTabs: chrome.tabs.Tab[];
      try {
        hiddenTabs = await chrome.tabs.query({ windowId: hiddenWindowId });
      } catch {
        // Window was closed or doesn't exist
        delete map[workspaceId];
        await this.setHiddenWindowMap(map);
        return false;
      }

      if (hiddenTabs.length === 0) {
        // Window exists but has no tabs — clean up
        try { await chrome.windows.remove(hiddenWindowId); } catch {}
        delete map[workspaceId];
        await this.setHiddenWindowMap(map);
        return false;
      }

      const mainWindowId = await this.getMainWindowId();
      if (mainWindowId === undefined) {
        console.warn('[TabFlow] Could not find main window for restore');
        return false;
      }

      // SAFETY: Never restore from a window that IS the main window
      if (hiddenWindowId === mainWindowId) {
        console.error('[TabFlow] SAFETY: Hidden window ID matches main window ID — aborting restore');
        delete map[workspaceId];
        await this.setHiddenWindowMap(map);
        return false;
      }

      // Move all tabs back to the main window
      const tabIds = hiddenTabs.map((t) => t.id!).filter((id) => id !== undefined);
      await chrome.tabs.move(tabIds, { windowId: mainWindowId, index: -1 });

      // Close the now-empty hidden window (verify it's not the main window)
      try {
        if (hiddenWindowId !== mainWindowId) {
          await chrome.windows.remove(hiddenWindowId);
        }
      } catch {
        // May have auto-closed
      }

      // Clean up mapping
      delete map[workspaceId];
      await this.setHiddenWindowMap(map);

      console.log(
        `[TabFlow] Restored ${tabIds.length} tabs from hidden window for workspace ${workspaceId}`
      );
      return true;
    } catch (error) {
      console.error('[TabFlow] Error restoring tabs from hidden window:', error);
      return false;
    }
  }

  /**
   * Safely hides minimized Chrome windows from the taskbar.
   * FIRST ensures the main window is focused/restored so it can never
   * accidentally be hidden. Then calls the native host to hide only
   * truly minimized windows (the hidden workspace windows).
   * AFTER hiding, explicitly restores the main window's taskbar presence
   * to undo any accidental hiding caused by race conditions.
   *
   * Uses fire-and-forget with a delay so it can't block workspace switches.
   */
  private async safeHideMinimizedWindows(mainWindowId: number): Promise<void> {
    if (!this.nativeHostAvailable) return;

    // Ensure the main window is focused/normal — NOT minimized.
    // This guarantees hideMinimized won't touch it.
    try {
      await chrome.windows.update(mainWindowId, { focused: true });
    } catch (e) {
      console.warn('[TabFlow] Could not focus main window before hiding:', e);
      return; // Don't hide if we can't guarantee the main window is safe
    }

    // Small delay to let Windows register the focus change
    setTimeout(async () => {
      try {
        // Double-check the main window state before hiding
        const mainWindow = await chrome.windows.get(mainWindowId);
        if (mainWindow.state === 'minimized') {
          console.warn('[TabFlow] Main window is still minimized — skipping hideMinimized');
          return;
        }
        const count = await this.nativeHost.hideMinimized();
        console.log(`[TabFlow] hideMinimized result: ${count} windows hidden`);

        // SAFETY NET: After hiding minimized windows, explicitly restore
        // the main window's taskbar presence. This undoes any accidental
        // hiding if the main window was briefly minimized during the operation.
        // We find the main window's active tab title and call showWindow.
        try {
          const mainTabs = await chrome.tabs.query({ windowId: mainWindowId, active: true });
          if (mainTabs.length > 0 && mainTabs[0].title) {
            await this.nativeHost.showWindow(mainTabs[0].title);
            console.log(`[TabFlow] Ensured main window is visible in taskbar`);
          }
        } catch (showErr) {
          console.warn('[TabFlow] Could not ensure main window visibility:', showErr);
        }
      } catch (e) {
        console.warn('[TabFlow] Could not hide windows from taskbar:', e);
      }
    }, 300);
  }

  /**
   * Cleans up the hidden window for a deleted workspace
   */
  async cleanupHiddenWindow(workspaceId: string): Promise<void> {
    try {
      const map = await this.getHiddenWindowMap();
      const hiddenWindowId = map[workspaceId];
      if (hiddenWindowId) {
        try {
          await chrome.windows.remove(hiddenWindowId);
        } catch {
          // Window may already be gone
        }
        delete map[workspaceId];
        await this.setHiddenWindowMap(map);
        console.log(`[TabFlow] Cleaned up hidden window for deleted workspace ${workspaceId}`);
      }
    } catch (error) {
      console.error('[TabFlow] Error cleaning up hidden window:', error);
    }
  }
}
