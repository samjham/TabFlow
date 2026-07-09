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
import { isFirefox, isUrlOpenable, crossBrowserOnlyLabel } from '../browser-compat';
import { NativeHostClient } from './NativeHostClient';
import { getExtensionBaseUrl } from '../browser-compat';
import { canonicalizeUrl, computeTabId } from '../utils/tabId';
import { logDiagnostic } from './DiagnosticLog';

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

  /**
   * Maps Chrome's numeric tab ID -> deterministic storage ID (tab-<16hex>)
   * for tabs in the active workspace. Refreshed as a byproduct of
   * `saveCurrentTabsToWorkspace`. Used by thumbnail capture and bulk
   * backfill so we don't have to redo position-among-same-URL matching
   * at capture time (which silently failed when multiple tabs shared a
   * URL). 0.1.31
   */
  private chromeTabToStorageId: Map<number, string> = new Map();

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
   * Ensures the main browser window is visible to the user.
   */
  async ensureMainWindowVisible(): Promise<void> {
    try {
      const mainWindowId = await this.getMainWindowId();
      if (mainWindowId === undefined) return;

      try {
        const win = await chrome.windows.get(mainWindowId);
        if (win.state === 'minimized') {
          await chrome.windows.update(mainWindowId, { state: 'normal' });
          console.log('[TabFlow] Unminimized main window');
        }
      } catch {
        // Non-fatal
      }

      if (this.nativeHostAvailable) {
        const mainTabs = await chrome.tabs.query({ windowId: mainWindowId, active: true });
        if (mainTabs.length > 0 && mainTabs[0].title) {
          await this.nativeHost.showWindow(mainTabs[0].title);
          console.log('[TabFlow] Ensured main window is visible in taskbar');
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * After extension reload, re-hide minimized hidden-workspace windows.
   */
  async rehideInactiveWorkspaceWindows(): Promise<void> {
    if (!this.nativeHostAvailable) return;
    try {
      const count = await this.nativeHost.hideMinimized(isFirefox ? 'firefox' : 'chrome');
      if (count > 0) {
        console.log(`[TabFlow] Rehid ${count} hidden workspace window(s) after reload`);
      }
    } catch (e) {
      console.warn('[TabFlow] Failed to re-hide windows after reload:', e);
    }
  }

  setTabFlowTabId(tabId: number): void {
    this.cachedTabFlowTabId = tabId;
    console.log(`[TabFlow] TabManager cached TabFlow tab ID updated: ${tabId}`);
  }

  getTabFlowTabId(): number | undefined {
    return this.cachedTabFlowTabId;
  }

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

  isTrackableUrl(url: string): boolean {
    if (!url) return false;
    if (this.isSuspendedUrl(url)) return true;
    if (url.startsWith(getExtensionBaseUrl())) return false;
    for (const prefix of EXCLUDED_URL_PREFIXES) {
      if (url.startsWith(prefix)) return false;
    }
    return true;
  }

  isSuspendedUrl(url: string): boolean {
    return url.startsWith(`${getExtensionBaseUrl()}suspended.html`);
  }

  getRealUrl(url: string): string {
    if (!this.isSuspendedUrl(url)) return url;
    try {
      const params = new URL(url).searchParams;
      return params.get('url') || url;
    } catch {
      return url;
    }
  }

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

  async getCurrentTabs(): Promise<Tab[]> {
    return this.getCurrentWindowTabs();
  }

  async saveCurrentTabsToWorkspace(
    workspaceId: string,
    storage: any,
    windowId?: number,
  ): Promise<{ deletedTabIds: string[] }> {
    try {
      console.log(`[TabFlow] Saving current tabs to workspace ${workspaceId} (window: ${windowId ?? 'current'})`);

      const currentTabs = await this.getCurrentWindowTabs(windowId);

      // 0.1.31: Pull matching chrome tab IDs in same order/filter so we can
      // build a chromeTabId -> storageId cache for thumbnail capture.
      let currentChromeTabIds: (number | undefined)[] = [];
      try {
        const query = windowId !== undefined
          ? { windowId }
          : { currentWindow: true as const };
        const rawChromeTabs = await chrome.tabs.query(query);
        const filtered = rawChromeTabs.filter((t) => this.isTrackableUrl(t.url || ''));
        currentChromeTabIds = filtered.map((t) => t.id);
      } catch {
        currentChromeTabIds = [];
      }

      if (currentTabs.length === 0) {
        console.log(`[TabFlow] No trackable tabs found — keeping existing records for workspace ${workspaceId}`);
        return { deletedTabIds: [] };
      }

      if (currentTabs.length > TabManager.MAX_RESTORE_TABS) {
        console.warn(`[TabFlow] SAFETY CAP: ${currentTabs.length} tabs in window, only saving first ${TabManager.MAX_RESTORE_TABS}`);
        currentTabs.splice(TabManager.MAX_RESTORE_TABS);
        if (currentChromeTabIds.length > TabManager.MAX_RESTORE_TABS) {
          currentChromeTabIds.splice(TabManager.MAX_RESTORE_TABS);
        }
      }

      // Fresh cache for this workspace.
      const newChromeTabToStorageId = new Map<number, string>();

      const existingTabs: Tab[] = await storage.getTabs(workspaceId);

      const matchableByUrl = new Map<string, Tab[]>();
      for (const t of existingTabs) {
        const key = canonicalizeUrl(t.url);
        const list = matchableByUrl.get(key) ?? [];
        list.push(t);
        matchableByUrl.set(key, list);
      }
      for (const list of matchableByUrl.values()) {
        list.sort((a, b) => {
          const aT = (a.createdAt ?? a.updatedAt) as Date;
          const bT = (b.createdAt ?? b.updatedAt) as Date;
          return new Date(aT).getTime() - new Date(bT).getTime();
        });
      }

      const now = new Date();
      const recordsToSave: Tab[] = [];

      const reuseIds = new Set<string>();
      const rewriteIds = new Set<string>();
      let reused = 0;
      let minted = 0;
      let rewritten = 0;

      for (let i = 0; i < currentTabs.length; i++) {
        const live = currentTabs[i];
        const chromeTabId = currentChromeTabIds[i];
        const key = canonicalizeUrl(live.url);
        const bucket = matchableByUrl.get(key);
        const match = bucket && bucket.length > 0 ? bucket.shift()! : undefined;

        const isLegacyId = (id: string) =>
          id.startsWith('chrome-') ||
          id.startsWith('restart-') ||
          id.startsWith('moved-') ||
          id.startsWith('dup-');

        let resolvedId: string;

        if (match && !isLegacyId(match.id)) {
          reuseIds.add(match.id);
          recordsToSave.push({
            ...match,
            workspaceId,
            title: live.title,
            faviconUrl: live.faviconUrl ?? match.faviconUrl,
            isPinned: live.isPinned,
            sortOrder: i,
            lastAccessed: now,
            updatedAt: now,
            scrollX: match.scrollX,
            scrollY: match.scrollY,
          });
          reused++;
          resolvedId = match.id;
        } else if (match) {
          const createdAt = (match.createdAt ?? match.updatedAt) as Date;
          const id = await computeTabId(workspaceId, live.url, new Date(createdAt));
          rewriteIds.add(match.id);
          recordsToSave.push({
            id,
            workspaceId,
            url: live.url,
            title: live.title,
            faviconUrl: live.faviconUrl ?? match.faviconUrl,
            sortOrder: i,
            isPinned: live.isPinned,
            lastAccessed: now,
            updatedAt: now,
            createdAt: new Date(createdAt),
            scrollX: match.scrollX,
            scrollY: match.scrollY,
          });
          rewritten++;
          resolvedId = id;
        } else {
          const createdAt = now;
          const id = await computeTabId(workspaceId, live.url, createdAt);
          recordsToSave.push({
            id,
            workspaceId,
            url: live.url,
            title: live.title,
            faviconUrl: live.faviconUrl,
            sortOrder: i,
            isPinned: live.isPinned,
            lastAccessed: now,
            updatedAt: now,
            createdAt,
          });
          minted++;
          resolvedId = id;
        }

        if (chromeTabId !== undefined) {
          newChromeTabToStorageId.set(chromeTabId, resolvedId);
        }
      }

      let deleted = 0;
      let preservedPending = 0;
      let preservedInert = 0;
      const deletedTabIds: string[] = [];
      for (const t of existingTabs) {
        if (reuseIds.has(t.id)) continue;
        if (rewriteIds.has(t.id)) {
          await storage.deleteTab(t.id);
          deletedTabIds.push(t.id);
          deleted++;
          continue;
        }
        if (crossBrowserOnlyLabel(t.url) !== null) {
          preservedInert++;
          continue;
        }
        if (!isUrlOpenable(t.url)) {
          preservedInert++;
          continue;
        }
        if (t.id.startsWith('moved-') || t.id.startsWith('dup-')) {
          // 0.1.50: don't preserve moved-*/dup-* placeholders that have
          // no matching live tab. These are stale in-flight IDs that
          // outlived their operation (Sam's 0.1.49 diagnostic showed
          // moved-17 lingering across multiple workspaces). Delete the
          // orphan; a subsequent snapshot with the URL live will mint
          // a proper deterministic tab-<hash> ID.
          await storage.deleteTab(t.id);
          deletedTabIds.push(t.id);
          deleted++;
          try {
            await logDiagnostic('cleanup', 'deleted orphan placeholder tab', {
              oldId: t.id,
              workspaceId: workspaceId?.slice(0, 8),
              url: (t.url ?? '').slice(0, 60),
            });
          } catch {}
          continue;
        }
        await storage.deleteTab(t.id);
        deletedTabIds.push(t.id);
        deleted++;
      }

      for (const t of recordsToSave) {
        await storage.saveTab(t);
      }

      console.log(
        `[TabFlow] Saved ${recordsToSave.length} tabs to workspace ${workspaceId} ` +
        `(reused ${reused}, rewritten ${rewritten}, minted ${minted}, ` +
        `deleted ${deleted}, preserved ${preservedPending} pending, ` +
        `preserved ${preservedInert} cross-browser)`
      );

      // 0.1.31: Replace the cache wholesale with the freshly-built mapping.
      this.chromeTabToStorageId = newChromeTabToStorageId;

      return { deletedTabIds };
    } catch (error) {
      console.error('[TabFlow] Error saving tabs to workspace:', error);
      return { deletedTabIds: [] };
    }
  }

  /**
   * 0.1.50: sweep the given workspace's DB records for stale placeholder
   * IDs (`moved-<n>` / `dup-<n>`) and regenerate them into proper
   * deterministic `tab-<16hex>` IDs.
   *
   * These placeholders come from in-flight move / duplicate operations
   * that never got renamed. Sam's 0.1.49 diagnostic showed `moved-17`
   * appearing in multiple workspaces' pushes — meaning the placeholder
   * outlived the operation. Called from startup reconcile so any
   * accumulated placeholders are cleaned up on browser start.
   *
   * If a placeholder's URL matches another record already at a proper
   * `tab-<hash>` ID, we DELETE the placeholder (dedupe) rather than
   * create a second row for the same URL.
   */
  async sweepStalePlaceholderIds(
    workspaceId: string,
    storage: any,
  ): Promise<{ renamed: number; deduped: number }> {
    let renamed = 0;
    let deduped = 0;
    try {
      const records: Tab[] = await storage.getTabs(workspaceId);
      const stale = records.filter((t) =>
        /^moved-\d+$/.test(t.id) || /^dup-\d+$/.test(t.id)
      );
      if (stale.length === 0) return { renamed, deduped };

      // Build a canonical-URL → proper-record lookup for dedupe
      const properByUrl = new Map<string, Tab>();
      for (const t of records) {
        if (/^tab-[0-9a-f]{16}$/.test(t.id)) {
          properByUrl.set(canonicalizeUrl(t.url ?? ''), t);
        }
      }

      for (const bad of stale) {
        const canon = canonicalizeUrl(bad.url ?? '');
        const existingProper = properByUrl.get(canon);
        if (existingProper) {
          // Dedupe: proper record already exists for this URL
          try {
            await storage.deleteTab(bad.id);
            deduped++;
            try {
              await logDiagnostic('cleanup', 'deduped stale moved-* tab', {
                oldId: bad.id,
                keepId: existingProper.id?.slice(0, 12),
                workspaceId: workspaceId?.slice(0, 8),
              });
            } catch {}
          } catch (err) {
            console.warn('[TabFlow] sweepStalePlaceholderIds: dedupe failed', err);
          }
          continue;
        }
        // Regenerate: create new record with deterministic ID
        try {
          const createdAt = (bad.createdAt ?? bad.updatedAt ?? new Date()) as Date;
          const newId = await computeTabId(workspaceId, bad.url ?? '', new Date(createdAt));
          await storage.saveTab({ ...bad, id: newId });
          await storage.deleteTab(bad.id);
          properByUrl.set(canon, { ...bad, id: newId });
          renamed++;
          try {
            await logDiagnostic('cleanup', 'renamed moved-* tab', {
              oldId: bad.id,
              newId: newId?.slice(0, 12),
              workspaceId: workspaceId?.slice(0, 8),
            });
          } catch {}
        } catch (err) {
          console.warn('[TabFlow] sweepStalePlaceholderIds: rename failed', err);
        }
      }
    } catch (err) {
      console.warn('[TabFlow] sweepStalePlaceholderIds: outer failure', err);
    }
    return { renamed, deduped };
  }

  /**
   * Look up the deterministic storage ID for a given Chrome tab ID in
   * the active workspace. Returns null if no mapping is known.
   */
  getStorageIdForTab(chromeTabId: number): string | null {
    return this.chromeTabToStorageId.get(chromeTabId) ?? null;
  }

  /**
   * Reverse lookup: storage ID -> Chrome tab ID. Used by thumbnail backfill.
   */
  getChromeTabIdForStorageId(storageId: string): number | null {
    for (const [chromeId, sid] of this.chromeTabToStorageId.entries()) {
      if (sid === storageId) return chromeId;
    }
    return null;
  }

  isTabFlowTab(tab: chrome.tabs.Tab): boolean {
    if (this.cachedTabFlowTabId !== undefined && tab.id === this.cachedTabFlowTabId) {
      return true;
    }

    const url = tab.url || '';

    if (url && !this.isSuspendedUrl(url)) {
      if (url.startsWith(getExtensionBaseUrl())) return true;
    }

    const pendingUrl = (tab as any).pendingUrl || '';
    if (pendingUrl && pendingUrl.startsWith(getExtensionBaseUrl())) {
      return true;
    }

    if (tab.pinned && tab.index === 0) {
      return true;
    }

    return false;
  }

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

      if (closeableTabs.length === chromeTabs.length) {
        console.log('[TabFlow] Creating safety blank tab before closing all tabs to prevent window closure');
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

  private buildSuspendedUrl(tab: Tab): string {
    const params = new URLSearchParams();
    params.set('url', tab.url);
    params.set('title', tab.title || 'Untitled');
    if (tab.faviconUrl) {
      params.set('favicon', tab.faviconUrl);
    }
    return `${getExtensionBaseUrl()}suspended.html?${params.toString()}`;
  }

  static readonly MAX_RESTORE_TABS = 30;

  async restoreWorkspaceTabs(tabs: Tab[], storageAdapter?: any, targetWindowId?: number): Promise<void> {
    try {
      if (tabs.length === 0) {
        console.log('[TabFlow] No tabs to restore, TabFlow tab will remain open');
        return;
      }

      if (tabs.length > TabManager.MAX_RESTORE_TABS) {
        console.warn(`[TabFlow] SAFETY CAP: workspace has ${tabs.length} tabs, only restoring first ${TabManager.MAX_RESTORE_TABS}`);
        tabs = tabs.slice(0, TabManager.MAX_RESTORE_TABS);
      }

      let windowId = targetWindowId;
      if (windowId === undefined) {
        windowId = await this.getMainWindowId();
      }
      if (windowId === undefined) {
        console.error('[TabFlow] Cannot restore tabs — no window ID available');
        return;
      }

      console.log(`[TabFlow] Restoring ${tabs.length} tabs as suspended in window ${windowId}`);

      let skippedPrivileged = 0;
      for (const tab of tabs) {
        if (crossBrowserOnlyLabel(tab.url) !== null) {
          skippedPrivileged++;
          continue;
        }
        try {
          const suspendedUrl = this.buildSuspendedUrl(tab);
          const created = await chrome.tabs.create({
            url: suspendedUrl,
            active: false,
            pinned: false,
            windowId: windowId,
          });
          void created;
          void storageAdapter;
        } catch (error) {
          console.error(`[TabFlow] Error creating suspended tab for ${tab.url}:`, error);
        }
      }

      console.log(`[TabFlow] Successfully restored ${tabs.length - skippedPrivileged} suspended tabs${skippedPrivileged > 0 ? ` (${skippedPrivileged} privileged-URL tiles skipped)` : ''}`);
    } catch (error) {
      console.error('[TabFlow] Error restoring workspace tabs:', error);
    }
  }

  async dedupeTabsInWindow(windowId: number): Promise<number> {
    try {
      const tabs = await chrome.tabs.query({ windowId });
      const groups = new Map<string, chrome.tabs.Tab[]>();
      for (const t of tabs) {
        if (!t.id || !t.url) continue;
        if (this.isTabFlowTab(t)) continue;
        const realUrl = this.getRealUrl(t.url);
        const key = canonicalizeUrl(realUrl);
        const list = groups.get(key) ?? [];
        list.push(t);
        groups.set(key, list);
      }

      let closed = 0;
      for (const [, list] of groups) {
        if (list.length <= 1) continue;
        list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const toClose = list.slice(1).map((t) => t.id!).filter((id) => id !== undefined);
        if (toClose.length > 0) {
          try {
            await chrome.tabs.remove(toClose);
            closed += toClose.length;
          } catch (e) {
            console.warn('[TabFlow] dedupeTabsInWindow: failed to close a duplicate:', e);
          }
        }
      }
      return closed;
    } catch (err) {
      console.error('[TabFlow] dedupeTabsInWindow failed:', err);
      return 0;
    }
  }

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

  async getHiddenWindowMap(): Promise<Record<string, number>> {
    const result = await chrome.storage.local.get('hiddenWindows');
    return result.hiddenWindows || {};
  }

  async getWorkspaceForHiddenWindow(windowId: number): Promise<string | null> {
    const map = await this.getHiddenWindowMap();
    for (const [workspaceId, hiddenWindowId] of Object.entries(map)) {
      if (hiddenWindowId === windowId) return workspaceId;
    }
    return null;
  }

  private async setHiddenWindowMap(map: Record<string, number>): Promise<void> {
    await chrome.storage.local.set({ hiddenWindows: map });
  }

  async cleanupStaleHiddenWindows(): Promise<void> {
    try {
      const map = await this.getHiddenWindowMap();
      const entries = Object.entries(map);
      if (entries.length === 0) return;

      const mainWindowId = await this.getMainWindowId();

      let changed = false;
      for (const [workspaceId, windowId] of entries) {
        if (mainWindowId !== undefined && windowId === mainWindowId) {
          delete map[workspaceId];
          changed = true;
          console.log(`[TabFlow] Cleaned up stale hidden window entry for workspace ${workspaceId} (ID reused by main window)`);
          continue;
        }

        try {
          const tabs = await chrome.tabs.query({ windowId });
          if (tabs.length === 0) {
            try { await chrome.windows.remove(windowId); } catch {}
            delete map[workspaceId];
            changed = true;
            console.log(`[TabFlow] Cleaned up empty hidden window for workspace ${workspaceId}`);
          }
        } catch {
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

  async getMainWindowId(): Promise<number | undefined> {
    try {
      const extBase = getExtensionBaseUrl();
      const suspendedPrefix = `${extBase}suspended.html`;
      const allTabs = await chrome.tabs.query({});

      const tabFlowTab = allTabs.find(
        (t) =>
          t.url?.startsWith(extBase) &&
          !t.url?.startsWith(suspendedPrefix)
      );
      if (tabFlowTab?.windowId !== undefined) {
        return tabFlowTab.windowId;
      }

      const pinnedAtZero = allTabs.find(
        (t) => t.pinned && t.index === 0
      );
      if (pinnedAtZero?.windowId !== undefined) {
        console.log('[TabFlow] Found main window via pinned tab at index 0');
        return pinnedAtZero.windowId;
      }

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

  async buildMainWindowUrlIndex(): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    const windowId = await this.getMainWindowId();
    if (windowId === undefined) return map;
    const tabs = await chrome.tabs.query({ windowId });
    const suspendedPrefix = `${getExtensionBaseUrl()}suspended.html`;
    for (const t of tabs) {
      if (!t.id || !t.url) continue;
      if (t.id === this.cachedTabFlowTabId) continue;
      let realUrl = t.url;
      if (t.url.startsWith(suspendedPrefix)) {
        try {
          realUrl = new URL(t.url).searchParams.get('url') || t.url;
        } catch { /* ignore */ }
      }
      const key = canonicalizeUrl(realUrl);
      const arr = map.get(key);
      if (arr) arr.push(t.id);
      else map.set(key, [t.id]);
    }
    return map;
  }

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

      if (movableTabs.length === allTabs.length) {
        console.warn('[TabFlow] SAFETY: All tabs marked as movable — TabFlow tab not detected. Keeping pinned tab at index 0.');
        const pinnedAtZero = allTabs.find((t) => t.pinned && t.index === 0);
        if (pinnedAtZero) {
          const safeMovableTabs = movableTabs.filter((t) => t.id !== pinnedAtZero.id);
          if (safeMovableTabs.length === 0) {
            console.log('[TabFlow] No tabs to hide after safety filter');
            return true;
          }
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

          await this.safeHideMinimizedWindows(mainWindowId);

          return true;
        }

        console.error('[TabFlow] SAFETY: Cannot find any TabFlow tab — aborting move to prevent Chrome closure');
        return false;
      }

      const hiddenWindow = await chrome.windows.create({
        state: 'minimized',
        url: 'about:blank',
      });

      if (!hiddenWindow?.id) {
        console.error('[TabFlow] Failed to create hidden window');
        return false;
      }

      const tabIds = movableTabs.map((t) => t.id!).filter((id) => id !== undefined);
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
        `[TabFlow] Moved ${tabIds.length} tabs to hidden window ${hiddenWindow.id} for workspace ${workspaceId}`
      );

      await this.safeHideMinimizedWindows(mainWindowId);

      return true;
    } catch (error) {
      console.error('[TabFlow] Error moving tabs to hidden window:', error);
      return false;
    }
  }

  async restoreTabsFromHiddenWindow(workspaceId: string): Promise<boolean> {
    try {
      const map = await this.getHiddenWindowMap();
      const hiddenWindowId = map[workspaceId];

      if (!hiddenWindowId) return false;

      let hiddenTabs: chrome.tabs.Tab[];
      try {
        hiddenTabs = await chrome.tabs.query({ windowId: hiddenWindowId });
      } catch {
        delete map[workspaceId];
        await this.setHiddenWindowMap(map);
        return false;
      }

      if (hiddenTabs.length === 0) {
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

      if (hiddenWindowId === mainWindowId) {
        console.error('[TabFlow] SAFETY: Hidden window ID matches main window ID — aborting restore');
        delete map[workspaceId];
        await this.setHiddenWindowMap(map);
        return false;
      }

      const tabIds = hiddenTabs.map((t) => t.id!).filter((id) => id !== undefined);
      await chrome.tabs.move(tabIds, { windowId: mainWindowId, index: -1 });

      try {
        if (hiddenWindowId !== mainWindowId) {
          await chrome.windows.remove(hiddenWindowId);
        }
      } catch {
        // May have auto-closed
      }

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

  private async safeHideMinimizedWindows(mainWindowId: number): Promise<void> {
    if (!this.nativeHostAvailable) return;

    try {
      await chrome.windows.update(mainWindowId, { focused: true });
    } catch (e) {
      console.warn('[TabFlow] Could not focus main window before hiding:', e);
      return;
    }

    setTimeout(async () => {
      try {
        const mainWindow = await chrome.windows.get(mainWindowId);
        if (mainWindow.state === 'minimized') {
          console.warn('[TabFlow] Main window is still minimized — skipping hideMinimized');
          return;
        }
        const count = await this.nativeHost.hideMinimized(isFirefox ? 'firefox' : 'chrome');
        console.log(`[TabFlow] hideMinimized result: ${count} windows hidden`);

        try {
          const mainWindow = await chrome.windows.get(mainWindowId);
          if (mainWindow.state === 'minimized') {
            await chrome.windows.update(mainWindowId, { state: 'normal' });
            console.log('[TabFlow] Safety net: unminimized main window after hideMinimized');
          }
          const mainTabs = await chrome.tabs.query({ windowId: mainWindowId, active: true });
          if (mainTabs.length > 0 && mainTabs[0].title) {
            await this.nativeHost.showWindow(mainTabs[0].title);
            console.log('[TabFlow] Ensured main window is visible in taskbar');
          }
        } catch (showErr) {
          console.warn('[TabFlow] Could not ensure main window visibility:', showErr);
        }
      } catch (e) {
        console.warn('[TabFlow] Could not hide windows from taskbar:', e);
      }
    }, 300);
  }

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
